import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { jwtVerify } from 'jose';

import type { Principal, SecondFactor, SupabaseJwtPayload } from '@/auth/principal.js';
import { isProviderKind, isRole, type Role } from '@/auth/roles.js';

export interface RequireAuthOptions {
  roles?: Role[];
  stepUpMaxAgeSec?: number;
}

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
  }
  interface FastifyInstance {
    requireAuth: (opts?: RequireAuthOptions) => PreHandler;
  }
}

const authPluginCallback: FastifyPluginAsync = async (app) => {
  app.decorateRequest('principal', null);

  const jwtSecret = new TextEncoder().encode(app.deps.env.SUPABASE_JWT_SECRET);

  const requireAuth = (opts: RequireAuthOptions = {}): PreHandler => {
    return async (req, reply) => {
      const header = req.headers.authorization;
      const token = extractBearer(header);
      if (!token) {
        reply.code(401).send({ error: 'missing_bearer_token' });
        return;
      }

      let payload: SupabaseJwtPayload;
      try {
        const verified = await jwtVerify(token, jwtSecret, {
          algorithms: ['HS256'],
          audience: 'authenticated',
        });
        payload = verified.payload as SupabaseJwtPayload;
      } catch (err) {
        req.log.warn({ err }, 'supabase access token verification failed');
        reply.code(401).send({ error: 'invalid_token' });
        return;
      }

      const principal = principalFromPayload(payload);
      req.principal = principal;

      if (opts.roles && opts.roles.length > 0) {
        if (!principal.role || !opts.roles.includes(principal.role)) {
          reply.code(403).send({ error: 'forbidden_role' });
          return;
        }
      }

      if (opts.stepUpMaxAgeSec !== undefined) {
        const now = new Date();
        const cutoff = new Date(now.getTime() - opts.stepUpMaxAgeSec * 1_000);
        const grant = await app.deps.db
          .selectFrom('auth_step_up_grants')
          .select(['granted_at'])
          .where('uid', '=', principal.uid)
          .where('granted_at', '>', cutoff)
          .where('expires_at', '>', now)
          .orderBy('granted_at', 'desc')
          .limit(1)
          .executeTakeFirst();
        if (!grant) {
          reply.code(403).send({ error: 'step_up_required' });
          return;
        }
      }
    };
  };

  app.decorate('requireAuth', requireAuth);
};

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

export const authPlugin = fp(authPluginCallback, { name: 'auth' });
