# Post-session tipping — optional Parent gratuity, 100% to the Caregiver, commission-exempt

**Status:** accepted (2026-06-23, client update). Extends **ADR-0001** (marketplace billing) and **ADR-0013** (single review window / payout). **Caregiver-only** — Provider consultations carry no on-platform money (ADR-0011), so they cannot be tipped.

> Domain language follows `CONTEXT.md` (§ Booking, § Payout, § Rating — updates pending, see Consequences). New domain term: **Tip**.

## Context

The 2026-06-23 client update added a post-session **tipping** flow to the prototype (`app/(screens)/tip-provider/page.tsx`, reached from the rating screen): after a Caregiver Booking completes and the Parent rates the Caregiver, the Parent may optionally add a gratuity. This is now in code (`Booking.tipAmount`, `store.tipBooking()`) but was never a documented decision — the v1 billing model (ADR-0001 Commission skim, ADR-0011 Caregiver payment-rail vs off-platform Provider, ADR-0013 same-day payout) has no concept of a tip.

Tipping is a real and expected behaviour in childcare — Parents routinely tip a babysitter who stayed late or handled a hard evening — and keeping it on-platform is both a supply-retention lever and a disintermediation safeguard (a Parent who can tip in-app has one less reason to settle up in cash off-platform). The open question was never *whether* to support it but on what commercial and payout terms.

## Decision

1. **Tipping is an optional, Parent-initiated gratuity on a completed Caregiver Booking.** It is offered after the Parent submits their rating (a natural "how did it go?" moment) and is reachable again later from the Booking detail (`Add a tip` / `Edit tip`). It is never required and never blocks rating, payout, or completion.

2. **A tip is 100% pass-through to the Caregiver — no Commission.** The platform takes **no `application_fee` on tips.** A tip is a discretionary gift from Parent to Caregiver, not marketplace-brokered consideration for the engagement; skimming it would be hostile to both sides and hard to defend. This is a deliberate divergence from the ADR-0001 Commission-on-every-Booking-payment posture, scoped strictly to tips. (Prototype: `tipBooking` adds the tip to Caregiver net with `fee` unchanged — "100% to the Caregiver, no fee.")

3. **Tips are mutable until they settle, then immutable.** Setting a tip amount of `0` clears any prior tip. The Parent may add, edit, or remove a tip while the Booking's payout has not yet been captured for the tip; once the tip is captured/paid out it is final (no "claw back a tip"). v1 prototype models add/edit/clear; the settlement cut-off is an implementation detail for the real Stripe integration (see Consequences).

4. **Tips do not change the dispute or review-window mechanics (ADR-0013).** A tip is added *after* completion and is independent of the ~24h hours-confirmation/dispute window. Disputing a charge does not implicitly dispute a tip; a tip is not "hours" and is not part of the agreed-rate computation the review window protects.

5. **Provider consultations cannot be tipped.** They carry a null payment intent and an off-platform clinical fee (ADR-0011); there is no on-platform money rail to attach a gratuity to. Tipping is gated to `role=caregiver`, hourly Bookings in a `completed` state.

## Why

- **It matches how families actually pay caregivers** and keeps that money on-platform rather than pushing a cash side-channel that erodes the marketplace's safety guarantees.
- **Zero Commission on tips is the only honest framing.** The Commission (ADR-0001) is the platform's cut of the brokered engagement; a tip is the Parent's own money moving to the Caregiver on top of that. Taxing it would read as a rake on a gift.
- **Keeping tips out of the review window keeps the fast-payout promise intact** (ADR-0013). The engagement payout still releases on the ~24h window; a later tip is a separate, additive transfer and does not re-open or delay anything.

## Considered alternatives

- **Commission on tips (apply the standard `application_fee` to the gratuity).** Rejected — see Why; a rake on a discretionary gift is indefensible and would suppress tipping (and thus push it off-platform).
- **Tip at booking / pre-authorise an estimated tip.** Rejected — a tip is a judgement made *after* the session ("they were great / they stayed late"); pre-committing it is the wrong mental model and complicates the authorize-at-booking / capture-at-completion flow (ADR-0001).
- **Fold the tip into the hours-confirmation / review window.** Rejected — it would couple a discretionary add-on to the dispute-bearing state (ADR-0013) and risk delaying the engagement payout behind a tip decision.
- **No on-platform tipping (tell Parents to tip in cash).** Rejected — cedes a disintermediation vector and a supply-retention lever for no benefit.

## Consequences

- **Schema deltas (`app/lib/types.ts`):** `Booking.tipAmount?: number` (already added). The payout breakdown gains a `tip` line that is additive to Caregiver `net` and bypasses `fee` (already in `store.ts` payout view).
- **Real-integration items (not in the prototype):** the production Stripe path must pay a tip as a **separate transfer to the Caregiver's Connect account with no `application_fee`** (or an additive capture on the same PaymentIntent with the application-fee unchanged); define the **settlement cut-off** after which a tip is immutable; and decide whether a tip rides the **same Instant-Payout / same-day-ACH rail** as the engagement payout (ADR-0013) or batches separately.
- **Tax/compliance (open — for privacy/tax counsel):** tips are Caregiver income. Confirm they are **included in the Caregiver's 1099-K** alongside engagement earnings (Stripe Connect typically reports gross processed), and that the **commission-exempt** treatment is reflected in the platform's books and Stripe Tax configuration (a tip is not platform revenue and carries no platform sales-tax nexus).
- **Docs to update:** `CONTEXT.md` § Booking / § Payout / § Rating (introduce **Tip**); DESIGN.md — the post-rating tip surface and the Booking-detail `Add a tip` / `Edit tip` affordance; PRD-0001 — new tipping stories + the payout-breakdown schema note (v1.7).
- **PRD-0001 stories:** new story for "Parent adds a tip after rating" (Parent side) and "Caregiver receives the full tip" (Caregiver side); the Pricing & Commission calculator description is annotated that **tips bypass the Commission skim**.
- **Open commercial question (Further Notes):** confirm with the client that tips carry **no platform Commission** in v1 (this ADR's assumption), and whether a Caregiver may **opt out** of tipping.
