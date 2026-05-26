# Embedded video calls via Daily.co — ad-hoc, in-chat, either party

**Status:** accepted (2026-05-19)

## Context

The 2026-05-19 client sync re-surfaced the video-call topic with a regression — Ci'erro suggested "Zoom or Google Meet for v1" with native video deferred. JD's existing engineering posture had already committed to **Daily.co embedded video** (see PRD-0001 § Backend runtime, § External services; `CONTEXT.md` § Data residency; DESIGN.md §5.4.5 Video interview room). This ADR resolves the conflict by formalising the existing commitment and refining the UX from "scheduled pre-booking interview" to "ad-hoc, in-chat, either-party-initiated".

PRD-0001 story 22 originally read: *"As a Parent, I want to schedule and join a video interview with a Provider before booking."* The sync moved the timing from pre-booking-only to anytime-in-chat, and the initiator from Parent-only to either party. This ADR captures the resulting design.

## Decision

**v1 ships native embedded video via Daily.co.** Not a Zoom/Meet redirect; not deferred to Phase 2.

- **Vendor:** Daily.co (WebRTC API, US-region rooms — matches `CONTEXT.md` data-residency posture).
- **Trigger:** a 44pt video-call icon in the chat thread's app bar (DESIGN.md §5.5.2). Available in **any** thread — Posted-Job Application threads and Direct-Message threads (pre- or post-acceptance). Both Parent and Provider can initiate; the Provider mobile companion's chat surface gets the same button.
- **Modality:** ad-hoc only ("start a call now" — generates a Daily.co room, posts a Join bubble in the thread, valid for ~30 min). No scheduling flow in v1.
- **Where the call happens:** full-screen embedded Daily.co room inside the app (DESIGN.md §5.4.5).
- **Audit posture:** log the *generation* of a call link (timestamp, thread ID, initiator) for Trust & Safety review; do **not** record call content. Privacy Policy disclosure: *"Video calls are conducted via Daily.co. Call content is not stored or monitored by Our Haven; only the timestamp and participants of call invitations are logged."*
- **Subscription gate:** none separate. Video inherits the messaging gate — a free-tier Parent can't reach a chat thread without an active Subscription anyway.

## Why

- **Native embedded video is the trust-and-safety story Ci'erro is selling.** A Zoom/Meet redirect dumps the user into a third-party app, which (i) breaks the "I can verify their face inside the app I trust" UX, (ii) creates a vector for both parties to exchange details outside the disintermediation detector, and (iii) raises the install friction enough that calls *will not actually happen*. Daily.co embed keeps the call inside Our Haven; the safety and trust framing is intact.
- **Daily.co's per-participant-minute pricing scales with usage**, not headcount — cheap during the soft-launch supply-seeding period when call volume is low, predictable as the marketplace grows. No per-seat licence cost.
- **HIPAA-eligible plan available** for the Specialist clinical-session use case if we choose to offer post-booking clinical-style video sessions later (Phase 2 candidate; not v1 scope, but worth noting the path is lit).
- **Ad-hoc, not scheduled.** A scheduled-video-interview flow needs a calendar-invite integration (Google/Apple/Outlook), a "Provider has confirmed the time" round-trip, and reminder notifications. The actual use case is *"meet face-to-face before booking"* — both parties are already in the chat thread negotiating; "tap call now" hits the use case directly.
- **Either-party initiation matches messaging symmetry.** The Provider should be able to say "let me show you my face" as much as the Parent can ask for it.
- **Log-but-don't-record** preserves the safety-review story without taking on the consent/storage/retention/transcript burden of video recording. Recording is a Phase 2 question if Trust & Safety asks for it.

## Considered alternatives

- **Zoom redirect.** Rejected — install friction, off-platform UX, weaker trust story.
- **Google Meet redirect.** Considered (less install friction than Zoom). Rejected for the same off-platform UX reason; also forces a Google account on both sides for full-feature access.
- **Daily.co scheduled-only.** The original PRD posture. Rejected as too heavy for the actual use case (parties are already chatting; the call is *part of* the conversation, not a separate calendared meeting).
- **Defer native video to Phase 2.** Rejected — contradicted by the client; Ci'erro views video as a core differentiator, not a polish item.
- **Recorded calls.** Rejected for v1 on consent/storage/transcript-retention build cost. Documented as a Trust & Safety follow-up if call abuse becomes a real signal.

## Consequences

- **`CONTEXT.md`** gains a § Video call glossary entry near § Message.
- **PRD-0001 story 22** is rewritten to "ad-hoc in-chat video call, either party". A sibling Provider-initiator story to be added during the PRD v1.1 revision pass.
- **PRD-0001 § External services** keeps Daily.co; no vendor change.
- **DESIGN.md §5.4.4** ("Schedule video interview") is rewritten as **"Video call (ad-hoc, in-chat)"** — modal + thread bubble pattern, no calendar UI.
- **DESIGN.md §5.5.2** chat thread app-bar video-call icon is available in *both* Parent and Provider thread surfaces (not Parent-only).
- **Privacy Policy** must disclose Daily.co as a sub-processor and the audit-without-recording posture.
- **Trust & Safety admin tooling** gains a "calls in this thread" line-item next to messages (timestamps and participants only; no content).
