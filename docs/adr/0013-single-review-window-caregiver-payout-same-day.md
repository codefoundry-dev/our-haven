# Single ~24h post-completion review window for Caregiver bookings; same-day payout; 7-day dispute-hold retired

**Status:** accepted (2026-05-30, client sync). **Amended 2026-06-23** (see § Amendment — self-serve dispute entry points widened beyond the review window; the **payout-hold semantics are unchanged** — the ~24h window is still the only state that auto-holds a Payout). Refines ADR-0001 (marketplace billing). Supersedes the `CONTEXT.md` § Dispute "7-day window … filing a Dispute pauses the Provider's Payout" rule and the separate § Session 24h hours-confirmation window (the two merge). **Caregiver-only** — Provider consultations carry no on-platform money (ADR-0011).

## Context

The 2026-05-28 client sync raised three asks that cannot all hold at once:

1. **Same-day Caregiver payout** (Caregivers "require payout within 24 hours").
2. **Auto-release** funds to the Caregiver if the Parent doesn't dispute within **24–48h**.
3. The documented **7-day** post-completion Dispute window, during which "filing a Dispute pauses the Provider's Payout."

You cannot pay a Caregiver same-day *and* hold the funds for a 7-day dispute — once the money is in the Caregiver's bank, a dispute on day 5 has nothing to pause. The existing model also had a *separate* 24h hours-confirmation window (the `awaiting-confirmation` state) layered before the 7-day dispute window, so there were effectively two post-session windows.

## Decision

**Collapse hours-confirmation and dispute into a single post-completion review window of ~24h, for Caregiver (hourly) bookings.**

- At session end the Caregiver proposes final hours; the Parent gets a **review/dispute push** (and can reach it from Booking history).
- Within the window the Parent may **confirm**, **adjust/dispute the hours**, or do nothing.
- If **no dispute** is filed by the deadline, the Booking **auto-confirms**, payment **captures**, and the **Payout releases** — fast: Stripe **Instant Payout** (≈1.5% fee, debit-rail) or **same-day ACH**. Who absorbs the instant-payout fee is an open commercial item (JD's Stripe research action).
- A **Dispute can only hold a Payout *during* the review window.** The **7-day post-payout dispute window is retired for payment purposes.**
- **Serious post-payout issues** (a safety incident surfacing after release) are an **admin escalation** — handled by platform-absorbed refund or a Stripe Connect clawback as an exception — **not** an automatic Payout hold.

The effective "same-day payout" promise is therefore: **paid within roughly a day of the session**, once the ~24h review window closes with no dispute. The exact window length (24h vs 48h) is a tunable launch parameter.

## Why

- **It removes the contradiction** instead of papering over it: a single short window is both the dispute window *and* the payout-hold window, so "auto-release at 24h" and "paid next-day" become the same statement.
- **Caregiver cashflow is a real supply-retention lever.** Gig caregivers churn off platforms that hold their money for a week; a ~24h hold is competitive while still giving Parents a genuine review window.
- **Post-payout disputes are rare and better handled as exceptions.** Reserving clawback/absorbed-refund for true safety incidents (vs. routine billing disputes) keeps the common path fast and the rare path safe.

## Consequences

- **Booking state machine:** `awaiting-confirmation` becomes the **sole dispute-bearing state**; `completed` is terminal for payout. The old 7-day post-`completed` dispute entry point is removed. Per-session (Specialist/Provider) paths are unaffected — they carry no on-platform payment.
- **Risk:** the platform accepts a short tail of post-payout safety-dispute exposure (absorbed refund or clawback). Bounded by the rarity of post-window safety escalations and by Caregiver background-screening.
- **Stripe:** requires Instant Payout or same-day ACH on Stripe Connect; fee-bearing party TBD. JD's open research action confirms feasibility + cost.
- **Docs:** `CONTEXT.md` § Booking states, § Session, § Dispute, § No-show, § Payout updated; DESIGN.md dispute/confirm-hours surfaces (§5.6.3/§5.6.4) reframed as a single review window; the post-session review push (§5.8) added.
- **Future readers:** if you find no 7-day dispute window in the code, this is why — disputes live inside the ~24h review window; later safety issues are admin exceptions.

---

## Amendment (2026-06-23) — self-serve dispute entry points widened; payout-hold semantics unchanged

The 2026-06-23 client update added a **"Dispute charge & billing"** action that is now reachable from more Booking states than the review window, plus a dispute action on **past Jobs**. The prototype gates it on `DISPUTABLE = { accepted, confirm_hours, completed }` (`app/(screens)/booking-detail/page.tsx`) and adds `store.disputeJob()` + `Job.dispute`. On the surface this looks like a return of the post-completion dispute window this ADR retired, so this amendment records *why it is not* and where the line is.

The original decision conflated two things that this amendment separates: **where a Parent can raise a problem** (the entry point) and **what filing does to the money** (the payout-hold). This ADR retired the *automatic 7-day payout hold*; it did not (and should not) prevent a Parent from *reporting* a billing problem after the fact.

### A1. The ~24h review window remains the only state that auto-holds a Payout.

A dispute filed while the Booking is in **`confirm_hours`** (the `awaiting-confirmation` review window) keeps its original semantics from this ADR: it **holds the Payout** and is resolved inside the window before any money releases. **Nothing about the fast-payout promise changes.**

### A2. Disputes filed outside the window are admin escalations, not payout holds — and that was always this ADR's intent.

This ADR already said serious post-payout issues are "an **admin escalation** — handled by platform-absorbed refund or a Stripe Connect clawback … **not** an automatic Payout hold." The amendment only adds a **self-serve entry point** to start that escalation, instead of forcing the Parent to find a support channel:

- **`completed` (post-payout):** filing creates a **dispute record that routes to admin review** (absorbed refund / clawback as an exception). It does **not** retroactively hold or reverse a Payout automatically. This is the same escalation the ADR described, now reachable from the Booking detail.
- **`accepted` (pre-session, pre-capture):** a Parent can raise a **charge/billing concern before the session happens** (e.g. authorization amount looks wrong, booking made in error). No payout exists yet, so there is no hold to apply; the record routes to admin and can also inform a cancellation.
- **Past Job (`disputeJob` / `Job.dispute`):** a billing/charge complaint about a Job-driven engagement, captured with the same `DisputeReason` chip + free-text shape. Admin-routed.

### A3. The dispute record shape is shared; the *consequence* is state-dependent.

All entry points capture the same `Dispute` (`{ reason ∈ overcharged | no-show | safety | quality | other, details, hasPhoto?, filedAt }`). The **state in which it is filed determines the consequence**: `confirm_hours` → automatic payout hold + in-window resolution; `accepted` / `completed` / past-Job → admin escalation queue with no automatic money movement. This keeps the fast common path (ADR-0013 core) intact while giving Parents a real recourse surface for the rare exceptions.

### Consequences of the amendment

- **No change to the Booking state machine's payout semantics:** `awaiting-confirmation`/`confirm_hours` is still the sole *payout-holding* state. A dispute on `accepted` or `completed` does not introduce a new hold; it sets the Booking's `dispute` and flags it for admin.
- **Real-integration items (not in the prototype):** the admin-escalation queue and its SLA; the rule that an outside-window dispute must **never** trigger an automatic Connect reversal (only an admin-actioned absorbed-refund/clawback); whether a `completed`+disputed Booking is visually distinguished from an in-window dispute.
- **Risk note (unchanged):** this is the same bounded post-payout exposure the original ADR accepted — the amendment just makes the entry point self-serve, which should *improve* signal (Parents report through a structured chip flow instead of ad-hoc support).
- **Docs to update:** `CONTEXT.md` § Dispute (entry points vs payout-hold distinction); DESIGN.md (the `Dispute charge & billing` affordance across `accepted` / `confirm_hours` / `completed` and the past-Job dispute surface); PRD-0001 stories 38 / 39 + the Job schema note (`Job.dispute`) (v1.7).

