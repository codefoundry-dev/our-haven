# Three top-level roles (Parent / Caregiver / Provider); Caregiver payment-rail vs Provider SaaS-listing

**Status:** accepted (2026-05-30, client sync). Supersedes the **Provider-as-umbrella** taxonomy resolutions in `CONTEXT.md` flagged-ambiguities (2026-05-08 and 2026-05-19). Partially reverses the **slot-pick full-deprecation** (2026-05-19), scoped to the Provider role. Narrows **ADR-0006** ("every Booking traces back to a Job") to Caregiver bookings only. Supersedes the **§ Subscription** rule "a Subscription is held by a Parent (not a Provider); Providers do not subscribe."

## Context

Through 2026-05-08 → 2026-05-19, the domain settled on **Provider** as the umbrella supply-side account role, with a `kind` discriminator selecting **Caregiver** (babysitter / tutor / nanny) or **Specialist** (clinical). The taxonomy is embedded in `packages/shared/src/provider-taxonomy.ts` and consumed across ~15 deep modules plus the generated OpenAPI schema.

The 2026-05-28 client sync used a different vocabulary that does not fit the umbrella model. In the client's product language there are **three flat personas — Parent, Caregiver, Provider** — where:

- **Caregiver** = babysitter / tutor / nanny. Found via search or by posting a Job. Hourly. The platform is the **payment rail**: card on file, Commission skim, Stripe Connect payout (same-day — separate grilling).
- **Provider** = the clinical / professional tier (speech, ABA, OT, psychology, etc. — formerly "Specialist"). Discovered by browsing a profile and **booking an open consultation slot**. The explicit design intent is to **keep medical discussion — and payment — off-platform** for HIPAA reasons. Monetized as a **listing/SaaS subscription**, not a per-transaction commission. Splits into **individual / small-business** (self-serve subscription) and **large corporation** (sales-led custom contract).

"Provider" is therefore no longer the umbrella term — it is a peer of Caregiver. There is **no single umbrella term**; surfaces that show both personas name them explicitly ("Caregivers & Providers").

The decisive insight: **Caregiver and Provider are two different businesses.** Caregiver is a transactional marketplace (the platform moves money and earns a commission). Provider is a listings-and-scheduling SaaS (the platform earns a subscription; the clinical service and its payment happen off-platform). Forcing them under one account role and one transaction model couples two things that diverge on discovery, booking, money, and compliance.

## Decision

**Flatten the supply side to three top-level roles: `role ∈ {parent, caregiver, provider}`.** The `kind` discriminator is absorbed into `role`. `caregiver` carries `category ∈ {babysitter, tutor, nanny}`; `provider` carries `specialty ∈ {slp, ot, aba, psychology, …}`. Fork **discovery, booking-creation, and monetization** by role; **share** the downstream Booking object, Rating, Messaging, Disintermediation, and the (per-role-parameterized) Verification workflow.

### Caregiver — transactional payment rail (unchanged from current model)
- Discovery: unified search → **message-first**, or Parent **posts a Job** → Caregivers apply.
- Booking creation: **Job → Application → Offer → Booking** chain (both entry paths), hourly, **negotiable** via Offers.
- Money: Parent pays on-platform; **Commission** skimmed via Stripe Connect `application_fee`; Caregiver receives a **payout** (same-day target — see grilling). Cancellation fees, no-show protection, and Dispute payout-holds all apply.

### Provider — listings + scheduling SaaS (new)
- Discovery: browse the Provider profile.
- Booking creation: **slot-pick** — the Provider publishes **consultation slots**; the Parent books an open slot **directly from the profile**. Per-session, **fixed price, no Offer, no Job, no negotiation**. A booked slot is a **schedule entry**, not a payment.
- Money: **payment happens off-platform** (HIPAA — the platform does not process clinical-service payments). **No Stripe Connect KYC, no Commission, no payout, no payment-coupled Dispute** on the clinical side. The Provider's published per-session Rate is **display-only**.
- Monetization of the Provider: a flat **Provider Subscription** (individual / small business, self-serve via Stripe billing as a customer) **OR** a **custom contract** (large corporation). v1 ships only a **"Contact Us" intake** for the corporate path — no self-serve organization onboarding, no multi-seat org model; contract terms are a sales/legal matter handled manually.

### Parent — unchanged
- **Parent Subscription** still gates marketplace access (search beyond preview, messaging, booking, Job posting). Applies to booking a Provider consultation too (it is the only platform revenue on the parent↔provider clinical interaction, since the consultation itself is off-platform).

## Why

- **The two supply sides are genuinely different businesses.** A payment-rail marketplace and a listings SaaS have different objects, different money flows, and different compliance surfaces. The flatten lets each be modeled honestly instead of bending one into the other's shape.
- **It matches the client's mental model and product vocabulary**, which removes a standing translation cost in every future client conversation (the umbrella "Provider" collided head-on with the client's "Provider = clinical tier").
- **Off-platform clinical payment is the right HIPAA posture.** Not processing clinical-service payments — and not storing clinical transaction detail — keeps the platform well clear of becoming a payment intermediary for medical services, consistent with the existing "Specialist is the covered entity; clinical notes stay off-platform" stance.
- **It removes the heaviest onboarding step from the clinical tier.** Stripe Connect Express KYC is the single most friction-laden Provider onboarding step; the clinical tier no longer needs it (Providers pay *us* a subscription; they don't receive payouts *from* us).
- **The downstream Booking machine already supports per-session.** "Specialist Bookings skip in-progress / awaiting-confirmation and move accepted→completed" was already in the state machine, so consultations reuse the Booking lifecycle + Rating with a null payment, rather than needing a parallel object.

## Considered alternatives

- **Keep Provider as the umbrella; UI says "Specialist."** Cheapest (display-only, zero churn), but rejected by the client — they want the word "Provider" surfaced for the clinical tier and "Caregiver"/"Provider" treated as siblings.
- **Display-only remap (keep wire values, separate the two in UI).** Satisfies the user-facing vocabulary with no migration. Rejected in favor of the structural flatten because the two sides diverge on far more than naming (booking path, money, KYC, compliance) — a vocabulary-only change would leave the divergent flows tangled under one role.
- **Provider = subscription + on-platform commission (Stripe Connect retained).** Double monetization, maximum revenue capture, but keeps clinical-service payments (and their dispute/refund/payout machinery) on-platform — more HIPAA/payment exposure for no clear v1 benefit. Rejected.
- **Provider = commission-only, no subscription (today's Specialist model + a corporate tier).** Smallest change, but ignores the client's explicit "subscription model" direction and keeps clinical payments on-platform. Rejected.
- **A fully separate Consultation object** (its own lifecycle/pricing/cancellation/dispute). Maximum separation, but duplicates the downstream machinery the shared Booking already provides for the per-session case. Rejected — fork the *creation* path, share the Booking.

## Consequences

**Module boundary (the shared-vs-forked cut):**

- **Caregiver-only:** Job lifecycle, Application lifecycle, Offer, Application-quota tracker (the four ADR-0006 deep modules); Pricing & commission calculator; Cancellation-policy calculator (refund math); Dispute payout-hold; Stripe Connect integration.
- **Provider-only:** consultation-slot calendar (**slot-pick resurrected, scoped to this role**); Provider Subscription billing; corporate "Contact Us" intake.
- **Shared:** Booking object + lifecycle state machine (per-session path, null payment for consultations); Rating reveal; Messaging + Supabase Realtime; Disintermediation detector + Trust & Safety; Search ranking (but discovery UX splits — search-then-message for Caregivers, browse-then-book for Providers); Verification workflow (per-**role** requirements, not per-`kind`).

**Docs to rewrite (consistency pass, this branch):**

- `CONTEXT.md`: § Provider, § Parent intro, § Verification, § Search & filters, § Availability (forks: Caregiver 7×3 grid vs Provider consultation slots), § Booking, § Job / § Application / § Offer (mark Caregiver-only), § Rate (Provider Rate display-only), § Commission (Caregiver-only), § Subscription (now two products — Parent Subscription + Provider Subscription; the corporate contract tier), § Payout (Caregiver-only on-platform), § Dispute (payment-coupled disputes are Caregiver-only). The two 2026-05-30 flagged-ambiguity notes already capture the headline; this ADR is their resolution.
- `packages/shared/src/provider-taxonomy.ts` and the OpenAPI schema: `role` enum gains `caregiver` + `provider`; `kind` is removed; `category` / `specialty` hang off the respective roles. Data migration for any existing `role=provider, kind=*` rows.
- PRD-0001: the Provider-side user stories (40–62, 78–83), the Subscription stories (5, 7, 85, 115), and the monetization framing in Solution / Architectural decisions need a v1.4 revision.
- DESIGN.md: role-pick (§5.1.1a) tabs unchanged in count but reworded; **Provider onboarding (§5.1.13) drops Stripe Connect KYC + adds Provider Subscription checkout**; a **consultation-slot booking surface** returns for Providers; § Availability forks; the Provider Account/Payouts surfaces (§5.11.2.4) are Caregiver-only.

**Open / pending (later grilling):**

- **Same-day Caregiver payout** mechanics vs the **Dispute auto-release window** (cashflow risk) — being grilled.
- **Caregiver certification** (CPR / degrees) verification + what the "Verified" badge means — being grilled.
- **Parent profile vs Child profile** restructure (Bio / Preferences / Safety Behaviors) — being grilled; independent of this ADR.
- Corporate contract commercial terms are out of scope for v1 engineering beyond the Contact-Us intake.

**Future readers:** if you find slot-pick code scoped to `role=provider`, a null-payment Booking, or a Provider that has no Stripe Connect account, land here first — the clinical tier is a listings/scheduling SaaS by design, not an under-built version of the Caregiver flow.
