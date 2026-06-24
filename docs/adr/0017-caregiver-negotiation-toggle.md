# Caregiver negotiation toggle — Counter is opt-out, not guaranteed

**Status:** accepted (2026-06-17, client update). **Amends ADR-0006** (job-posting + negotiable pricing), whose invariant was that **either party may Counter** an Offer. Caregiver-only (Providers are fixed-price slot-pick with no Offers — ADR-0011). Leaves the Offer object, the initial-Offer path, and the Job → Application → Offer → Booking chain intact — it gates only the **`countered`** transition.

> Domain language follows `CONTEXT.md` (§ Offer — updated 2026-06-17).

## Context

The 2026-06-17 client review asked to let **"the caregiver toggle a switch to allow negotiations or not, which should affect whether the counter button shows in the booking flow."** Today negotiation is unconditional: ADR-0006 made Caregiver pricing negotiable and `CONTEXT.md` § Offer renders **Accept / Counter / Decline** on every Offer bubble, with either party able to Counter.

That suits caregivers who want to haggle, but not those who price firmly (a tutor with a set hourly, a nanny with a non-negotiable rate). For them, an ever-present Counter button invites lowball offers they have to keep declining — friction with no upside. The client wants fixed-price caregivers to be able to switch negotiation off.

## Decision

1. **Person-level `negotiable` boolean on the Caregiver, default `true`.** Default-true preserves ADR-0006's negotiable-first marketplace; the switch is an **opt-out**, not an opt-in.

2. **When `false`, Counter is hidden wherever it would involve that Caregiver — on both sides.** The Parent cannot counter the Caregiver, and the Caregiver cannot counter the Parent.

3. **Direct-Message path (negotiable = false):** the Parent's Book-request rate is **locked to the Caregiver's published per-category Rate** (+ per-child surcharge) — the Parent cannot enter a haggled number — and the Caregiver sees **Accept / Decline only**. The Parent still sets the non-price terms (date, time, hours, child count); the rate auto-computes.

4. **Posted Job path (negotiable = false):** the Caregiver still **applies with their own bid** (the initial Offer is theirs to set — that is not "negotiating"), but the Parent reviewing that Application gets **Accept / Decline only**, no Counter.

5. **Only the `countered` transition is gated.** The Offer object, its fields, and the Accept/Decline path are unchanged; a non-negotiable Caregiver simply has the `countered` transition disabled in their threads/applications.

6. **Providers are unaffected** — clinical consultations are fixed-price slot-pick with no Offers or negotiation already.

7. **One person-level switch in v1.** Per-category negotiation control (negotiate tutoring, fix babysitting) is a deferred v2 refinement — rates are already per-category, so it slots in cleanly later, but the client asked for "a switch" and v1 keeps one.

## Why

- **Respects caregiver pricing autonomy** without abandoning the negotiable default that ADR-0006 chose for liquidity.
- **A locked rate is honest.** "This caregiver's price is fixed" is clearer than letting Parents type any number and get declined — the looser version just manufactures decline churn.
- **Minimal mechanic change.** The Offer and Accept/Decline path are untouched; one transition is guarded by a boolean. No new primitive, no change to the Booking lifecycle.
- **Default-true is the safe amendment.** Defaulting off would silently flip every existing caregiver to fixed-price and reverse ADR-0006 for the whole marketplace.

## Considered alternatives

- **Keep ADR-0006 as-is (always negotiable).** Rejected — ignores the client ask and the real population of fixed-price caregivers.
- **Default `false` (fixed-price by default).** Rejected — silently reverses ADR-0006's negotiable-first design for everyone; negotiation should remain the default and the switch an opt-out.
- **Per-category toggle now.** Deferred to v2 — more flexible, and per-category rates already exist to support it, but the client specified one switch and v1 favors the simpler UI.
- **"Soft" off: Parent may still propose any rate; Caregiver only gets Accept/Decline (no rate lock).** Rejected — invites lowballing and decline churn; locking the rate is more honest and less wasteful.
- **Hide Counter only on the Caregiver's side (Parent can still counter).** Rejected — asymmetric and confusing; if the Caregiver won't negotiate, a Parent counter is a dead end.

## Consequences

- **`CONTEXT.md` updated (2026-06-17):** § Offer — Negotiation toggle paragraph; "either party can send" now annotated as countering-gated.
- **Schema deltas (PRD / `app/lib/types.ts`):** the Caregiver `Provider` record gains `negotiable: boolean` (default `true`). The Offer state machine guards the `countered` transition on the counterparty Caregiver's `negotiable`. The Direct-Message composer locks `proposed_rate` to the published per-category Rate when `negotiable = false`.
- **PRD-0001 stories to revise:** 103 + 104 + 105 (negotiable pricing / Accept-Counter-Decline — now conditional on the Caregiver's setting), 89 (Parent reviewing an Application — Counter conditional), 46 (Caregiver Rate setup — add the `negotiable` switch). **New story:** as a Caregiver I toggle negotiation on/off so Parents either can or cannot counter my price.
- **DESIGN.md:** a `negotiable` switch on the Caregiver rate/profile step; the Offer bubble and the Application-review surface hide the **Counter** pill when the Caregiver is non-negotiable; the Direct-Message composer renders the rate as locked (read-only at published) in that case.
- **Out of scope / deferred:** per-category negotiation control (v2); any change to Provider fixed-price slot-pick.
