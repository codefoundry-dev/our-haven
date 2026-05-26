# Background screening: Checkr standard package, not statutory Florida Level 2

**Status:** accepted (2026-05-19, partially supersedes the background-check sub-decision in ADR-0003)

## Context

ADR-0003 (Miami / Florida launch jurisdiction) committed v1 to **Florida Level 2 Background Screening** for every Provider — fingerprint-based FBI + FDLE check filed against the AHCA / DCF Care Provider Background Screening Clearinghouse under Fla. Stat. §§ 402.305 / 402.3055 / 435.04 — at ~$50–80 per check, run via Checkr.

The 2026-05-19 client sync surfaced two facts that re-frame this:

1. **The statutory regime does not actually apply to our supply.** Fla. Stat. §§ 402.305 etc. govern personnel of **licensed child-care facilities** — employees of facilities operating under DCF licensure. The bulk of Our Haven's Caregivers will be independent in-home Providers operating informally; the statute is silent on them. The earlier choice to adopt statutory Level 2 was a voluntary trust-signal call, not a legal requirement.
2. **The client's stated pricing model is incompatible with statutory Level 2.** Ci'erro quoted **~$29.99 per check** and a **$35 charge to the Provider** as the working assumption. That price is Checkr's *standard* package (county criminal + national criminal database + national sex offender registry + SSN trace), not the statutory regime. The product names collide — Checkr also markets a tier called "Level 2" — but the two things are not the same.

There is also a marketing-honesty constraint: advertising "Florida Level 2" while running Checkr standard is a misrepresentation under **FDUTPA** (Florida Deceptive and Unfair Trade Practices Act) and an obvious complaint surface for the Florida AG's office.

## Decision

**v1 uses Checkr's standard package — county criminal (7-year) + national criminal database + national sex offender registry + SSN trace — for every Provider, regardless of `kind`.** Per-check cost ~$30; charged at **$35** to the Provider at sign-up (small platform margin).

Marketing copy describes the screening as **"marketplace-grade Checkr screening (criminal, sex offender, SSN)"**. The phrase **"Florida Level 2"** does not appear in any user-facing copy. Internally the field is `background_check` with `vendor=checkr`, `package=standard`.

**Asymmetric upgrade path documented but not built in v1.** Specialists who already hold a current statutory FL Level 2 clearance from their professional licensure (most BCBAs, OTs, SLPs operating in licensed contexts will) may upload the clearance card as an optional credential — a "honour a recent clearance" path — without the platform running the screening itself. This is a Phase 2 polish; v1 keeps a single screening pipeline.

The background-check vendor adapter stays vendor-agnostic, so an upgrade to statutory Level 2 (or a different vendor in a different state) is a configuration change, not a re-platforming.

JD has an open action with Checkr to ask about startup-discount pricing. If the per-check cost lands below $29.99, the **$35 Provider charge does not change** in v1 — the margin grows, the published price stays stable.

## Why

- **The stated cost target ($35) only works at standard tier.** Statutory Level 2 would put Provider acquisition cost at $80–100. The project plan's "marketplace must look populated at launch" goal (`docs/updated-plan.md`) makes supply barrier matter more than screening depth for v1.
- **The statutory regime doesn't apply.** Operating under it would be a marketing claim, not a legal posture. Better to honestly describe what we do.
- **Marketplace-grade Checkr is what every direct competitor uses.** Care.com, Sittercity, UrbanSitter all run roughly this same package. The trust differentiator for Our Haven is the verification stack as a *whole* — email + phone + ID + screening + Specialist license verification + two-way Ratings + message scanning + video interview — not deeper screening on any single axis.
- **FDUTPA exposure is real.** Florida's deceptive-trade-practices statute treats false claims about safety/compliance status as actionable. "Florida Level 2 screened" is a specific claim with a specific meaning; using it for a different product is a category of risk the platform doesn't need to take on.

## Considered alternatives

- **Keep statutory Florida Level 2 for everyone.** Rejected — incompatible with the $35 price point and the supply-acquisition urgency.
- **Asymmetric: statutory Level 2 for Specialists, standard Checkr for Caregivers.** Considered. Rejected for v1 on build cost (two screening pipelines, two cost lines, two marketing claims). Documented as a Phase 2 candidate via the "honour a recent statutory clearance card" pattern, which costs ~nothing to build because it's just a credential upload.
- **No screening at all in v1.** Rejected — the trust-triangle premise of the product collapses without screening, and every direct competitor runs at least standard Checkr.

## Consequences

- **`CONTEXT.md` § Verification and the geographic-scope blurb** lose the "Florida Level 2 / AHCA / DCF clearinghouse / Fla. Stat." language; replaced with "Checkr standard package".
- **ADR-0003's background-check sub-bullet** is partially superseded by this ADR. The rest of ADR-0003 (Florida jurisdiction, DOH/DBPR Specialist verification, FDBR / COPPA / HIPAA framing, USD, Stripe Connect US) is unaffected.
- **PRD-0001's verification stories** need cost and statutory references rewritten; the verification state machine is unchanged.
- **Marketing copy** must avoid the phrase "Florida Level 2" unless and until the platform upgrades to it.
- **Provider sign-up cost line** is now a fixed $35, not a $50–80 range. The verification step in the Provider onboarding flow can quote this number with confidence.
