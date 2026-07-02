import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';

/**
 * Notification registration + preferences (OH-223; CONTEXT § Notifications,
 * PRD-0001 v1.7 stories 30/31/50/76/77).
 *
 * The client-facing WRITE side the OH-194 endpoint tables + dispatcher were built
 * to consume (their migration explicitly deferred this "app → API on sign-in /
 * permission grant" path here). Available to EVERY authenticated role — Parent,
 * Caregiver, Provider all run the one unified app (ADR-0011), so there is no role
 * gate; the row is keyed by the JWT `uid`.
 *
 *   PUT    /v1/notifications/push-tokens   register/refresh this device's Expo push token
 *   DELETE /v1/notifications/push-tokens   drop this device's token on sign-out
 *   PUT    /v1/notifications/web-push      register/refresh a VAPID web-push subscription
 *   DELETE /v1/notifications/web-push      drop a web-push subscription
 *   GET    /v1/notifications/preferences   read the marketing opt-in
 *   PUT    /v1/notifications/preferences   set the marketing opt-in
 *
 * **Marketing opt-in is separate from transactional** (CONTEXT): the preferences
 * row gates only future marketing sends; the `worker-tick` transactional
 * dispatcher never reads it, and the four SMS-mandatory events are no-opt-out.
 *
 * A push token is globally unique per device; a PUT upserts on the token and
 * re-points its `uid` (a shared device that changes account rebinds cleanly). A
 * DELETE is scoped to `token AND uid` so a caller only ever removes their own row.
 */

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('NotificationError');

const OkResponse = z.object({ ok: z.literal(true) }).openapi('NotificationOk');

const PushTokenRequest = z
  .object({
    /** The Expo push token, `ExponentPushToken[…]`, from getExpoPushTokenAsync. */
    expoPushToken: z.string().min(1).max(255),
    /** Device platform — diagnostics only (Expo routes by token, not platform). */
    platform: z.enum(['ios', 'android', 'web']),
  })
  .openapi('NotificationPushTokenRequest');

const PushTokenDeleteRequest = z
  .object({ expoPushToken: z.string().min(1).max(255) })
  .openapi('NotificationPushTokenDeleteRequest');

const WebPushRequest = z
  .object({
    /** The push-service endpoint URL the browser handed us at subscribe time. */
    endpoint: z.string().url().max(2048),
    /** RFC 8291 keys — stored for future payload encryption (v1 sends an empty tickle). */
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255),
  })
  .openapi('NotificationWebPushRequest');

const WebPushDeleteRequest = z
  .object({ endpoint: z.string().url().max(2048) })
  .openapi('NotificationWebPushDeleteRequest');

// NB: OpenAPI component names are GLOBAL across route files (a duplicate silently
// overwrites — the OH-218 gotcha); OH-221's notification-preferences.ts owns
// 'NotificationPreferences' (channel opt-outs), so the marketing pair is
// namespaced 'Marketing*'.
const PreferencesResponse = z
  .object({
    /** Whether the user has opted IN to marketing messages (default false). */
    marketingOptIn: z.boolean(),
  })
  .openapi('MarketingPreferences');

const PreferencesRequest = z
  .object({ marketingOptIn: z.boolean() })
  .openapi('MarketingPreferencesRequest');

/* ── helpers ─────────────────────────────────────────────────────────────────── */

async function readMarketingOptIn(db: Db, uid: string): Promise<boolean> {
  const row = await db
    .selectFrom('notification_preferences')
    .select('marketing_opt_in')
    .where('uid', '=', uid)
    .executeTakeFirst();
  return row?.marketing_opt_in ?? false;
}

/* ── route definitions ──────────────────────────────────────────────────────── */

const putPushTokenRoute = createRoute({
  method: 'put',
  path: '/notifications/push-tokens',
  tags: ['notifications'],
  summary: "Register or refresh this device's Expo push token",
  description:
    "Upserts the caller's Expo push token (unique per device). Re-registering a token already on file re-points it to the current user + refreshes the platform — a shared device that switches account rebinds cleanly. Idempotent.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth()] as const,
  request: { body: { content: json(PushTokenRequest), required: true } },
  responses: {
    200: { description: 'Token registered', content: json(OkResponse) },
    400: { description: 'Invalid token / platform', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
  },
});

const deletePushTokenRoute = createRoute({
  method: 'delete',
  path: '/notifications/push-tokens',
  tags: ['notifications'],
  summary: "Drop this device's Expo push token on sign-out",
  description:
    "Deletes the caller's push token (scoped to token AND uid, so a caller only ever removes their own row). Idempotent — deleting an unknown token is a no-op.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth()] as const,
  request: { body: { content: json(PushTokenDeleteRequest), required: true } },
  responses: {
    200: { description: 'Token removed (or already absent)', content: json(OkResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
  },
});

const putWebPushRoute = createRoute({
  method: 'put',
  path: '/notifications/web-push',
  tags: ['notifications'],
  summary: 'Register or refresh a VAPID web-push subscription',
  description:
    "Upserts a browser web-push subscription (unique per endpoint). Re-points the endpoint to the current user on conflict. v1 delivery is a best-effort empty 'tickle'.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth()] as const,
  request: { body: { content: json(WebPushRequest), required: true } },
  responses: {
    200: { description: 'Subscription registered', content: json(OkResponse) },
    400: { description: 'Invalid subscription', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
  },
});

const deleteWebPushRoute = createRoute({
  method: 'delete',
  path: '/notifications/web-push',
  tags: ['notifications'],
  summary: 'Drop a VAPID web-push subscription',
  description:
    'Deletes a web-push subscription (scoped to endpoint AND uid). Idempotent.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth()] as const,
  request: { body: { content: json(WebPushDeleteRequest), required: true } },
  responses: {
    200: { description: 'Subscription removed (or already absent)', content: json(OkResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
  },
});

const getPreferencesRoute = createRoute({
  method: 'get',
  path: '/notifications/preferences',
  tags: ['notifications'],
  summary: 'Read the marketing opt-in preference',
  description:
    'Returns the caller\'s marketing opt-in (default false when never set). Transactional notifications are unaffected by this — they always send per the channel matrix.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth()] as const,
  responses: {
    200: { description: 'The preferences', content: json(PreferencesResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
  },
});

const putPreferencesRoute = createRoute({
  method: 'put',
  path: '/notifications/preferences',
  tags: ['notifications'],
  summary: 'Set the marketing opt-in preference',
  description:
    'Sets the caller\'s marketing opt-in (separate from transactional notifications; CONTEXT § Notifications). Stamps the moment the value was set for the consent audit trail. Idempotent.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth()] as const,
  request: { body: { content: json(PreferencesRequest), required: true } },
  responses: {
    200: { description: 'The updated preferences', content: json(PreferencesResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
  },
});

/* ── handlers ───────────────────────────────────────────────────────────────── */

export function registerNotificationRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(putPushTokenRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { expoPushToken, platform } = c.req.valid('json');

    const now = new Date();
    await db
      .insertInto('notification_push_tokens')
      .values({ uid: principal.uid, expo_push_token: expoPushToken, platform })
      .onConflict((oc) =>
        oc.column('expo_push_token').doUpdateSet({ uid: principal.uid, platform, updated_at: now }),
      )
      .execute();

    return c.json({ ok: true } as const, 200);
  });

  app.openapi(deletePushTokenRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { expoPushToken } = c.req.valid('json');

    await db
      .deleteFrom('notification_push_tokens')
      .where('expo_push_token', '=', expoPushToken)
      .where('uid', '=', principal.uid)
      .execute();

    return c.json({ ok: true } as const, 200);
  });

  app.openapi(putWebPushRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { endpoint, p256dh, auth } = c.req.valid('json');

    const now = new Date();
    await db
      .insertInto('notification_web_push_subscriptions')
      .values({ uid: principal.uid, endpoint, p256dh, auth })
      .onConflict((oc) =>
        oc.column('endpoint').doUpdateSet({ uid: principal.uid, p256dh, auth, updated_at: now }),
      )
      .execute();

    return c.json({ ok: true } as const, 200);
  });

  app.openapi(deleteWebPushRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { endpoint } = c.req.valid('json');

    await db
      .deleteFrom('notification_web_push_subscriptions')
      .where('endpoint', '=', endpoint)
      .where('uid', '=', principal.uid)
      .execute();

    return c.json({ ok: true } as const, 200);
  });

  app.openapi(getPreferencesRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const marketingOptIn = await readMarketingOptIn(db, principal.uid);
    return c.json({ marketingOptIn }, 200);
  });

  app.openapi(putPreferencesRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { marketingOptIn } = c.req.valid('json');

    const now = new Date();
    await db
      .insertInto('notification_preferences')
      .values({
        uid: principal.uid,
        marketing_opt_in: marketingOptIn,
        marketing_opt_in_at: now,
      })
      .onConflict((oc) =>
        oc
          .column('uid')
          .doUpdateSet({ marketing_opt_in: marketingOptIn, marketing_opt_in_at: now, updated_at: now }),
      )
      .execute();

    return c.json({ marketingOptIn }, 200);
  });
}
