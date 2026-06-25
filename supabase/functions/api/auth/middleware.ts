import type { MiddlewareHandler } from 'hono';
import { jwtVerify } from 'jose';

import type { AppEnv } from '../context.ts';
import type { Principal, SecondFactor, SupabaseJwtPayload } from './principal.ts';
import { isProviderKind, isRole, type Role } from './roles.ts';

export interface RequireAuthOptions {
  roles?: Role[];
  stepUpMaxAgeSec?: number;
}

/**
 * Port of the Fastify `requireAuth` (apps/backend/src/plugins/auth.ts) to a
 * Hono middleware factory (ADR-0019 § Decision 1 — one auth chain on the fat
 * function). Verifies the Supabase HS256 access token locally, attaches the
 * Principal to the context, and enforces role + optional step-up-MFA gates.
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
      const verified = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET), {
        algorithms: ['HS256'],
        audience: 'authenticated',
      });
      payload = verified.payload as SupabaseJwtPayload;
    } catch {
      return c.json({ error: 'invalid_token' }, 401);
    }

    const principal = principalFromPayload(payload);
    c.set('principal', principal);

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
  const kind = isProviderKind(appMeta.kind) ? appMeta.kind : null;

  return {
    uid: payload.sub,
    role,
    kind: role === 'provider' ? kind : null,
    email: payload.email ?? null,
    phone: payload.phone ?? null,
    secondFactor: deriveSecondFactor(payload),
    claims: payload,
  };
}

function deriveSecondFactor(payload: SupabaseJwtPayload): SecondFactor | null {
  if (payload.aal !== 'aal2') return null;
  const amr = payload.amr ?? [];
  const methods = new Set(amr.map((entry) => entry.method));
  if (methods.has('totp') || methods.has('mfa/totp')) return 'totp';
  if (methods.has('phone') || methods.has('mfa/phone') || methods.has('phone_otp')) return 'phone';
  return null;
}
