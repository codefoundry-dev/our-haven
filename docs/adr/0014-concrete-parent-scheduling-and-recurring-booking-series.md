# Concrete parent-specified scheduling + recurring Booking Series

**Status:** accepted (2026-06-10). **Amended 2026-06-23** (see § Amendment — multi-day one-off + adjust booked time; reverses the original §3 "exactly one date" constraint for one-off and the deferral of per-occurrence schedule edits). **Amends ADR-0006** (job-posting + negotiable pricing) and extends **ADR-0013** (single review window) to the recurring case. Does not disturb the Caregiver Job → Application → Offer → Booking chain (ADR-0006 §1) or the Caregiver/Provider fork (ADR-0011) — it enriches the *schedule* carried through that chain.

> Domain language follows `CONTEXT.md` (§ Booking, § Job, § Offer, § Availability — all updated 2026-06-10).

## Context

The 2026-06-10 client review flagged the parent booking flow as "unusable": **a Parent cannot set a specific date or time for a job.** Grounding the complaint in the prototype confirmed it across both Caregiver booking paths:

- **Post a Job** (`app/screens/post-job/steps.tsx`) captured only a *window length* (1 week / 2 weeks / 1 month / 3 months), bare *day-of-week* toggles ("Tuesday through Thursday"), and a Morning/Afternoon/Evening *band* — no calendar date, no clock time.
- **Send a request to a Caregiver** (`app/screens/booking-compose/page.tsx`) inherited `dateLabel` from a draft and exposed only child count + ages — no date picker, time shown only as a band.

The root cause is a **mis-application of ADR-0006**. ADR-0006 (refined 2026-05-19) deliberately killed *slot-pick* — Caregivers no longer publish per-slot calendars, because Ci'erro reported per-slot calendars are impractical for Caregivers to maintain; Caregiver Availability became a general weekly grid + free-text note. That decision was about the **Caregiver's** published availability. But the prototype over-extended the resulting "fuzziness" onto the **Parent's own request**, leaving the Parent with no way to express the concrete date/time *they* need. Parents think in concrete dates ("this Friday 6–10 PM", "every Tue & Thu after school until June"); the fuzzy day-of-week + band + abstract multi-month window model does not serve that and reads as broken.

A second gap surfaced in the same review (handled here because it shares the booking object): the prototype had no model for **recurring** engagements beyond a `scope` label, even though Nanny work is recurring by definition (`CONTEXT.md` § Booking already hinted "a Nanny engagement is modeled as a long-running hourly Caregiver Booking, potentially recurring" without defining how).

## Decision

1. **Parent-specified concrete scheduling — not slot-pick.** The Parent sets a **concrete date + start–end time window** directly on the request. This applies to both Caregiver booking paths: the Direct-Message **Book-request / Offer** and the **Posted Job**. Caregivers still publish **no bookable calendar** — the Caregiver **accepts / counters / declines** the proposed time. ADR-0006's removal of Caregiver slot-pick stands; this changes only what the *Parent* may specify, not what the *Caregiver* publishes.

2. **Time is a start–end window.** The Parent picks concrete start and end clock times (e.g. "6:00–9:00 PM"). **Duration** is derived from the window and feeds the Pricing & Commission calculator (`agreed_rate × hours`, unchanged arithmetic). The Morning/Afternoon/Evening **band** is **derived** from the window solely to intersect against the Caregiver's weekly Availability grid for search/filtering — it is no longer a hand-picked field.

3. **One-off jobs: single date + window.** A one-off Job/Booking is exactly one calendar date plus the time window. The **window-length control (1 week / 2 weeks / 1 month / 3 months) is removed.** One-off → exactly one Booking.

4. **Recurring jobs: anchored pattern.** A recurring Job carries an *anchored recurrence rule* — **start date + weekday selection + start–end time window + end date** — and the compose UI **previews the concrete occurrence dates** the rule generates. Weekdays are retained (the correct abstraction for genuine recurrence) but are now anchored to real calendar dates at both ends, replacing the abstract multi-month window.

5. **Recurring arrangement → Booking Series, materialised up front.** Awarding a recurring Job (or accepting a recurring Book-request) creates a **Booking Series** that owns the recurrence rule + Agreed Rate and **materialises all of its occurrence Bookings immediately**, grouped under the Series. Each occurrence is an ordinary Booking running the full per-session lifecycle (in-progress → ~24h review window → payment capture → dispute, per ADR-0013) and is individually cancellable. The card is **authorized per-occurrence near each session and captured at each completion** (ADR-0001 timing, applied per occurrence — there is no upfront charge for the whole series). Cancelling one occurrence leaves the rest; cancelling the Series cancels all still-upcoming occurrences under the standard Cancellation policy. A one-off Booking has no Series.

6. **Caregiver weekly Availability is a discovery/filter signal only.** Reaffirmed explicitly: the grid is never what a Parent books against; it informs search ranking/filtering and gives the Parent a hint before proposing a concrete time. A Parent may propose a time outside the grid — the Caregiver simply declines if it doesn't suit (the grid is advisory, not a hard constraint).

## Why

- **Honors the client need without reversing ADR-0006.** The painful UX was the Parent's inability to state concrete dates/times. Slot-pick (Caregivers publishing bookable slots) was rejected for good reasons that still hold; parent-specified scheduling is a different mechanism that delivers the concrete date/time picker the client asked for while keeping Caregiver calendars out of scope.
- **Reuses the existing money/lifecycle machinery.** Per-occurrence Bookings keep ADR-0013's single ~24h review window and ADR-0001's authorize-at-booking / capture-at-completion semantics intact — each occurrence is just a normal Booking. No new payment or dispute primitive.
- **Up-front materialisation fits the management-hub goal.** The same review asked for post-booking management; a Parent can only manage a session that exists as a record. Materialising the full schedule makes every session visible and actionable, grouped under the Series so a 12-week arrangement does not read as 36 disconnected rows.
- **Weekday recurrence + concrete anchoring is the honest model.** Tapping dozens of individual dates is unusable for a school-term engagement; a pure pattern with no calendar anchor was the thing that felt broken. Anchoring the pattern to real start/end dates and previewing the generated occurrences gives both precision and scale.

## Considered alternatives

- **Reintroduce Caregiver slot-pick** (Caregivers publish bookable slots; Parents tap one). Rejected — re-litigates ADR-0006 §9 / § Considered alternatives; Caregivers find per-slot calendar upkeep impractical. Parent-specified scheduling achieves "pick a specific time" without it.
- **Keep Morning/Afternoon/Evening bands as the only time control** (add a date, keep bands). Rejected — does not deliver "specific times"; would re-trigger the same complaint. Bands are retained only as a *derived* matching dimension.
- **Multi-date one-off** (tap several specific dates under one one-off Job). Rejected for v1 — blurs the one-off/recurring boundary and forces the one-job-many-bookings question onto the one-off path; irregular schedules go through recurring or separate jobs.
- **One Booking for the whole recurring series.** Rejected — breaks per-session payment + the ~24h dispute window, fights the existing Booking state machine, and cannot cleanly adjust/dispute a single occurrence (e.g. one late Tuesday).
- **Many independent occurrence Bookings with no Series grouping.** Rejected — smallest schema change, but a recurring Nanny arrangement floods the Parent's list with no "manage this arrangement" surface; weak for the role that is recurring by definition.
- **Rolling-window / lazy occurrence materialisation.** Rejected for v1 — fewer records, but the Parent can't see or manage sessions beyond the window and total-session count is fuzzy, undercutting the post-booking-management ask. Revisit only if up-front record volume becomes a real problem.

## Consequences

- **`CONTEXT.md` updated (2026-06-10):** § Booking (concrete schedule + Booking Series), § Job (one-off vs recurring schedule), § Offer (schedule on the Offer), § Availability (grid is discovery-only). New domain term: **Booking Series**.
- **Schema deltas (PRD / `app/lib/types.ts`):** the Offer, Booking, and Job gain a concrete `date` + `start_time`/`end_time` (one-off) or a `recurrence` rule (start date + weekdays + window + end date). A new **`BookingSeries`** entity is introduced, with a nullable `seriesId` on Booking. `durationHours` is derived from the window (kept as the pricing input); `band` becomes derived. The Pricing & Commission and Cancellation calculators are unchanged in arithmetic — only the *source* of the duration changes.
- **PRD-0001 stories to revise:** 24 (Direct-Message Book-request — add concrete date/time), 25 / 90 (child detail capture moments — now alongside concrete schedule), 84 (post a Job — one-off vs recurring concrete schedule; drop the multi-month window), 12 (date/time filter — intersect derived band). **New story:** recurring arrangement → Booking Series + per-occurrence management.
- **DESIGN.md additions:** a date picker, a start–end time picker, the recurrence editor (start/end date + weekday + window with an occurrence-count preview), the **Booking Series** grouping on the unified Bookings management hub, and removal of the window-length pills + bare day-of-week toggles from the Post-a-Job logistics step.
- **Out of scope (deferred):** per-occurrence edits to a generated series (skip/add individual dates — a "pattern + edit occurrences" v2), multi-date one-off jobs, and any Caregiver-published bookable calendar. *(2026-06-23: the first two are **partially un-deferred** — see § Amendment.)*

---

## Amendment (2026-06-23) — multi-day one-off + adjust booked time

The 2026-06-23 client update shipped two scheduling capabilities that the original decision had ruled out. This amendment records the reversal and the new mechanics. The core of ADR-0014 stands: the Parent specifies concrete dates/times, Caregivers publish no bookable calendar, recurring arrangements still materialise a Booking Series, and the money/lifecycle machinery (ADR-0001 / ADR-0013) is unchanged.

### A1. Multi-day one-off is now allowed (reverses §3 and the "multi-date one-off" rejection)

A one-off request may now carry **several concrete dates, each with its own start–end time window**, instead of exactly one date. This was previously rejected ("Considered alternatives → Multi-date one-off"; "Out of scope → multi-date one-off jobs") on the grounds that it blurred the one-off/recurring boundary. The client wanted it for the common "a few specific evenings that aren't a weekly pattern" case (e.g. this Fri 6–10, next Wed 5–8), which recurring (a fixed weekday pattern) models awkwardly and "separate jobs" makes tedious.

- **Direct-Message Book-request:** the Offer carries a **`slots[]`** list (`OfferSlot = { date, startMin, endMin }`); the primary slot also stays on `dateLabel`/`startMin`/`endMin` for back-compat. The multi-day request shows in chat as **one bundled card** ("N dates · Xh total · $Y"). **Accepting materialises one ordinary Booking per slot** — each runs the full per-session lifecycle (ADR-0013) and is individually cancellable, exactly like Series occurrences but **with no Booking Series** (a one-off bundle is not a recurrence).
- **Posted Job:** the one-off composer accepts several dates with per-day times and **posts one Job per date** (each `scheduleMode: "one-off"`). (Note the deliberate asymmetry: the Book-request bundles into one Offer → many Bookings; the Job path fans out into many Jobs. Both deliver "a few specific dates" without inventing a one-off-with-many-occurrences Job object.)
- One-off with a single date is unchanged (`slots` absent or length ≤ 1 → exactly one Booking).

**Why the reversal is safe:** the original objection was that multi-date one-off forced a "one Job → many Bookings" question onto the one-off path. The Book-request path answers it the same way a Series does (one accept → many Bookings, each independent); the Job path sidesteps it entirely by fanning out into separate Jobs. The one-off/recurring boundary stays meaningful: **recurring = a weekday pattern anchored between two dates** (→ Booking Series, grouped); **multi-day one-off = an explicit hand-picked set of dates** (→ independent Bookings, ungrouped).

### A2. Search-radius dropped from Post-a-Job

The Post-a-Job logistics step no longer captures a **search radius** (the radius slider/presets and the `radius` field are removed); location is the ZIP only. Radius was a Caregiver-discovery control that no longer fits now that a Job's location is expressed as a **service address** with **ZIP-centroid approximate distance** surfaced on the open-Job card (ADR-0016 / PRD story 124, v1.6). This is a schema delta on the Job (drop `radius`).

### A3. Adjust a booked session's time (un-defers "per-occurrence schedule edits", asymmetrically)

A Parent may now change the time of an **`accepted`, non-consultation Booking** — previously deferred ("Out of scope → per-occurrence edits to a generated series"). The mechanic is deliberately **asymmetric**, because the two directions have different consent implications:

- **Extending (more time) applies immediately.** The Parent is simply buying more of the Caregiver's time; `extendBookingTime(id, addHours)` mutates `durationHours` / `endMin` directly. (Real-integration note: extending raises the authorization amount — the production path must re-authorize the larger total.)
- **Shortening (less time) requires Caregiver approval**, because it removes paid hours the Caregiver agreed to. `requestReduceBookingTime(id, newDurationHours, note?)` writes a **`pendingTimeChange`** proposal onto the Booking (`PendingTimeChange = { proposedDurationHours, proposedEndMin?, note?, requestedAt }`); the Caregiver sees a banner and **`approveBookingTimeReduction`** (applies it) or **`declineBookingTimeReduction`** (drops it). The Parent may rescind their own pending request (`cancelBookingTimeReductionRequest`). Until approved, the Booking keeps its original duration and pay.
- Applies to hourly Caregiver Bookings in `accepted` only. Provider consultations (off-platform, slot-based) have no adjust-time affordance.

**Why asymmetric:** extending is a unilateral Parent purchase (no Caregiver downside); shortening unilaterally would let a Parent cut a Caregiver's agreed pay without consent. The approval gate makes the reduction a negotiated change, consistent with the negotiable-engagement posture (ADR-0006/0017) without involving the cancellation-fee calculator (this is a duration change, not a cancellation).

### Consequences of the amendment

- **Schema deltas (`app/lib/types.ts`, already in code):** `Offer.slots?: OfferSlot[]`; `Booking.pendingTimeChange?: PendingTimeChange`; `Job` drops `radius`. (Tip and dispute-surface deltas are tracked in ADR-0018 / ADR-0013 respectively.)
- **Booking state machine:** `pendingTimeChange` is a transient sub-state on an `accepted` Booking, not a new top-level status; approve/decline/cancel resolve it back to a plain `accepted` Booking with a new (or unchanged) duration. No change to the `requested → … → completed` graph.
- **Real-integration items (not in the prototype):** re-authorization on extend; whether a same-day shorten before session start has any cancellation-policy interaction (current decision: none — it is a duration change, not a cancellation).
- **Docs to update:** `CONTEXT.md` § Booking / § Job / § Offer (multi-day one-off bundle; adjust-time; drop radius); DESIGN.md (the multi-date one-off picker, the Adjust-time bottom sheet with hour presets + custom half-hour picker, the bundled multi-day chat card, the Post-a-Job logistics step without the radius control); PRD-0001 stories 24 / 84 + schema-shape implications + the multi-date-one-off out-of-scope reversal (v1.7).

