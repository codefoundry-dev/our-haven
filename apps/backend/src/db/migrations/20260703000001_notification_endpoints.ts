import { type Kysely, sql } from 'kysely';

/**
 * Notification delivery endpoints (OH-194) — the per-recipient destinations the
 * `worker-tick` notifications dispatcher fans out to (CONTEXT § Notifications;
 * docs/notifications-deep-link-format.md).
 *
 * Two greenfield tables. Email + phone live on the Supabase-managed `auth.users`
 * row (the dispatcher reads them there), so the only destinations the platform
 * stores itself are the push endpoints:
 *
 * 1. `notification_push_tokens` — Expo Push tokens (`ExponentPushToken[…]`). A
 *    recipient can have one per device, so the table is keyed by the token
 *    (unique) with a `uid` index for the dispatcher's per-recipient lookup.
 *    `platform` records ios/android/web for diagnostics. The dispatcher prunes a
 *    row when Expo answers `DeviceNotRegistered`.
 *
 * 2. `notification_web_push_subscriptions` — VAPID web-push subscriptions. v1
 *    sends an empty "tickle" (no RFC 8291 encryption), so only the `endpoint` is
 *    strictly needed to send; `p256dh` + `auth` are captured now so payload
 *    encryption can land later without a re-subscribe. Keyed by `endpoint`
 *    (unique) with a `uid` index. The dispatcher prunes on 404/410.
 *
 * The token-registration WRITE path (app → API on sign-in / permission grant) is
 * a mobile/web client concern that lands with the apps/mobile push-setup ticket;
 * this migration + the dispatcher are the READ/consume side. Until registration
 * ships these tables are empty, so push/web-push are no-ops in prod while email +
 * SMS (sourced from auth.users) send immediately — the same "adapter + tests now,
 * live wiring follows" posture as the other M2 vendor tickets.
 *
 * Pure DDL — no plpgsql (the canary stays green). RLS is enabled on both tables;
 * the Edge Functions reach them over the privileged pooler connection.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('notification_push_tokens')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // Recipient — a Supabase auth user (uuid), matching notification_outbox.recipient_uid.
    .addColumn('uid', 'uuid', (c) => c.notNull())
    // Expo push token, `ExponentPushToken[…]`. Unique: one row per device token.
    .addColumn('expo_push_token', 'text', (c) => c.notNull())
    // ios | android | web — diagnostics only (Expo routes by token, not platform).
    .addColumn('platform', 'text', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'notification_push_tokens_platform_chk',
      sql`platform IN ('ios','android','web')`,
    )
    .execute();

  await sql`
    create unique index notification_push_tokens_token_uniq
      on notification_push_tokens (expo_push_token)
  `.execute(db);
  // The dispatcher's lookup: every live token for a recipient.
  await sql`
    create index notification_push_tokens_uid_idx
      on notification_push_tokens (uid)
  `.execute(db);

  await sql`ALTER TABLE public.notification_push_tokens ENABLE ROW LEVEL SECURITY`.execute(db);

  await db.schema
    .createTable('notification_web_push_subscriptions')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('uid', 'uuid', (c) => c.notNull())
    // The push-service endpoint URL the browser handed us at subscribe time.
    .addColumn('endpoint', 'text', (c) => c.notNull())
    // RFC 8291 keys — unused by the v1 empty tickle, stored for future encryption.
    .addColumn('p256dh', 'text', (c) => c.notNull())
    .addColumn('auth', 'text', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    create unique index notification_web_push_subscriptions_endpoint_uniq
      on notification_web_push_subscriptions (endpoint)
  `.execute(db);
  await sql`
    create index notification_web_push_subscriptions_uid_idx
      on notification_web_push_subscriptions (uid)
  `.execute(db);

  await sql`ALTER TABLE public.notification_web_push_subscriptions ENABLE ROW LEVEL SECURITY`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('notification_web_push_subscriptions').ifExists().execute();
  await db.schema.dropTable('notification_push_tokens').ifExists().execute();
}
