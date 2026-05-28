import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  boardsForState,
  findLicenseBoard,
  isLicenseBoardLaunchState,
  type LicenseBoard,
} from '@our-haven/domain';
import { SPECIALTIES, US_STATES_50_PLUS_DC, type Specialty, type UsState } from '@our-haven/shared';

/**
 * Specialist license + insurance credential surface (OH-107).
 *
 * Provider-side endpoints let a Specialist see their issuing state board
 * (boards-by-(state, specialty) come from `@our-haven/domain`'s license-board
 * slate) and upload the license certificate + insurance COI.
 *
 * Admin-side endpoints let a Trust & Safety admin review the uploaded
 * artefacts, cross-check the license number against the surfaced register URL,
 * and record a `verified` | `rejected` decision. On `verified`, the matching
 * `provider_verifications.license_verified_at` timestamp is updated, which the
 * pure-TS Verification state machine reads to advance the Provider.
 *
 * Caregivers (kind=caregiver) get HTTP 409 from these endpoints — they never
 * need a license; Checkr alone is sufficient.
 */

const Kind = z.enum(['caregiver', 'specialist']);
const SpecialtyEnum = z.enum(SPECIALTIES);
const StateEnum = z.enum(US_STATES_50_PLUS_DC);

const LicenseBoardSchema = z.object({
  state: StateEnum,
  specialty: SpecialtyEnum,
  boardName: z.string(),
  registerUrl: z.string().url(),
  mode: z.enum(['api', 'portal-only']),
  hint: z.string().optional(),
});

const CredentialsResponse = z.object({
  providerId: z.uuid(),
  kind: Kind,
  residentState: StateEnum,
  specialty: SpecialtyEnum.nullable(),
  licenseBoardSupported: z.boolean(),
  defaultBoard: LicenseBoardSchema.nullable(),
  /** Alternate boards in the resident state (one per specialty) — useful when
   *  a Specialist with `specialty=other` needs to pick which board issued them. */
  altBoardsInState: z.array(LicenseBoardSchema),
  licenseBoardState: StateEnum.nullable(),
  licenseNumber: z.string().nullable(),
  licenseDocObjectPath: z.string().nullable(),
  licenseUploadedAt: z.iso.datetime().nullable(),
  insuranceDocObjectPath: z.string().nullable(),
  insuranceUploadedAt: z.iso.datetime().nullable(),
  decision: z.enum(['verified', 'rejected']).nullable(),
  decisionAt: z.iso.datetime().nullable(),
  decisionByAdminUid: z.string().nullable(),
  decisionNotes: z.string().nullable(),
});

const LicenseConfirmRequest = z
  .object({
    objectPath: z.string().min(1).max(512),
    licenseNumber: z.string().min(1).max(64).nullable().optional(),
    licenseBoardState: StateEnum.nullable().optional(),
  })
  .strict();

const InsuranceConfirmRequest = z
  .object({
    objectPath: z.string().min(1).max(512),
  })
  .strict();

const AdminDecisionRequest = z
  .object({
    decision: z.enum(['verified', 'rejected']),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const ProviderIdParam = z.object({ providerId: z.uuid() });

const ErrorResponse = z.object({
  error: z.string(),
  reason: z.string().optional(),
});

interface ProviderRow {
  id: string;
  uid: string;
  kind: 'caregiver' | 'specialist';
  caregiver_category: string | null;
  specialty: string | null;
  state: string;
}

interface CredentialsRow {
  provider_id: string;
  license_board_state: string | null;
  license_number: string | null;
  license_doc_object_path: string | null;
  license_uploaded_at: Date | null;
  insurance_doc_object_path: string | null;
  insurance_uploaded_at: Date | null;
  decision: 'verified' | 'rejected' | null;
  decision_at: Date | null;
  decision_by_admin_uid: string | null;
  decision_notes: string | null;
}

function asDate(value: Date | null): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function toIso(value: Date | null): string | null {
  const d = asDate(value);
  return d ? d.toISOString() : null;
}

function buildResponse(provider: ProviderRow, row: CredentialsRow) {
  const residentState = provider.state as UsState;
  const specialty = provider.specialty as Specialty | null;
  const board: LicenseBoard | null =
    specialty !== null ? findLicenseBoard(residentState, specialty) : null;
  const altBoards = [...boardsForState(residentState)];
  return {
    providerId: provider.id,
    kind: provider.kind,
    residentState,
    specialty,
    licenseBoardSupported: isLicenseBoardLaunchState(residentState),
    defaultBoard: board,
    altBoardsInState: altBoards,
    licenseBoardState: row.license_board_state as UsState | null,
    licenseNumber: row.license_number,
    licenseDocObjectPath: row.license_doc_object_path,
    licenseUploadedAt: toIso(asDate(row.license_uploaded_at)),
    insuranceDocObjectPath: row.insurance_doc_object_path,
    insuranceUploadedAt: toIso(asDate(row.insurance_uploaded_at)),
    decision: row.decision,
    decisionAt: toIso(asDate(row.decision_at)),
    decisionByAdminUid: row.decision_by_admin_uid,
    decisionNotes: row.decision_notes,
  };
}

export const specialistCredentialsRoutes: FastifyPluginAsyncZod = async (app) => {
  async function loadProviderByUid(uid: string): Promise<ProviderRow | null> {
    const row = await app.deps.db
      .selectFrom('providers')
      .select(['id', 'uid', 'kind', 'caregiver_category', 'specialty', 'state'])
      .where('uid', '=', uid)
      .executeTakeFirst();
    return row ? (row as ProviderRow) : null;
  }

  async function loadProviderById(providerId: string): Promise<ProviderRow | null> {
    const row = await app.deps.db
      .selectFrom('providers')
      .select(['id', 'uid', 'kind', 'caregiver_category', 'specialty', 'state'])
      .where('id', '=', providerId)
      .executeTakeFirst();
    return row ? (row as ProviderRow) : null;
  }

  async function loadOrCreateCredentials(providerId: string): Promise<CredentialsRow> {
    const existing = await app.deps.db
      .selectFrom('specialist_credentials')
      .selectAll()
      .where('provider_id', '=', providerId)
      .executeTakeFirst();
    if (existing) return existing as CredentialsRow;
    const inserted = await app.deps.db
      .insertInto('specialist_credentials')
      .values({ provider_id: providerId })
      .returningAll()
      .executeTakeFirstOrThrow();
    return inserted as CredentialsRow;
  }

  // ---- Provider-side ----

  app.get(
    '/providers/me/credentials',
    {
      preHandler: app.requireAuth({ roles: ['provider'] }),
      schema: {
        tags: ['providers'],
        summary: "Read the authenticated Specialist's license + insurance credentials",
        description:
          'Returns the per-state license-board context (board name, register URL, hint) plus the current upload + decision state for the Specialist. Caregivers (kind=caregiver) get 409 — they never need a license.',
        security: [{ supabaseAccessToken: [] }],
        response: {
          200: CredentialsResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const principal = req.principal!;
      const provider = await loadProviderByUid(principal.uid);
      if (!provider) {
        reply.code(404);
        return { error: 'provider_not_found' };
      }
      if (provider.kind !== 'specialist') {
        reply.code(409);
        return {
          error: 'license_not_applicable',
          reason: 'license verification is only required for Specialists',
        };
      }
      const row = await loadOrCreateCredentials(provider.id);
      return buildResponse(provider, row);
    },
  );

  app.post(
    '/providers/me/credentials/license',
    {
      preHandler: app.requireAuth({ roles: ['provider'] }),
      schema: {
        tags: ['providers'],
        summary: 'Record a completed Specialist license-document upload',
        description:
          'Called after the Provider portal uploads a license certificate through the signed-URL flow (POST /v1/uploads/signed-url with kind=license-doc). The body carries the returned objectPath plus optional licenseNumber and licenseBoardState. The server validates the objectPath is scoped to the caller and records the upload + metadata.',
        security: [{ supabaseAccessToken: [] }],
        body: LicenseConfirmRequest,
        response: {
          200: CredentialsResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const principal = req.principal!;
      const provider = await loadProviderByUid(principal.uid);
      if (!provider) {
        reply.code(404);
        return { error: 'provider_not_found' };
      }
      if (provider.kind !== 'specialist') {
        reply.code(409);
        return { error: 'license_not_applicable' };
      }
      const expectedPrefix = `license-doc/${principal.uid}/`;
      if (!req.body.objectPath.startsWith(expectedPrefix)) {
        reply.code(400);
        return { error: 'invalid_object_path', reason: `objectPath must start with ${expectedPrefix}` };
      }

      await loadOrCreateCredentials(provider.id);

      const updates: Record<string, unknown> = {
        license_doc_object_path: req.body.objectPath,
        license_uploaded_at: new Date(),
        updated_at: new Date(),
      };
      if (req.body.licenseNumber !== undefined) updates.license_number = req.body.licenseNumber;
      if (req.body.licenseBoardState !== undefined)
        updates.license_board_state = req.body.licenseBoardState;

      const updated = await app.deps.db
        .updateTable('specialist_credentials')
        .set(updates)
        .where('provider_id', '=', provider.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return buildResponse(provider, updated as CredentialsRow);
    },
  );

  app.post(
    '/providers/me/credentials/insurance',
    {
      preHandler: app.requireAuth({ roles: ['provider'] }),
      schema: {
        tags: ['providers'],
        summary: 'Record a completed Specialist liability-insurance COI upload',
        description:
          'Called after the Provider portal uploads a Certificate of Insurance through the signed-URL flow (POST /v1/uploads/signed-url with kind=insurance-doc). Optional — encouraged but not required for activation.',
        security: [{ supabaseAccessToken: [] }],
        body: InsuranceConfirmRequest,
        response: {
          200: CredentialsResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const principal = req.principal!;
      const provider = await loadProviderByUid(principal.uid);
      if (!provider) {
        reply.code(404);
        return { error: 'provider_not_found' };
      }
      if (provider.kind !== 'specialist') {
        reply.code(409);
        return { error: 'license_not_applicable' };
      }
      const expectedPrefix = `insurance-doc/${principal.uid}/`;
      if (!req.body.objectPath.startsWith(expectedPrefix)) {
        reply.code(400);
        return { error: 'invalid_object_path', reason: `objectPath must start with ${expectedPrefix}` };
      }

      await loadOrCreateCredentials(provider.id);

      const updated = await app.deps.db
        .updateTable('specialist_credentials')
        .set({
          insurance_doc_object_path: req.body.objectPath,
          insurance_uploaded_at: new Date(),
          updated_at: new Date(),
        })
        .where('provider_id', '=', provider.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return buildResponse(provider, updated as CredentialsRow);
    },
  );

  // ---- Admin-side ----

  app.get(
    '/admin/providers/:providerId/license-verification',
    {
      preHandler: app.requireAuth({ roles: ['admin'] }),
      schema: {
        tags: ['providers'],
        summary: 'Admin — read a Specialist Provider\'s license-board context + uploaded docs + decision',
        description:
          'Surfaces the per-state license-board metadata (board name + register URL + hint) so the admin can cross-check the uploaded license number on the right portal. Returns the same shape as the Provider-side endpoint plus the admin decision audit fields.',
        security: [{ supabaseAccessToken: [] }],
        params: ProviderIdParam,
        response: {
          200: CredentialsResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const provider = await loadProviderById(req.params.providerId);
      if (!provider) {
        reply.code(404);
        return { error: 'provider_not_found' };
      }
      if (provider.kind !== 'specialist') {
        reply.code(409);
        return { error: 'license_not_applicable' };
      }
      const row = await loadOrCreateCredentials(provider.id);
      return buildResponse(provider, row);
    },
  );

  app.post(
    '/admin/providers/:providerId/license-verification',
    {
      preHandler: app.requireAuth({ roles: ['admin'] }),
      schema: {
        tags: ['providers'],
        summary: 'Admin — record a license-verification decision (verified | rejected)',
        description:
          'Admin manual verification flow per CONTEXT.md § Verification + ADR-0007 / OH-107. On `verified`, sets `provider_verifications.license_verified_at = now()`, which the Verification state machine reads to advance the Specialist toward `activated`. On `rejected`, sets `provider_verifications.rejected_at = now()` with the decision notes mirrored into rejection_reason.',
        security: [{ supabaseAccessToken: [] }],
        params: ProviderIdParam,
        body: AdminDecisionRequest,
        response: {
          200: CredentialsResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const principal = req.principal!;
      const provider = await loadProviderById(req.params.providerId);
      if (!provider) {
        reply.code(404);
        return { error: 'provider_not_found' };
      }
      if (provider.kind !== 'specialist') {
        reply.code(409);
        return { error: 'license_not_applicable' };
      }

      await loadOrCreateCredentials(provider.id);

      const now = new Date();
      const updated = await app.deps.db
        .updateTable('specialist_credentials')
        .set({
          decision: req.body.decision,
          decision_at: now,
          decision_by_admin_uid: principal.uid,
          decision_notes: req.body.notes ?? null,
          updated_at: now,
        })
        .where('provider_id', '=', provider.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Mirror into provider_verifications so the state machine advances.
      // The verification row may not yet exist if the Specialist hasn't hit
      // the verification GET; create it on demand.
      const existingVerif = await app.deps.db
        .selectFrom('provider_verifications')
        .select('provider_id')
        .where('provider_id', '=', provider.id)
        .executeTakeFirst();
      if (!existingVerif) {
        await app.deps.db
          .insertInto('provider_verifications')
          .values({ provider_id: provider.id })
          .execute();
      }
      const verifUpdates: Record<string, unknown> = { updated_at: now };
      if (req.body.decision === 'verified') {
        verifUpdates.license_verified_at = now;
      } else {
        verifUpdates.rejected_at = now;
        verifUpdates.rejection_reason = req.body.notes ?? 'license rejected by admin';
      }
      await app.deps.db
        .updateTable('provider_verifications')
        .set(verifUpdates)
        .where('provider_id', '=', provider.id)
        .execute();

      return buildResponse(provider, updated as CredentialsRow);
    },
  );
};
