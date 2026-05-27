import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { DecodedIdToken } from 'firebase-admin/auth';

import type { Principal, SecondFactor } from '@/auth/principal.js';
import { isProviderKind, isRole, type Role } from '@/auth/roles.js';

export interface RequireAuthOptions {
  roles?: Role[];
  stepUpMaxAgeSec?: number;
  checkRevoked?: boolean;
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

  const requireAuth = (opts: RequireAuthOptions = {}): PreHandler => {
    return async (req, reply) => {
      const header = req.headers.authorization;
      const token = extractBearer(header);
      if (!token) {
        reply.code(401).send({ error: 'missing_bearer_token' });
        return;
      }

      let decoded: DecodedIdToken;
      try {
        decoded = await app.deps.firebase.auth.verifyIdToken(token, opts.checkRevoked ?? false);
      } catch (err) {
        req.log.warn({ err }, 'firebase id token verification failed');
        reply.code(401).send({ error: 'invalid_token' });
        return;
      }

      const principal = principalFromToken(decoded);
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

function principalFromToken(decoded: DecodedIdToken): Principal {
  const rawRole = (decoded as Record<string, unknown>).role;
  const rawKind = (decoded as Record<string, unknown>).kind;
  const role = isRole(rawRole) ? rawRole : null;
  const kind = isProviderKind(rawKind) ? rawKind : null;
  const sf = decoded.firebase?.sign_in_second_factor;
  const secondFactor: SecondFactor | null = sf === 'totp' || sf === 'phone' ? sf : null;

  return {
    uid: decoded.uid,
    role,
    kind: role === 'provider' ? kind : null,
    email: decoded.email ?? null,
    phone: decoded.phone_number ?? null,
    secondFactor,
    claims: decoded,
  };
}

export const authPlugin = fp(authPluginCallback, { name: 'auth' });
