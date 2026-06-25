import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import { SPECIALTIES, type Specialty } from '../auth/taxonomy.ts';
import { US_STATES, type UsState } from '../auth/us-states.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';
// The per-state license-board slate (@our-haven/domain, OH-107/181) is the single
// source of truth for board name + public-register URL + verification mode. It is
// reached cross-tree by an explicit `.ts` specifier — the SAME pattern
// verification.ts uses for the Verification state machine — now that OH-186 made
// the module Deno-clean (type-only @our-haven/shared import). No more CSV mirror:
// the admin's register pointer comes straight from the domain slate.
import {
  boardsForState,
  findLicenseBoard,
  isLicenseBoardLaunchState,
  type LicenseBoard,
} from '../../../../packages/domain/src/license-board/index.ts';

/**
 * Provider (clinical tier) license + insurance credential surface (OH-186).
 *
 * Ports the Fastify plugin (apps/backend/src/routes/specialist-credentials.ts)
 * onto the Hono fat Edge Function (ADR-0019). Two audiences:
 *
 *   Provider-side (role=provider) — see your issuing state board (resolved from
 *   the per-state license-board slate) and record license + insurance uploads:
 *     GET  /v1/providers/me/credentials
 *     POST /v1/providers/me/credentials/license
 *     POST /v1/providers/me/credentials/insurance
 *
 *   Admin-side (role=admin, aal2+TOTP) — cross-check the uploaded license number
 *   against the surfaced register URL and record a decision with a timestamp:
 *     GET  /v1/admin/providers/{providerId}/license-verification
 *     POST /v1/admin/providers/{providerId}/license-verification
 *
 * ── How the admin decision advances the Verification state machine ───────────
 * The clinical Provider has TWO domain activation gates after screening —
 * `license-pending` then `insurance-pending` (verification-workflow, OH-181) —
 * but `specialist_credentials` carries ONE decision (it is the admin's holistic
 * review of the uploaded license cert + insurance COI together). So a `verified`
 * decision stamps BOTH `provider_verifications.license_verified_at` AND
 * `.insurance_verified_at = now()`, clearing both gates in one action; a
 * `rejected` decision stamps the terminal `rejected_at` + `rejection_reason`.
 * The admin GET surfaces both upload paths so the decision is never made blind.
 *
 * All 12 launch states are `portal-only` (license-board Mode legend): there is no
 * programmatic register API in v1, so the admin verifies out-of-band via the
 * board's `registerUrl` and this handler records the outcome. A Provider whose
 * resident state is outside the slate (`licenseBoardSupported=false`) rests in
 * the domain's `holding-state-not-supported` branch; they may still upload, and
 * the admin records the decision once that state's adapter ships.
 */

const SUPPLY_ROLES = ['caregiver', 'provider'] as const;

const SpecialtyEnum = z.enum(SPECIALTIES);
const StateEnum = z.enum(US_STATES);

const LicenseBoardSchema = z
  .object({
    state: StateEnum,
    specialty: SpecialtyEnum,
    boardName: z.string(),
    registerUrl: z.string().url(),
    mode: z.enum(['api', 'portal-only']),
    hint: z.string().optional(),
  })
  .openapi('LicenseBoard');

const CredentialsResponse = z
  .object({
    providerId: z.string(),
    role: z.enum(SUPPLY_ROLES),
    residentState: StateEnum,
    specialty: SpecialtyEnum.nullable(),
    /** Whether the resident state is in the launch adapter slate (drives the holding state). */
    licenseBoardSupported: z.boolean(),
    /** The board for (residentState, specialty), or null if specialty unset / out of slate. */
    defaultBoard: LicenseBoardSchema.nullable(),
    /** All boards in the resident state (one per specialty) — for a Provider with specialty=other. */
    altBoardsInState: z.array(LicenseBoardSchema),
    licenseBoardState: StateEnum.nullable(),
    licenseNumber: z.string().nullable(),
    licenseDocObjectPath: z.string().nullable(),
    licenseUploadedAt: z.string().datetime().nullable(),
    insuranceDocObjectPath: z.string().nullable(),
    insuranceUploadedAt: z.string().datetime().nullable(),
    decision: z.enum(['verified', 'rejected']).nullable(),
    decisionAt: z.string().datetime().nullable(),
    decisionByAdminUid: z.string().nullable(),
    decisionNotes: z.string().nullable(),
  })
  .openapi('ProviderCredentials');

const LicenseConfirmRequest = z
  .object({
    objectPath: z.string().min(1).max(512),
    licenseNumber: z.string().min(1).max(64).nullable().optional(),
    licenseBoardState: StateEnum.nullable().optional(),
  })
  .openapi('ProviderLicenseConfirmRequest');

const InsuranceConfirmRequest = z
  .object({
    objectPath: z.string().min(1).max(512),
  })
  .openapi('ProviderInsuranceConfirmRequest');

const AdminDecisionRequest = z
  .object({
    decision: z.enum(['verified', 'rejected']),
    notes: z.string().max(2000).optional(),
  })
  .openapi('ProviderLicenseDecisionRequest');

const ProviderIdParam = z.object({
  providerId: z.string().uuid().openapi({ param: { name: 'providerId', in: 'path' } }),
});

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('ProviderCredentialsError');

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

interface ProviderRow {
  id: string;
  uid: string;
  role: 'caregiver' | 'provider';
  specialty: string | null;
  state: string;
}

interface CredentialsRow {
  provider_id: string;
  license_board_state: string | null;
  license_number: string | null;
  license_doc_object_path: string | null;
  license_uploaded_at: Date | string | null;
  insurance_doc_object_path: string | null;
  insurance_uploaded_at: Date | string | null;
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

async function loadProviderByUid(db: Db, uid: string): Promise<ProviderRow | null> {
  const row = await db
    .selectFrom('providers')
    .select(['id', 'uid', 'role', 'specialty', 'state'])
    .where('uid', '=', uid)
    .executeTakeFirst();
  return row ? (row as ProviderRow) : null;
}

async function loadProviderById(db: Db, providerId: string): Promise<ProviderRow | null> {
  const row = await db
    .selectFrom('providers')
    .select(['id', 'uid', 'role', 'specialty', 'state'])
    .where('id', '=', providerId)
    .executeTakeFirst();
  return row ? (row as ProviderRow) : null;
}

async function loadOrCreateCredentials(db: Db, providerId: string): Promise<CredentialsRow> {
  const existing = await db
    .selectFrom('specialist_credentials')
    .selectAll()
    .where('provider_id', '=', providerId)
    .executeTakeFirst();
  if (existing) return existing as unknown as CredentialsRow;

  const inserted = await db
    .insertInto('specialist_credentials')
    .values({ provider_id: providerId })
    .returningAll()
    .executeTakeFirstOrThrow();
  return inserted as unknown as CredentialsRow;
}

function buildResponse(provider: ProviderRow, row: CredentialsRow) {
  const residentState = provider.state as UsState;
  const specialty = provider.specialty as Specialty | null;
  const defaultBoard: LicenseBoard | null =
    specialty !== null ? findLicenseBoard(residentState, specialty) : null;
  return {
    providerId: provider.id,
    role: provider.role,
    residentState,
    specialty,
    licenseBoardSupported: isLicenseBoardLaunchState(residentState),
    defaultBoard,
    altBoardsInState: [...boardsForState(residentState)],
    licenseBoardState: (row.license_board_state as UsState | null) ?? null,
    licenseNumber: row.license_number,
    licenseDocObjectPath: row.license_doc_object_path,
    licenseUploadedAt: toIso(row.license_uploaded_at),
    insuranceDocObjectPath: row.insurance_doc_object_path,
    insuranceUploadedAt: toIso(row.insurance_uploaded_at),
    decision: row.decision,
    decisionAt: toIso(row.decision_at),
    decisionByAdminUid: row.decision_by_admin_uid,
    decisionNotes: row.decision_notes,
  };
}

/* ── routes ─────────────────────────────────────────────────────────────── */

const getMyCredentialsRoute = createRoute({
  method: 'get',
  path: '/providers/me/credentials',
  tags: ['verification'],
  summary: "Read the authenticated Provider's license + insurance credentials",
  description:
    'Returns the per-state license-board context (board name, register URL, hint) resolved from the resident state + specialty, plus the current upload + decision state. Caregivers are rejected by the provider-only role guard (403) — they never need a license; Checkr alone suffices.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['provider'] })] as const,
  responses: {
    200: { description: 'License + insurance credential state', content: json(CredentialsResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role (caregiver / parent / admin)', content: json(ErrorResponse) },
    404: { description: 'Supply (provider) row not found', content: json(ErrorResponse) },
    409: { description: 'Not a clinical Provider', content: json(ErrorResponse) },
  },
});

const confirmLicenseRoute = createRoute({
  method: 'post',
  path: '/providers/me/credentials/license',
  tags: ['verification'],
  summary: 'Record a completed Provider license-document upload',
  description:
    'Called after the supply portal uploads a license certificate through the signed-URL flow (POST /v1/uploads/signed-url with kind=license-doc). The body carries the returned objectPath (validated to the caller\'s license-doc namespace) plus optional licenseNumber and licenseBoardState.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['provider'] })] as const,
  request: { body: { content: json(LicenseConfirmRequest), required: true } },
  responses: {
    200: { description: 'License upload recorded', content: json(CredentialsResponse) },
    400: { description: 'objectPath not scoped to this user', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Supply (provider) row not found', content: json(ErrorResponse) },
    409: { description: 'Not a clinical Provider', content: json(ErrorResponse) },
  },
});

const confirmInsuranceRoute = createRoute({
  method: 'post',
  path: '/providers/me/credentials/insurance',
  tags: ['verification'],
  summary: 'Record a completed Provider liability-insurance COI upload',
  description:
    'Called after the supply portal uploads a Certificate of Insurance through the signed-URL flow (POST /v1/uploads/signed-url with kind=insurance-doc). The body carries the returned objectPath, validated to the caller\'s insurance-doc namespace.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['provider'] })] as const,
  request: { body: { content: json(InsuranceConfirmRequest), required: true } },
  responses: {
    200: { description: 'Insurance upload recorded', content: json(CredentialsResponse) },
    400: { description: 'objectPath not scoped to this user', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Supply (provider) row not found', content: json(ErrorResponse) },
    409: { description: 'Not a clinical Provider', content: json(ErrorResponse) },
  },
});

const adminGetRoute = createRoute({
  method: 'get',
  path: '/admin/providers/{providerId}/license-verification',
  tags: ['admin', 'verification'],
  summary: "Admin — read a Provider's license-board context + uploaded docs + decision",
  description:
    'Surfaces the per-state license-board metadata (board name + register URL + hint) so the admin can cross-check the uploaded license number on the right portal, plus both uploaded doc paths and the current decision audit fields. Admin role requires aal2+TOTP.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['admin'] })] as const,
  request: { params: ProviderIdParam },
  responses: {
    200: { description: 'Credential context for review', content: json(CredentialsResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Not an admin / TOTP required', content: json(ErrorResponse) },
    404: { description: 'Provider not found', content: json(ErrorResponse) },
    409: { description: 'Not a clinical Provider', content: json(ErrorResponse) },
  },
});

const adminDecisionRoute = createRoute({
  method: 'post',
  path: '/admin/providers/{providerId}/license-verification',
  tags: ['admin', 'verification'],
  summary: 'Admin — record a license + insurance verification decision (verified | rejected)',
  description:
    'Admin manual verification flow (CONTEXT § Verification; PRD stories 43, 65; ADR-0009). On `verified`, stamps provider_verifications.license_verified_at AND .insurance_verified_at = now() (the single decision covers both clinical-credential gates), advancing the Provider toward activation. On `rejected`, stamps the terminal rejected_at with the notes mirrored into rejection_reason. The decision (+ actor uid + timestamp + notes) is recorded on specialist_credentials as the audit trail.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['admin'] })] as const,
  request: {
    params: ProviderIdParam,
    body: { content: json(AdminDecisionRequest), required: true },
  },
  responses: {
    200: { description: 'Decision recorded', content: json(CredentialsResponse) },
    400: { description: 'Invalid request', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Not an admin / TOTP required', content: json(ErrorResponse) },
    404: { description: 'Provider not found', content: json(ErrorResponse) },
    409: { description: 'Not a clinical Provider', content: json(ErrorResponse) },
  },
});

export function registerProviderCredentialsRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(getMyCredentialsRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;

    const provider = await loadProviderByUid(db, principal.uid);
    if (!provider) {
      return c.json(
        { error: 'provider_not_found', reason: 'claim a supply role first (POST /v1/auth/role-claim)' },
        404,
      );
    }
    if (provider.role !== 'provider') {
      return c.json(
        { error: 'license_not_applicable', reason: 'license verification is only for clinical Providers' },
        409,
      );
    }
    const row = await loadOrCreateCredentials(db, provider.id);
    return c.json(buildResponse(provider, row), 200);
  });

  app.openapi(confirmLicenseRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const body = c.req.valid('json');

    const provider = await loadProviderByUid(db, principal.uid);
    if (!provider) return c.json({ error: 'provider_not_found' }, 404);
    if (provider.role !== 'provider') return c.json({ error: 'license_not_applicable' }, 409);

    const expectedPrefix = `license-doc/${principal.uid}/`;
    if (!body.objectPath.startsWith(expectedPrefix)) {
      return c.json(
        { error: 'invalid_object_path', reason: `objectPath must start with ${expectedPrefix}` },
        400,
      );
    }

    await loadOrCreateCredentials(db, provider.id);

    const updates: Record<string, unknown> = {
      license_doc_object_path: body.objectPath,
      license_uploaded_at: new Date(),
      updated_at: new Date(),
    };
    if (body.licenseNumber !== undefined) updates.license_number = body.licenseNumber;
    if (body.licenseBoardState !== undefined) updates.license_board_state = body.licenseBoardState;

    const updated = await db
      .updateTable('specialist_credentials')
      .set(updates)
      .where('provider_id', '=', provider.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return c.json(buildResponse(provider, updated as unknown as CredentialsRow), 200);
  });

  app.openapi(confirmInsuranceRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const body = c.req.valid('json');

    const provider = await loadProviderByUid(db, principal.uid);
    if (!provider) return c.json({ error: 'provider_not_found' }, 404);
    if (provider.role !== 'provider') return c.json({ error: 'license_not_applicable' }, 409);

    const expectedPrefix = `insurance-doc/${principal.uid}/`;
    if (!body.objectPath.startsWith(expectedPrefix)) {
      return c.json(
        { error: 'invalid_object_path', reason: `objectPath must start with ${expectedPrefix}` },
        400,
      );
    }

    await loadOrCreateCredentials(db, provider.id);

    const updated = await db
      .updateTable('specialist_credentials')
      .set({
        insurance_doc_object_path: body.objectPath,
        insurance_uploaded_at: new Date(),
        updated_at: new Date(),
      })
      .where('provider_id', '=', provider.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return c.json(buildResponse(provider, updated as unknown as CredentialsRow), 200);
  });

  app.openapi(adminGetRoute, async (c) => {
    const { db } = c.var.deps;
    const { providerId } = c.req.valid('param');

    const provider = await loadProviderById(db, providerId);
    if (!provider) return c.json({ error: 'provider_not_found' }, 404);
    if (provider.role !== 'provider') return c.json({ error: 'license_not_applicable' }, 409);

    const row = await loadOrCreateCredentials(db, provider.id);
    return c.json(buildResponse(provider, row), 200);
  });

  app.openapi(adminDecisionRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { providerId } = c.req.valid('param');
    const body = c.req.valid('json');

    const provider = await loadProviderById(db, providerId);
    if (!provider) return c.json({ error: 'provider_not_found' }, 404);
    if (provider.role !== 'provider') return c.json({ error: 'license_not_applicable' }, 409);

    await loadOrCreateCredentials(db, provider.id);

    const now = new Date();
    const updated = await db
      .updateTable('specialist_credentials')
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

    // Mirror into provider_verifications so the Verification state machine
    // advances. The verification row may not exist yet if the Provider never hit
    // the verification GET; create it on demand (matching the Fastify port).
    const existingVerif = await db
      .selectFrom('provider_verifications')
      .select('provider_id')
      .where('provider_id', '=', provider.id)
      .executeTakeFirst();
    if (!existingVerif) {
      await db.insertInto('provider_verifications').values({ provider_id: provider.id }).execute();
    }

    const verifUpdates: Record<string, unknown> = { updated_at: now };
    if (body.decision === 'verified') {
      // One decision clears BOTH clinical-credential gates (see header note):
      // license verified against the register + insurance COI reviewed.
      verifUpdates.license_verified_at = now;
      verifUpdates.insurance_verified_at = now;
    } else {
      verifUpdates.rejected_at = now;
      verifUpdates.rejection_reason = body.notes ?? 'clinical credentials rejected by admin';
    }
    await db
      .updateTable('provider_verifications')
      .set(verifUpdates)
      .where('provider_id', '=', provider.id)
      .execute();

    return c.json(buildResponse(provider, updated as unknown as CredentialsRow), 200);
  });
}
