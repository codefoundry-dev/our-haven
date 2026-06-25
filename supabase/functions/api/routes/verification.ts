import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import { US_STATES, type UsState } from '../auth/us-states.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';
import type { SupabaseHandles } from '../supabase/admin.ts';
// The pure-TS Verification state machine (@our-haven/domain, OH-181) is the
// single source of truth for the per-role activation gates. It is reached
// cross-tree by an explicit `.ts` specifier — the SAME pattern db/kysely.ts uses
// for the Kysely schema — because the module is Deno-clean: its only import is a
// type-only `@our-haven/shared` (fully erased at Deno runtime). The Edge import
// map carries no `@our-haven/*` entry, so a bare specifier would not resolve;
// the relative path does, on both Node (vitest/tsc) and deployed Deno.
import {
  computeVerificationState,
  VERIFICATION_STATES,
  type VerificationFacts,
} from '../../../../packages/domain/src/verification-workflow/index.ts';

/**
 * Supply Verification flow — read state + record per-step facts (OH-184).
 *
 * Ported from the Fastify plugin (apps/backend/src/routes/verification.ts) onto
 * the Hono fat Edge Function (ADR-0019). Three supply-scoped endpoints, all
 * gated to `roles: ['caregiver', 'provider']` (the unified `providers` supply
 * table backs both):
 *
 *   GET  /v1/providers/me/verification
 *     - Computes the current Verification state from the per-step facts via the
 *       domain fold, plus returns the raw timestamps that drive the design's
 *       checklist. Email + phone confirmations are mirrored from Supabase Auth on
 *       read, so they reflect the latest session state without a separate poll.
 *
 *   POST /v1/providers/me/verification/phone-confirm
 *     - Called after the client completes Supabase phone OTP
 *       (supabase.auth.verifyOtp). Reads the user via the admin client, requires
 *       phone_confirmed_at, and mirrors it onto provider_verifications.
 *       phoneConfirmedAt is the HARD final activation gate (ADR-0015). Idempotent.
 *
 *   POST /v1/providers/me/verification/id-doc
 *     - Records a completed government-ID upload. The client first mints a signed
 *       upload URL (POST /v1/uploads/signed-url, routes/uploads.ts), PUTs the file
 *       to Supabase Storage, then posts the returned objectPath here. The server
 *       validates the path is scoped to this user's id-doc namespace and stamps
 *       id_doc_uploaded_at.
 *
 * Writes are deliberately minimal — the heavy verification facts
 * (screening_*_at, license_verified_at, rejected_at) are owned by the Checkr
 * webhook (OH-185) and the admin review queue (OH-195/OH-186). This module only
 * records the applicant-driven facts (ID upload) and mirrors Supabase Auth
 * confirmations (email/phone).
 */

const SUPPLY_ROLES = ['caregiver', 'provider'] as const;
type SupplyRole = (typeof SUPPLY_ROLES)[number];

const VerificationStateEnum = z.enum(VERIFICATION_STATES);

const VerificationFactsSchema = z
  .object({
    emailConfirmedAt: z.string().datetime().nullable(),
    phoneConfirmedAt: z.string().datetime().nullable(),
    idDocUploadedAt: z.string().datetime().nullable(),
    idDocObjectPath: z.string().nullable(),
    screeningInitiatedAt: z.string().datetime().nullable(),
    screeningPassedAt: z.string().datetime().nullable(),
    licenseVerifiedAt: z.string().datetime().nullable(),
    connectAccountReadyAt: z.string().datetime().nullable(),
    rejectedAt: z.string().datetime().nullable(),
    rejectionReason: z.string().nullable(),
  })
  .openapi('SupplyVerificationFacts');

const VerificationResponse = z
  .object({
    state: VerificationStateEnum,
    role: z.enum(SUPPLY_ROLES),
    residentState: z.enum(US_STATES),
    /** Caregiver: always true (Checkr is multi-state). Provider: state in the launch slate. */
    licenseBoardSupported: z.boolean(),
    facts: VerificationFactsSchema,
  })
  .openapi('SupplyVerification');

const IdDocConfirmRequest = z
  .object({
    objectPath: z.string().min(1).max(512),
  })
  .openapi('IdDocConfirmRequest');

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('VerificationError');

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

interface ProviderRow {
  id: string;
  uid: string;
  role: SupplyRole;
  state: string;
}

interface VerificationRow {
  provider_id: string;
  email_confirmed_at: Date | string | null;
  phone_confirmed_at: Date | string | null;
  id_doc_object_path: string | null;
  id_doc_uploaded_at: Date | string | null;
  screening_initiated_at: Date | string | null;
  screening_passed_at: Date | string | null;
  license_verified_at: Date | string | null;
  rejected_at: Date | string | null;
  rejection_reason: string | null;
}

interface ConnectSnapshot {
  account_ready_at: Date | string | null;
}

interface SupabaseUserSummary {
  email_confirmed_at?: string | null;
  phone_confirmed_at?: string | null;
}

/**
 * Resolve the supported-state set from the ops-overridable env CSV (defaulted to
 * the launch slate in config/env.ts). Filters to valid 2-letter codes; an empty
 * or all-invalid value yields an empty set (every Provider then routes to
 * `holding-state-not-supported`, which is the safe conservative default).
 */
function parseSupportedStates(raw: string): ReadonlySet<UsState> {
  const valid = new Set<string>(US_STATES);
  const parts = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is UsState => valid.has(s));
  return new Set(parts);
}

function asDate(value: Date | string | null): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function toIso(value: Date | string | null): string | null {
  const d = asDate(value);
  return d ? d.toISOString() : null;
}

async function loadProvider(db: Db, uid: string): Promise<ProviderRow | null> {
  const row = await db
    .selectFrom('providers')
    .select(['id', 'uid', 'role', 'state'])
    .where('uid', '=', uid)
    .executeTakeFirst();
  return row ? (row as ProviderRow) : null;
}

async function loadOrCreateVerification(db: Db, providerId: string): Promise<VerificationRow> {
  const existing = await db
    .selectFrom('provider_verifications')
    .selectAll()
    .where('provider_id', '=', providerId)
    .executeTakeFirst();
  if (existing) return existing as unknown as VerificationRow;

  const inserted = await db
    .insertInto('provider_verifications')
    .values({ provider_id: providerId })
    .returningAll()
    .executeTakeFirstOrThrow();
  return inserted as unknown as VerificationRow;
}

async function loadConnectSnapshot(db: Db, providerId: string): Promise<ConnectSnapshot | null> {
  const row = await db
    .selectFrom('provider_connect_accounts')
    .select(['account_ready_at'])
    .where('provider_id', '=', providerId)
    .executeTakeFirst();
  return row ? (row as ConnectSnapshot) : null;
}

async function fetchSupabaseUser(
  supabase: SupabaseHandles,
  uid: string,
): Promise<SupabaseUserSummary> {
  const { data, error } = await supabase.admin.auth.admin.getUserById(uid);
  if (error || !data?.user) {
    throw new Error(`supabase getUserById failed: ${error?.message ?? 'no user'}`);
  }
  return data.user as SupabaseUserSummary;
}

/**
 * Mirror Supabase Auth email/phone confirmation timestamps onto the verification
 * row when they are newly present. One-directional + idempotent: only fills a
 * null column, never clears one. Returns the (possibly updated) row.
 */
async function syncAuthConfirmations(
  db: Db,
  supabase: SupabaseHandles,
  uid: string,
  providerId: string,
  current: VerificationRow,
  knownUser?: SupabaseUserSummary,
): Promise<VerificationRow> {
  const user = knownUser ?? (await fetchSupabaseUser(supabase, uid));
  const emailAt = user.email_confirmed_at ? new Date(user.email_confirmed_at) : null;
  const phoneAt = user.phone_confirmed_at ? new Date(user.phone_confirmed_at) : null;

  const patch: Record<string, Date> = {};
  if (emailAt && !current.email_confirmed_at) patch.email_confirmed_at = emailAt;
  if (phoneAt && !current.phone_confirmed_at) patch.phone_confirmed_at = phoneAt;

  if (Object.keys(patch).length === 0) return current;

  const updated = await db
    .updateTable('provider_verifications')
    .set({ ...patch, updated_at: new Date() })
    .where('provider_id', '=', providerId)
    .returningAll()
    .executeTakeFirstOrThrow();
  return updated as unknown as VerificationRow;
}

function buildResponse(
  provider: ProviderRow,
  row: VerificationRow,
  supportedStates: ReadonlySet<UsState>,
  connect: ConnectSnapshot | null,
) {
  const role = provider.role;
  const residentState = provider.state as UsState;
  const facts: VerificationFacts = {
    emailConfirmedAt: asDate(row.email_confirmed_at),
    phoneConfirmedAt: asDate(row.phone_confirmed_at),
    idDocUploadedAt: asDate(row.id_doc_uploaded_at),
    screeningInitiatedAt: asDate(row.screening_initiated_at),
    screeningPassedAt: asDate(row.screening_passed_at),
    licenseVerifiedAt: asDate(row.license_verified_at),
    // Liability-insurance proof is a Provider activation gate (OH-181), but its
    // upload + admin-verify column lands with OH-186. Until then it is null, so a
    // Provider correctly rests at `insurance-pending` after the license clears.
    // Caregivers ignore it.
    insuranceVerifiedAt: null,
    connectAccountReadyAt: asDate(connect?.account_ready_at ?? null),
    rejectedAt: asDate(row.rejected_at),
  };
  const state = computeVerificationState({
    role,
    state: residentState,
    supportedStates,
    facts,
  });
  return {
    state,
    role,
    residentState,
    licenseBoardSupported: role === 'caregiver' ? true : supportedStates.has(residentState),
    facts: {
      emailConfirmedAt: toIso(facts.emailConfirmedAt),
      phoneConfirmedAt: toIso(facts.phoneConfirmedAt),
      idDocUploadedAt: toIso(facts.idDocUploadedAt),
      idDocObjectPath: row.id_doc_object_path,
      screeningInitiatedAt: toIso(facts.screeningInitiatedAt),
      screeningPassedAt: toIso(facts.screeningPassedAt),
      licenseVerifiedAt: toIso(facts.licenseVerifiedAt),
      connectAccountReadyAt: toIso(facts.connectAccountReadyAt),
      rejectedAt: toIso(facts.rejectedAt),
      rejectionReason: row.rejection_reason,
    },
  };
}

const getVerificationRoute = createRoute({
  method: 'get',
  path: '/providers/me/verification',
  tags: ['verification'],
  summary: "Read the authenticated supply member's verification state + checklist facts",
  description:
    "Returns the current Verification state computed from per-step facts (email / phone / ID / screening / license) plus the raw timestamps that drive the verification checklist. Email + phone confirmations are mirrored from Supabase Auth on read so they reflect the latest session state. Scoped to the unified `providers` supply table, so both Caregivers and Providers use it.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: [...SUPPLY_ROLES] })] as const,
  responses: {
    200: { description: 'Verification state + facts', content: json(VerificationResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role (parent / admin)', content: json(ErrorResponse) },
    404: { description: 'Supply (provider) row not found', content: json(ErrorResponse) },
  },
});

const phoneConfirmRoute = createRoute({
  method: 'post',
  path: '/providers/me/verification/phone-confirm',
  tags: ['verification'],
  summary: 'Mirror a completed Supabase phone confirmation into the verification facts',
  description:
    'Called by the client after it completes Supabase phone OTP (supabase.auth.verifyOtp). Fetches the user from the Supabase admin API, requires phone_confirmed_at, and records it on provider_verifications. Phone is the hard final activation gate (ADR-0015). Idempotent.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: [...SUPPLY_ROLES] })] as const,
  responses: {
    200: { description: 'Phone confirmation mirrored', content: json(VerificationResponse) },
    400: { description: 'Phone not yet confirmed in Supabase', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role (parent / admin)', content: json(ErrorResponse) },
    404: { description: 'Supply (provider) row not found', content: json(ErrorResponse) },
  },
});

const idDocConfirmRoute = createRoute({
  method: 'post',
  path: '/providers/me/verification/id-doc',
  tags: ['verification'],
  summary: 'Record a completed government-ID upload',
  description:
    "Called after the client uploads a government-issued ID through the signed-URL flow (POST /v1/uploads/signed-url → PUT to Supabase Storage). The body carries the returned objectPath; the server validates it is scoped to this user's id-doc namespace (id-doc/<uid>/) and records the upload timestamp.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: [...SUPPLY_ROLES] })] as const,
  request: { body: { content: json(IdDocConfirmRequest), required: true } },
  responses: {
    200: { description: 'ID upload recorded', content: json(VerificationResponse) },
    400: { description: 'objectPath not scoped to this user', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role (parent / admin)', content: json(ErrorResponse) },
    404: { description: 'Supply (provider) row not found', content: json(ErrorResponse) },
  },
});

export function registerVerificationRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(getVerificationRoute, async (c) => {
    const { db, env, supabase } = c.var.deps;
    const principal = c.get('principal')!;
    const supportedStates = parseSupportedStates(env.LICENSE_BOARD_SUPPORTED_STATES);

    const provider = await loadProvider(db, principal.uid);
    if (!provider) {
      return c.json(
        { error: 'provider_not_found', reason: 'claim a supply role first (POST /v1/auth/role-claim)' },
        404,
      );
    }

    const row = await loadOrCreateVerification(db, provider.id);
    const synced = await syncAuthConfirmations(db, supabase, principal.uid, provider.id, row);
    const connect = await loadConnectSnapshot(db, provider.id);
    return c.json(buildResponse(provider, synced, supportedStates, connect), 200);
  });

  app.openapi(phoneConfirmRoute, async (c) => {
    const { db, env, supabase } = c.var.deps;
    const principal = c.get('principal')!;
    const supportedStates = parseSupportedStates(env.LICENSE_BOARD_SUPPORTED_STATES);

    const provider = await loadProvider(db, principal.uid);
    if (!provider) {
      return c.json({ error: 'provider_not_found' }, 404);
    }

    const user = await fetchSupabaseUser(supabase, principal.uid);
    if (!user.phone_confirmed_at) {
      return c.json({ error: 'phone_not_confirmed', reason: 'complete Supabase phone OTP first' }, 400);
    }

    const current = await loadOrCreateVerification(db, provider.id);
    const synced = await syncAuthConfirmations(
      db,
      supabase,
      principal.uid,
      provider.id,
      current,
      user,
    );
    const connect = await loadConnectSnapshot(db, provider.id);
    return c.json(buildResponse(provider, synced, supportedStates, connect), 200);
  });

  app.openapi(idDocConfirmRoute, async (c) => {
    const { db, env, supabase } = c.var.deps;
    const principal = c.get('principal')!;
    const body = c.req.valid('json');
    const supportedStates = parseSupportedStates(env.LICENSE_BOARD_SUPPORTED_STATES);

    const provider = await loadProvider(db, principal.uid);
    if (!provider) {
      return c.json({ error: 'provider_not_found' }, 404);
    }

    const expectedPrefix = `id-doc/${principal.uid}/`;
    if (!body.objectPath.startsWith(expectedPrefix)) {
      return c.json(
        { error: 'invalid_object_path', reason: `objectPath must start with ${expectedPrefix}` },
        400,
      );
    }

    await loadOrCreateVerification(db, provider.id);
    const updated = await db
      .updateTable('provider_verifications')
      .set({
        id_doc_object_path: body.objectPath,
        id_doc_uploaded_at: new Date(),
        updated_at: new Date(),
      })
      .where('provider_id', '=', provider.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    const synced = await syncAuthConfirmations(
      db,
      supabase,
      principal.uid,
      provider.id,
      updated as unknown as VerificationRow,
    );
    const connect = await loadConnectSnapshot(db, provider.id);
    return c.json(buildResponse(provider, synced, supportedStates, connect), 200);
  });
}
