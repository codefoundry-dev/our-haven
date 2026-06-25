import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import { CAREGIVER_CATEGORIES, type CaregiverCategory } from '../auth/taxonomy.ts';
import { US_STATES, type UsState } from '../auth/us-states.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';
// The per-state home-childcare slate + badge derivation (@our-haven/domain,
// OH-108/187) is the single source of truth for the agency name + programme +
// public register URL. It is reached cross-tree by an explicit `.ts` specifier —
// the SAME pattern provider-credentials.ts uses for the professional-license
// slate — because the module is Deno-clean (type-only @our-haven/shared import).
import {
  deriveStateRegisteredHomeChildcareBadge,
  findHomeChildcareLicenseBoard,
  isHomeChildcareLicenseBoardLaunchState,
  type HomeChildcareLicenseBoard,
} from '../../../../packages/domain/src/home-childcare-license-board/index.ts';
// The W-10 eligibility predicate (Babysitter/Nanny self-attest). Folding the
// category test through the domain keeps "who is eligible for a CDCTC badge" in
// one place (CONTEXT § CDCTC); `selfAttested=true` reduces it to the category
// gate that ALSO governs the FCCH upload affordance.
import { isTaxCreditFriendlyBadgeEligible } from '../../../../packages/domain/src/credentials/index.ts';

/**
 * Optional Caregiver badge surface (OH-187).
 *
 * Ports the Fastify plugins (apps/backend/src/routes/home-childcare-registration.ts
 * + the W-10 toggle in provider-profile.ts) onto the Hono fat Edge Function
 * (ADR-0019). Two optional, search-discoverability badges for Babysitter / Nanny
 * Caregivers — NEITHER gates activation (CONTEXT § CDCTC-eligibility & state
 * childcare licensure; PRD story 44):
 *
 *   "State-registered home childcare" (FCCH) — admin-verified upload:
 *     GET  /v1/providers/me/home-childcare-registration
 *     POST /v1/providers/me/home-childcare-registration
 *     GET  /v1/admin/providers/{providerId}/home-childcare-registration
 *     POST /v1/admin/providers/{providerId}/home-childcare-registration
 *
 *   "Tax-credit-friendly" (W-10) — pure self-attestation, no upload/review:
 *     GET  /v1/providers/me/tax-credit-attestation
 *     PUT  /v1/providers/me/tax-credit-attestation
 *
 * ── Why these never touch provider_verifications ─────────────────────────────
 * Unlike the clinical-Provider license flow (provider-credentials.ts) whose
 * admin decision mirrors into provider_verifications to advance the Verification
 * state machine, BOTH badges here are decoupled from activation. The FCCH admin
 * decision lands only on provider_home_childcare_registrations; the W-10 flag
 * lands only on provider_profiles. The Verification state machine reads neither.
 *
 * Eligibility (role guard + a categories check): role=caregiver AND categories
 * includes 'babysitter' or 'nanny'. A Tutor-only Caregiver gets 409 on the FCCH
 * surface (the upload affordance must not mis-signal); on the W-10 surface a
 * Tutor simply reads `w10Eligible=false` and is refused (400) only if they try
 * to self-attest. Clinical Providers are rejected by the caregiver-only role
 * guard (403) — they have no childcare badge.
 */

const SUPPLY_ROLES = ['caregiver', 'provider'] as const;

const StateEnum = z.enum(US_STATES);
const CategoryEnum = z.enum(CAREGIVER_CATEGORIES);

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('CaregiverBadgesError');

/* ── FCCH (state home-childcare registration) ───────────────────────────────── */

const HomeChildcareBoardSchema = z
  .object({
    state: StateEnum,
    agencyName: z.string(),
    programName: z.string(),
    registerUrl: z.string().url(),
    hint: z.string(),
  })
  .openapi('HomeChildcareBoard');

const StateRegisteredHomeChildcareBadgeSchema = z
  .object({
    state: StateEnum,
    agencyName: z.string(),
    programName: z.string(),
    verifiedAt: z.string().datetime(),
  })
  .openapi('StateRegisteredHomeChildcareBadge');

const RegistrationResponse = z
  .object({
    providerId: z.string(),
    role: z.enum(SUPPLY_ROLES),
    categories: z.array(CategoryEnum).nullable(),
    residentState: StateEnum,
    /** Whether the launch slate covers the Caregiver's resident state. */
    homeChildcareBoardSupported: z.boolean(),
    /** Board metadata for the resident state, or null when out of slate. */
    board: HomeChildcareBoardSchema.nullable(),
    /** Resident state captured at upload time (kept stable if the Caregiver moves). */
    stateAtUpload: StateEnum.nullable(),
    certificateDocObjectPath: z.string().nullable(),
    certificateUploadedAt: z.string().datetime().nullable(),
    decision: z.enum(['verified', 'rejected']).nullable(),
    decisionAt: z.string().datetime().nullable(),
    decisionByAdminUid: z.string().nullable(),
    decisionNotes: z.string().nullable(),
    /**
     * The public "State-registered home childcare" badge — present only on a
     * `verified` decision, naming the upload-time state agency. Null otherwise.
     */
    badge: StateRegisteredHomeChildcareBadgeSchema.nullable(),
  })
  .openapi('HomeChildcareRegistration');

const RegistrationConfirmRequest = z
  .object({
    objectPath: z.string().min(1).max(512),
  })
  .openapi('HomeChildcareRegistrationConfirmRequest');

const AdminDecisionRequest = z
  .object({
    decision: z.enum(['verified', 'rejected']),
    notes: z.string().max(2000).optional(),
  })
  .openapi('HomeChildcareRegistrationDecisionRequest');

const ProviderIdParam = z.object({
  providerId: z.string().uuid().openapi({ param: { name: 'providerId', in: 'path' } }),
});

/* ── W-10 ("Tax-credit-friendly") self-attestation ──────────────────────────── */

const AttestationResponse = z
  .object({
    providerId: z.string(),
    role: z.enum(SUPPLY_ROLES),
    categories: z.array(CategoryEnum).nullable(),
    /** Whether the Caregiver may carry the badge at all (Babysitter / Nanny). */
    w10Eligible: z.boolean(),
    /** The stored self-attestation flag (provider_profiles.w10_tax_credit_friendly). */
    selfAttested: z.boolean(),
    /**
     * The effective public badge / search facet: eligible AND self-attested.
     * This is the value the unified search "Tax-credit-friendly" filter reads
     * (OH-201) — self-attestation alone on a Tutor never lights the badge.
     */
    taxCreditFriendly: z.boolean(),
  })
  .openapi('TaxCreditAttestation');

const AttestationPutRequest = z
  .object({
    selfAttested: z.boolean(),
  })
  .openapi('TaxCreditAttestationRequest');

/* ── shared row types + helpers ─────────────────────────────────────────────── */

interface ProviderRow {
  id: string;
  uid: string;
  role: 'caregiver' | 'provider';
  categories: string[] | null;
  specialty: string | null;
  state: string;
}

interface RegistrationRow {
  provider_id: string;
  state_at_upload: string | null;
  certificate_doc_object_path: string | null;
  certificate_uploaded_at: Date | string | null;
  decision: 'verified' | 'rejected' | null;
  decision_at: Date | string | null;
  decision_by_admin_uid: string | null;
  decision_notes: string | null;
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString();
}

/**
 * The Babysitter / Nanny gate that governs BOTH optional badges. Folded through
 * the domain W-10 predicate (with `selfAttested=true`) so the eligible-category
 * set lives in exactly one place.
 */
function isChildcareCaregiver(provider: ProviderRow): boolean {
  if (provider.role !== 'caregiver') return false;
  return isTaxCreditFriendlyBadgeEligible((provider.categories ?? []) as CaregiverCategory[], true);
}

async function loadProviderByUid(db: Db, uid: string): Promise<ProviderRow | null> {
  const row = await db
    .selectFrom('providers')
    .select(['id', 'uid', 'role', 'categories', 'specialty', 'state'])
    .where('uid', '=', uid)
    .executeTakeFirst();
  return row ? (row as ProviderRow) : null;
}

async function loadProviderById(db: Db, providerId: string): Promise<ProviderRow | null> {
  const row = await db
    .selectFrom('providers')
    .select(['id', 'uid', 'role', 'categories', 'specialty', 'state'])
    .where('id', '=', providerId)
    .executeTakeFirst();
  return row ? (row as ProviderRow) : null;
}

async function loadOrCreateRegistration(db: Db, providerId: string): Promise<RegistrationRow> {
  const existing = await db
    .selectFrom('provider_home_childcare_registrations')
    .selectAll()
    .where('provider_id', '=', providerId)
    .executeTakeFirst();
  if (existing) return existing as unknown as RegistrationRow;

  const inserted = await db
    .insertInto('provider_home_childcare_registrations')
    .values({ provider_id: providerId })
    .returningAll()
    .executeTakeFirstOrThrow();
  return inserted as unknown as RegistrationRow;
}

function buildRegistrationResponse(provider: ProviderRow, row: RegistrationRow) {
  const residentState = provider.state as UsState;
  const board: HomeChildcareLicenseBoard | null = findHomeChildcareLicenseBoard(residentState);
  // The domain badge types `state` loosely (string) to stay cross-tree friction-
  // free; narrow it back to the response's UsState enum (it is always a launch
  // state — the derivation returns null for anything outside the slate).
  const rawBadge = deriveStateRegisteredHomeChildcareBadge(
    row.state_at_upload,
    row.decision,
    row.decision_at,
  );
  const badge = rawBadge ? { ...rawBadge, state: rawBadge.state as UsState } : null;
  return {
    providerId: provider.id,
    role: provider.role,
    categories: provider.categories as CaregiverCategory[] | null,
    residentState,
    homeChildcareBoardSupported: isHomeChildcareLicenseBoardLaunchState(residentState),
    board,
    stateAtUpload: (row.state_at_upload as UsState | null) ?? null,
    certificateDocObjectPath: row.certificate_doc_object_path,
    certificateUploadedAt: toIso(row.certificate_uploaded_at),
    decision: row.decision,
    decisionAt: toIso(row.decision_at),
    decisionByAdminUid: row.decision_by_admin_uid,
    decisionNotes: row.decision_notes,
    badge,
  };
}

/* ── route definitions ──────────────────────────────────────────────────────── */

const getMyRegistrationRoute = createRoute({
  method: 'get',
  path: '/providers/me/home-childcare-registration',
  tags: ['badges'],
  summary: "Read the authenticated Caregiver's state home-childcare (FCCH) registration context",
  description:
    "Returns the per-state home-childcare-licensing-agency context (agency + programme + register URL + admin hint) resolved from the resident state, plus the current upload + admin-decision state and the derived public badge. Eligibility: role=caregiver AND categories includes babysitter or nanny — Tutor-only Caregivers get 409; clinical Providers are rejected by the role guard (403). When the resident state is outside the launch slate, homeChildcareBoardSupported is false and board is null; the upload affordance should be hidden client-side. Never gates activation.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  responses: {
    200: { description: 'Home-childcare registration state', content: json(RegistrationResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role (provider / parent / admin)', content: json(ErrorResponse) },
    404: { description: 'Supply (caregiver) row not found', content: json(ErrorResponse) },
    409: { description: 'Not a Babysitter / Nanny Caregiver', content: json(ErrorResponse) },
  },
});

const confirmRegistrationRoute = createRoute({
  method: 'post',
  path: '/providers/me/home-childcare-registration',
  tags: ['badges'],
  summary: 'Record a completed state home-childcare-registration certificate upload',
  description:
    "Called after the supply portal uploads the state registration certificate through the signed-URL flow (POST /v1/uploads/signed-url with kind=state-childcare-registration). The body carries the returned objectPath (validated to the caller's namespace); the server records the upload along with the Caregiver's resident state at upload time so the badge keeps naming the right agency if the Caregiver later moves. A fresh upload retires any prior admin decision (re-review).",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  request: { body: { content: json(RegistrationConfirmRequest), required: true } },
  responses: {
    200: { description: 'Certificate upload recorded', content: json(RegistrationResponse) },
    400: { description: 'objectPath not scoped to this user', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Supply (caregiver) row not found', content: json(ErrorResponse) },
    409: { description: 'Not a Babysitter / Nanny Caregiver', content: json(ErrorResponse) },
  },
});

const adminGetRegistrationRoute = createRoute({
  method: 'get',
  path: '/admin/providers/{providerId}/home-childcare-registration',
  tags: ['admin', 'badges'],
  summary: "Admin — read a Caregiver's home-childcare-registration context + uploaded cert + decision",
  description:
    'Surfaces the per-state home-childcare-licensing-agency metadata (agency + register URL + hint) so the admin can cross-check the uploaded certificate on the right state portal, plus the uploaded cert path and the current decision audit fields. Admin role requires aal2+TOTP.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['admin'] })] as const,
  request: { params: ProviderIdParam },
  responses: {
    200: { description: 'Registration context for review', content: json(RegistrationResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Not an admin / TOTP required', content: json(ErrorResponse) },
    404: { description: 'Caregiver not found', content: json(ErrorResponse) },
    409: { description: 'Not a Babysitter / Nanny Caregiver', content: json(ErrorResponse) },
  },
});

const adminDecisionRoute = createRoute({
  method: 'post',
  path: '/admin/providers/{providerId}/home-childcare-registration',
  tags: ['admin', 'badges'],
  summary: 'Admin — record a home-childcare-registration decision (verified | rejected)',
  description:
    'Admin manual verification flow per CONTEXT § CDCTC-eligibility & state childcare licensure. On `verified` the Caregiver\'s public profile gains the "State-registered home childcare" badge naming the specific state agency (returned in `badge`). On `rejected` the badge stays off. This decision is decoupled from the Verification state machine — it lands only on provider_home_childcare_registrations and never blocks activation.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['admin'] })] as const,
  request: {
    params: ProviderIdParam,
    body: { content: json(AdminDecisionRequest), required: true },
  },
  responses: {
    200: { description: 'Decision recorded', content: json(RegistrationResponse) },
    400: { description: 'Invalid request', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Not an admin / TOTP required', content: json(ErrorResponse) },
    404: { description: 'Caregiver not found', content: json(ErrorResponse) },
    409: { description: 'Not a Babysitter / Nanny Caregiver', content: json(ErrorResponse) },
  },
});

const getAttestationRoute = createRoute({
  method: 'get',
  path: '/providers/me/tax-credit-attestation',
  tags: ['badges'],
  summary: "Read the authenticated Caregiver's W-10 \"Tax-credit-friendly\" self-attestation",
  description:
    'Returns the W-10 eligibility (Babysitter / Nanny), the stored self-attestation flag, and the effective `taxCreditFriendly` facet (eligible AND self-attested) that the unified-search filter reads. Self-attestation only — no upload, no admin review; never gates activation (CONTEXT § CDCTC).',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  responses: {
    200: { description: 'Attestation state', content: json(AttestationResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role (provider / parent / admin)', content: json(ErrorResponse) },
    404: { description: 'Supply (caregiver) row not found', content: json(ErrorResponse) },
  },
});

const putAttestationRoute = createRoute({
  method: 'put',
  path: '/providers/me/tax-credit-attestation',
  tags: ['badges'],
  summary: 'Set the W-10 "Tax-credit-friendly" self-attestation toggle',
  description:
    'Sets provider_profiles.w10_tax_credit_friendly. The Caregiver attests they will issue IRS Form W-10 on request. Self-attesting `true` is rejected with 400 unless the account is a Babysitter or Nanny; `false` is always allowed (clearing the badge). No upload, no admin review; never gates activation.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  request: { body: { content: json(AttestationPutRequest), required: true } },
  responses: {
    200: { description: 'Attestation updated', content: json(AttestationResponse) },
    400: { description: 'Not eligible to self-attest', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Supply (caregiver) row not found', content: json(ErrorResponse) },
  },
});

/* ── handlers ───────────────────────────────────────────────────────────────── */

export function registerCaregiverBadgeRoutes(app: OpenAPIHono<AppEnv>): void {
  // --- FCCH provider-side ---

  app.openapi(getMyRegistrationRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;

    const provider = await loadProviderByUid(db, principal.uid);
    if (!provider) {
      return c.json(
        { error: 'provider_not_found', reason: 'claim a supply role first (POST /v1/auth/role-claim)' },
        404,
      );
    }
    if (!isChildcareCaregiver(provider)) {
      return c.json(
        {
          error: 'home_childcare_registration_not_applicable',
          reason: 'home-childcare registration is only available for Babysitter / Nanny Caregivers',
        },
        409,
      );
    }
    const row = await loadOrCreateRegistration(db, provider.id);
    return c.json(buildRegistrationResponse(provider, row), 200);
  });

  app.openapi(confirmRegistrationRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const body = c.req.valid('json');

    const provider = await loadProviderByUid(db, principal.uid);
    if (!provider) return c.json({ error: 'provider_not_found' }, 404);
    if (!isChildcareCaregiver(provider)) {
      return c.json({ error: 'home_childcare_registration_not_applicable' }, 409);
    }

    const expectedPrefix = `state-childcare-registration/${principal.uid}/`;
    if (!body.objectPath.startsWith(expectedPrefix)) {
      return c.json(
        { error: 'invalid_object_path', reason: `objectPath must start with ${expectedPrefix}` },
        400,
      );
    }

    await loadOrCreateRegistration(db, provider.id);

    const now = new Date();
    const updated = await db
      .updateTable('provider_home_childcare_registrations')
      .set({
        state_at_upload: provider.state,
        certificate_doc_object_path: body.objectPath,
        certificate_uploaded_at: now,
        // A fresh upload retires any prior decision — admin re-reviews.
        decision: null,
        decision_at: null,
        decision_by_admin_uid: null,
        decision_notes: null,
        updated_at: now,
      })
      .where('provider_id', '=', provider.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return c.json(buildRegistrationResponse(provider, updated as unknown as RegistrationRow), 200);
  });

  // --- FCCH admin-side ---

  app.openapi(adminGetRegistrationRoute, async (c) => {
    const { db } = c.var.deps;
    const { providerId } = c.req.valid('param');

    const provider = await loadProviderById(db, providerId);
    if (!provider) return c.json({ error: 'provider_not_found' }, 404);
    if (!isChildcareCaregiver(provider)) {
      return c.json({ error: 'home_childcare_registration_not_applicable' }, 409);
    }
    const row = await loadOrCreateRegistration(db, provider.id);
    return c.json(buildRegistrationResponse(provider, row), 200);
  });

  app.openapi(adminDecisionRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { providerId } = c.req.valid('param');
    const body = c.req.valid('json');

    const provider = await loadProviderById(db, providerId);
    if (!provider) return c.json({ error: 'provider_not_found' }, 404);
    if (!isChildcareCaregiver(provider)) {
      return c.json({ error: 'home_childcare_registration_not_applicable' }, 409);
    }

    await loadOrCreateRegistration(db, provider.id);

    const now = new Date();
    const updated = await db
      .updateTable('provider_home_childcare_registrations')
      .set({
        decision: body.decision,
        decision_at: now,
        decision_by_admin_uid: principal.uid,
        decision_notes: body.notes ?? null,
        updated_at: now,
      })
      .where('provider_id', '=', provider.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return c.json(buildRegistrationResponse(provider, updated as unknown as RegistrationRow), 200);
  });

  // --- W-10 self-attestation ---

  app.openapi(getAttestationRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;

    const provider = await loadProviderByUid(db, principal.uid);
    if (!provider) {
      return c.json(
        { error: 'provider_not_found', reason: 'claim a supply role first (POST /v1/auth/role-claim)' },
        404,
      );
    }

    const profile = await db
      .selectFrom('provider_profiles')
      .select(['w10_tax_credit_friendly'])
      .where('provider_id', '=', provider.id)
      .executeTakeFirst();
    const selfAttested = profile?.w10_tax_credit_friendly ?? false;

    return c.json(buildAttestationResponse(provider, selfAttested), 200);
  });

  app.openapi(putAttestationRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const body = c.req.valid('json');

    const provider = await loadProviderByUid(db, principal.uid);
    if (!provider) return c.json({ error: 'provider_not_found' }, 404);

    if (body.selfAttested && !isChildcareCaregiver(provider)) {
      return c.json(
        {
          error: 'w10_not_eligible',
          reason: 'the Tax-credit-friendly (W-10) badge is only available for Babysitter and Nanny Caregivers',
        },
        400,
      );
    }

    // load-or-create the profile row so the toggle always has a target.
    const existing = await db
      .selectFrom('provider_profiles')
      .select(['provider_id'])
      .where('provider_id', '=', provider.id)
      .executeTakeFirst();
    if (!existing) {
      await db.insertInto('provider_profiles').values({ provider_id: provider.id }).execute();
    }

    await db
      .updateTable('provider_profiles')
      .set({ w10_tax_credit_friendly: body.selfAttested, updated_at: new Date() })
      .where('provider_id', '=', provider.id)
      .execute();

    return c.json(buildAttestationResponse(provider, body.selfAttested), 200);
  });
}

function buildAttestationResponse(provider: ProviderRow, selfAttested: boolean) {
  const categories = (provider.categories ?? []) as CaregiverCategory[];
  return {
    providerId: provider.id,
    role: provider.role,
    categories: provider.categories as CaregiverCategory[] | null,
    w10Eligible: isTaxCreditFriendlyBadgeEligible(categories, true),
    selfAttested,
    taxCreditFriendly: isTaxCreditFriendlyBadgeEligible(categories, selfAttested),
  };
}
