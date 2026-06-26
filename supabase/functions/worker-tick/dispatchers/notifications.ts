import { sql } from 'kysely';

// The pure channel-matrix + deep-link + templates module (@our-haven/domain,
// OH-194). Value import via explicit `.ts` — the module is a single Deno-clean
// file with no internal relative imports, the same pattern the screening
// dispatcher uses for the background-check reducer.
import {
  getChannelMatrixEntry,
  isNotificationEventKind,
  renderNotification,
  type DeepLinkBases,
  type NotificationEventKind,
} from '../../../../packages/domain/src/notifications/index.ts';
import type { ExpoPushAdapter } from '../../_shared/expo-push.ts';
import type { ResendAdapter } from '../../_shared/resend.ts';
import type { TwilioAdapter } from '../../_shared/twilio.ts';
import type { WebPushAdapter } from '../../_shared/web-push.ts';
import type { Db } from '../db/kysely.ts';
import { loggingDispatcher, type NotificationDispatcher, type OutboxRow } from '../outbox.ts';

/**
 * The notifications dispatcher (OH-194) — the real channel fan-out behind the
 * OH-237 outbox/`worker-tick` substrate, replacing the `loggingDispatcher` no-op.
 *
 * For each drained `notification_outbox` row whose `event_type` is a known
 * notification kind, it: reads the channel matrix, renders the per-channel copy +
 * deep links, resolves the recipient's destinations, and sends. Operational
 * event types it does not recognise (e.g. `screening.invite`) fall through to the
 * fallback dispatcher — so this sits in the chain as the screening dispatcher's
 * fallback: screening → notifications → logging.
 *
 * Delivery contract (CONTEXT § Notifications):
 *   - SMS is MANDATORY for four event kinds. The mandatory SMS is attempted
 *     FIRST and a failure THROWS (the row retries/backs off). Attempting it first
 *     means a Twilio outage never leaves a duplicate push/email behind on retry.
 *   - push / web_push / email are BEST-EFFORT: a per-channel failure is logged,
 *     not thrown, so one dead channel never blocks the others. If NOTHING was
 *     delivered AND at least one best-effort channel errored, the row throws so a
 *     transient outage retries; if nothing was delivered only because the
 *     recipient has no destinations, the row is marked sent (retrying can't help).
 *
 * Like the screening dispatcher, the `Db` here MUST be a connection SEPARATE from
 * the outbox drain's (the drain holds its single pooled connection in a
 * transaction across dispatch) — index.ts passes the dedicated `dispatchDb`.
 */

export interface WebPushSubscriptionRef {
  endpoint: string;
}

export interface RecipientContacts {
  /** From `auth.users.email`. */
  email: string | null;
  /** From `auth.users.phone` (digits, normalised to E.164 at send time). */
  phone: string | null;
  expoPushTokens: string[];
  webPushSubscriptions: WebPushSubscriptionRef[];
}

/** All recipient-table I/O behind one seam so the dispatcher is fake-testable. */
export interface RecipientResolver {
  resolve(uid: string): Promise<RecipientContacts>;
  /** Delete Expo tokens Expo reported `DeviceNotRegistered`. Best-effort. */
  pruneExpoTokens(tokens: string[]): Promise<void>;
  /** Delete web-push subscriptions the push service reported gone. Best-effort. */
  pruneWebPushEndpoints(endpoints: string[]): Promise<void>;
}

export interface NotificationsDispatcherDeps {
  resolver: RecipientResolver;
  bases: DeepLinkBases;
  /** Configured adapters; an absent adapter means that channel is skipped (best-effort) or, for mandatory SMS, throws. */
  expoPush?: ExpoPushAdapter;
  webPush?: WebPushAdapter;
  resend?: ResendAdapter;
  twilio?: TwilioAdapter;
  /** Dispatcher for unrecognised event types. Defaults to the logging no-op. */
  fallback?: NotificationDispatcher;
}

/** Supabase stores phone auth digits without the leading `+`; Twilio wants E.164. */
function toE164(phone: string): string {
  const trimmed = phone.trim();
  return trimmed.startsWith('+') ? trimmed : `+${trimmed.replace(/[^\d]/g, '')}`;
}

export function createNotificationsDispatcher(
  deps: NotificationsDispatcherDeps,
): NotificationDispatcher {
  const fallback = deps.fallback ?? loggingDispatcher;

  return {
    async dispatch(row: OutboxRow): Promise<void> {
      if (!isNotificationEventKind(row.event_type)) {
        return fallback.dispatch(row);
      }
      const kind = row.event_type as NotificationEventKind;
      const entry = getChannelMatrixEntry(kind);

      // Render first — a payload missing a required route param throws here, which
      // the drain treats as a retryable failure (never a silent broken deep link).
      const rendered = renderNotification(kind, row.payload, deps.bases);
      const contacts = await deps.resolver.resolve(row.recipient_uid);

      let deliveredAny = false;
      const bestEffortErrors: string[] = [];

      // ── 1. Mandatory SMS first (failure is fatal → retry, no dup on the rest) ──
      if (entry.smsMandatory) {
        if (!deps.twilio) {
          throw new Error(`notifications: SMS-mandatory ${kind} but Twilio is not configured`);
        }
        if (!contacts.phone) {
          throw new Error(`notifications: SMS-mandatory ${kind} but recipient has no phone on file`);
        }
        await deps.twilio.sendSms({ to: toE164(contacts.phone), body: rendered.sms.body });
        deliveredAny = true;
      }

      // ── 2. Push (Expo) — best-effort ──
      if (entry.channels.includes('push') && deps.expoPush && contacts.expoPushTokens.length > 0) {
        try {
          const result = await deps.expoPush.sendPush(
            contacts.expoPushTokens.map((token) => ({
              to: token,
              title: rendered.push.title,
              body: rendered.push.body,
              data: rendered.push.data,
            })),
          );
          if (result.tickets.some((t) => t.status === 'ok')) deliveredAny = true;
          if (result.invalidTokens.length > 0) {
            await deps.resolver.pruneExpoTokens(result.invalidTokens).catch((err) =>
              console.warn('[notifications] prune expo tokens failed', err),
            );
          }
        } catch (err) {
          bestEffortErrors.push(`push: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // ── 3. Web push (VAPID, empty tickle) — best-effort (adapter swallows per-endpoint) ──
      if (
        entry.channels.includes('web_push') &&
        deps.webPush &&
        contacts.webPushSubscriptions.length > 0
      ) {
        try {
          const result = await deps.webPush.sendTickle(contacts.webPushSubscriptions);
          if (result.sent > 0) deliveredAny = true;
          if (result.goneEndpoints.length > 0) {
            await deps.resolver.pruneWebPushEndpoints(result.goneEndpoints).catch((err) =>
              console.warn('[notifications] prune web-push endpoints failed', err),
            );
          }
        } catch (err) {
          bestEffortErrors.push(`web_push: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // ── 4. Email (Resend) — best-effort ──
      if (entry.channels.includes('email') && deps.resend && contacts.email) {
        try {
          await deps.resend.sendEmail({
            to: contacts.email,
            subject: rendered.email.subject,
            text: rendered.email.body,
            // Correlation tags per docs/notifications-deep-link-format.md § Email.
            tags: [
              { name: 'event_kind', value: kind },
              { name: 'dispatch_id', value: row.id },
              { name: 'category', value: kind },
            ],
          });
          deliveredAny = true;
        } catch (err) {
          bestEffortErrors.push(`email: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Nothing landed but a channel errored → retry the transient outage. Nothing
      // landed only for want of destinations → done (retrying cannot help).
      if (!deliveredAny && bestEffortErrors.length > 0) {
        throw new Error(`notifications: all channels failed for ${kind}: ${bestEffortErrors.join('; ')}`);
      }
    },
  };
}

/**
 * Kysely-backed recipient resolver. Email + phone come from the Supabase-managed
 * `auth.users` row (read-only, via raw `sql` — it is not part of our migration
 * contract); push destinations come from the OH-194 endpoint tables. Runs on the
 * dedicated dispatch connection (NOT the drain's locked one).
 */
export function makeKyselyRecipientResolver(db: Db): RecipientResolver {
  return {
    async resolve(uid: string): Promise<RecipientContacts> {
      const user = await sql<{ email: string | null; phone: string | null }>`
        select email, phone from auth.users where id = ${uid}
      `.execute(db);
      const tokens = await db
        .selectFrom('notification_push_tokens')
        .select('expo_push_token')
        .where('uid', '=', uid)
        .execute();
      const subs = await db
        .selectFrom('notification_web_push_subscriptions')
        .select('endpoint')
        .where('uid', '=', uid)
        .execute();

      const row = user.rows[0];
      // Supabase stores empty phone/email as '' rather than NULL in some flows.
      const email = row?.email && row.email.length > 0 ? row.email : null;
      const phone = row?.phone && row.phone.length > 0 ? row.phone : null;

      return {
        email,
        phone,
        expoPushTokens: tokens.map((t) => t.expo_push_token),
        webPushSubscriptions: subs.map((s) => ({ endpoint: s.endpoint })),
      };
    },

    async pruneExpoTokens(toks: string[]): Promise<void> {
      if (toks.length === 0) return;
      await db
        .deleteFrom('notification_push_tokens')
        .where('expo_push_token', 'in', toks)
        .execute();
    },

    async pruneWebPushEndpoints(endpoints: string[]): Promise<void> {
      if (endpoints.length === 0) return;
      await db
        .deleteFrom('notification_web_push_subscriptions')
        .where('endpoint', 'in', endpoints)
        .execute();
    },
  };
}
