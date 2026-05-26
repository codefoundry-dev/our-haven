# US-national launch from day one; per-state compliance adapters are core v1, not Phase 2

**Status:** accepted (2026-05-26, supersedes ADR-0003). **Background-check sub-decision unchanged** (Checkr standard package, multi-state — see ADR-0007).

## Context

ADR-0003 landed v1 on **Miami / Florida statewide** as the launch jurisdiction, with state-pluggable compliance modules sized so a second US state could be added in Phase 2 as a configuration exercise. The 2026-05-26 client direction is to drop the Florida-eccentric framing and treat **the United States as a whole** as the v1 market — no soft-launch metro, no single-state geofence, no Florida-first vendor adapter slate.

The vendor and platform choices that ADR-0003 made are mostly orthogonal to single-state vs. national:

- **Checkr standard-package screening** (ADR-0007) is multi-state out of the box. Vendor unchanged.
- **Stripe Connect Express, US entity** + **Stripe Tax** is the right marketplace billing rail regardless of whether v1 lights up one state or fifty.
- **GCP US-region hosting** + **Firebase Auth US identity pool** + **Daily.co US rooms** are US-wide, not Florida-pinned.
- **Federal compliance floor** (COPPA, HIPAA-adjacent prudence for Specialist notes, FCRA disposal rules, IRS 20-factor classification, Title VII, CAN-SPAM, TCPA, IRS Form W-10 / Form 2441) is reusable across all 50 states.

What ADR-0003 made Florida-eccentric — and what this ADR un-eccentrifies:

- **Specialist license verification** was scoped to Florida's DOH MQA / DBPR boards (FL Board of SLP & Audiology, OT Practice, Psychology, Behavior Analysis, Medicine, Osteopathic Medicine, Nursing). National launch means **the per-state license adapter set is a v1 deliverable, not a Phase 2 add**, populated at launch with the priority states for Specialist supply and extended state-by-state as Specialists onboard from other states.
- **State-privacy framing** was anchored on **FDBR + FIPA**. National launch means the privacy posture rests on the **federal floor** plus a **state-privacy patchwork module** that adapts to whichever state the user resides in (notably **CCPA/CPRA** for California, **VCDPA** for Virginia, **CPA** for Colorado, **CTDPA** for Connecticut, **UCPA** for Utah, **FDBR** for Florida, etc., with new states adding as their laws take effect). US privacy counsel scope broadens accordingly.
- **Provider classification** was anchored on **IRS common-law test + Florida-specific factors**. National launch means the Provider Terms carry the federal IRS test as the baseline and a **per-state addendum pattern** for states with materially different classification regimes (notably **California AB5 / ABC test**, **Massachusetts ABC test**, **New Jersey ABC test**, etc.). 1099-K issuance via Stripe Connect is unchanged.
- **Sales tax** was anchored on Florida's largely-exempt service mix. National launch means **Stripe Tax handles per-state nexus and per-state taxability** computation on Subscription, Commission, and (where applicable) the Booking itself, light up state-by-state as supply emerges in each state.
- **Soft-launch concentration on Miami-Dade** is **dropped**. Marketing and supply-seeding are national from day one; the Phase 0 question "which metro do we concentrate on" is dropped from the discovery checklist.
- **Provider sign-up geofence to Florida** is **dropped**. Sign-up accepts any US state address; the Provider's `state` field drives per-state adapter routing.

## Decision

**v1 launches as a US-national marketplace from day one.** No soft-launch metro. No single-state engineering. Per-state compliance adapters (background-check, license verification, sales-tax, classification language) are **core v1 deliverables**, not Phase 2.

- **Background-check vendor:** Checkr standard-package (county criminal 7-year + national criminal database + national sex offender registry + SSN trace; ~$30 per check, charged at $35 to the Provider). Multi-state coverage out of the box. **Unchanged from ADR-0007.** The vendor-agnostic interface that ADR-0003 introduced "for Phase 2" is now exercised at launch — v1 uses Checkr behind that interface so a second background-check vendor (Sterling, GoodHire, statutory state-level uploads, etc.) can slot in by configuration.
- **Specialist license verification:** **per-state adapter set populated at launch** for the priority Specialist-supply states. Each adapter knows (a) the state's professional licensing boards by specialty, (b) the URL or API of the public license register, and (c) whether the register is API-callable or human-portal-only. v1 ships an admin manual verification flow that consumes the adapter's lookup output; no third-party verification vendor in v1. States outside the adapter slate accept Specialist sign-ups but route them to a **"verification pending — your state is not yet supported, you will be notified"** holding state.
- **State-privacy patchwork module:** a thin module that maps a user's state to the applicable privacy regime (sensitive-data rules, consumer-rights surfaces, data-protection-assessment thresholds, breach-notification statute). The Privacy Policy carries state-specific addenda surfaced based on the user's state. **External US privacy counsel** is engaged with national scope (was Florida-specific in ADR-0003). The **Privacy Impact Assessment** covers the multi-state patchwork (was Florida-DPIA-aligned).
- **Provider classification:** federal IRS common-law / 20-factor test as the baseline; the Provider Terms carry a **per-state classification addendum pattern**. States with materially different classification regimes (AB5 / ABC test states) are flagged for the Provider at sign-up and the Provider's Terms acceptance is state-scoped.
- **Sales tax:** Stripe Tax handles per-state nexus and per-state taxability on Subscription and Commission. Bookings are **not** taxed by Our Haven (Providers are responsible for any sales-tax exposure on their own services). State sales-tax registrations are pursued **as nexus is established**, not preemptively at launch.
- **Geographic scope at launch:** **the United States.** Provider sign-up accepts any US state address; the Provider's state drives per-state adapter routing. Out-of-US sign-ups are rejected with a "we're not yet available outside the US" message.
- **Data residency:** US regions (GCP `us-east1` default, `us-east4` fallback; Firestore `nam5` US multi-region; Firebase Auth US identity pool; Daily.co US rooms; Cloud Storage US bucket; Cloud Tasks / Cloud Scheduler US). **Unchanged from ADR-0003.**
- **Payments:** Stripe Connect Express US entity. **Unchanged from ADR-0003.** 3DS opportunistic, not mandatory (no PSD2/SCA equivalent in the US). Form 1099-K issuance via Stripe Connect.

International expansion (UK, EU, Canada, etc.) remains out of scope for v1 and is a full re-platforming if pursued later, not a Phase 2 add.

## Why

- **Multi-state engineering at v1 is cheaper than Florida-then-multi-state.** ADR-0003 already committed to vendor-agnostic interfaces for background-check and license-board lookup so that Phase 2 expansion would be a configuration exercise. Exercising those interfaces at launch (rather than letting them rot as un-tested abstractions) is the lowest-risk way to honor that design.
- **The platform's structural compliance work is federal, not state-eccentric.** COPPA, HIPAA-adjacent prudence, FCRA disposal, IRS classification, Title VII, CAN-SPAM, TCPA, Form W-10, Form 1099-K — none of these are Florida-specific. Anchoring the privacy posture and the worker-classification posture on the federal floor makes the platform's compliance design portable across all 50 states with state-specific addenda where they actually matter.
- **Stripe Tax + Stripe Connect already do the multi-state heavy lifting for payments.** Per-state sales-tax nexus tracking, per-state taxability decisions, Form 1099-K issuance — Stripe handles these at the SDK level. The marginal v1 cost of going national on payments is approximately zero.
- **Marketplace supply seeds faster on a national footprint.** A Miami-Dade soft-launch concentrates marketing spend but throttles the supply funnel to one metro; a Provider who lives in Tampa, Atlanta, or Phoenix cannot help seed the marketplace. National marketing means the cold-start problem is amortized across a much larger pool of potential Providers.
- **The state-privacy patchwork is small enough to ship in v1.** As of 2026-05-26, ~20 US states have comprehensive consumer-privacy laws on the books or in force (CA, VA, CO, CT, UT, FL, OR, TX, MT, IA, IN, TN, DE, NJ, NH, KY, MD, MN, RI, plus others phasing in). A thin state-mapping module + per-state Privacy Policy addenda is meaningfully cheaper than re-platforming when expansion forces it.
- **The 1099 / AB5 classification risk is real but bounded.** Providers in AB5-style states (CA, MA, NJ, IL — and watch states like NY) carry a higher misclassification risk than Providers in contractor-friendly states (TX, FL). The per-state addendum pattern + state-flagged Terms acceptance is the same compliance scaffold a Florida-then-California expansion would have required at Phase 2; building it at launch is no more expensive and avoids a re-platforming gate.

## Considered alternatives

- **Stay with Miami/Florida soft-launch per ADR-0003.** Faster vendor-adapter scoping but creates a hard re-platforming gate the moment supply emerges from a second state, and wastes the per-state-adapter abstraction work already committed to. Rejected per client direction.
- **US-national footprint with a single soft-launch metro (any metro).** Operationally identical to ADR-0003 with a different metro pin. Rejected per client direction — the soft-launch concentration is what's being dropped.
- **Multi-state-ready but launch with a slate of 3–5 priority states only.** A middle path. Cheaper than full-national in marketing spend; supply geofence at sign-up. Rejected — the marketing/seeding rationale for going national wins, and the v1 adapter set covers priority states first regardless.
- **Postpone national launch until Phase 2, ship FL-only v1 quickly.** The original ADR-0003 posture. Rejected per client direction.

## Consequences

- **ADR-0003 is superseded.** Florida-specific design choices in `CONTEXT.md`, `docs/prd/0001-our-haven-v1.md`, and `docs/project-plan.md` need to be rewritten or genericized:
  - § Geographic scope, § Verification (Specialist boards), § Sensitive-data consent, § Privacy counsel, § Privacy Impact Assessment, § Sales tax model, § Retention policy footnote, and the "Launch jurisdiction pivot" flagged-ambiguities entry all need updating.
  - PRD Problem Statement, Solution, Architectural decisions, Phase 0 / Phase 4 activities, and Florida-board-eccentric user stories (42, 43, 64, 65) need rewriting.
  - project-plan.md Project Overview, Phase 0 activities, Phase 4 soft-launch concentration, Dependencies on Ci'erro all need rewriting.
- **Phase 0 discovery checklist changes.** The Miami / Florida confirmation, the Miami-Dade vs tri-county vs neighborhood concentration question, and the Florida Department of Revenue sales-tax registration call are **dropped**. Two new Phase 0 items take their place: (a) confirm the priority-state slate for v1 Specialist-supply adapter coverage; (b) confirm whether the v1 marketing posture targets all 50 states uniformly or weights spend toward priority metros.
- **Specialist license adapter work moves from "build a Florida adapter + stub for second state" to "build adapters for the priority state slate."** Adapter contract + admin manual-verification flow are unchanged; only the population of the adapter slate grows.
- **US privacy counsel engagement scope broadens** from Florida-anchored to national. The PIA covers the multi-state privacy patchwork (CCPA + VCDPA + CPA + CTDPA + UCPA + FDBR + others). Counsel selection happens in Phase 0.
- **Provider sign-up surface accepts any US state.** No FL geofence. The `state` field on the Provider record drives per-state adapter routing for license verification and per-state classification-addendum surfacing.
- **Marketing surface broadens.** Phase 4 soft-launch marketing focused on Miami-Dade is replaced with a national marketing plan. Listing copy on App Store / Play Store is national-marketplace-shaped, not metro-marketplace-shaped.
- **Sales-tax registrations are pursued as nexus develops**, not preemptively at launch. Stripe Tax monitors nexus state-by-state and surfaces registration prompts when thresholds are crossed.
- **The Verification workflow deep module stays state-agnostic** — it consumes verification *results*, not vendor APIs. Per-state pluggability lives in the adapter layer, exactly as ADR-0003 designed.
- **Future readers** looking at the codebase and seeing per-state adapter scaffolding should land here first to understand why v1 was multi-state from day one and not Florida-narrow.
