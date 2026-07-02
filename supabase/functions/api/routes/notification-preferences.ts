import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';

/**
 * Notification channel preferences (OH-221) — the read/write surface behind the
 * Account tab's "Notifications" settings. Keyed by the authenticated `uid`, so
 * it serves every role (the Caregiver Account tab is the first consumer).
 *
 *   GET   /v1/me/notification-preferences   the caller's effective channel prefs
 *   PATCH /v1/me/notification-preferences   flip one or more channel opt-outs
 *
 * A missing row means "all channels on" — the same default the worker-tick
 * notifications dispatcher applies (an absent preference never blocks a
 * channel). GET therefore synthesises the all-on default when no row exists;
 * PATCH upserts, so the first flip materialises the row.
 *
 * `sms` is exposed for symmetry but the dispatcher NEVER suppresses the
 * mandatory-SMS event set with it (safety-critical — CONTEXT § Notifications);
 * the client surfaces SMS as an always-on informational row, not a live toggle.
 */

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('NotificationPreferencesError');

const NotificationPreferences = z
  .object({
    push: z.boolean(),
    webPush: z.boolean(),
    email: z.boolean(),
    sms: z.boolean(),
  })
  .openapi('NotificationPreferences');

// Every field optional: a PATCH flips only the channels it names, leaving the
// rest untouched (a partial update, not a full replace). At least one required.
const NotificationPreferencesPatch = z
  .object({
    push: z.boolean().optional(),
    webPush: z.boolean().optional(),
    email: z.boolean().optional(),
    sms: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'at least one channel must be provided',
  })
  .openapi('NotificationPreferencesPatch');

interface PrefsRow {
  uid: string;
  push: boolean;
  web_push: boolean;
  email: boolean;
  sms: boolean;
}

const ALL_ON = { push: true, webPush: true, email: true, sms: true } as const;

function toResponse(row: PrefsRow | null): z.infer<typeof NotificationPreferences> {
  if (!row) return { ...ALL_ON };
  return { push: row.push, webPush: row.web_push, email: row.email, sms: row.sms };
}

async function loadPrefs(db: Db, uid: string): Promise<PrefsRow | null> {
  const row = await db
    .selectFrom('notification_preferences')
    .select(['uid', 'push', 'web_push', 'email', 'sms'])
    .where('uid', '=', uid)
    .executeTakeFirst();
  return (row as PrefsRow | undefined) ?? null;
}

const getRoute = createRoute({
  method: 'get',
  path: '/me/notification-preferences',
  tags: ['notifications'],
  summary: "Read the authenticated user's notification channel preferences",
  description:
    'Returns the caller\'s per-channel notification preferences (`push` / `webPush` / `email` / `sms`). A user who has never changed a preference has no row; the endpoint synthesises the all-on default. `sms` reflects the stored flag but mandatory safety SMS always sends regardless (CONTEXT § Notifications).',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth()] as const,
  responses: {
    200: { description: 'Effective preferences', content: json(NotificationPreferences) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
  },
});

const patchRoute = createRoute({
  method: 'patch',
  path: '/me/notification-preferences',
  tags: ['notifications'],
  summary: "Update the authenticated user's notification channel preferences",
  description:
    'Partial update — only the channels named in the body change; the rest keep their current value (or the all-on default if no row exists yet). Upserts, so the first change materialises the row. Returns the full effective preferences after the change.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth()] as const,
  request: { body: { content: json(NotificationPreferencesPatch), required: true } },
  responses: {
    200: { description: 'Updated preferences', content: json(NotificationPreferences) },
    400: { description: 'Empty patch', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
  },
});

export function registerNotificationPreferenceRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(getRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const row = await loadPrefs(db, principal.uid);
    return c.json(toResponse(row), 200);
  });

  app.openapi(patchRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const body = c.req.valid('json');

    // Map the camelCase channels to their columns; skip the ones the PATCH omits.
    const set: Record<string, boolean | Date> = {};
    if (body.push !== undefined) set.push = body.push;
    if (body.webPush !== undefined) set.web_push = body.webPush;
    if (body.email !== undefined) set.email = body.email;
    if (body.sms !== undefined) set.sms = body.sms;
    set.updated_at = new Date();

    const row = (await db
      .insertInto('notification_preferences')
      .values({ uid: principal.uid, ...set })
      .onConflict((oc) => oc.column('uid').doUpdateSet(set))
      .returning(['uid', 'push', 'web_push', 'email', 'sms'])
      .executeTakeFirstOrThrow()) as PrefsRow;

    return c.json(toResponse(row), 200);
  });
}
