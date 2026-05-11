# Our Haven — Domain Context

A two-sided marketplace mobile app connecting parents with vetted childcare and child-development professionals.

## Geographic scope (v1)

**Florida statewide compliance, Miami-Dade as the soft-launch market.** Currency is **USD**. Data residency in US regions (GCP `us-east1` / `us-east4`; Firestore `nam5` US multi-region). Subject to a sectoral US compliance patchwork: **Florida Digital Bill of Rights (FDBR)** for consumer-rights and data-protection-assessment requirements, **COPPA** posture for processing of children's information, **HIPAA**-adjacent prudence for special-needs notes (with Specialists treated as the covered entity for clinical notes, not Our Haven), **FIPA** for breach notification, **IRS 20-factor / common-law test** plus Florida-specific factors for Provider classification, and **Florida sales tax** rules (childcare services largely exempt; FL does not currently tax most digital services). Background checks are run as a **Florida Level 2 Background Screening** (FBI + FDLE fingerprint-based check against the AHCA / DCF Care Provider Background Screening Clearinghouse under Fla. Stat. §§ 402.305 / 402.3055 / 435.04), plus National Sex Offender Registry, via **Checkr** (working assumption, confirmed in Phase 0).

State-pluggable compliance: background-check integration and license-board lookup are wrapped behind vendor-agnostic per-state adapters so that a second US state can be added in Phase 2 as a configuration exercise rather than a re-platforming exercise. The Verification workflow deep module is state-agnostic — it consumes verification *results*, not vendor APIs. See **ADR-0003** for the full jurisdictional decision.

> ⚠ **Pending client confirmation.** Miami / Florida is the working assumption per the JD↔Ci'erro discussion on 2026-05-11 (pivoted from the prior UK working assumption of 2026-05-08). If the launch state changes, the per-state adapter set re-points; the federal compliance design (HIPAA, COPPA, 1099-K, FDBR-style PIA) is reused with minor adjustments.

## Glossary

### Provider
The supply side of the marketplace. An adult who offers services to families through the platform. *Provider* is the umbrella domain term used in code, admin tools, contracts, and internal docs. The word "caregiver" appears in parent-facing marketing copy but is **not** a domain term — never use it in code, schemas, or admin UI.

Every Provider belongs to exactly one of four **categories**:

- **Babysitter** — short-engagement childcare, typically by-the-hour, no live-in expectation.
- **Tutor** — academic instruction. Subject-matter focus rather than caregiving.
- **Nanny** — long-engagement childcare, recurring or live-in arrangements.
- **Specialist** — licensed or credentialed clinical/professional services (speech therapy, ABA, occupational therapy, and similar). Distinct from caregiving in liability profile and verification depth — Specialists require license verification that the other three categories do not.

Phase 1 ships all four categories.

### Parent
The demand side. An adult account holder who books Providers for one or more children. A single Parent account can hold multiple **Child profiles**.

### Child profile
A record under a Parent account representing one child, with age, special-needs flags, and notes. Bookings are made *by* a Parent *for* one or more Child profiles. A Child is not an account holder and never authenticates.

### Verification
The set of checks a Provider must clear before they can be activated and listed in search.

**All categories** require: email verification, phone verification, government ID upload, and a **Florida Level 2 Background Screening** — fingerprint-based FBI + FDLE check run against the **AHCA / DCF Care Provider Background Screening Clearinghouse** (the legal standard for FL child-care personnel under Fla. Stat. §§ 402.305 / 402.3055 / 435.04 — a name-only or Level 1 check is insufficient), plus a **National Sex Offender Registry** check. Run via **Checkr** (working assumption confirmed 2026-05-11; final vendor reconfirmed by JD in Phase 0). Per-check cost ~$50–80 (Checkr Level 2 + fingerprinting + NSOR) + small platform markup, paid by the Provider at sign-up. The integration sits behind a vendor-agnostic background-check interface so a second-state regime can be swapped in without touching the Verification workflow's state machine.

**Specialists** additionally require: professional license number, issuing **Florida** board, license document upload, and proof of liability insurance — verified manually by admin against the relevant Florida public register via the **FL Department of Health (DOH) MQA license verification portal** (or **DBPR** where applicable). Boards by sub-category: **FL Board of Speech-Language Pathology and Audiology** for SLPs; **FL Board of Occupational Therapy Practice** for OTs; **FL Board of Psychology** for psychologists; **FL Board of Behavior Analysis** for BCBAs (ABA has been statutorily licensed in Florida since 2022 — license-number lookup is authoritative); **FL Board of Medicine / Board of Osteopathic Medicine** for MD/DO; **FL Board of Nursing** for RN/LPN. No third-party verification vendor in v1; license verification is absorbed by the platform. License-board lookup is wrapped in a per-state adapter (Florida first; second-state adapter is a Phase 2 add).

> ⚠ Verification details (FL Level 2 specifically) are contingent on Florida as the launch state. If launch state changes, the per-state adapter re-points to the new jurisdiction's equivalent screening regime and license registers.

### CDCTC-eligibility & FL childcare licensure (Babysitter / Nanny only)
The US has no direct analogue to Ofsted's Voluntary Childcare Register. Instead, Parents claiming the **Child and Dependent Care Tax Credit (CDCTC)** on **IRS Form 2441**, or using a **Dependent Care Flexible Spending Account (FSA)**, must collect the Provider's TIN/SSN via **IRS Form W-10** (Dependent Care Provider's Identification and Certification). Surfaced as a **"Tax-credit-friendly" badge** on Babysitter and Nanny profiles: a Provider who self-attests they will issue Form W-10 on request gets the badge; Parents can filter by it. **Self-attestation only in v1** — no document upload, no admin verification. The badge is a search-discoverability aid, not a tax-validity guarantee.

Separately, the small minority of Providers who operate as a **Family Child Care Home (FCCH)** under Florida DCF child-care licensing may upload their FCCH registration certificate as an optional credential (admin verifies → "DCF-registered Family Child Care Home" badge). Most v1 Providers are in-home Nannies/Babysitters and are exempt from FL DCF licensing; FCCH operators are surfaced for the families who specifically want them. Activation is **not** gated on either badge.

### Search & filters (v1)
Single unified search surface across all Provider categories. **v1 filters:** Category, ZIP code + radius (default 5 miles), date/time (intersected with Provider Availability), hourly Rate ceiling, minimum star Rating, Tax-credit-friendly toggle (Babysitter/Nanny only — Form W-10 self-attested), and a per-category specialty field (free-text + small canned set; primarily relevant for Tutor and Specialist). **Specialist-specific filters** unlock when Category = Specialist (license type, in-person vs telehealth, age range served).

**Ranking** is hybrid: `0.5 × distance_proximity + 0.3 × rating + 0.2 × recency_active_in_last_7_days`. Editorial / featured slots and admin-driven boosting are deferred to post-launch.

**Provider gender** as a filter is **deferred** to post-launch — gender is a protected class under federal Title VII and the Florida Civil Rights Act, and exposing it as a primary filter on every profile carries a higher product/legal call than is appropriate for v1. The platform may still surface gender on the Provider's own profile if they choose to disclose, without offering it as a search facet.

### Notifications
Multi-channel transactional notification system — push (Parent mobile via Firebase Cloud Messaging), web push (Provider portal, best-effort), email (both, via SendGrid), SMS (both, via Twilio).

**SMS is reserved for urgent events only**:
- **Booking request received → Provider** (the single most critical notification in the system; if it doesn't reach the Provider quickly, the marketplace stalls). **Mandatory** in v1; no Provider opt-out.
- **Cancellation inside the 24h window → both sides.**
- **Session start reminder → Provider** (1h before).

In-app notification inbox is **deferred** to post-launch. Marketing messages require a separate opt-in distinct from transactional notifications, surfaced from sign-up.

### Authentication
**Identity provider:** Firebase Auth, US-region identity pool (co-located with the rest of the GCP US-region stack).

**Parent (mobile):** Sign in with Apple + Sign in with Google + email/password. Apple is required by App Store rules whenever a third-party social login is offered. Phone is verified once at sign-up; not used as primary auth.

**Provider (web portal):** Email/password + Sign in with Google. Apple sign-in is not offered on web (no policy mandate).

**MFA posture:**
- **Parent:** device-trust model — SMS OTP only triggered on new-device sign-in or suspicious-sign-in heuristics. Not required on every login.
- **Provider:** SMS OTP on new-device sign-in plus **step-up MFA** for payout-sensitive actions (changing bank details, initiating withdrawals).
- **Admin (Trust & Safety, etc.):** TOTP MFA mandatory on every sign-in.

### Sensitive-data consent (special-needs flags)
Special-needs flags and notes on Child profiles are **sensitive information about a child**. No single US statute imposes a UK-GDPR-Article-9-style "explicit consent" requirement on this data, but **COPPA**-aware best practice, **HIPAA**-adjacent prudence (since these notes can shade into health information), and emerging state laws (including **FDBR**'s sensitive-data provisions) all point to the same UX pattern: a **discrete, explicit Parent-consent step** at sign-up with a timestamp, re-prompt on material privacy policy changes, and full erasure on Parent account deletion or consent withdrawal. This is non-optional — without consent, special-needs flags cannot be stored. The platform deliberately avoids becoming a **HIPAA Business Associate** by *not* requiring Specialists to upload clinical notes through the platform; clinical notes stay in the Specialist's own EHR, and the platform handles only what the Parent chooses to disclose.

### Privacy counsel
External **US privacy counsel** (boutique privacy firm or larger firm's privacy practice — selected in Phase 0). Required before launch given Our Haven processes children's information, runs systematic message monitoring, and operates across a sectoral US patchwork (COPPA, HIPAA-adjacency, FDBR, FIPA, evolving state laws). Engaged in Phase 0 / 1. Replaces the UK fractional-DPO model.

### Privacy Impact Assessment (PIA)
A mandatory pre-launch document — analogous in posture to the UK DPIA, and required as a **"data protection assessment"** under FDBR if Our Haven crosses applicability thresholds. Drafted in collaboration with US privacy counsel, reviewed by Ci'erro's lawyers, signed off before Phase 4 launch. Covers the trigger combination here: sensitive information about children + large-scale message monitoring + sectoral overlap with HIPAA and COPPA.

### Data residency
All personal data is processed in **US regions**. Vendor settings (Firebase Auth → US identity pool; Daily.co → US rooms; cloud hosting → GCP `us-east1` or `us-east4`; Firestore → `nam5` US multi-region; Cloud Storage → US bucket; Cloud Tasks / Cloud Scheduler → US; Checkr → US by default) are configured at project setup, not after launch. A vendor data-flow inventory is maintained as a Privacy Policy appendix.

### Retention policy
- **Account data:** 30-day soft-delete grace period after deletion request, then hard-delete.
- **Booking + payment records:** retained **7 years** in pseudonymized form (deleted user → "Deleted user {id}") regardless of account deletion — aligned with IRS recordkeeping recommendations for taxpayer records (7-year retention covers the basic 3-year limit and the 6-year "substantial understatement" window with margin) and Florida statute-of-limitations exposure for civil disputes.
- **Message content:** **3 years** post last activity, then hard-delete unless flagged in an active investigation.
- **Background-check raw details:** **6 months** maximum (vendor-recommended; aligned with FCRA disposal-rule best practice for non-needed consumer report information), then hard-delete. The cleared/not status remains on the Provider account.
- **Sensitive data (special-needs flags + notes):** deleted on account deletion **or** on explicit consent withdrawal.

> ⚠ Privacy counsel, PIA, data residency, and retention policy are framed for **US-Florida** compliance. If launch location changes, this section is re-scoped per the new jurisdiction's regime; the federal-level retention rationale (IRS, FCRA) is reused.

### Booking
A scheduled engagement between a Parent and a Provider for one or more Child profiles. In Phase 1 a Booking is either **hourly** (Babysitter, Tutor, Nanny) or **per-session** at a fixed price (Specialist). A Provider sets their own rate, which is what is displayed to the Parent. Live-in / salaried **Nanny contract** arrangements are deferred past Phase 1 — in v1, a Nanny engagement is modeled as a long-running hourly Booking (potentially recurring), not as a separate contract concept.

### Availability
A schedule published by a Provider showing when they are open to receive Booking requests. Parents browse a Provider's Availability and select a slot from it; selecting a slot creates a Booking request, not a confirmed Booking — the Provider must still accept it. A slot existing on the calendar does not guarantee availability; it narrows the Parent's choices.

A slot is **blocked on request**: as soon as a Parent submits a request for a slot, that slot is removed from the calendar for all other Parents. If the Provider declines or the request expires (24h), the slot is automatically released back onto the calendar.

### Booking states
A Booking moves through: **requested** (Parent selected a slot, awaiting Provider) → **accepted** | **declined** | **expired** (24h auto-decline) → **in-progress** (hourly Bookings only, after session start) → **awaiting-confirmation** (hourly only, Provider proposed final hours, Parent has 24h to dispute) → **completed** | **disputed** | **cancelled**. Per-session Specialist Bookings skip in-progress / awaiting-confirmation and move directly from accepted to completed.

### Session
The actual hours worked during an hourly Booking (Babysitter, Tutor, Nanny). Distinct from the Booking itself: a Booking has a planned duration; a Session has an actual duration. The Provider proposes the Session's final hours at the end; the Parent has 24h to dispute, otherwise it auto-confirms and payment captures. Specialist Bookings have no Session — they're billed on the per-session Rate at booking time.

### Rate
The price a Provider charges, set by the Provider. Hourly Providers (Babysitter, Tutor, Nanny) publish an hourly Rate. Specialists publish a per-session Rate. Our Haven does not set or cap Rates in Phase 1.

**Babysitter** and **Nanny** Rates may include an optional **per-child surcharge** — a flat hourly uplift added for each Child beyond the first on a Booking. **Tutor** and **Specialist** Bookings are **single-child only** (enforced at Booking creation); a Parent who wants two children seen creates two separate Bookings.

### Child profile visibility on Booking requests
At Booking request time, the Provider sees each attached Child's **age** and a marker indicating whether special-needs notes exist — but not the notes themselves. Full Child profile notes unlock for the Provider once the Booking is accepted. **Exception:** Specialists see full Child profile notes pre-accept, because clinical fit must be assessed before acceptance; this is consistent with Specialist Bookings being single-child.

### Message
A communication between a Parent and a Provider inside the app. Messages are encrypted in transit and at rest, but are accessible to Our Haven's Trust & Safety role for fraud and safety review (disclosed in the Privacy Policy). Every message passes through **disintermediation detection** — regex-based scanning for phone numbers, email addresses, social handles, payment app names (Venmo, Zelle, Cashapp, PayPal, etc.), and address-like patterns. Detected substrings are **redacted** before delivery; the unredacted original is queued for Trust & Safety review. Detection runs on every message, not only the first.

### Trust & Safety
A specific admin role (not all admins) authorized to access Message content. Access is split into two modes: a **flagged-thread queue** (messages that tripped disintermediation detection) and **investigation access** (on-demand thread pull when a Parent or Provider files a safety or fraud report). Every thread access is audit-logged with admin ID, thread ID, timestamp, mode, and — for investigation access — a free-text reason.

### Cancellation policy
A single platform-wide rule in v1 (per-Provider policies are deferred). Parent-initiated cancellation: free if ≥24h before start, 50% of estimated charge inside 24h, 100% inside 2h or after start. Cancellation fees flow to the Provider (less Commission). Provider-initiated cancellation is free in v1 but tracked — repeated cancellations surface to admin review and affect search ranking.

### No-show
**Provider no-show**: Parent receives a full refund; the Provider is auto-flagged for admin review. Two flagged no-shows trigger manual review; three trigger suspension pending review. **Parent no-show**: the Provider reports it within 2 hours of scheduled start; the Parent has 24h to contest; if uncontested, the Provider receives 50% of the estimated total. A no-show is distinct from a Cancellation — it occurs at or after the scheduled start time without a Cancellation having been filed.

### Rating
A 1–5 star score plus optional text, submitted by one party about the other after a Booking enters `completed`. Both sides may rate within a **14-day window** post-completion. Ratings are submitted **blind** and revealed mutually — visible only after both sides submit or the window closes (Airbnb-style). Ratings are not editable after reveal; users may appeal a rating via admin review. A rating tied to a Booking under active Dispute is withheld from public display until the dispute resolves.

Display is **asymmetric**:
- **Provider Ratings** (Parent → Provider) are **public** on the Provider's profile — aggregate stars, count, and full text reviews visible to all Parents.
- **Parent Ratings** (Provider → Parent) are visible **only to Providers** evaluating a Booking request from that Parent, and only as **aggregate stars + count** — text reviews are internal (admin context and ranking signal only), not exposed to Providers.

### Dispute
A formal challenge raised inside a 7-day window after a Booking completes (or during the awaiting-confirmation state for hourly Bookings). Filing a Dispute pauses the Provider's Payout, routes the case to the admin queue, and resolution is by admin decision — final, except where overridden by a Stripe chargeback. Disputes are an in-app flow, not an email-the-team workflow.

### Sales tax model (US / Florida)
Our Haven is a **marketplace agent**, not a deemed supplier — Parents pay Providers for Bookings via Stripe; Providers pay Our Haven a Commission for marketplace services. Sales tax exposure breaks down as:

1. **Parent Subscription** — Florida does **not** currently impose sales tax on most digital services or SaaS-style access fees, so the Subscription is treated as non-taxable in FL. Stripe Tax monitors the position state-by-state as US expansion proceeds; states that do tax digital access (e.g., parts of Texas, Pennsylvania, Washington) will be activated per state when supply lights up there.
2. **Commission** — Generally non-taxable in Florida (B2B service to the Provider). Stripe Tax handles per-state taxability as expansion proceeds.
3. **The Booking itself** — In Florida, childcare and personal-services-to-children are generally not subject to sales tax; private tutoring is generally exempt; licensed clinical services (SLP, OT, ABA, psychology) are exempt as professional medical services. Our Haven does **not** collect sales tax on Bookings — Providers are responsible for any sales-tax exposure on their own services where it applies.

Operationally: **Florida Department of Revenue** sales-tax registration is a Phase 0 call (likely not required given the exempt status of in-scope services, but counsel-confirmed before launch). **Stripe Tax** is integrated regardless — it handles nexus tracking, per-state taxability decisions, and per-state filings as US expansion proceeds. **Form 1099-K** issuance to Providers is handled by Stripe Connect automatically; Providers are responsible for their own income-tax filings. Replaces the UK VAT model entirely.

### Commission
The percentage of every Booking that Our Haven retains. Skimmed from the Provider's Rate via Stripe Connect's application fee — the Parent pays exactly the displayed Rate, the Provider receives Rate × (1 - Commission). The exact percentage is a business decision (target 15–20%) and is not yet set.
_Avoid_: Service fee, take rate, platform fee

### Subscription
A recurring payment held by a **Parent** (not a Provider) that unlocks full search, messaging, and booking. Without an active Subscription a Parent sees a gated preview only. Sold via Stripe through a web-hosted checkout (not through iOS/Android in-app purchase). Providers do **not** subscribe.
_Avoid_: Membership, plan, premium

### Payout
Funds transferred from Our Haven to a Provider after a completed booking, routed via **Stripe Connect**. Our Haven retains a platform commission on each booking. A Provider must have a connected Stripe account before they can receive Payouts.
_Avoid_: Disbursement, transfer, settlement

## Flagged ambiguities

- **"Caregiver" vs "Provider" in the project plan (resolved 2026-05-08).** `docs/project-plan.md` uses "caregiver" as the umbrella noun and lists "providers" as a peer category alongside babysitter/tutor/nanny. This conflicts with this glossary. Resolution: `CONTEXT.md` is canonical — **Provider** is the umbrella, **Specialist** is the 4th category. The plan will be rewritten to match ("caregiver web portal" → "provider web portal", "providers" category → "specialist").
- **Launch jurisdiction pivot (resolved 2026-05-11).** The 2026-05-08 discovery landed on the United Kingdom as the launch base; on 2026-05-11 Ci'erro pivoted to **Miami, Florida** with Florida statewide compliance and Phase-2 US-expansion intent. All UK-specific vendor and compliance language in this glossary (DBS, HCPC/GMC/NMC, Ofsted VCR, UK GDPR / DPA 2018, PSD2-FCA SCA, UK VAT, fractional DPO) has been rewritten in place to the Florida / US equivalents. See **ADR-0003** for the full jurisdictional rationale.
