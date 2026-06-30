import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';
// Cross-tree, Deno-clean domain/shared modules (ADR-0019; the same explicit-`.ts`
// pattern caregiver-profile.ts uses). None carry a runtime `@our-haven/*` import,
// so they deploy unchanged on Deno. The Parent-profile RULES (consent gate,
// withdrawal erasure, address sanitiser) live in the domain; the fixed taxonomies
// live in shared.
import {
  eraseSafetyBehaviors,
  hasSafetyBehaviorsConsent,
  resolveConsentGrant,
  resolveSafetyBehaviorsSave,
  sanitiseDefaultAddress,
  type DefaultAddress,
} from '../../../../packages/domain/src/parent-profile/index.ts';
import {
  PARENT_PREFERENCES,
  normaliseParentPreferences,
} from '../../../../packages/shared/src/parent-preferences.ts';
import {
  SAFETY_BEHAVIORS,
  normaliseSafetyBehaviors,
} from '../../../../packages/shared/src/safety-behaviors.ts';
import { isUsState } from '../../../../packages/shared/src/us-states.ts';

/**
 * Parent profile (OH-200) — ADR-0012 / ADR-0016; CONTEXT.md § Parent profile /
 * § Sensitive-data consent / § Service address & distance; PRD-0001 v1.7 stories
 * 3, 4, 74, 124.
 *
 * The family-level Parent profile that replaces the removed Child entity:
 *
 *   GET    /v1/parents/me/profile                  read the full profile
 *   PATCH  /v1/parents/me/profile                  update Bio / Preferences / default address
 *   POST   /v1/parents/me/profile/consent          grant sensitive-info consent (timestamp)
 *   DELETE /v1/parents/me/profile/consent          withdraw consent → erase Safety Behaviors + stamp
 *   PUT    /v1/parents/me/profile/safety-behaviors  replace the Safety-Behaviors checklist
 *
 * The **consent-to-store gate** is the headline rule (PRD story 3): Safety
 * Behaviors can be saved only AFTER an explicit, timestamped consent — so editing
 * the checklist (`PUT …/safety-behaviors`) is a separate endpoint from the
 * non-sensitive `PATCH`, and it 403s without consent. Withdrawal erases both the
 * behaviours and the timestamp (story 74); Bio + Preferences survive. The
 * optional default address pre-fills a transaction's `service_address` (story 124).
 *
 * Like the Parent Subscription there is **no `parents` table** — a Parent is just
 * the Supabase auth user — so the row is keyed by the JWT `uid` directly; there is
 * no supply-row lookup. Supply / admin roles are rejected by the parent-only guard.
 */

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('ParentProfileError');

const PreferenceEnum = z.enum(PARENT_PREFERENCES);
const SafetyBehaviorEnum = z.enum(SAFETY_BEHAVIORS);

const DefaultAddressSchema = z
  .object({
    line1: z.string().max(120).nullable(),
    line2: z.string().max(120).nullable(),
    city: z.string().max(80).nullable(),
    /** 2-letter US state / DC, or null. Validated against the US-state list. */
    state: z.string().max(2).nullable(),
    /** 5-digit US ZIP, or null. */
    postalCode: z.string().max(5).nullable(),
  })
  .openapi('ParentDefaultAddress');

/** The default address as a PATCH input — every field optional (omit = leave / treated as null). */
const DefaultAddressPatchSchema = z
  .object({
    line1: z.string().max(200).nullable().optional(),
    line2: z.string().max(200).nullable().optional(),
    city: z.string().max(120).nullable().optional(),
    state: z.string().max(2).nullable().optional(),
    postalCode: z.string().max(10).nullable().optional(),
  })
  .openapi('ParentDefaultAddressPatch');

const ProfileResponse = z
  .object({
    bio: z.string().nullable(),
    preferences: z.array(PreferenceEnum),
    safetyBehaviors: z.array(SafetyBehaviorEnum),
    /** ISO timestamp of the sensitive-info consent, or null when not consented / withdrawn. */
    safetyBehaviorsConsentAt: z.string().datetime().nullable(),
    /** Derived: whether sensitive-info consent is currently in force. */
    hasConsent: z.boolean(),
    defaultAddress: DefaultAddressSchema,
  })
  .openapi('ParentProfile');

const ProfilePatchRequest = z
  .object({
    /** Free-text family bio (≤ 600 chars), or null to clear. */
    bio: z.string().max(600).nullable().optional(),
    /** Replaces the FULL preferences checklist; validated against the taxonomy + de-duped. */
    preferences: z.array(PreferenceEnum).optional(),
    /** Replaces the FULL default address; validated + normalised server-side. */
    defaultAddress: DefaultAddressPatchSchema.optional(),
  })
  .openapi('ParentProfilePatchRequest');

const SafetyBehaviorsRequest = z
  .object({
    /** The full Safety-Behaviors checklist to persist; validated against the taxonomy + de-duped. */
    safetyBehaviors: z.array(SafetyBehaviorEnum),
  })
  .openapi('ParentSafetyBehaviorsRequest');

/* ── row shape + helpers ────────────────────────────────────────────────────── */

interface ProfileRow {
  uid: string;
  bio: string | null;
  preferences: string[];
  safety_behaviors: string[];
  safety_behaviors_consent_at: Date | string | null;
  default_address_line1: string | null;
  default_address_line2: string | null;
  default_city: string | null;
  default_state: string | null;
  default_postal_code: string | null;
}

const PROFILE_COLUMNS = [
  'uid',
  'bio',
  'preferences',
  'safety_behaviors',
  'safety_behaviors_consent_at',
  'default_address_line1',
  'default_address_line2',
  'default_city',
  'default_state',
  'default_postal_code',
] as const;

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function loadProfile(db: Db, uid: string): Promise<ProfileRow | null> {
  const row = await db
    .selectFrom('parent_profiles')
    .select(PROFILE_COLUMNS)
    .where('uid', '=', uid)
    .executeTakeFirst();
  return row ? (row as unknown as ProfileRow) : null;
}

async function ensureProfileRow(db: Db, uid: string): Promise<ProfileRow> {
  const existing = await loadProfile(db, uid);
  if (existing) return existing;
  const inserted = await db
    .insertInto('parent_profiles')
    .values({ uid })
    .returningAll()
    .executeTakeFirstOrThrow();
  return inserted as unknown as ProfileRow;
}

/** The synthetic empty profile a Parent with no row yet reads (no write on GET). */
function emptyProfileView() {
  return {
    bio: null as string | null,
    // Typed empties (ParentPreference[] / SafetyBehavior[]) so the GET union with
    // profileView matches the zod response enum arrays.
    preferences: normaliseParentPreferences([]),
    safetyBehaviors: normaliseSafetyBehaviors([]),
    safetyBehaviorsConsentAt: null as string | null,
    hasConsent: false,
    defaultAddress: {
      line1: null as string | null,
      line2: null as string | null,
      city: null as string | null,
      state: null as string | null,
      postalCode: null as string | null,
    },
  };
}

function profileView(row: ProfileRow) {
  const consentAt = toIso(row.safety_behaviors_consent_at);
  return {
    bio: row.bio ?? null,
    // Re-normalise on read so a taxonomy change (a value retired from the list)
    // self-heals the projection without a migration.
    preferences: normaliseParentPreferences(row.preferences ?? []),
    safetyBehaviors: normaliseSafetyBehaviors(row.safety_behaviors ?? []),
    safetyBehaviorsConsentAt: consentAt,
    hasConsent: hasSafetyBehaviorsConsent(consentAt),
    defaultAddress: {
      line1: row.default_address_line1 ?? null,
      line2: row.default_address_line2 ?? null,
      city: row.default_city ?? null,
      state: row.default_state ?? null,
      postalCode: row.default_postal_code ?? null,
    },
  };
}

/* ── route definitions ──────────────────────────────────────────────────────── */

const getProfileRoute = createRoute({
  method: 'get',
  path: '/parents/me/profile',
  tags: ['parent-profile'],
  summary: "Read the authenticated Parent's family profile",
  description:
    'Returns the family-level Parent profile: Bio, the Preferences checklist, the consent-gated Safety-Behaviors checklist with its consent timestamp (`safetyBehaviorsConsentAt`) + derived `hasConsent`, and the optional default service address. A Parent with no profile row yet reads sensible empties (no write). Supply / admin roles are rejected by the parent-only guard (403).',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  responses: {
    200: { description: 'The Parent profile', content: json(ProfileResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role (caregiver / provider / admin)', content: json(ErrorResponse) },
  },
});

const patchProfileRoute = createRoute({
  method: 'patch',
  path: '/parents/me/profile',
  tags: ['parent-profile'],
  summary: "Update the authenticated Parent's Bio / Preferences / default address",
  description:
    'Partial update of the NON-sensitive fields — only the supplied fields change. `preferences`, when present, replaces the FULL checklist (validated against the taxonomy + de-duped). `defaultAddress`, when present, replaces the FULL default address (validated: 2-letter US state, 5-digit ZIP). Safety Behaviors are NOT settable here — they go through the consent-gated `PUT …/safety-behaviors` (the consent-to-store gate).',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { body: { content: json(ProfilePatchRequest), required: true } },
  responses: {
    200: { description: 'The updated profile', content: json(ProfileResponse) },
    400: { description: 'Invalid fields / address', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
  },
});

const grantConsentRoute = createRoute({
  method: 'post',
  path: '/parents/me/profile/consent',
  tags: ['parent-profile'],
  summary: 'Grant sensitive-information consent (stamp the consent timestamp)',
  description:
    'Records the explicit, timestamped sensitive-info consent that unlocks saving Safety Behaviors (PRD story 3). Idempotent: a first grant stamps now; a repeat grant keeps the original timestamp. After this the Parent may PUT their Safety-Behaviors checklist.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  responses: {
    200: { description: 'Consent recorded; returns the profile', content: json(ProfileResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
  },
});

const withdrawConsentRoute = createRoute({
  method: 'delete',
  path: '/parents/me/profile/consent',
  tags: ['parent-profile'],
  summary: 'Withdraw sensitive-information consent — erases Safety Behaviors + timestamp',
  description:
    'Withdraws consent and permanently deletes every Safety Behavior AND the consent timestamp (PRD story 74). Bio + Preferences are untouched. Idempotent — withdrawing with nothing stored is a no-op that returns the (empty-sensitive) profile.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  responses: {
    200: { description: 'Consent withdrawn + behaviours erased; returns the profile', content: json(ProfileResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
  },
});

const putSafetyBehaviorsRoute = createRoute({
  method: 'put',
  path: '/parents/me/profile/safety-behaviors',
  tags: ['parent-profile'],
  summary: "Replace the authenticated Parent's Safety-Behaviors checklist (consent-gated)",
  description:
    'Replaces the full Safety-Behaviors checklist (validated against the taxonomy + de-duped). REQUIRES sensitive-info consent to already be in force — without it the request is rejected 403 `consent_required` (the consent-to-store gate, PRD story 3). To remove every behaviour, withdraw consent (which also clears the timestamp) rather than PUTting an empty list.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { body: { content: json(SafetyBehaviorsRequest), required: true } },
  responses: {
    200: { description: 'The updated profile', content: json(ProfileResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role / consent required', content: json(ErrorResponse) },
  },
});

/* ── handlers ───────────────────────────────────────────────────────────────── */

export function registerParentProfileRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(getProfileRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const row = await loadProfile(db, principal.uid);
    return c.json(row ? profileView(row) : emptyProfileView(), 200);
  });

  app.openapi(patchProfileRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const patch = c.req.valid('json');

    // Validate the address BEFORE any write (domain rule — single source of truth).
    let address: DefaultAddress | null = null;
    if (patch.defaultAddress !== undefined) {
      const result = sanitiseDefaultAddress(patch.defaultAddress, isUsState);
      if (!result.ok) return c.json({ error: 'invalid_default_address', reason: result.reason }, 400);
      address = result.address;
    }

    await ensureProfileRow(db, principal.uid);

    const now = new Date();
    const set: Record<string, unknown> = { updated_at: now };
    if (patch.bio !== undefined) set.bio = patch.bio;
    if (patch.preferences !== undefined) set.preferences = normaliseParentPreferences(patch.preferences);
    if (address !== null) {
      set.default_address_line1 = address.line1;
      set.default_address_line2 = address.line2;
      set.default_city = address.city;
      set.default_state = address.state;
      set.default_postal_code = address.postalCode;
    }
    await db.updateTable('parent_profiles').set(set).where('uid', '=', principal.uid).execute();

    const row = (await loadProfile(db, principal.uid))!;
    return c.json(profileView(row), 200);
  });

  app.openapi(grantConsentRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;

    const row = await ensureProfileRow(db, principal.uid);
    const now = new Date();
    const currentIso = toIso(row.safety_behaviors_consent_at);
    const grantedIso = resolveConsentGrant(currentIso, now.toISOString());
    // Idempotent: only write when consent was not already in force.
    if (currentIso !== grantedIso) {
      await db
        .updateTable('parent_profiles')
        .set({ safety_behaviors_consent_at: now, updated_at: now })
        .where('uid', '=', principal.uid)
        .execute();
    }

    const fresh = (await loadProfile(db, principal.uid))!;
    return c.json(profileView(fresh), 200);
  });

  app.openapi(withdrawConsentRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;

    await ensureProfileRow(db, principal.uid);
    const erased = eraseSafetyBehaviors();
    const now = new Date();
    await db
      .updateTable('parent_profiles')
      .set({
        safety_behaviors: [...erased.safetyBehaviors],
        safety_behaviors_consent_at: erased.safetyBehaviorsConsentAt,
        updated_at: now,
      })
      .where('uid', '=', principal.uid)
      .execute();

    const fresh = (await loadProfile(db, principal.uid))!;
    return c.json(profileView(fresh), 200);
  });

  app.openapi(putSafetyBehaviorsRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { safetyBehaviors } = c.req.valid('json');

    const row = await ensureProfileRow(db, principal.uid);
    const consentAt = toIso(row.safety_behaviors_consent_at);
    const result = resolveSafetyBehaviorsSave(consentAt, normaliseSafetyBehaviors(safetyBehaviors));
    if (!result.ok) {
      return c.json(
        { error: 'consent_required', reason: 'grant sensitive-information consent before saving Safety Behaviors' },
        403,
      );
    }

    const now = new Date();
    await db
      .updateTable('parent_profiles')
      .set({ safety_behaviors: [...result.safetyBehaviors], updated_at: now })
      .where('uid', '=', principal.uid)
      .execute();

    const fresh = (await loadProfile(db, principal.uid))!;
    return c.json(profileView(fresh), 200);
  });
}
