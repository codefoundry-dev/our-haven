import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  CAREGIVER_CATEGORIES,
  SPECIALTIES,
  SUPPLY_ROLES,
  US_STATES_50_PLUS_DC,
  type CaregiverCategory,
  type Specialty,
  type SupplyRole,
  type UsState,
} from '@our-haven/shared';

const Role = z.enum(SUPPLY_ROLES);
const State = z.enum(US_STATES_50_PLUS_DC);
const CaregiverCategoryEnum = z.enum(CAREGIVER_CATEGORIES);
const SpecialtyEnum = z.enum(SPECIALTIES);

const SignupRequest = z.discriminatedUnion('role', [
  z
    .object({
      role: z.literal('caregiver'),
      categories: z.array(CaregiverCategoryEnum).min(1),
      state: State,
    })
    .strict(),
  z
    .object({
      role: z.literal('provider'),
      specialty: SpecialtyEnum,
      state: State,
    })
    .strict(),
]);

const ProviderResponse = z.object({
  id: z.uuid(),
  uid: z.string(),
  role: Role,
  categories: z.array(CaregiverCategoryEnum).nullable(),
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
  role: string;
  categories: string[] | null;
  specialty: string | null;
  state: string;
  created_at: Date;
}

/** Order-insensitive equality for the caregiver `categories[]` immutability check. */
function sameCategories(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

export const providerRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/providers',
    {
      preHandler: app.requireAuth(),
      schema: {
        tags: ['providers'],
        summary: 'Supply sign-up — persist the supply row + set role/state claims',
        description:
          'Creates a supply row keyed by Supabase user id and writes custom claims to Supabase `app_metadata` (role ∈ {caregiver, provider}, state, categories | specialty per ADR-0011). Idempotent: re-posting identical attributes returns 200 with the existing row; a mismatched role / categories / specialty / state returns 409 (role + sub-type + state are permanent per CONTEXT.md § Authentication). A user already bound to role=parent or role=admin cannot sign up as supply — they must create a second account.',
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
        return { error: 'role_already_claimed', reason: 'admin accounts cannot become supply' };
      }

      const desiredCategories: string[] | null = body.role === 'caregiver' ? body.categories : null;
      const desiredSpecialty: Specialty | null = body.role === 'provider' ? body.specialty : null;

      const existing = await app.deps.db
        .selectFrom('providers')
        .select(['id', 'uid', 'role', 'categories', 'specialty', 'state', 'created_at'])
        .where('uid', '=', principal.uid)
        .executeTakeFirst();

      if (existing) {
        const match =
          existing.role === body.role &&
          sameCategories(existing.categories, desiredCategories) &&
          existing.specialty === desiredSpecialty &&
          existing.state === body.state;
        if (!match) {
          reply.code(409);
          return {
            error: 'provider_attributes_immutable',
            reason: 'role, categories/specialty, and state are permanent — use a change-of-residence flow (future)',
          };
        }
        return toResponse(existing);
      }

      const inserted = await app.deps.db
        .insertInto('providers')
        .values({
          uid: principal.uid,
          role: body.role,
          categories: desiredCategories,
          specialty: desiredSpecialty,
          state: body.state,
        })
        .returning(['id', 'uid', 'role', 'categories', 'specialty', 'state', 'created_at'])
        .executeTakeFirstOrThrow();

      const existingAppMeta = (principal.claims.app_metadata ?? {}) as Record<string, unknown>;
      const nextAppMeta: Record<string, unknown> = {
        ...existingAppMeta,
        role: body.role,
        state: body.state,
      };
      if (desiredCategories) nextAppMeta.categories = desiredCategories;
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
    role: row.role as SupplyRole,
    categories: row.categories as CaregiverCategory[] | null,
    specialty: row.specialty as Specialty | null,
    state: row.state as UsState,
    createdAt: created.toISOString(),
  };
}
