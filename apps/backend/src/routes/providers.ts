import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  CAREGIVER_CATEGORIES,
  SPECIALTIES,
  US_STATES_50_PLUS_DC,
  type CaregiverCategory,
  type Specialty,
  type UsState,
} from '@our-haven/shared';

const Kind = z.enum(['caregiver', 'specialist']);
const State = z.enum(US_STATES_50_PLUS_DC);
const CaregiverCategoryEnum = z.enum(CAREGIVER_CATEGORIES);
const SpecialtyEnum = z.enum(SPECIALTIES);

const SignupRequest = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('caregiver'),
      caregiverCategory: CaregiverCategoryEnum,
      state: State,
    })
    .strict(),
  z
    .object({
      kind: z.literal('specialist'),
      specialty: SpecialtyEnum,
      state: State,
    })
    .strict(),
]);

const ProviderResponse = z.object({
  id: z.uuid(),
  uid: z.string(),
  kind: Kind,
  caregiverCategory: CaregiverCategoryEnum.nullable(),
  specialty: SpecialtyEnum.nullable(),
  state: State,
  createdAt: z.iso.datetime(),
});

const ErrorResponse = z.object({
  error: z.string(),
  reason: z.string().optional(),
});

interface ProviderRow {
  id: string;
  uid: string;
  kind: string;
  caregiver_category: string | null;
  specialty: string | null;
  state: string;
  created_at: Date;
}

export const providerRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/providers',
    {
      preHandler: app.requireAuth(),
      schema: {
        tags: ['providers'],
        summary: 'Provider sign-up — persist Provider row + set role/kind/state claims',
        description:
          'Creates a Provider row keyed by Supabase user id and writes custom claims to Supabase `app_metadata` (role=provider, kind, state, caregiver_category | specialty). Idempotent: re-posting identical attributes returns 200 with the existing row; mismatched kind / category / specialty / state returns 409 (role + kind + state are permanent per CONTEXT.md § Authentication / Account roles). A user already bound to role=parent or role=admin cannot sign up as provider — they must create a second account.',
        security: [{ supabaseAccessToken: [] }],
        body: SignupRequest,
        response: {
          200: ProviderResponse,
          201: ProviderResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const principal = req.principal!;
      const body = req.body;

      if (principal.role === 'parent') {
        reply.code(409);
        return { error: 'role_already_claimed', reason: 'account is permanently bound as parent' };
      }
      if (principal.role === 'admin') {
        reply.code(409);
        return { error: 'role_already_claimed', reason: 'admin accounts cannot become provider' };
      }

      const desiredCategory: CaregiverCategory | null =
        body.kind === 'caregiver' ? body.caregiverCategory : null;
      const desiredSpecialty: Specialty | null =
        body.kind === 'specialist' ? body.specialty : null;

      const existing = await app.deps.db
        .selectFrom('providers')
        .select(['id', 'uid', 'kind', 'caregiver_category', 'specialty', 'state', 'created_at'])
        .where('uid', '=', principal.uid)
        .executeTakeFirst();

      if (existing) {
        const match =
          existing.kind === body.kind &&
          existing.caregiver_category === desiredCategory &&
          existing.specialty === desiredSpecialty &&
          existing.state === body.state;
        if (!match) {
          reply.code(409);
          return {
            error: 'provider_attributes_immutable',
            reason: 'kind, category/specialty, and state are permanent — use a change-of-residence flow (future)',
          };
        }
        return toResponse(existing);
      }

      const inserted = await app.deps.db
        .insertInto('providers')
        .values({
          uid: principal.uid,
          kind: body.kind,
          caregiver_category: desiredCategory,
          specialty: desiredSpecialty,
          state: body.state,
        })
        .returning(['id', 'uid', 'kind', 'caregiver_category', 'specialty', 'state', 'created_at'])
        .executeTakeFirstOrThrow();

      const existingAppMeta = (principal.claims.app_metadata ?? {}) as Record<string, unknown>;
      const nextAppMeta: Record<string, unknown> = {
        ...existingAppMeta,
        role: 'provider',
        kind: body.kind,
        state: body.state,
      };
      if (desiredCategory) nextAppMeta.caregiver_category = desiredCategory;
      if (desiredSpecialty) nextAppMeta.specialty = desiredSpecialty;

      const { error: updateErr } = await app.deps.supabase.admin.auth.admin.updateUserById(
        principal.uid,
        { app_metadata: nextAppMeta },
      );
      if (updateErr) {
        req.log.error({ err: updateErr }, 'supabase updateUserById failed');
        throw new Error('failed_to_set_provider_claims');
      }

      reply.code(201);
      return toResponse(inserted);
    },
  );
};

function toResponse(row: ProviderRow) {
  const created = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
  return {
    id: row.id,
    uid: row.uid,
    kind: row.kind as 'caregiver' | 'specialist',
    caregiverCategory: row.caregiver_category as CaregiverCategory | null,
    specialty: row.specialty as Specialty | null,
    state: row.state as UsState,
    createdAt: created.toISOString(),
  };
}
