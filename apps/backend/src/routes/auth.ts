import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { EmailOtpService, LoggingEmailOtpNotifier } from '@/services/email-otp.js';

const STEP_UP_GRANT_TTL_MS = 15 * 60 * 1_000;

const RoleClaimRequest = z
  .object({
    role: z.enum(['parent', 'provider']),
    kind: z.enum(['caregiver', 'specialist']).optional(),
    caregiverCategory: z.string().min(1).max(64).optional(),
    specialty: z.string().min(1).max(64).optional(),
  })
  .refine((data) => !(data.role === 'provider' && !data.kind), {
    message: 'kind is required when role=provider',
    path: ['kind'],
  })
  .refine((data) => !(data.role === 'parent' && data.kind), {
    message: 'kind must be omitted when role=parent',
    path: ['kind'],
  })
  .refine((data) => !(data.kind === 'caregiver' && data.specialty), {
    message: 'specialty is for kind=specialist',
    path: ['specialty'],
  })
  .refine((data) => !(data.kind === 'specialist' && data.caregiverCategory), {
    message: 'caregiverCategory is for kind=caregiver',
    path: ['caregiverCategory'],
  });

const RoleClaimResponse = z.object({
  role: z.enum(['parent', 'provider']),
  kind: z.enum(['caregiver', 'specialist']).nullable(),
});

const EmailOtpIssueResponse = z.object({
  id: z.string().uuid(),
  expiresAt: z.string().datetime(),
});

const EmailOtpVerifyRequest = z.object({
  code: z.string().regex(/^\d{6}$/, 'must be a 6-digit code'),
});

const StepUpRefreshResponse = z.object({
  secondFactor: z.enum(['totp', 'phone']),
  grantedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

const ErrorResponse = z.object({
  error: z.string(),
  reason: z.string().optional(),
});

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const emailOtp = new EmailOtpService(app.deps.db, new LoggingEmailOtpNotifier(app.log));

  app.post(
    '/auth/role-claim',
    {
      preHandler: app.requireAuth(),
      schema: {
        tags: ['auth'],
        summary: 'Set the permanent role + kind on the authenticated Supabase user',
        description:
          'Idempotent. Rejects with 409 if the user already has a role claim that differs from the request. Once set, role is permanent per CONTEXT.md § Authentication. Claims are written to Supabase `app_metadata`; the client must refresh its session to receive an access token carrying the new claims.',
        security: [{ supabaseAccessToken: [] }],
        body: RoleClaimRequest,
        response: {
          200: RoleClaimResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const principal = req.principal!;
      const desired = req.body;

      if (principal.role) {
        const sameRole = principal.role === desired.role;
        const sameKind = (principal.kind ?? null) === (desired.kind ?? null);
        if (sameRole && sameKind) {
          return { role: principal.role as 'parent' | 'provider', kind: principal.kind };
        }
        reply.code(409);
        return { error: 'role_already_claimed', reason: 'role is permanent and cannot be changed' };
      }

      const existingAppMeta = (principal.claims.app_metadata ?? {}) as Record<string, unknown>;
      const nextAppMeta: Record<string, unknown> = {
        ...existingAppMeta,
        role: desired.role,
      };
      if (desired.kind) nextAppMeta.kind = desired.kind;
      if (desired.caregiverCategory) nextAppMeta.caregiver_category = desired.caregiverCategory;
      if (desired.specialty) nextAppMeta.specialty = desired.specialty;

      const { error } = await app.deps.supabase.admin.auth.admin.updateUserById(principal.uid, {
        app_metadata: nextAppMeta,
      });
      if (error) {
        req.log.error({ err: error }, 'supabase updateUserById failed');
        throw new Error('failed_to_set_role_claim');
      }
      return { role: desired.role, kind: desired.kind ?? null };
    },
  );

  app.post(
    '/auth/email-otp/issue',
    {
      preHandler: app.requireAuth(),
      schema: {
        tags: ['auth'],
        summary: 'Issue an email-OTP for the authenticated user',
        description:
          'Email-OTP fallback path per CONTEXT.md § MFA posture — used for pre-paywall Parents without a phone on file. The notifier is a dev stub today; SendGrid wiring lands in OH-115 (Notifications dispatcher).',
        security: [{ supabaseAccessToken: [] }],
        response: {
          200: EmailOtpIssueResponse,
          400: ErrorResponse,
          401: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const principal = req.principal!;
      if (!principal.email) {
        reply.code(400);
        return { error: 'no_email_on_account' };
      }
      const result = await emailOtp.issue({ uid: principal.uid, email: principal.email });
      return { id: result.id, expiresAt: result.expiresAt.toISOString() };
    },
  );

  app.post(
    '/auth/email-otp/verify',
    {
      preHandler: app.requireAuth(),
      schema: {
        tags: ['auth'],
        summary: 'Verify an email-OTP and open a step-up window',
        security: [{ supabaseAccessToken: [] }],
        body: EmailOtpVerifyRequest,
        response: {
          200: StepUpRefreshResponse,
          400: ErrorResponse,
          401: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const principal = req.principal!;
      const verification = await emailOtp.verify({ uid: principal.uid, code: req.body.code });
      if (!verification.ok) {
        reply.code(400);
        return { error: 'otp_rejected', reason: verification.reason };
      }
      const grant = await grantStepUp(app, principal.uid, 'phone');
      return {
        secondFactor: 'phone' as const,
        grantedAt: grant.granted_at.toISOString(),
        expiresAt: grant.expires_at.toISOString(),
      };
    },
  );

  app.post(
    '/auth/step-up/refresh',
    {
      preHandler: app.requireAuth(),
      schema: {
        tags: ['auth'],
        summary: 'Record a fresh MFA challenge from a Supabase aal2 access token',
        description:
          'Called by clients after completing a Supabase MFA challenge (TOTP enrollment / phone factor). Reads the token\'s `aal` and `amr` claims and opens a step-up window. Rejects when the access token is not `aal2`.',
        security: [{ supabaseAccessToken: [] }],
        response: {
          200: StepUpRefreshResponse,
          400: ErrorResponse,
          401: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const principal = req.principal!;
      if (!principal.secondFactor) {
        reply.code(400);
        return { error: 'no_second_factor', reason: 'access token is not aal2' };
      }
      const grant = await grantStepUp(app, principal.uid, principal.secondFactor);
      return {
        secondFactor: principal.secondFactor,
        grantedAt: grant.granted_at.toISOString(),
        expiresAt: grant.expires_at.toISOString(),
      };
    },
  );
};

async function grantStepUp(
  app: { deps: { db: import('@/db/kysely.js').Db } },
  uid: string,
  secondFactor: 'totp' | 'phone',
): Promise<{ granted_at: Date; expires_at: Date }> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + STEP_UP_GRANT_TTL_MS);
  const row = await app.deps.db
    .insertInto('auth_step_up_grants')
    .values({
      uid,
      second_factor: secondFactor,
      expires_at: expiresAt,
    })
    .returning(['granted_at', 'expires_at'])
    .executeTakeFirstOrThrow();
  const granted = row.granted_at instanceof Date ? row.granted_at : new Date(row.granted_at);
  const expires = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
  return { granted_at: granted, expires_at: expires };
}
