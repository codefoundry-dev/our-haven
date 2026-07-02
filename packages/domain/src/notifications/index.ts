/**
 * Notifications channel matrix + deep-link + templates (OH-194; PRD-0001 v1.7
 * § Notifications, CONTEXT.md § Notifications, docs/notifications-deep-link-format.md).
 *
 * The pure, vendor-agnostic core of the transactional notification system: given
 * a notification *event kind* and its payload, this module decides
 *   - which channels the event fans out to (Expo push / VAPID web push / Resend
 *     email / Twilio SMS) and whether SMS is mandatory,
 *   - the deep-link route into the relevant app surface, and
 *   - the rendered copy per channel.
 *
 * It imports nothing from the database, Stripe, Twilio, Supabase, etc. (ADR-0004)
 * and — like every other domain module the Edge value-imports — is a SINGLE,
 * self-contained file with no internal relative imports, so it is Deno-clean and
 * the `worker-tick` notifications dispatcher can import it cross-tree by explicit
 * `.ts` specifier. The dispatcher supplies the vendor adapters; this module never
 * performs I/O.
 */

export const NOTIFICATION_MODULE_VERSION = '1.0.0';

// ── Channels ────────────────────────────────────────────────────────────────

/**
 * The four delivery channels. `push` is Expo Push (mobile, FCM+APNs); `web_push`
 * is VAPID web push (best-effort, empty "tickle" in v1); `email` is Resend;
 * `sms` is Twilio. Per CONTEXT § Notifications, `sms` appears only on the
 * SMS-mandatory event set — `sms` in `channels` iff `smsMandatory`.
 */
export type NotificationChannel = 'push' | 'web_push' | 'email' | 'sms';

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = [
  'push',
  'web_push',
  'email',
  'sms',
] as const;

// ── Event kinds ─────────────────────────────────────────────────────────────

/**
 * The transactional notification event kinds. These ARE the `event_type` strings
 * a producer writes onto a `notification_outbox` row (see apps/backend
 * jobs/outbox.ts `enqueueNotification`). An `event_type` that is not one of these
 * is not a user-facing notification (e.g. the operational `screening.invite`),
 * and the dispatcher delegates it to its fallback.
 */
export type NotificationEventKind =
  // SMS-mandatory (push + web_push + email + sms) — CONTEXT § Notifications.
  | 'booking_request_received' // → Caregiver (direct Book-request received — the single most critical notification)
  | 'job_awarded' // → Caregiver (Application accepted, Booking being created)
  | 'consultation_booked' // → Provider (a consultation slot was filled)
  | 'cancellation_within_24h' // → both sides (inside the 24h window)
  // Push + web_push + email (no SMS).
  | 'application_received' // → Parent (new Application on their Job)
  | 'counter_offer_received' // → recipient of a counter-Offer
  | 'offer_expired' // → the party whose Offer expired
  | 'job_expiring_48h' // → Parent (Job expiring in 48h with no Applications)
  | 'job_expired_no_award' // → Parent (Job expired with no award)
  | 'session_start_reminder' // → both sides (1h before the session)
  | 'booking_accepted' // → Parent (Caregiver accepted the booking request)
  | 'booking_declined' // → Parent (Caregiver declined the booking request)
  | 'booking_expired' // → Parent (booking request expired with no response)
  // Promoted operational Booking events (OH-223) — push + web_push + email, no SMS.
  // Each is already enqueued by an OH-211/212/213 producer; OH-223 gives them copy
  // + a deep-link so they actually deliver instead of falling through to logging.
  | 'booking_session_started' // → Parent (Caregiver started the session)
  | 'booking_hours_proposed' // → Parent (hours submitted — confirm in the review window)
  | 'booking_time_change_approved' // → Parent (their shorten request was approved)
  | 'booking_time_change_declined' // → Parent (their shorten request was declined)
  | 'booking_time_extended' // → Caregiver (Parent bought more time)
  | 'booking_time_reduce_requested' // → Caregiver (Parent requested a shorter session)
  | 'booking_time_reduce_rescinded' // → Caregiver (Parent withdrew the shorten request)
  | 'booking_disputed' // → Parent (a dispute was opened on the booking)
  | 'booking_no_show' // → Caregiver (Parent reported a no-show)
  | 'booking_payment_failed' // → Parent (a payment attempt failed)
  | 'booking_authorization_action_required' // → Parent (3DS needed to authorize)
  | 'booking_tip_received'; // → Caregiver (a settled tip landed — 100% pass-through, OH-215)

export const NOTIFICATION_EVENT_KINDS: readonly NotificationEventKind[] = [
  'booking_request_received',
  'job_awarded',
  'consultation_booked',
  'cancellation_within_24h',
  'application_received',
  'counter_offer_received',
  'offer_expired',
  'job_expiring_48h',
  'job_expired_no_award',
  'session_start_reminder',
  'booking_accepted',
  'booking_declined',
  'booking_expired',
  'booking_session_started',
  'booking_hours_proposed',
  'booking_time_change_approved',
  'booking_time_change_declined',
  'booking_time_extended',
  'booking_time_reduce_requested',
  'booking_time_reduce_rescinded',
  'booking_disputed',
  'booking_no_show',
  'booking_payment_failed',
  'booking_authorization_action_required',
  'booking_tip_received',
] as const;

export function isNotificationEventKind(value: string): value is NotificationEventKind {
  return (NOTIFICATION_EVENT_KINDS as readonly string[]).includes(value);
}

// ── Channel matrix ──────────────────────────────────────────────────────────

export interface ChannelMatrixEntry {
  /** Channels this event fans out to. `sms` present iff `smsMandatory`. */
  readonly channels: readonly NotificationChannel[];
  /**
   * When true the SMS send is non-negotiable (CONTEXT § Notifications) — the
   * dispatcher treats an SMS failure for this event as fatal (retry/back off)
   * rather than best-effort. Always equals `channels.includes('sms')`.
   */
  readonly smsMandatory: boolean;
  /**
   * The deep-link route template; `{key}` placeholders are filled from the event
   * payload at dispatch time (docs/notifications-deep-link-format.md).
   */
  readonly routeTemplate: string;
  /** Payload keys the route template requires — used to validate the payload. */
  readonly routeParams: readonly string[];
}

// Push + web_push are on every event; the SMS-mandatory four add `sms`.
const PUSH_EMAIL: readonly NotificationChannel[] = ['push', 'web_push', 'email'];
const PUSH_EMAIL_SMS: readonly NotificationChannel[] = ['push', 'web_push', 'email', 'sms'];

function entry(
  channels: readonly NotificationChannel[],
  routeTemplate: string,
  routeParams: readonly string[],
): ChannelMatrixEntry {
  return { channels, smsMandatory: channels.includes('sms'), routeTemplate, routeParams };
}

/**
 * The single source of truth for per-event channel routing + deep-link route.
 * Mirrors docs/notifications-deep-link-format.md (which names this file) and the
 * SMS-mandatory set in CONTEXT § Notifications. `consultation_booked` is included
 * per CONTEXT's SMS-mandatory list (it predates, and is absent from, the
 * deep-link doc's route table — it reuses the `schedule/booking/{bookingId}`
 * surface, since a booked consultation materialises a Booking).
 */
export const CHANNEL_MATRIX: Readonly<Record<NotificationEventKind, ChannelMatrixEntry>> = {
  // Fired when a Parent SENDS a direct Book-request Offer to a Caregiver, so the
  // deep link takes the Caregiver into the chat thread to Accept/Counter/Decline
  // (the posted-Job "you were awarded" path is the separate `job_awarded` below).
  booking_request_received: entry(PUSH_EMAIL_SMS, 'thread/{threadId}', ['threadId']),
  job_awarded: entry(PUSH_EMAIL_SMS, 'schedule/booking/{bookingId}', ['bookingId']),
  consultation_booked: entry(PUSH_EMAIL_SMS, 'schedule/booking/{bookingId}', ['bookingId']),
  cancellation_within_24h: entry(PUSH_EMAIL_SMS, 'booking/{bookingId}', ['bookingId']),
  application_received: entry(PUSH_EMAIL, 'job/{jobId}', ['jobId']),
  counter_offer_received: entry(PUSH_EMAIL, 'thread/{threadId}', ['threadId']),
  offer_expired: entry(PUSH_EMAIL, 'thread/{threadId}', ['threadId']),
  job_expiring_48h: entry(PUSH_EMAIL, 'job/{jobId}', ['jobId']),
  job_expired_no_award: entry(PUSH_EMAIL, 'job/{jobId}', ['jobId']),
  session_start_reminder: entry(PUSH_EMAIL, 'schedule/booking/{bookingId}', ['bookingId']),
  booking_accepted: entry(PUSH_EMAIL, 'booking/{bookingId}', ['bookingId']),
  booking_declined: entry(PUSH_EMAIL, 'booking/{bookingId}', ['bookingId']),
  booking_expired: entry(PUSH_EMAIL, 'booking/{bookingId}', ['bookingId']),
  // Promoted operational Booking events (OH-223). Parent-facing land on the shared
  // booking detail (`booking/{bookingId}`); Caregiver-facing action items land on
  // the Caregiver's Schedule tab (`schedule/booking/{bookingId}`).
  booking_session_started: entry(PUSH_EMAIL, 'booking/{bookingId}', ['bookingId']),
  booking_hours_proposed: entry(PUSH_EMAIL, 'booking/{bookingId}', ['bookingId']),
  booking_time_change_approved: entry(PUSH_EMAIL, 'booking/{bookingId}', ['bookingId']),
  booking_time_change_declined: entry(PUSH_EMAIL, 'booking/{bookingId}', ['bookingId']),
  booking_time_extended: entry(PUSH_EMAIL, 'schedule/booking/{bookingId}', ['bookingId']),
  booking_time_reduce_requested: entry(PUSH_EMAIL, 'schedule/booking/{bookingId}', ['bookingId']),
  booking_time_reduce_rescinded: entry(PUSH_EMAIL, 'schedule/booking/{bookingId}', ['bookingId']),
  booking_disputed: entry(PUSH_EMAIL, 'booking/{bookingId}', ['bookingId']),
  booking_no_show: entry(PUSH_EMAIL, 'schedule/booking/{bookingId}', ['bookingId']),
  booking_payment_failed: entry(PUSH_EMAIL, 'booking/{bookingId}', ['bookingId']),
  booking_authorization_action_required: entry(PUSH_EMAIL, 'booking/{bookingId}', ['bookingId']),
  booking_tip_received: entry(PUSH_EMAIL, 'schedule/booking/{bookingId}', ['bookingId']),
};

export function getChannelMatrixEntry(kind: NotificationEventKind): ChannelMatrixEntry {
  return CHANNEL_MATRIX[kind];
}

// ── Deep links ──────────────────────────────────────────────────────────────

export interface DeepLinkBases {
  /** Mobile custom scheme, e.g. `ourhaven://` (NOTIFICATIONS_DEEP_LINK_BASE_MOBILE). */
  readonly mobile: string;
  /** Web portal base, e.g. `https://provider.ourhaven.com/` (NOTIFICATIONS_DEEP_LINK_BASE_WEB). */
  readonly web: string;
}

export interface DeepLinks {
  /** The mobile deep link (used in push `data.route` + SMS bodies). */
  readonly mobile: string;
  /** The web URL (used in web-push + email bodies). */
  readonly web: string;
}

/** Notification payloads are channel-agnostic template params (see outbox row). */
export type NotificationPayload = Record<string, unknown>;

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Fill a route template's `{key}` placeholders from the payload. Throws on a
 * missing/empty/non-string param — a malformed payload the dispatcher surfaces
 * as a retryable failure (it never silently drops the deep link). Returns the
 * route path with no leading slash (e.g. `schedule/booking/b-1`).
 */
export function buildRoutePath(routeTemplate: string, payload: NotificationPayload): string {
  return routeTemplate.replace(PLACEHOLDER, (_match, key: string) => {
    const value = payload[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`notifications: route param "${key}" missing from payload`);
    }
    return encodeURIComponent(value);
  });
}

function joinBase(base: string, path: string): string {
  // `ourhaven://` + `schedule/...` and `https://host/` + `schedule/...` both want
  // exactly one separator. The mobile scheme already ends in `://`; a web base
  // may or may not end in `/`.
  if (base.endsWith('/') || base.endsWith(':')) return `${base}${path}`;
  return `${base}/${path}`;
}

/** Build the parallel mobile + web deep links for an event payload. */
export function buildDeepLinks(
  routeTemplate: string,
  payload: NotificationPayload,
  bases: DeepLinkBases,
): DeepLinks {
  const path = buildRoutePath(routeTemplate, payload);
  return {
    mobile: joinBase(bases.mobile, path),
    web: joinBase(bases.web, path),
  };
}

// ── Templates ───────────────────────────────────────────────────────────────

export interface RenderedPush {
  readonly title: string;
  readonly body: string;
  /** Push data per the deep-link contract: `{ kind, route }` (route = mobile link). */
  readonly data: { readonly kind: NotificationEventKind; readonly route: string };
}

export interface RenderedEmail {
  readonly subject: string;
  /** Plain-text body (v1 is text-only) including both deep links. */
  readonly body: string;
}

export interface RenderedSms {
  /** GSM-7-friendly body, `Our Haven:`-prefixed, mobile link only. */
  readonly body: string;
}

export interface RenderedNotification {
  readonly kind: NotificationEventKind;
  readonly links: DeepLinks;
  readonly push: RenderedPush;
  readonly email: RenderedEmail;
  readonly sms: RenderedSms;
}

/** Read an optional string field from the payload (trimmed, non-empty). */
function optStr(payload: NotificationPayload, key: string): string | undefined {
  const value = payload[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

interface Copy {
  readonly title: string;
  readonly body: string;
}

/**
 * Per-kind title + body, English-only (v1). Optional payload fields (`actorName`,
 * `whenText`, `jobTitle`) personalise the copy when present and fall back to a
 * generic phrasing when absent, so a sparse payload never breaks a send. The
 * deep link is appended per-channel by `renderNotification`, not here.
 */
function copyFor(kind: NotificationEventKind, payload: NotificationPayload): Copy {
  const actor = optStr(payload, 'actorName');
  const when = optStr(payload, 'whenText');
  const jobTitle = optStr(payload, 'jobTitle');
  const forWhen = when ? ` for ${when}` : '';
  const jobLabel = jobTitle ? ` "${jobTitle}"` : '';

  switch (kind) {
    case 'booking_request_received':
      return {
        title: 'New booking request',
        body: `${actor ?? 'A family'} sent a booking request${forWhen}.`,
      };
    case 'job_awarded':
      return {
        title: 'You were awarded a job',
        body: `${actor ?? 'A family'} awarded you their job${jobLabel}.`,
      };
    case 'consultation_booked':
      return {
        title: 'Consultation booked',
        body: `${actor ?? 'A client'} booked a consultation${forWhen}.`,
      };
    case 'cancellation_within_24h':
      return {
        title: 'Booking cancelled',
        body: `${actor ?? 'The other party'} cancelled a booking within the 24-hour window${forWhen}.`,
      };
    case 'application_received':
      return {
        title: 'New application',
        body: `${actor ?? 'A caregiver'} applied to your job${jobLabel}.`,
      };
    case 'counter_offer_received':
      return {
        title: 'Counter-offer received',
        body: `${actor ?? 'The caregiver'} sent you a counter-offer.`,
      };
    case 'offer_expired':
      return {
        title: 'Offer expired',
        body: `Your offer${actor ? ` to ${actor}` : ''} expired with no response.`,
      };
    case 'job_expiring_48h':
      return {
        title: 'Your job is expiring soon',
        body: `Your job${jobLabel} expires in 48 hours and has no applications yet.`,
      };
    case 'job_expired_no_award':
      return {
        title: 'Your job expired',
        body: `Your job${jobLabel} expired with no caregiver awarded.`,
      };
    case 'session_start_reminder':
      return {
        title: 'Upcoming session',
        body: `Your session starts in 1 hour${when ? ` (${when})` : ''}.`,
      };
    case 'booking_accepted':
      return {
        title: 'Booking accepted',
        body: `${actor ?? 'The caregiver'} accepted your booking request.`,
      };
    case 'booking_declined':
      return {
        title: 'Booking declined',
        body: `${actor ?? 'The caregiver'} declined your booking request.`,
      };
    case 'booking_expired':
      return {
        title: 'Booking request expired',
        body: `Your booking request${actor ? ` to ${actor}` : ''} expired with no response.`,
      };
    case 'booking_session_started':
      return {
        title: 'Session started',
        body: `${actor ?? 'Your caregiver'} started the session${forWhen}.`,
      };
    case 'booking_hours_proposed':
      return {
        title: 'Hours submitted for review',
        body: `${actor ?? 'Your caregiver'} submitted their hours — review and confirm.`,
      };
    case 'booking_time_change_approved':
      return {
        title: 'Time change approved',
        body: `${actor ?? 'Your caregiver'} approved your time change.`,
      };
    case 'booking_time_change_declined':
      return {
        title: 'Time change declined',
        body: `${actor ?? 'Your caregiver'} declined your time change.`,
      };
    case 'booking_time_extended':
      return {
        title: 'Booking extended',
        body: `${actor ?? 'The family'} added more time to your booking${forWhen}.`,
      };
    case 'booking_time_reduce_requested':
      return {
        title: 'Shorter session requested',
        body: `${actor ?? 'The family'} asked to shorten your booking — review the request.`,
      };
    case 'booking_time_reduce_rescinded':
      return {
        title: 'Shorten request withdrawn',
        body: `${actor ?? 'The family'} withdrew their request to shorten the booking.`,
      };
    case 'booking_disputed':
      return {
        title: 'Booking disputed',
        body: `A dispute was opened on a booking${forWhen}.`,
      };
    case 'booking_no_show':
      return {
        title: 'No-show reported',
        body: `${actor ?? 'The family'} reported a no-show for a booking${forWhen}.`,
      };
    case 'booking_payment_failed':
      return {
        title: 'Payment problem',
        body: `A payment for your booking didn't go through — please check your payment method.`,
      };
    case 'booking_authorization_action_required':
      return {
        title: 'Action needed',
        body: `Confirm your payment details to secure your booking.`,
      };
    case 'booking_tip_received':
      return {
        title: 'You received a tip',
        body: `${actor ?? 'The family'} sent you a tip — 100% yours, no fees.`,
      };
  }
}

/**
 * Render a notification for every channel from its kind + payload + the
 * deep-link bases. The single entry point the dispatcher calls before fanning
 * out. Throws (via `buildDeepLinks`) on a payload missing a required route param.
 *
 * Per docs/notifications-deep-link-format.md:
 *   - push `data.route` carries the MOBILE link;
 *   - SMS carries the MOBILE link only, `Our Haven:`-prefixed;
 *   - email carries BOTH links.
 */
export function renderNotification(
  kind: NotificationEventKind,
  payload: NotificationPayload,
  bases: DeepLinkBases,
): RenderedNotification {
  const links = buildDeepLinks(CHANNEL_MATRIX[kind].routeTemplate, payload, bases);
  const { title, body } = copyFor(kind, payload);

  return {
    kind,
    links,
    push: { title, body, data: { kind, route: links.mobile } },
    email: {
      subject: title,
      body: `${body}\n\nOpen in the app: ${links.mobile}\nOr on the web: ${links.web}\n\n— Our Haven`,
    },
    sms: { body: `Our Haven: ${body} Open: ${links.mobile}` },
  };
}
