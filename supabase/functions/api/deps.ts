import type { BackgroundCheckAdapter } from '../../../packages/domain/src/background-check/index.ts';
import type { Env } from './config/env.ts';
import type { Db } from './db/kysely.ts';
import type { SupabaseHandles } from './supabase/admin.ts';
import type { StripeAdapter } from './vendors/stripe.ts';

/**
 * Collaborators handed to the Hono app at construction (ADR-0019 § Why —
 * testability). Mirrors the Fastify `AppDeps` shape so route ports carry over
 * with minimal change; grows as Storage and the vendor adapters are wired in
 * later tickets.
 */
export interface AppDeps {
  env: Env;
  db: Db;
  supabase: SupabaseHandles;
  /** Stripe Connect Express — Caregiver payment rail (OH-190). */
  stripe: StripeAdapter;
  /** Background-check vendor (Checkr) — webhook verify + normalize on the api
   *  host; the slow invitation call lives on the worker-tick (OH-185). */
  backgroundCheck: BackgroundCheckAdapter;
}
