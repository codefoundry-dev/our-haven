import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';
// Reuse the SINGLE listability definition from Search/supply-profile so a Parent
// can never open a thread with a Caregiver that Search would not surface (a
// paused / unverified Caregiver 404s here exactly as it is hidden there).
import { isListable, type VerificationRow } from './search.ts';
// Cross-tree, Deno-clean domain modules (ADR-0019; explicit-`.ts`). Redaction is
// the OH-180 disintermediation detector; the Parent subscription GATE is the same
// `deriveAccessDecision` the paywall reads (OH-193). No new domain code — the
// handler composes the two.
import { scanMessage } from '../../../../packages/domain/src/disintermediation/index.ts';
import {
  deriveAccessDecision,
  type StripeSubscriptionStatus,
} from '../../../../packages/domain/src/parent-subscription/index.ts';

/**
 * In-app Messaging (OH-205) — CONTEXT.md § Message / § Trust & Safety; PRD-0001
 * v1.7 stories 18–21, 58.
 *
 *   POST /v1/threads                          Parent opens (get-or-creates) a DM thread
 *   GET  /v1/threads                          the caller's inbox
 *   GET  /v1/threads/{threadId}/messages      a thread's transcript
 *   POST /v1/threads/{threadId}/messages      send a message
 *
 * A thread is a 1:1 conversation. v1 only creates the **pre-acceptance
 * Parent↔Caregiver Direct-Message thread** (ADR-0011 — Offers/DM are
 * Caregiver-only; Providers are slot-pick). The model stays role-agnostic so
 * OH-179's job-anchored threads + the DM-accept rebind slot in later.
 *
 * REDACTION AT DELIVERY (CONTEXT § Message): Supabase Realtime broadcasts the
 * `messages` row directly, so redaction happens at WRITE time — the send handler
 * runs the body through `scanMessage` and stores the **redacted** delivery-safe
 * text in `messages.body` (with `redacted` flagging that contact info was
 * stripped). The unredacted original + match metadata go to `message_flags`, the
 * service-role-only Trust & Safety flagged-thread queue (never published to
 * Realtime). The participant-scoped SELECT RLS policy (this ticket's migration)
 * is what authorises Realtime delivery to the two participants.
 *
 * GATE (M3.7): opening a thread + a Parent SEND are Parent-Subscription-gated
 * (402) — the same `deriveAccessDecision` gate the paywall reads (OH-204 turns
 * that into the upsell UI). Caregiver replies are not gated.
 */

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('MessagingError');

const CounterpartyRoleEnum = z.enum(['parent', 'caregiver', 'provider']);

/** One thread as it appears in the VIEWER's inbox (counterparty = the OTHER party). */
const ThreadSummarySchema = z
  .object({
    /** The thread id (the Realtime + transcript anchor). */
    id: z.string(),
    /** The supply profile id — a Parent re-opens the thread by this (idempotent). */
    providerId: z.string(),
    /** The other party's display name, or null if not set yet. */
    counterpartyName: z.string().nullable(),
    /** The other party's role from the viewer's perspective. */
    counterpartyRole: CounterpartyRoleEnum,
    /** `thread` pre-acceptance; `job` once OH-179 rebinds it to a Job. */
    anchor: z.enum(['thread', 'job']),
    /** Delivery-safe preview of the last message (redacted), or null if empty. */
    lastMessagePreview: z.string().nullable(),
    /** ISO timestamp of the last activity (thread sort key). */
    lastMessageAt: z.string(),
    /** True when the last message had contact info redacted. */
    lastMessageRedacted: z.boolean(),
  })
  .openapi('MessageThreadSummary');

/** One delivered (redacted) message. The client derives "mine" from `senderUid`. */
export const MessageSchema = z
  .object({
    id: z.string(),
    threadId: z.string(),
    senderUid: z.string(),
    /** Delivery-safe body — contact info already redacted at write time. */
    body: z.string(),
    /** True when this message had contact info redacted before delivery. */
    redacted: z.boolean(),
    /** 'text' for a chat message; 'video_call' for an ad-hoc Daily.co call poke
     *  (OH-216) — the client renders it as a "Join video call" bubble. */
    kind: z.enum(['text', 'video_call']),
    /** The generated call link a 'video_call' poke announces (join via
     *  POST /v1/calls/{callId}/join); null for an ordinary message. The room URL +
     *  join token are NOT here — they are minted through the join route. */
    videoCallLinkId: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('Message');

const OpenThreadRequest = z
  .object({ providerId: z.string().uuid() })
  .openapi('OpenThreadRequest');

const ThreadListResponse = z
  .object({ threads: z.array(ThreadSummarySchema) })
  .openapi('MessageThreadList');

const MessageListResponse = z
  .object({ messages: z.array(MessageSchema) })
  .openapi('MessageList');

const SendMessageRequest = z
  .object({ body: z.string().min(1).max(4000) })
  .openapi('SendMessageRequest');

const ThreadIdParam = z.object({
  threadId: z.string().uuid().openapi({ param: { name: 'threadId', in: 'path' } }),
});

const MessagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().openapi({ param: { name: 'limit', in: 'query' } }),
});

/* ── row shapes + helpers ───────────────────────────────────────────────────── */

interface ProviderRow {
  id: string;
  uid: string;
  role: 'caregiver' | 'provider';
}
interface ThreadRow {
  id: string;
  parent_uid: string;
  supply_uid: string;
  provider_id: string;
  supply_role: 'caregiver' | 'provider';
  job_id: string | null;
  last_message_at: Date | string;
  last_message_preview: string | null;
  last_message_redacted: boolean;
  created_at: Date | string;
}
export interface MessageRow {
  id: string;
  thread_id: string;
  sender_uid: string;
  body: string;
  redacted: boolean;
  kind: 'text' | 'video_call';
  video_call_link_id: string | null;
  created_at: Date | string;
}

const THREAD_COLUMNS = [
  'id',
  'parent_uid',
  'supply_uid',
  'provider_id',
  'supply_role',
  'job_id',
  'last_message_at',
  'last_message_preview',
  'last_message_redacted',
  'created_at',
] as const;

export const MESSAGE_COLUMNS = [
  'id',
  'thread_id',
  'sender_uid',
  'body',
  'redacted',
  'kind',
  'video_call_link_id',
  'created_at',
] as const;

/** Thrown inside the get-or-create when a concurrent request won the unique race. */
class ThreadRaceError extends Error {}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Delivery-safe inbox preview (the redacted text, length-capped). */
function previewOf(redacted: string): string {
  const trimmed = redacted.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 119)}…` : trimmed;
}

function fullName(first: string | null, last: string | null): string | null {
  const name = [first, last].filter((p) => p && p.length > 0).join(' ').trim();
  return name.length > 0 ? name : null;
}

export function toMessage(row: MessageRow): z.infer<typeof MessageSchema> {
  return {
    id: row.id,
    threadId: row.thread_id,
    senderUid: row.sender_uid,
    body: row.body,
    redacted: row.redacted,
    kind: row.kind,
    videoCallLinkId: row.video_call_link_id,
    createdAt: toIso(row.created_at),
  };
}

function toSummary(
  row: ThreadRow,
  counterpartyName: string | null,
  counterpartyRole: z.infer<typeof CounterpartyRoleEnum>,
): z.infer<typeof ThreadSummarySchema> {
  return {
    id: row.id,
    providerId: row.provider_id,
    counterpartyName,
    counterpartyRole,
    anchor: row.job_id ? 'job' : 'thread',
    lastMessagePreview: row.last_message_preview,
    lastMessageAt: toIso(row.last_message_at),
    lastMessageRedacted: row.last_message_redacted,
  };
}

async function loadProviderById(db: Db, providerId: string): Promise<ProviderRow | null> {
  const row = await db
    .selectFrom('providers')
    .select(['id', 'uid', 'role'])
    .where('id', '=', providerId)
    .executeTakeFirst();
  return row ? (row as unknown as ProviderRow) : null;
}

async function loadProviderByUid(db: Db, uid: string): Promise<ProviderRow | null> {
  const row = await db
    .selectFrom('providers')
    .select(['id', 'uid', 'role'])
    .where('uid', '=', uid)
    .executeTakeFirst();
  return row ? (row as unknown as ProviderRow) : null;
}

async function loadThreadById(db: Db, threadId: string): Promise<ThreadRow | null> {
  const row = await db
    .selectFrom('message_threads')
    .select(THREAD_COLUMNS)
    .where('id', '=', threadId)
    .executeTakeFirst();
  return row ? (row as unknown as ThreadRow) : null;
}

async function loadThreadByParentProvider(
  db: Db,
  parentUid: string,
  providerId: string,
): Promise<ThreadRow | null> {
  const row = await db
    .selectFrom('message_threads')
    .select(THREAD_COLUMNS)
    .where('parent_uid', '=', parentUid)
    .where('provider_id', '=', providerId)
    // The pre-acceptance Direct-Message thread is the one with no Job anchor. A
    // (parent, provider) pair may also have job-anchored Application threads
    // (OH-219, job_id set) — those are reached via their Job/Application surface,
    // never this general "open a DM" get-or-create (mirrors the partial
    // message_threads_parent_provider_dm_uniq index).
    .where('job_id', 'is', null)
    .executeTakeFirst();
  return row ? (row as unknown as ThreadRow) : null;
}

/** The same Subscription gate the paywall reads (OH-193): entitled iff active|trialing. */
async function parentEntitled(db: Db, uid: string): Promise<boolean> {
  const sub = (await db
    .selectFrom('parent_subscriptions')
    .select(['status'])
    .where('uid', '=', uid)
    .executeTakeFirst()) as { status: StripeSubscriptionStatus | null } | undefined;
  return deriveAccessDecision({ status: sub?.status ?? null }).entitled;
}

/* ── route definitions ──────────────────────────────────────────────────────── */

const openThreadRoute = createRoute({
  method: 'post',
  path: '/threads',
  tags: ['messaging'],
  summary: 'Open (get-or-create) a Direct-Message thread with a Caregiver — OH-205',
  description:
    'Parent-only, idempotent get-or-create of the pre-acceptance Direct-Message thread with a listable Caregiver (ADR-0011 — DM is Caregiver-only). Parent-Subscription-gated (402 on the free browse account). 404 if the supply member is unknown, not a Caregiver, or not listable (paused/unverified) — never reveal hidden supply.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { body: { content: json(OpenThreadRequest), required: true } },
  responses: {
    200: { description: 'Thread (existing or newly created)', content: json(ThreadSummarySchema) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    402: { description: 'No active Parent Subscription — messaging gated', content: json(ErrorResponse) },
    403: { description: 'Wrong role (caregiver / provider / admin)', content: json(ErrorResponse) },
    404: { description: 'Caregiver not found / not listable', content: json(ErrorResponse) },
  },
});

const listThreadsRoute = createRoute({
  method: 'get',
  path: '/threads',
  tags: ['messaging'],
  summary: "The caller's inbox (their Direct-Message threads) — OH-205",
  description:
    "Returns the authenticated caller's threads from their viewer perspective — a Parent sees the Caregivers they messaged; a Caregiver sees the Parents who messaged them — newest activity first. (Provider threads do not exist in v1 → empty.)",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent', 'caregiver', 'provider'] })] as const,
  responses: {
    200: { description: "The caller's threads", content: json(ThreadListResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
  },
});

const listMessagesRoute = createRoute({
  method: 'get',
  path: '/threads/{threadId}/messages',
  tags: ['messaging'],
  summary: "A thread's transcript (delivery-safe) — OH-205",
  description:
    "Returns a thread's messages (oldest first) for a participant. Bodies are already redacted (delivery-safe). 404 if the thread is unknown or not the caller's — never reveal another's thread.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent', 'caregiver', 'provider'] })] as const,
  request: { params: ThreadIdParam, query: MessagesQuery },
  responses: {
    200: { description: 'The transcript', content: json(MessageListResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Thread not found (or not the caller\'s)', content: json(ErrorResponse) },
  },
});

const sendMessageRoute = createRoute({
  method: 'post',
  path: '/threads/{threadId}/messages',
  tags: ['messaging'],
  summary: 'Send a message (redacted at delivery) — OH-205',
  description:
    'Sends a message into a thread the caller participates in. The body is run through the disintermediation detector and stored REDACTED (delivery-safe) — the unredacted original is queued for Trust & Safety. A Parent send is Parent-Subscription-gated (402); Caregiver replies are not. 404 if the thread is not the caller\'s.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent', 'caregiver', 'provider'] })] as const,
  request: { params: ThreadIdParam, body: { content: json(SendMessageRequest), required: true } },
  responses: {
    201: { description: 'Delivered (redacted) message', content: json(MessageSchema) },
    400: { description: 'Empty message body', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    402: { description: 'No active Parent Subscription — messaging gated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Thread not found (or not the caller\'s)', content: json(ErrorResponse) },
  },
});

/* ── handlers ───────────────────────────────────────────────────────────────── */

export function registerMessagingRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(openThreadRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { providerId } = c.req.valid('json');

    const provider = await loadProviderById(db, providerId);
    // DM is Caregiver-only (ADR-0011). A non-Caregiver (or unknown) 404s.
    if (!provider || provider.role !== 'caregiver') {
      return c.json({ error: 'caregiver_not_found' }, 404);
    }

    const [ver, profile, entitled] = await Promise.all([
      db
        .selectFrom('provider_verifications')
        .select(['provider_id', 'phone_confirmed_at', 'screening_passed_at', 'license_verified_at', 'insurance_verified_at', 'rejected_at'])
        .where('provider_id', '=', provider.id)
        .executeTakeFirst() as Promise<unknown> as Promise<VerificationRow | undefined>,
      db
        .selectFrom('provider_profiles')
        .select(['display_name', 'paused'])
        .where('provider_id', '=', provider.id)
        .executeTakeFirst() as Promise<unknown> as Promise<
        { display_name: string | null; paused: boolean | null } | undefined
      >,
      parentEntitled(db, principal.uid),
    ]);

    // Subscription gate (M3.7) — the same gate the paywall reads (OH-193).
    if (!entitled) {
      return c.json(
        { error: 'subscription_required', reason: 'an active Parent Subscription is required to message' },
        402,
      );
    }

    // Listability mirrors Search exactly (isListable + the paused check it applies
    // separately) so the two surfaces can never disagree about who is visible.
    if (!isListable('caregiver', ver, undefined) || profile?.paused === true) {
      return c.json({ error: 'caregiver_not_found' }, 404);
    }

    // Get-or-create, idempotent on (parent_uid, provider_id). On a concurrent
    // race the unique index makes one INSERT lose; we re-select its winner.
    let row = await loadThreadByParentProvider(db, principal.uid, provider.id);
    if (!row) {
      try {
        const inserted = (await db
          .insertInto('message_threads')
          .values({
            parent_uid: principal.uid,
            supply_uid: provider.uid,
            provider_id: provider.id,
            supply_role: 'caregiver',
          })
          .returning(THREAD_COLUMNS)
          .executeTakeFirstOrThrow()) as unknown as ThreadRow;
        row = inserted;
      } catch {
        row = await loadThreadByParentProvider(db, principal.uid, provider.id);
        if (!row) throw new ThreadRaceError();
      }
    }

    return c.json(toSummary(row, profile?.display_name ?? null, 'caregiver'), 200);
  });

  app.openapi(listThreadsRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;

    if (principal.role === 'parent') {
      const rows = (await db
        .selectFrom('message_threads')
        .select(THREAD_COLUMNS)
        .where('parent_uid', '=', principal.uid)
        .orderBy('last_message_at', 'desc')
        .execute()) as unknown as ThreadRow[];

      const providerIds = [...new Set(rows.map((r) => r.provider_id))];
      const nameByProvider = new Map<string, string | null>();
      const roleByProvider = new Map<string, 'caregiver' | 'provider'>();
      if (providerIds.length > 0) {
        const profs = (await db
          .selectFrom('provider_profiles')
          .select(['provider_id', 'display_name'])
          .where('provider_id', 'in', providerIds)
          .execute()) as { provider_id: string; display_name: string | null }[];
        profs.forEach((p) => nameByProvider.set(p.provider_id, p.display_name));
      }
      rows.forEach((r) => roleByProvider.set(r.provider_id, r.supply_role));

      const threads = rows.map((r) =>
        toSummary(r, nameByProvider.get(r.provider_id) ?? null, roleByProvider.get(r.provider_id) ?? 'caregiver'),
      );
      return c.json({ threads }, 200);
    }

    if (principal.role === 'caregiver') {
      const rows = (await db
        .selectFrom('message_threads')
        .select(THREAD_COLUMNS)
        .where('supply_uid', '=', principal.uid)
        .orderBy('last_message_at', 'desc')
        .execute()) as unknown as ThreadRow[];

      const parentUids = [...new Set(rows.map((r) => r.parent_uid))];
      const nameByUid = new Map<string, string | null>();
      if (parentUids.length > 0) {
        const profs = (await db
          .selectFrom('profiles')
          .select(['id', 'first_name', 'last_name'])
          .where('id', 'in', parentUids)
          .execute()) as { id: string; first_name: string | null; last_name: string | null }[];
        profs.forEach((p) => nameByUid.set(p.id, fullName(p.first_name, p.last_name)));
      }

      const threads = rows.map((r) => toSummary(r, nameByUid.get(r.parent_uid) ?? null, 'parent'));
      return c.json({ threads }, 200);
    }

    // Provider: no DM threads in v1.
    return c.json({ threads: [] }, 200);
  });

  app.openapi(listMessagesRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { threadId } = c.req.valid('param');
    const { limit } = c.req.valid('query');

    const thread = await loadThreadById(db, threadId);
    // 404 (not 403) when not the caller's — never reveal another's thread.
    if (!thread || (principal.uid !== thread.parent_uid && principal.uid !== thread.supply_uid)) {
      return c.json({ error: 'thread_not_found' }, 404);
    }

    const rows = (await db
      .selectFrom('messages')
      .select(MESSAGE_COLUMNS)
      .where('thread_id', '=', threadId)
      .orderBy('created_at', 'asc')
      .limit(limit ?? 100)
      .execute()) as unknown as MessageRow[];

    return c.json({ messages: rows.map(toMessage) }, 200);
  });

  app.openapi(sendMessageRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { threadId } = c.req.valid('param');
    const { body } = c.req.valid('json');

    const thread = await loadThreadById(db, threadId);
    if (!thread || (principal.uid !== thread.parent_uid && principal.uid !== thread.supply_uid)) {
      return c.json({ error: 'thread_not_found' }, 404);
    }

    const trimmed = body.trim();
    if (trimmed.length === 0) {
      return c.json({ error: 'empty_message', reason: 'message body must not be empty' }, 400);
    }

    // A Parent send is gated; Caregiver replies are not (supply side).
    if (principal.uid === thread.parent_uid && !(await parentEntitled(db, principal.uid))) {
      return c.json(
        { error: 'subscription_required', reason: 'an active Parent Subscription is required to message' },
        402,
      );
    }

    // Redaction at delivery (CONTEXT § Message): store the redacted text; queue
    // the unredacted original for Trust & Safety when it tripped the detector.
    const scan = scanMessage(trimmed);
    const now = new Date();

    const inserted = await db.transaction().execute(async (trx) => {
      const msg = (await trx
        .insertInto('messages')
        .values({
          thread_id: threadId,
          sender_uid: principal.uid,
          body: scan.redacted,
          redacted: scan.flagged,
        })
        .returning(['id', 'created_at'])
        .executeTakeFirstOrThrow()) as { id: string; created_at: Date | string };

      if (scan.flagged) {
        await trx
          .insertInto('message_flags')
          .values({
            message_id: msg.id,
            thread_id: threadId,
            sender_uid: principal.uid,
            categories: [...scan.categories],
            original_body: trimmed,
            matches: scan.matches.map((m) => ({
              category: m.category,
              value: m.value,
              start: m.start,
              end: m.end,
            })),
          })
          .execute();
      }

      await trx
        .updateTable('message_threads')
        .set({
          last_message_at: now,
          last_message_preview: previewOf(scan.redacted),
          last_message_redacted: scan.flagged,
        })
        .where('id', '=', threadId)
        .execute();

      return msg;
    });

    return c.json(
      toMessage({
        id: inserted.id,
        thread_id: threadId,
        sender_uid: principal.uid,
        body: scan.redacted,
        redacted: scan.flagged,
        kind: 'text',
        video_call_link_id: null,
        created_at: inserted.created_at,
      }),
      201,
    );
  });
}
