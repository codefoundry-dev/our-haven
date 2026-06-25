import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import { SIGNUP_ROLES } from '../auth/roles.ts';
import { CAREGIVER_CATEGORIES, SPECIALTIES } from '../auth/taxonomy.ts';
import { US_STATES } from '../auth/us-states.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';
import { ConsoleEmailOtpNotifier, EmailOtpService } from '../services/email-otp.ts';

/**
 * Auth surface ported from the Fastify plugin (apps/backend/src/routes/auth.ts)
 * to the Hono fat Edge Function (ADR-0019, OH-175):
 *   - POST /auth/role-claim        — set the permanent sign-up role + sub-type
 *   - POST /auth/email-otp/issue   — pre-paywall Parent email-OTP fallback
 *   - POST /auth/email-otp/verify  — verify the email-OTP, open a step-up window
 *   - POST /auth/step-up/refresh   — mint a step-up grant from an aal2 token
 *   - GET  /caregiver/payout-settings — SCAFFOLD sample of the step-up gate
 *
 * Role permanence (ADR-0011 / CONTEXT § Authentication) is enforced server-side:
 * once `app_metadata.role` is set, role-claim returns 409 on any change.
 */

const STEP_UP_GRANT_TTL_MS = 15 * 60 * 1_000;
const STEP_UP_MAX_AGE_SEC = 15 * 60;

const RoleEnum = z.enum(SIGNUP_ROLES);
const CategoriesSchema = z.array(z.enum(CAREGIVER_CATEGORIES)).min(1);
const SpecialtySchema = z.enum(SPECIALTIES);
const StateSchema = z.enum(US_STATES);

const RoleClaimRequest = z.object({
  role: RoleEnum,
  categories: CategoriesSchema.optional(),
  specialty: SpecialtySchema.optional(),
  // Resident state (drives per-state adapter routing, ADR-0009/0015). Required
  // for supply roles; not allowed for parent (cross-field check in the handler).
  state: StateSchema.optional(),
});

const RoleClaimResponse = z
  .object({
    role: RoleEnum,
    categories: z.array(z.enum(CAREGIVER_CATEGORIES)).nullable(),
    specialty: SpecialtySchema.nullable(),
    state: StateSchema.nullable(),
  })
  .openapi('RoleClaimResponse');

const EmailOtpIssueResponse = z
  .object({
    id: z.string().uuid(),
    expiresAt: z.string().datetime(),
  })
  .openapi('EmailOtpIssueResponse');

const EmailOtpVerifyRequest = z.object({
  code: z.string().regex(/^\d{6}$/, 'must be a 6-digit code'),
});

const StepUpRefreshResponse = z
  .object({
    secondFactor: z.enum(['totp', 'phone']),
    grantedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .openapi('StepUpRefreshResponse');

const StepUpSampleResponse = z
  .object({
    uid: z.string(),
    stepUp: z.literal('satisfied'),
    note: z.string(),
  })
  .openapi('StepUpSampleResponse');

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('AuthErrorResponse');

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const roleClaimRoute = createRoute({
  method: 'post',
  path: '/auth/role-claim',
  tags: ['auth'],
  summary: 'Set the permanent role on the authenticated Supabase user',
  description:
    'Idempotent. Rejects with 409 if the user already has a role claim that differs from the request — role is permanent (ADR-0011 / CONTEXT § Authentication). `role` is one of {parent, caregiver, provider} (admin is internal-only, never self-assignable). A caregiver must include `categories`; a provider must include `specialty`. Supply roles (caregiver/provider) must include a resident `state` (drives per-state adapter routing, ADR-0009/0015); parent must not. Claims are written to Supabase `app_metadata`, and the supply identity (role, categories/specialty, state) is persisted to the `providers` table. The client must refresh its session to receive an access token carrying the new claims.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth()] as const,
  request: { body: { content: json(RoleClaimRequest), required: true } },
  responses: {
    200: { description: 'Role claim set (or already matching)', content: json(RoleClaimResponse) },
    400: { description: 'Validation error', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    409: { description: 'Role already claimed (permanent)', content: json(ErrorResponse) },
  },
});

const emailOtpIssueRoute = createRoute({
  method: 'post',
  path: '/auth/email-otp/issue',
  tags: ['auth'],
  summary: 'Issue an email-OTP for the authenticated user',
  description:
    'Email-OTP fallback per CONTEXT § MFA posture — used for pre-paywall Parents without a phone on file. The notifier is a dev stub today; Resend wiring lands in OH-194.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth()] as const,
  responses: {
    200: { description: 'OTP issued', content: json(EmailOtpIssueResponse) },
    400: { description: 'No email on account', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
  },
});

const emailOtpVerifyRoute = createRoute({
  method: 'post',
  path: '/auth/email-otp/verify',
  tags: ['auth'],
  summary: 'Verify an email-OTP and open a step-up window',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth()] as const,
  request: { body: { content: json(EmailOtpVerifyRequest), required: true } },
  responses: {
    200: { description: 'OTP verified — step-up window opened', content: json(StepUpRefreshResponse) },
    400: { description: 'OTP rejected', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
  },
});

const stepUpRefreshRoute = createRoute({
  method: 'post',
  path: '/auth/step-up/refresh',
  tags: ['auth'],
  summary: 'Record a fresh MFA challenge from a Supabase aal2 access token',
  description:
    "Called by clients after completing a Supabase MFA challenge (TOTP / phone factor). Reads the token's `aal` + `amr` claims and opens a 15-minute step-up window in `auth_step_up_grants`. Rejects when the access token is not `aal2`.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth()] as const,
  responses: {
    200: { description: 'Step-up window opened', content: json(StepUpRefreshResponse) },
    400: { description: 'Access token is not aal2', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
  },
});

const stepUpSampleRoute = createRoute({
  method: 'get',
  path: '/caregiver/payout-settings',
  tags: ['auth'],
  summary: 'SCAFFOLD — sample step-up-MFA-gated payout-sensitive endpoint',
  description:
    'Demonstrates the step-up MFA gate for payout-sensitive Caregiver actions (CONTEXT § MFA posture). Requires role=caregiver AND a fresh step-up grant (POST /v1/auth/step-up/refresh within 15 min) — otherwise 403 `step_up_required`. OH-190 replaces this scaffold with the real Stripe Connect bank-detail / withdrawal endpoints.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'], stepUpMaxAgeSec: STEP_UP_MAX_AGE_SEC })] as const,
  responses: {
    200: { description: 'Step-up satisfied', content: json(StepUpSampleResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role or step-up required', content: json(ErrorResponse) },
  },
});

/** Order-insensitive equality for the caregiver `categories[]` permanence check. */
function sameStringArray(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

async function grantStepUp(
  db: Db,
  uid: string,
  secondFactor: 'totp' | 'phone',
): Promise<{ granted_at: Date; expires_at: Date }> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + STEP_UP_GRANT_TTL_MS);
  const row = await db
    .insertInto('auth_step_up_grants')
    .values({ uid, second_factor: secondFactor, expires_at: expiresAt })
    .returning(['granted_at', 'expires_at'])
    .executeTakeFirstOrThrow();
  const granted = row.granted_at instanceof Date ? row.granted_at : new Date(row.granted_at);
  const expires = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
  return { granted_at: granted, expires_at: expires };
}

export function registerAuthRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(roleClaimRoute, async (c) => {
    const { supabase, db } = c.var.deps;
    const principal = c.get('principal')!;
    const body = c.req.valid('json');

    // Cross-field validation (kept in the handler so the request schema stays a
    // plain ZodObject for @hono/zod-openapi).
    const isSupply = body.role === 'caregiver' || body.role === 'provider';

    if (body.role === 'caregiver' && !body.categories) {
      return c.json({ error: 'categories_required', reason: 'categories is required when role=caregiver' }, 400);
    }
    if (body.role !== 'caregiver' && body.categories) {
      return c.json({ error: 'categories_not_allowed', reason: 'categories is only valid when role=caregiver' }, 400);
    }
    if (body.role === 'provider' && !body.specialty) {
      return c.json({ error: 'specialty_required', reason: 'specialty is required when role=provider' }, 400);
    }
    if (body.role !== 'provider' && body.specialty) {
      return c.json({ error: 'specialty_not_allowed', reason: 'specialty is only valid when role=provider' }, 400);
    }
    if (isSupply && !body.state) {
      return c.json({ error: 'state_required', reason: 'state is required when role=caregiver or role=provider' }, 400);
    }
    if (!isSupply && body.state) {
      return c.json(
        { error: 'state_not_allowed', reason: 'state is only valid for supply roles (caregiver, provider)' },
        400,
      );
    }

    const desiredCategories = body.categories ?? null;
    const desiredSpecialty = body.specialty ?? null;
    const desiredState = body.state ?? null;

    if (principal.role) {
      const same =
        principal.role === body.role &&
        sameStringArray(principal.categories, desiredCategories) &&
        (principal.specialty ?? null) === desiredSpecialty &&
        (principal.state ?? null) === desiredState;
      if (same) {
        return c.json(
          { role: body.role, categories: desiredCategories, specialty: desiredSpecialty, state: desiredState },
          200,
        );
      }
      return c.json({ error: 'role_already_claimed', reason: 'role is permanent and cannot be changed' }, 409);
    }

    // First claim. Persist the supply identity to the `providers` table BEFORE
    // writing app_metadata: the two stores can't share a transaction, and a
    // failed app_metadata write must leave the user re-claimable (role still
    // unset in the JWT) rather than logged-in with no supply record. The insert
    // is idempotent on `uid`, so a retry after a partial failure converges.
    if (isSupply && desiredState) {
      await db
        .insertInto('providers')
        .values({
          uid: principal.uid,
          role: body.role as 'caregiver' | 'provider',
          categories: desiredCategories,
          specialty: desiredSpecialty,
          state: desiredState,
        })
        .onConflict((oc) => oc.column('uid').doNothing())
        .execute();
    }

    const existingAppMeta = (principal.claims.app_metadata ?? {}) as Record<string, unknown>;
    const nextAppMeta: Record<string, unknown> = { ...existingAppMeta, role: body.role };
    if (desiredCategories) nextAppMeta.categories = desiredCategories;
    if (desiredSpecialty) nextAppMeta.specialty = desiredSpecialty;
    if (desiredState) nextAppMeta.state = desiredState;

    const { error } = await supabase.admin.auth.admin.updateUserById(principal.uid, {
      app_metadata: nextAppMeta,
    });
    if (error) {
      console.error('[auth] supabase updateUserById failed', error);
      throw new Error('failed_to_set_role_claim');
    }
    return c.json(
      { role: body.role, categories: desiredCategories, specialty: desiredSpecialty, state: desiredState },
      200,
    );
  });

  app.openapi(emailOtpIssueRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    if (!principal.email) {
      return c.json({ error: 'no_email_on_account' }, 400);
    }
    const emailOtp = new EmailOtpService(db, new ConsoleEmailOtpNotifier());
    const result = await emailOtp.issue({ uid: principal.uid, email: principal.email });
    return c.json({ id: result.id, expiresAt: result.expiresAt.toISOString() }, 200);
  });

  app.openapi(emailOtpVerifyRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { code } = c.req.valid('json');
    const emailOtp = new EmailOtpService(db, new ConsoleEmailOtpNotifier());
    const verification = await emailOtp.verify({ uid: principal.uid, code });
    if (!verification.ok) {
      return c.json({ error: 'otp_rejected', reason: verification.reason }, 400);
    }
    const grant = await grantStepUp(db, principal.uid, 'phone');
    return c.json(
      {
        secondFactor: 'phone' as const,
        grantedAt: grant.granted_at.toISOString(),
        expiresAt: grant.expires_at.toISOString(),
      },
      200,
    );
  });

  app.openapi(stepUpRefreshRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    if (!principal.secondFactor) {
      return c.json({ error: 'no_second_factor', reason: 'access token is not aal2' }, 400);
    }
    const grant = await grantStepUp(db, principal.uid, principal.secondFactor);
    return c.json(
      {
        secondFactor: principal.secondFactor,
        grantedAt: grant.granted_at.toISOString(),
        expiresAt: grant.expires_at.toISOString(),
      },
      200,
    );
  });

  app.openapi(stepUpSampleRoute, (c) => {
    const principal = c.get('principal')!;
    return c.json(
      {
        uid: principal.uid,
        stepUp: 'satisfied' as const,
        note: 'scaffold — OH-190 replaces with the real Stripe Connect bank/withdrawal endpoints',
      },
      200,
    );
  });
}
