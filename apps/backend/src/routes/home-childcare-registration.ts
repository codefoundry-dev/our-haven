import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  findHomeChildcareLicenseBoard,
  isHomeChildcareLicenseBoardLaunchState,
  type HomeChildcareLicenseBoard,
} from '@our-haven/domain';
import { US_STATES_50_PLUS_DC, type UsState } from '@our-haven/shared';

/**
 * Optional "State-registered home childcare" credential surface (OH-108).
 *
 * Provider-side endpoints let a Babysitter / Nanny Caregiver see the home-
 * childcare licensing agency for their state (sourced from the
 * `home-childcare-license-board` slate in @our-haven/domain) and upload the
 * state registration certificate.
 *
 * Admin-side endpoints let a Trust & Safety admin review the uploaded
 * certificate, cross-check it against the surfaced state register URL, and
 * record a `verified` | `rejected` decision. On `verified`, the Provider's
 * public profile shows the "State-registered home childcare" badge naming the
 * specific state agency.
 *
 * Unlike the Specialist license flow (OH-107), this credential is **purely
 * optional** — it never updates `provider_verifications` and never gates
 * activation. The Verification state machine ignores the decision entirely.
 *
 * Eligibility:
 *   - kind=caregiver AND caregiver_category IN ('babysitter','nanny')  → allowed
 *   - anything else (Tutor, Specialist)                                → 409
 *
 * Both endpoint pairs return 409 for ineligible Providers because exposing
 * upload affordances to Tutors/Specialists would mis-signal that the badge is
 * applicable to them.
 */

const StateEnum = z.enum(US_STATES_50_PLUS_DC);

const HomeChildcareBoardSchema = z.object({
  state: StateEnum,
  agencyName: z.string(),
  programName: z.string(),
  registerUrl: z.string().url(),
  hint: z.string(),
});

const RegistrationResponse = z.object({
  providerId: z.uuid(),
  kind: z.enum(['caregiver', 'specialist']),
  caregiverCategory: z.enum(['babysitter', 'tutor', 'nanny']).nullable(),
  residentState: StateEnum,
  /** Whether the slate covers the Provider's resident state. */
  homeChildcareBoardSupported: z.boolean(),
  /** Board metadata for the resident state. Null when not in the launch slate. */
  board: HomeChildcareBoardSchema.nullable(),
  /** The state captured at upload time (kept stable if the Provider moves). */
  stateAtUpload: StateEnum.nullable(),
  certificateDocObjectPath: z.string().nullable(),
  certificateUploadedAt: z.iso.datetime().nullable(),
  decision: z.enum(['verified', 'rejected']).nullable(),
  decisionAt: z.iso.datetime().nullable(),
  decisionByAdminUid: z.string().nullable(),
  decisionNotes: z.string().nullable(),
});

const RegistrationConfirmRequest = z
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

interface RegistrationRow {
  provider_id: string;
  state_at_upload: string | null;
  certificate_doc_object_path: string | null;
  certificate_uploaded_at: Date | null;
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

function isEligible(provider: ProviderRow): boolean {
  return (
    provider.kind === 'caregiver' &&
    (provider.caregiver_category === 'babysitter' || provider.caregiver_category === 'nanny')
  );
}

function buildResponse(provider: ProviderRow, row: RegistrationRow) {
  const residentState = provider.state as UsState;
  const board: HomeChildcareLicenseBoard | null = findHomeChildcareLicenseBoard(residentState);
  return {
    providerId: provider.id,
    kind: provider.kind,
    caregiverCategory: provider.caregiver_category as 'babysitter' | 'tutor' | 'nanny' | null,
    residentState,
    homeChildcareBoardSupported: isHomeChildcareLicenseBoardLaunchState(residentState),
    board,
    stateAtUpload: row.state_at_upload as UsState | null,
    certificateDocObjectPath: row.certificate_doc_object_path,
    certificateUploadedAt: toIso(row.certificate_uploaded_at),
    decision: row.decision,
    decisionAt: toIso(row.decision_at),
    decisionByAdminUid: row.decision_by_admin_uid,
    decisionNotes: row.decision_notes,
  };
}

export const homeChildcareRegistrationRoutes: FastifyPluginAsyncZod = async (app) => {
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

  async function loadOrCreateRegistration(providerId: string): Promise<RegistrationRow> {
    const existing = await app.deps.db
      .selectFrom('provider_home_childcare_registrations')
      .selectAll()
      .where('provider_id', '=', providerId)
      .executeTakeFirst();
    if (existing) return existing as RegistrationRow;
    const inserted = await app.deps.db
      .insertInto('provider_home_childcare_registrations')
      .values({ provider_id: providerId })
      .returningAll()
      .executeTakeFirstOrThrow();
    return inserted as RegistrationRow;
  }

  // ---- Provider-side ----

  app.get(
    '/providers/me/home-childcare-registration',
    {
      preHandler: app.requireAuth({ roles: ['provider'] }),
      schema: {
        tags: ['providers'],
        summary: "Read the authenticated Caregiver's state home-childcare registration context",
        description:
          'Returns the per-state home-childcare-licensing-agency context (agency name, programme name, register URL, admin hint) plus the current upload + admin-decision state. Eligibility: kind=caregiver AND caregiver_category in [babysitter, nanny] — Tutors and Specialists get 409. When the Provider\'s state is outside the launch slate, `homeChildcareBoardSupported` is false and `board` is null; the upload affordance should be hidden client-side.',
        security: [{ supabaseAccessToken: [] }],
        response: {
          200: RegistrationResponse,
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
      if (!isEligible(provider)) {
        reply.code(409);
        return {
          error: 'home_childcare_registration_not_applicable',
          reason: 'home-childcare registration is only available for Babysitter / Nanny Caregivers',
        };
      }
      const row = await loadOrCreateRegistration(provider.id);
      return buildResponse(provider, row);
    },
  );

  app.post(
    '/providers/me/home-childcare-registration',
    {
      preHandler: app.requireAuth({ roles: ['provider'] }),
      schema: {
        tags: ['providers'],
        summary: 'Record a completed state home-childcare-registration certificate upload',
        description:
          'Called after the Provider portal uploads the state registration certificate through the signed-URL flow (POST /v1/uploads/signed-url with kind=state-childcare-registration). The body carries the returned objectPath; the server validates the objectPath is scoped to the caller and records the upload along with the Provider\'s resident state at upload time (so the badge keeps naming the correct agency if the Provider later moves).',
        security: [{ supabaseAccessToken: [] }],
        body: RegistrationConfirmRequest,
        response: {
          200: RegistrationResponse,
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
      if (!isEligible(provider)) {
        reply.code(409);
        return { error: 'home_childcare_registration_not_applicable' };
      }
      const expectedPrefix = `state-childcare-registration/${principal.uid}/`;
      if (!req.body.objectPath.startsWith(expectedPrefix)) {
        reply.code(400);
        return { error: 'invalid_object_path', reason: `objectPath must start with ${expectedPrefix}` };
      }

      await loadOrCreateRegistration(provider.id);
      const now = new Date();
      const updated = await app.deps.db
        .updateTable('provider_home_childcare_registrations')
        .set({
          state_at_upload: provider.state,
          certificate_doc_object_path: req.body.objectPath,
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
      return buildResponse(provider, updated as RegistrationRow);
    },
  );

  // ---- Admin-side ----

  app.get(
    '/admin/providers/:providerId/home-childcare-registration',
    {
      preHandler: app.requireAuth({ roles: ['admin'] }),
      schema: {
        tags: ['providers'],
        summary: 'Admin — read a Caregiver Provider\'s home-childcare-registration context + uploaded cert + decision',
        description:
          'Surfaces the per-state home-childcare-licensing-agency metadata (agency name + register URL + hint) so the admin can cross-check the uploaded certificate on the right state portal. Same response shape as the Provider-side endpoint.',
        security: [{ supabaseAccessToken: [] }],
        params: ProviderIdParam,
        response: {
          200: RegistrationResponse,
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
      if (!isEligible(provider)) {
        reply.code(409);
        return { error: 'home_childcare_registration_not_applicable' };
      }
      const row = await loadOrCreateRegistration(provider.id);
      return buildResponse(provider, row);
    },
  );

  app.post(
    '/admin/providers/:providerId/home-childcare-registration',
    {
      preHandler: app.requireAuth({ roles: ['admin'] }),
      schema: {
        tags: ['providers'],
        summary: 'Admin — record a home-childcare-registration decision (verified | rejected)',
        description:
          'Admin manual verification flow per CONTEXT.md § CDCTC-eligibility & state childcare licensure. On `verified` the Provider\'s public profile gains the "State-registered home childcare" badge naming the specific state agency. On `rejected` the badge stays off. This decision is decoupled from the Verification state machine — it never blocks activation.',
        security: [{ supabaseAccessToken: [] }],
        params: ProviderIdParam,
        body: AdminDecisionRequest,
        response: {
          200: RegistrationResponse,
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
      if (!isEligible(provider)) {
        reply.code(409);
        return { error: 'home_childcare_registration_not_applicable' };
      }

      await loadOrCreateRegistration(provider.id);

      const now = new Date();
      const updated = await app.deps.db
        .updateTable('provider_home_childcare_registrations')
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

      return buildResponse(provider, updated as RegistrationRow);
    },
  );
};
