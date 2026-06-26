import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTVerifyGetKey } from 'jose';

import type { Env } from '../config/env.ts';
import type { AppEnv } from '../context.ts';
import type { Principal, SecondFactor, SupabaseJwtPayload } from './principal.ts';
import { isRole, type Role } from './roles.ts';

export interface RequireAuthOptions {
  roles?: Role[];
  stepUpMaxAgeSec?: number;
}

/**
 * Memoized JWKS resolvers, one per project (keyed by the JWKS URL). Supabase
 * now signs access tokens with ASYMMETRIC JWT signing keys (ES256, published at
 * `/auth/v1/.well-known/jwks.json`) by default — the legacy symmetric HS256 JWT
 * secret only signs tokens on older projects and the local CLI stack. `jose`'s
 * createRemoteJWKSet fetches + caches the public keys and resolves the right one
 * by `kid` (handling rotation), so it MUST be built once and reused across
 * requests, never per-request.
 */
const jwksByUrl = new Map<string, JWTVerifyGetKey>();

function jwksFor(supabaseUrl: string): JWTVerifyGetKey {
  const url = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`;
  let jwks = jwksByUrl.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksByUrl.set(url, jwks);
  }
  return jwks;
}

/**
 * Verify a Supabase access token, dispatching on its own `alg` header so both
 * signing schemes work: prod ES256/RS256 against the project JWKS, and the
 * local/test HS256 secret against `env.JWT_SECRET`. The audience is pinned to
 * `authenticated` (GoTrue's user audience) in both branches. Throws on any
 * malformed/forged/expired token; the caller maps that to a 401.
 */
async function verifyAccessToken(token: string, env: Env): Promise<SupabaseJwtPayload> {
  const { alg } = decodeProtectedHeader(token);
  if (alg === 'HS256') {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET), {
      algorithms: ['HS256'],
      audience: 'authenticated',
    });
    return payload as SupabaseJwtPayload;
  }
  const { payload } = await jwtVerify(token, jwksFor(env.SUPABASE_URL), {
    algorithms: ['ES256', 'RS256'],
    audience: 'authenticated',
  });
  return payload as SupabaseJwtPayload;
}

/**
 * Port of the Fastify `requireAuth` (apps/backend/src/plugins/auth.ts) to a
 * Hono middleware factory (ADR-0019 § Decision 1 — one auth chain on the fat
 * function). Verifies the Supabase access token (asymmetric ES256 via the
 * project JWKS, or legacy/local HS256 via the shared secret — see
 * verifyAccessToken), attaches the Principal to the context, and enforces
 * role + optional step-up-MFA gates.
 * Reads collaborators from `c.var.deps` (set by the root middleware in
 * `buildApp`), so it needs no closure state.
 */
export function requireAuth(opts: RequireAuthOptions = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { env, db } = c.var.deps;

    const token = extractBearer(c.req.header('authorization'));
    if (!token) {
      return c.json({ error: 'missing_bearer_token' }, 401);
    }

    let payload: SupabaseJwtPayload;
    try {
      payload = await verifyAccessToken(token, env);
    } catch {
      return c.json({ error: 'invalid_token' }, 401);
    }

    const principal = principalFromPayload(payload);
    c.set('principal', principal);

    // Admin TOTP is mandatory server-side on every request, not just at
    // sign-in (CONTEXT § MFA posture; PRD § Admin). An admin token that is not
    // aal2+TOTP cannot act as admin anywhere.
    if (principal.role === 'admin' && principal.secondFactor !== 'totp') {
      return c.json({ error: 'admin_totp_required' }, 403);
    }

    if (opts.roles && opts.roles.length > 0) {
      if (!principal.role || !opts.roles.includes(principal.role)) {
        return c.json({ error: 'forbidden_role' }, 403);
      }
    }

    if (opts.stepUpMaxAgeSec !== undefined) {
      const now = new Date();
      const cutoff = new Date(now.getTime() - opts.stepUpMaxAgeSec * 1_000);
      const grant = await db
        .selectFrom('auth_step_up_grants')
        .select(['granted_at'])
        .where('uid', '=', principal.uid)
        .where('granted_at', '>', cutoff)
        .where('expires_at', '>', now)
        .orderBy('granted_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      if (!grant) {
        return c.json({ error: 'step_up_required' }, 403);
      }
    }

    await next();
  };
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const lower = header.toLowerCase();
  if (!lower.startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

function principalFromPayload(payload: SupabaseJwtPayload): Principal {
  const appMeta = (payload.app_metadata ?? {}) as Record<string, unknown>;
  const role = isRole(appMeta.role) ? appMeta.role : null;

  const isSupply = role === 'caregiver' || role === 'provider';

  return {
    uid: payload.sub,
    role,
    categories: role === 'caregiver' ? readStringArray(appMeta.categories) : null,
    specialty: role === 'provider' ? readString(appMeta.specialty) : null,
    state: isSupply ? readString(appMeta.state) : null,
    email: payload.email ?? null,
    phone: payload.phone ?? null,
    secondFactor: deriveSecondFactor(payload),
    claims: payload,
  };
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  return items.length > 0 ? items : null;
}

function deriveSecondFactor(payload: SupabaseJwtPayload): SecondFactor | null {
  if (payload.aal !== 'aal2') return null;
  const amr = payload.amr ?? [];
  const methods = new Set(amr.map((entry) => entry.method));
  if (methods.has('totp') || methods.has('mfa/totp')) return 'totp';
  if (methods.has('phone') || methods.has('mfa/phone') || methods.has('phone_otp')) return 'phone';
  return null;
}
