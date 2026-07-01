import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';
import { NotConfiguredError } from '../errors.ts';
// Reuse the SINGLE message DTO + projection from Messaging so the video-call poke
// is byte-identical to a chat message on the wire (the client renders both from
// the same `messages` Realtime pipe — OH-205).
import { MESSAGE_COLUMNS, MessageSchema, toMessage, type MessageRow } from './messaging.ts';
// The Parent gate is the same `deriveAccessDecision` the paywall + messaging read
// (OH-193). No new domain code — the handler composes it.
import {
  deriveAccessDecision,
  type StripeSubscriptionStatus,
} from '../../../../packages/domain/src/parent-subscription/index.ts';

/**
 * Ad-hoc embedded video calls (OH-216) — CONTEXT.md § Video call; ADR-0008;
 * PRD-0001 v1.7 stories 22, 113.
 *
 *   POST /v1/threads/{threadId}/calls   either party starts a call "now"
 *   POST /v1/calls/{callId}/join        a participant mints a fresh join token
 *
 * A call is a short-lived (~30 min) Daily.co PRIVATE room started from a
 * Direct-Message thread by EITHER party (ADR-0008 — symmetric with messaging).
 * Starting a call:
 *   1. logs the link GENERATION to `video_call_links` — the audit record
 *      (timestamp, thread, initiator, participants) for Trust & Safety; call
 *      content is never recorded (ADR-0008 § Audit posture);
 *   2. posts a `kind = 'video_call'` poke into `messages` (no URL/token on it) so
 *      Supabase Realtime delivers a "Join video call" bubble to the counterparty
 *      through the existing OH-205 pipe.
 *
 * The joinable room URL + a per-user Daily meeting token are returned ONLY from
 * these authenticated routes (a private room is useless without a token) — never
 * on the Realtime-published message. `video_call_links` is service-role-only.
 *
 * GATE: video inherits the messaging Subscription gate (ADR-0008 — no separate
 * gate). A Parent starting OR joining is Parent-Subscription-gated (402); the
 * supply side is never gated (it can only be in a thread a subscribed Parent
 * opened). 503 `not_configured` when DAILY_API_KEY is unset.
 */

/** Room + poke validity window (ADR-0008 "valid for ~30 min"). */
const VIDEO_CALL_TTL_MINUTES = 30;
/** The poke message body — a fixed, contact-info-free system string (no redaction). */
const VIDEO_CALL_POKE_BODY = 'Video call';

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('VideoCallError');

/** Everything a client needs to enter the embedded room. */
const CallSessionSchema = z
  .object({
    /** The `video_call_links` id — the counterparty joins by it (POST /calls/{id}/join). */
    callId: z.string(),
    /** The Daily room URL. Useless without `token` (the room is private). */
    roomUrl: z.string(),
    /** A short-lived per-user Daily meeting token, expiring with the room. */
    token: z.string(),
    /** ISO timestamp when the room stops being joinable (~30 min out). */
    expiresAt: z.string(),
  })
  .openapi('VideoCallSession');

/** Start returns the join session for the initiator + the poke message it posted
 *  (so the initiator's client adds the bubble to the timeline without a refetch). */
const StartCallResponse = z
  .object({ call: CallSessionSchema, message: MessageSchema })
  .openapi('StartVideoCallResponse');

const ThreadIdParam = z.object({
  threadId: z.string().uuid().openapi({ param: { name: 'threadId', in: 'path' } }),
});
const CallIdParam = z.object({
  callId: z.string().uuid().openapi({ param: { name: 'callId', in: 'path' } }),
});

/* ── row shapes + helpers ───────────────────────────────────────────────────── */

interface ThreadRow {
  id: string;
  parent_uid: string;
  supply_uid: string;
}

interface CallRow {
  id: string;
  thread_id: string;
  initiator_uid: string;
  daily_room_name: string;
  daily_room_url: string;
  expires_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function loadThreadById(db: Db, threadId: string): Promise<ThreadRow | null> {
  const row = await db
    .selectFrom('message_threads')
    .select(['id', 'parent_uid', 'supply_uid'])
    .where('id', '=', threadId)
    .executeTakeFirst();
  return row ? (row as unknown as ThreadRow) : null;
}

async function loadCallById(db: Db, callId: string): Promise<CallRow | null> {
  const row = await db
    .selectFrom('video_call_links')
    .select(['id', 'thread_id', 'initiator_uid', 'daily_room_name', 'daily_room_url', 'expires_at'])
    .where('id', '=', callId)
    .executeTakeFirst();
  return row ? (row as unknown as CallRow) : null;
}

/** True when `uid` is one of the thread's two participants. */
function isParticipant(thread: ThreadRow, uid: string): boolean {
  return uid === thread.parent_uid || uid === thread.supply_uid;
}

/** The same Subscription gate the paywall + messaging read (OH-193): entitled iff active|trialing. */
async function parentEntitled(db: Db, uid: string): Promise<boolean> {
  const sub = (await db
    .selectFrom('parent_subscriptions')
    .select(['status'])
    .where('uid', '=', uid)
    .executeTakeFirst()) as { status: StripeSubscriptionStatus | null } | undefined;
  return deriveAccessDecision({ status: sub?.status ?? null }).entitled;
}

/* ── route definitions ──────────────────────────────────────────────────────── */

const startCallRoute = createRoute({
  method: 'post',
  path: '/threads/{threadId}/calls',
  tags: ['video'],
  summary: 'Start an ad-hoc video call in a thread — OH-216',
  description:
    'Either participant starts a short-lived (~30 min) Daily.co video call from the thread. Logs the link generation for Trust & Safety (no content recorded) and posts a "Join video call" poke that Realtime delivers to the counterparty. Returns the initiator\'s join session. A Parent start is Parent-Subscription-gated (402); the supply side is not. 404 if the thread is not the caller\'s. 503 if video is not configured.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent', 'caregiver', 'provider'] })] as const,
  request: { params: ThreadIdParam },
  responses: {
    201: { description: 'Call started — the initiator\'s join session + the posted poke', content: json(StartCallResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    402: { description: 'No active Parent Subscription — video gated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Thread not found (or not the caller\'s)', content: json(ErrorResponse) },
    503: { description: 'Video not configured (DAILY_API_KEY unset)', content: json(ErrorResponse) },
  },
});

const joinCallRoute = createRoute({
  method: 'post',
  path: '/calls/{callId}/join',
  tags: ['video'],
  summary: 'Join (or re-join) an ad-hoc video call — OH-216',
  description:
    'A participant mints a fresh per-user Daily meeting token for a still-live call and receives the room URL. A Parent join is Parent-Subscription-gated (402); the supply side is not. 404 if the call is unknown or not the caller\'s thread; 410 once the call has expired. 503 if video is not configured.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent', 'caregiver', 'provider'] })] as const,
  request: { params: CallIdParam },
  responses: {
    200: { description: 'A fresh join session for the call', content: json(CallSessionSchema) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    402: { description: 'No active Parent Subscription — video gated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Call not found (or not the caller\'s thread)', content: json(ErrorResponse) },
    410: { description: 'The call has expired', content: json(ErrorResponse) },
    503: { description: 'Video not configured (DAILY_API_KEY unset)', content: json(ErrorResponse) },
  },
});

/* ── handlers ───────────────────────────────────────────────────────────────── */

export function registerVideoCallRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(startCallRoute, async (c) => {
    const { db, env, daily } = c.var.deps;
    const principal = c.get('principal')!;
    const { threadId } = c.req.valid('param');

    const thread = await loadThreadById(db, threadId);
    // 404 (not 403) when not the caller's — never reveal another's thread.
    if (!thread || !isParticipant(thread, principal.uid)) {
      return c.json({ error: 'thread_not_found' }, 404);
    }

    // A Parent start is gated; the supply side is not (mirrors a messaging send).
    if (principal.uid === thread.parent_uid && !(await parentEntitled(db, principal.uid))) {
      return c.json(
        { error: 'subscription_required', reason: 'an active Parent Subscription is required to start a video call' },
        402,
      );
    }

    // Video is optional config — a party trying to call while it is unset gets a
    // clean 503, not an opaque 500 (errors.ts → app.onError).
    if (!env.DAILY_API_KEY) throw new NotConfiguredError('DAILY_API_KEY');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + VIDEO_CALL_TTL_MINUTES * 60_000);

    // Create the private room + the initiator's owner token BEFORE opening the TX
    // (a Daily failure surfaces as a 500 with no partial audit row written).
    const room = await daily.createRoom({ expiresAt });
    const { token } = await daily.createMeetingToken({
      roomName: room.name,
      userId: principal.uid,
      isOwner: true,
      expiresAt,
    });

    const participantUids = [thread.parent_uid, thread.supply_uid];

    const { call, message } = await db.transaction().execute(async (trx) => {
      // 1. The audit record (ADR-0008) — the row IS the T&S log of generation.
      const link = (await trx
        .insertInto('video_call_links')
        .values({
          thread_id: threadId,
          initiator_uid: principal.uid,
          participant_uids: participantUids,
          provider: 'daily',
          daily_room_name: room.name,
          daily_room_url: room.url,
          expires_at: expiresAt,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow()) as { id: string };

      // 2. The Realtime poke — a video_call message the counterparty's client
      //    renders as a Join bubble (no URL/token rides on it).
      const poke = (await trx
        .insertInto('messages')
        .values({
          thread_id: threadId,
          sender_uid: principal.uid,
          body: VIDEO_CALL_POKE_BODY,
          redacted: false,
          kind: 'video_call',
          video_call_link_id: link.id,
        })
        .returning(MESSAGE_COLUMNS)
        .executeTakeFirstOrThrow()) as unknown as MessageRow;

      await trx
        .updateTable('message_threads')
        .set({ last_message_at: now, last_message_preview: VIDEO_CALL_POKE_BODY, last_message_redacted: false })
        .where('id', '=', threadId)
        .execute();

      return { call: link, message: poke };
    });

    return c.json(
      {
        call: { callId: call.id, roomUrl: room.url, token, expiresAt: toIso(expiresAt) },
        message: toMessage(message),
      },
      201,
    );
  });

  app.openapi(joinCallRoute, async (c) => {
    const { db, env, daily } = c.var.deps;
    const principal = c.get('principal')!;
    const { callId } = c.req.valid('param');

    const call = await loadCallById(db, callId);
    if (!call) return c.json({ error: 'call_not_found' }, 404);

    const thread = await loadThreadById(db, call.thread_id);
    // 404 (never reveal) when the caller isn't a participant of the call's thread.
    if (!thread || !isParticipant(thread, principal.uid)) {
      return c.json({ error: 'call_not_found' }, 404);
    }

    // A Parent join is gated too (video is a subscription feature); supply is not.
    if (principal.uid === thread.parent_uid && !(await parentEntitled(db, principal.uid))) {
      return c.json(
        { error: 'subscription_required', reason: 'an active Parent Subscription is required to join a video call' },
        402,
      );
    }

    const expiresAt = call.expires_at instanceof Date ? call.expires_at : new Date(call.expires_at);
    if (Date.now() >= expiresAt.getTime()) {
      return c.json({ error: 'call_expired', reason: 'this video call has ended' }, 410);
    }

    if (!env.DAILY_API_KEY) throw new NotConfiguredError('DAILY_API_KEY');

    const { token } = await daily.createMeetingToken({
      roomName: call.daily_room_name,
      userId: principal.uid,
      // The initiator re-joins as owner; the counterparty as a regular participant.
      isOwner: principal.uid === call.initiator_uid,
      expiresAt,
    });

    return c.json(
      { callId: call.id, roomUrl: call.daily_room_url, token, expiresAt: toIso(expiresAt) },
      200,
    );
  });
}
