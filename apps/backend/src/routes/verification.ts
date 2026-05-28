import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  computeVerificationState,
  LICENSE_BOARD_LAUNCH_STATES,
  VERIFICATION_STATES,
  type VerificationFacts,
} from '@our-haven/domain';
import {
  isUsState,
  PROVIDER_KINDS,
  US_STATES_50_PLUS_DC,
  type ProviderKind,
  type UsState,
} from '@our-haven/shared';

const VerificationStateEnum = z.enum(VERIFICATION_STATES);

const VerificationResponse = z.object({
  state: VerificationStateEnum,
  kind: z.enum(PROVIDER_KINDS),
  residentState: z.enum(US_STATES_50_PLUS_DC),
  licenseBoardSupported: z.boolean(),
  facts: z.object({
    emailConfirmedAt: z.iso.datetime().nullable(),
    phoneConfirmedAt: z.iso.datetime().nullable(),
    idDocUploadedAt: z.iso.datetime().nullable(),
    idDocObjectPath: z.string().nullable(),
    screeningInitiatedAt: z.iso.datetime().nullable(),
    screeningPassedAt: z.iso.datetime().nullable(),
    licenseVerifiedAt: z.iso.datetime().nullable(),
    connectAccountReadyAt: z.iso.datetime().nullable(),
    connectChargesEnabled: z.boolean(),
    connectPayoutsEnabled: z.boolean(),
    rejectedAt: z.iso.datetime().nullable(),
    rejectionReason: z.string().nullable(),
  }),
});

const IdDocConfirmRequest = z.object({
  objectPath: z.string().min(1).max(512),
});

const ErrorResponse = z.object({
  error: z.string(),
  reason: z.string().optional(),
});

interface ProviderRow {
  id: string;
  uid: string;
  kind: 'caregiver' | 'specialist';
  state: string;
}

interface VerificationRow {
  provider_id: string;
  email_confirmed_at: Date | null;
  phone_confirmed_at: Date | null;
  id_doc_object_path: string | null;
  id_doc_uploaded_at: Date | null;
  screening_initiated_at: Date | null;
  screening_passed_at: Date | null;
  license_verified_at: Date | null;
  rejected_at: Date | null;
  rejection_reason: string | null;
}

interface ConnectAccountSnapshot {
  charges_enabled: boolean;
  payouts_enabled: boolean;
  account_ready_at: Date | null;
}

/**
 * Resolve the supported-state set per OH-107. The canonical slate lives in
 * @our-haven/domain (`LICENSE_BOARD_LAUNCH_STATES`); the env var is an ops
 * override — set it to disable a state at runtime, or expand to additional
 * states once their adapter ships.
 */
function parseSupportedStates(raw: string): ReadonlySet<UsState> {
  if (!raw.trim()) return new Set<UsState>(LICENSE_BOARD_LAUNCH_STATES);
  const parts = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is UsState => isUsState(s));
  return new Set(parts);
}

function asDate(value: Date | null): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function toIso(value: Date | null): string | null {
  const d = asDate(value);
  return d ? d.toISOString() : null;
}

function buildResponse(
  provider: ProviderRow,
  row: VerificationRow,
  supportedStates: ReadonlySet<UsState>,
  connect: ConnectAccountSnapshot | null,
) {
  const kind = provider.kind as ProviderKind;
  const residentState = provider.state as UsState;
  const facts: VerificationFacts = {
    emailConfirmedAt: asDate(row.email_confirmed_at),
    phoneConfirmedAt: asDate(row.phone_confirmed_at),
    idDocUploadedAt: asDate(row.id_doc_uploaded_at),
    screeningInitiatedAt: asDate(row.screening_initiated_at),
    screeningPassedAt: asDate(row.screening_passed_at),
    licenseVerifiedAt: asDate(row.license_verified_at),
    connectAccountReadyAt: asDate(connect?.account_ready_at ?? null),
    rejectedAt: asDate(row.rejected_at),
  };
  const state = computeVerificationState({
    kind,
    state: residentState,
    supportedStates,
    facts,
  });
  return {
    state,
    kind,
    residentState,
    licenseBoardSupported: kind === 'caregiver' ? true : supportedStates.has(residentState),
    facts: {
      emailConfirmedAt: toIso(facts.emailConfirmedAt),
      phoneConfirmedAt: toIso(facts.phoneConfirmedAt),
      idDocUploadedAt: toIso(facts.idDocUploadedAt),
      idDocObjectPath: row.id_doc_object_path,
      screeningInitiatedAt: toIso(facts.screeningInitiatedAt),
      screeningPassedAt: toIso(facts.screeningPassedAt),
      licenseVerifiedAt: toIso(facts.licenseVerifiedAt),
      connectAccountReadyAt: toIso(facts.connectAccountReadyAt),
      connectChargesEnabled: connect?.charges_enabled ?? false,
      connectPayoutsEnabled: connect?.payouts_enabled ?? false,
      rejectedAt: toIso(facts.rejectedAt),
      rejectionReason: row.rejection_reason,
    },
  };
}

export const verificationRoutes: FastifyPluginAsyncZod = async (app) => {
  const supportedStates = parseSupportedStates(app.deps.env.LICENSE_BOARD_SUPPORTED_STATES);

  async function loadProvider(uid: string): Promise<ProviderRow | null> {
    const row = await app.deps.db
      .selectFrom('providers')
      .select(['id', 'uid', 'kind', 'state'])
      .where('uid', '=', uid)
      .executeTakeFirst();
    return row ? (row as ProviderRow) : null;
  }

  async function loadOrCreateVerification(providerId: string): Promise<VerificationRow> {
    const existing = await app.deps.db
      .selectFrom('provider_verifications')
      .selectAll()
      .where('provider_id', '=', providerId)
      .executeTakeFirst();
    if (existing) return existing as VerificationRow;

    const inserted = await app.deps.db
      .insertInto('provider_verifications')
      .values({ provider_id: providerId })
      .returningAll()
      .executeTakeFirstOrThrow();
    return inserted as VerificationRow;
  }

  async function loadConnectSnapshot(providerId: string): Promise<ConnectAccountSnapshot | null> {
    const row = await app.deps.db
      .selectFrom('provider_connect_accounts')
      .select(['charges_enabled', 'payouts_enabled', 'account_ready_at'])
      .where('provider_id', '=', providerId)
      .executeTakeFirst();
    return row ? (row as ConnectAccountSnapshot) : null;
  }

  app.get(
    '/providers/me/verification',
    {
      preHandler: app.requireAuth({ roles: ['provider'] }),
      schema: {
        tags: ['providers'],
        summary: 'Read the authenticated Provider\'s verification state + checklist facts',
        description:
          'Returns the current Verification state computed from per-step facts (email/phone/ID/screening/license) plus the raw timestamps that drive the design\'s 8-step checklist. Email + phone confirmations are mirrored from Supabase Auth on read so they reflect the latest session state.',
        security: [{ supabaseAccessToken: [] }],
        response: {
          200: VerificationResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const principal = req.principal!;
      const provider = await loadProvider(principal.uid);
      if (!provider) {
        reply.code(404);
        return { error: 'provider_not_found', reason: 'create a Provider row first (POST /v1/providers)' };
      }

      const row = await loadOrCreateVerification(provider.id);

      const synced = await syncAuthConfirmations(app, principal.uid, provider.id, row);
      const connect = await loadConnectSnapshot(provider.id);
      return buildResponse(provider, synced, supportedStates, connect);
    },
  );

  app.post(
    '/providers/me/verification/phone-confirm',
    {
      preHandler: app.requireAuth({ roles: ['provider'] }),
      schema: {
        tags: ['providers'],
        summary: 'Mirror Supabase phone confirmation into the verification facts',
        description:
          'Called by the Provider portal after the client completes Supabase phone OTP (supabase.auth.verifyOtp). Fetches the user from Supabase Admin, checks phone_confirmed_at, and records it on provider_verifications. Idempotent.',
        security: [{ supabaseAccessToken: [] }],
        response: {
          200: VerificationResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const principal = req.principal!;
      const provider = await loadProvider(principal.uid);
      if (!provider) {
        reply.code(404);
        return { error: 'provider_not_found' };
      }

      const user = await fetchSupabaseUser(app, principal.uid);
      if (!user.phone_confirmed_at) {
        reply.code(400);
        return { error: 'phone_not_confirmed', reason: 'complete supabase phone OTP first' };
      }

      const existing = await loadOrCreateVerification(provider.id);
      const confirmedAt = new Date(user.phone_confirmed_at);
      const updated = await app.deps.db
        .updateTable('provider_verifications')
        .set({ phone_confirmed_at: confirmedAt, updated_at: new Date() })
        .where('provider_id', '=', provider.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      const synced = await syncAuthConfirmations(app, principal.uid, provider.id, updated as VerificationRow, {
        knownUser: user,
      });
      void existing;
      const connect = await loadConnectSnapshot(provider.id);
      return buildResponse(provider, synced, supportedStates, connect);
    },
  );

  app.post(
    '/providers/me/verification/id-doc',
    {
      preHandler: app.requireAuth({ roles: ['provider'] }),
      schema: {
        tags: ['providers'],
        summary: 'Record a completed ID-document upload',
        description:
          'Called after the Provider portal uploads a government-issued ID through the signed-URL flow (POST /v1/uploads/signed-url with kind=id-doc → PUT to Supabase Storage). The body carries the returned objectPath; the server validates it is scoped to this user\'s id-doc namespace and records the upload timestamp.',
        security: [{ supabaseAccessToken: [] }],
        body: IdDocConfirmRequest,
        response: {
          200: VerificationResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const principal = req.principal!;
      const provider = await loadProvider(principal.uid);
      if (!provider) {
        reply.code(404);
        return { error: 'provider_not_found' };
      }

      const expectedPrefix = `id-doc/${principal.uid}/`;
      if (!req.body.objectPath.startsWith(expectedPrefix)) {
        reply.code(400);
        return { error: 'invalid_object_path', reason: `objectPath must start with ${expectedPrefix}` };
      }

      await loadOrCreateVerification(provider.id);
      const updated = await app.deps.db
        .updateTable('provider_verifications')
        .set({
          id_doc_object_path: req.body.objectPath,
          id_doc_uploaded_at: new Date(),
          updated_at: new Date(),
        })
        .where('provider_id', '=', provider.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      const synced = await syncAuthConfirmations(
        app,
        principal.uid,
        provider.id,
        updated as VerificationRow,
      );
      const connect = await loadConnectSnapshot(provider.id);
      return buildResponse(provider, synced, supportedStates, connect);
    },
  );
};

interface SupabaseUserSummary {
  email_confirmed_at?: string | null;
  phone_confirmed_at?: string | null;
}

async function fetchSupabaseUser(app: { deps: { supabase: { admin: { auth: { admin: { getUserById: (uid: string) => Promise<{ data: { user: SupabaseUserSummary | null } | null; error: { message: string } | null }> } } } } } }, uid: string): Promise<SupabaseUserSummary> {
  const { data, error } = await app.deps.supabase.admin.auth.admin.getUserById(uid);
  if (error || !data?.user) {
    throw new Error(`supabase getUserById failed: ${error?.message ?? 'no user'}`);
  }
  return data.user;
}

async function syncAuthConfirmations(
  app: Parameters<typeof fetchSupabaseUser>[0] & { deps: { db: import('@/db/kysely.js').Db } },
  uid: string,
  providerId: string,
  current: VerificationRow,
  opts: { knownUser?: SupabaseUserSummary } = {},
): Promise<VerificationRow> {
  const user = opts.knownUser ?? (await fetchSupabaseUser(app, uid));
  const emailAt = user.email_confirmed_at ? new Date(user.email_confirmed_at) : null;
  const phoneAt = user.phone_confirmed_at ? new Date(user.phone_confirmed_at) : null;

  const patch: Record<string, Date> = {};
  if (emailAt && !current.email_confirmed_at) patch.email_confirmed_at = emailAt;
  if (phoneAt && !current.phone_confirmed_at) patch.phone_confirmed_at = phoneAt;

  if (Object.keys(patch).length === 0) return current;

  const updated = await app.deps.db
    .updateTable('provider_verifications')
    .set({ ...patch, updated_at: new Date() })
    .where('provider_id', '=', providerId)
    .returningAll()
    .executeTakeFirstOrThrow();
  return updated as VerificationRow;
}
