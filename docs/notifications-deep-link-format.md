# Notification deep-link format

**Status:** v1 (OH-116, implemented by OH-194) — initial shipping format. Subject to revision when in-app deep-link routing lands in Phase 3 (apps/mobile, provider-web). The `CHANNEL_MATRIX` referenced below now lives at `packages/domain/src/notifications/index.ts` (single self-contained module). `consultation_booked` (CONTEXT § Notifications SMS-mandatory set, absent from the original OH-116 table) reuses the `schedule/booking/{bookingId}` surface and is included.

Every transactional notification dispatched by the OH-116 dispatcher carries **two parallel deep links**: one for mobile (custom URL scheme) and one for the Provider web portal. The recipient client picks the one it can open. Push notifications carry the mobile URL in `data.route`; SMS bodies and emails include both URLs inline.

## URL schemes

| Surface | Scheme | Configured via |
|---|---|---|
| Parent + Provider mobile | `ourhaven://` | `NOTIFICATIONS_DEEP_LINK_BASE_MOBILE` |
| Provider web portal | `https://provider.ourhaven.com/` | `NOTIFICATIONS_DEEP_LINK_BASE_WEB` |

The mobile scheme is the Expo app scheme registered by `apps/mobile` (Parent app) and reused by the Provider mobile companion. Both apps share the same scheme so a single `data.route` deep link works against whichever app is installed. The Parent app handles parent-facing events; the Provider mobile companion handles provider-facing events; the OS opens whichever app is registered for the URL when both are installed (this is acceptable — the user's role context disambiguates).

## Target priority

A notification reaches multiple channels at once and each channel includes a target URL. The recipient resolves them as follows:

1. **Push notification on mobile** → tap → app opens via `ourhaven://…` deep link directly. No URL navigation needed; the system intercepts.
2. **Push notification on web (VAPID)** → click → service worker routes to `https://provider.ourhaven.com/…`.
3. **Email** → recipient may click either link. The mobile link only resolves if the app is installed and the OS supports universal links for the scheme; otherwise the web link is the fallback.
4. **SMS** → recipient taps the link. On iOS/Android the OS resolves `ourhaven://…` if the app is installed; otherwise it does nothing (SMS clients won't auto-translate to web). For this reason **SMS bodies use the mobile URL only** — the web URL is reserved for email + push contexts where the client can render two URLs without confusion.

## Route paths per event kind

The route template is encoded in `CHANNEL_MATRIX` (`packages/domain/src/notifications/index.ts`). `{key}` placeholders are filled from the event payload at dispatch time.

| Event kind | Route template | Param source |
|---|---|---|
| `booking_request_received` | `schedule/booking/{bookingId}` | `event.bookingId` |
| `job_awarded` | `schedule/booking/{bookingId}` | `event.bookingId` |
| `consultation_booked` | `schedule/booking/{bookingId}` | `event.bookingId` |
| `cancellation_within_24h` | `booking/{bookingId}` | `event.bookingId` |
| `session_start_reminder` | `schedule/booking/{bookingId}` | `event.bookingId` |
| `application_received` | `job/{jobId}` | `event.jobId` |
| `counter_offer_received` | `thread/{threadId}` | `event.threadId` |
| `offer_expired` | `thread/{threadId}` | `event.threadId` |
| `job_expiring_48h` | `job/{jobId}` | `event.jobId` |
| `job_expired_no_award` | `job/{jobId}` | `event.jobId` |
| `booking_accepted` / `booking_declined` / `booking_expired` | `booking/{bookingId}` | `event.bookingId` |

A booking-request notification therefore expands to:

```
mobile:  ourhaven://schedule/booking/b-1
web:     https://provider.ourhaven.com/schedule/booking/b-1
```

The `schedule/booking/{id}` prefix takes the Provider directly to their Schedule tab's booking detail; `booking/{id}` is the shared detail surface for both sides; `job/{id}` is the parent's job detail; `thread/{id}` is the chat thread (used for pre-acceptance Direct-Message flows).

## Push notification payload contract

`data.route` carries the mobile deep-link; `data.kind` carries the event kind for client-side analytics + routing.

```json
{
  "title": "New booking request",
  "body": "Alex wants to book Mon Jun 1, 3 PM",
  "data": {
    "kind": "booking_request_received",
    "route": "ourhaven://schedule/booking/b-1"
  }
}
```

For web push (VAPID) **v1 sends an empty payload** ("tickle"). The service worker registered by `apps/provider-web` receives a `push` event with no data, refetches the user's notification inbox from the API, and renders the resulting notifications. RFC 8291 aes128gcm payload encryption is deferred — the empty-payload flow avoids the implementation cost while preserving correctness (the canonical state lives server-side regardless).

## SMS body conventions

- Lead with `Our Haven:` so the recipient identifies the sender.
- Include the **mobile** link inline (no web link — see "Target priority" above).
- Keep ≤160 GSM-7 chars where possible to avoid multi-segment billing.
- Renderers live in `packages/domain/src/notifications/index.ts`.

Example: `Our Haven: Alex sent a booking request for Mon Jun 1, 3:00 PM. Open: ourhaven://schedule/booking/b-1`

## Email body conventions

- Plain-text only in v1 (no HTML).
- Subject ≤ ~78 chars per RFC 5322 best practice.
- Body includes **both** links explicitly so the recipient can pick whichever they prefer.
- Resend `tags: [{ name: 'dispatch_id', value }, { name: 'event_kind', value }, { name: 'category', value: event_kind }]` are stamped on every send so the future Resend webhook can correlate opens/clicks/bounces back to `notification_dispatches` rows. (The adapter input still uses the dispatcher-shaped `customArgs` + `categories` keys; the adapter maps them into Resend `tags` on the wire.)

## Out of scope (v1)

- **Universal Links / Android App Links.** The mobile scheme is currently a plain custom URL scheme. Migrating to Apple Universal Links (`https://ourhaven.com/...` with the `apple-app-site-association` file) and Android App Links is a Phase 3 mobile ticket — it unlocks unbroken email-to-app flow without prompting the user to install the app.
- **Web-push payload encryption (RFC 8291).** v1 sends an empty "tickle" body; service worker refetches. Full payload encryption is deferred.
- **In-app notification inbox.** Per CONTEXT.md § Notifications, deferred to post-launch.
- **Per-locale templates.** Templates are English-only in v1. i18n lands when the marketing launch covers non-English-primary states.
