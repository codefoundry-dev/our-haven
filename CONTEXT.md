# Our Haven — Domain Context

A two-sided marketplace app connecting parents with vetted childcare and child-development professionals.

> **Status:** refreshed **2026-06-24** to match **PRD-0001 v1.7** and **ADR-0011 … ADR-0018**. This supersedes the pre-2026-05-30 `kind` / "Specialist" / Child-profile model that earlier revisions of this file described. Headline changes folded in: the supply side is **three flat top-level roles** (`parent` / `caregiver` / `provider`; the `kind` discriminator is gone and "Provider" is now the **clinical tier**, not the supply umbrella — ADR-0011); the **Child entity is removed** in favour of a family-level **Parent profile** (ADR-0012); the Caregiver payout/dispute mechanic is a **single ~24h review window** with same-day payout (ADR-0013); booking is **concrete parent-specified scheduling** with **recurring Booking Series** and **multi-day one-off** bundles (ADR-0014, amended v1.7); Caregivers are **multi-category** with a **per-category Rate** and a **negotiation toggle** (ADR-0015 / ADR-0017); a parent-selected **Safety-Behaviors subset is disclosed pre-application** (ADR-0016); and a **post-session Tip** is a commission-exempt gratuity (ADR-0018). The platform also renders **web and mobile from one React Native + Expo codebase** (React Native Web) — there is no separate supply or parent web app; only the internal admin dashboard is a separate web surface.

## Geographic scope (v1)

**US-national launch from day one.** No soft-launch metro, no single-state geofence. Currency is **USD**. Data residency in US regions (Supabase US-region project for Auth + Postgres + Realtime + Storage; Fly.io `iad` for the Fastify backend; Vercel US-region for the admin Next.js surface — per ADR-0010, which supersedes the originally specified GCP `us-east1` / `us-east4` + Firestore `nam5` stack from ADR-0004). Compliance design rests on a **federal floor** — **COPPA** for processing of children's information, **HIPAA**-adjacent prudence for sensitive child data (with clinical Providers treated as the covered entity for clinical notes, not Our Haven), **FCRA** disposal-rule best practice for background-check raw data, the **IRS 20-factor / common-law test** for supply-side classification, **Title VII** for protected-class search-filter posture, **CAN-SPAM** / **TCPA** for transactional vs. marketing notification separation, and **IRS Form W-10 / Form 2441** for CDCTC eligibility — plus a **state-privacy patchwork module** that adapts per the user's state of residence (notably **CCPA/CPRA** in CA, **VCDPA** in VA, **CPA** in CO, **CTDPA** in CT, **UCPA** in UT, **FDBR** in FL, **OCPA** in OR, **TDPSA** in TX, plus other state laws phasing in). Background screening is run via **Checkr's standard package** (county criminal 7-year + national criminal database + national sex offender registry + SSN trace) — ~$30 per check, charged at **$35** to the supply applicant with a small platform margin. This is **marketplace-grade screening, applicable in any US state**; see **ADR-0007** for the screening posture and **ADR-0009** for the US-national launch decision (supersedes ADR-0003).

**Per-state compliance adapters are core v1 deliverables, not Phase 2.** Background-check integration, clinical-Provider license-board lookup, sales-tax taxability decisions, and supply-side classification-addendum surfacing are all wrapped behind vendor-agnostic / state-pluggable adapters exercised at launch (not abstract hooks). The Verification workflow deep module remains state-agnostic — it consumes verification *results*, not vendor APIs. Supply sign-up accepts any US state; the supply member's `state` field drives per-state adapter routing. Out-of-US sign-ups are rejected with a "we're not yet available outside the US" message.

> The Florida soft-launch posture from ADR-0003 (Miami-Dade marketing concentration, FL-statewide geofence, FL-board-eccentric verification) is **superseded by ADR-0009 (2026-05-26)**. Federal compliance design and vendor choices (Checkr, Stripe Connect Express US, Daily.co US rooms) are unchanged. The platform stack (Firebase Auth + GCP) was re-architected to **Supabase + Fly.io + Vercel** per **ADR-0010 (2026-05-27)**; data-residency remains US-only.

## Glossary

### Supply
Umbrella term for the two supply-side roles — **Caregiver** and **Provider** — used in admin UI, metrics, and any place the distinction doesn't matter. Note: "supply" is the umbrella; **"Provider" is no longer the umbrella** (it now names the clinical tier only — see below). Every account is permanently one **`role`** — exactly one of `parent`, `caregiver`, or `provider` — chosen at sign-up via the 3-tab role-pick. The former `kind` discriminator is **removed** (ADR-0011).

### Caregiver
Non-clinical childcare supply, and the marketplace's **transactional payment rail.** A Caregiver carries one or more **`categories[]`** (multi-select, ADR-0015):

- **Babysitter** — short-engagement childcare, typically by-the-hour, no live-in expectation.
- **Tutor** — academic instruction. Subject-matter focus rather than caregiving. Single-child only.
- **Nanny** — long-engagement childcare, recurring or live-in-style arrangements (modelled as long-running hourly Bookings in v1).

One Caregiver account holds a **set** of categories, each with its own **per-category Rate** (ADR-0015); every Booking / Job / Application / Offer is pinned to exactly one category. Caregivers are discovered via **unified search → message-first** or by **posting a Job** they apply to; engagement is **hourly and negotiable** (Job → Application → Offer → Booking); the platform takes a **Commission** and pays the Caregiver via **Stripe Connect** (same-day target). Caregivers run the day-to-day on mobile (accept Bookings, manage Availability, apply to Jobs, message, complete Sessions). Schema shape: `(role=caregiver, categories=[...], rate_per_category={...})`.

### Provider
The **clinical tier** — licensed/credentialed professional services (speech-language pathology, occupational therapy, ABA, psychology, and similar) — and a **listings + scheduling SaaS**, *not* a payment rail. A Provider carries a single **`specialty`**. Parents **browse the profile and book an open consultation slot** directly (per-session, fixed **display-only** Rate, no Job / Application / Offer / negotiation — slot-pick, resurrected for the Provider role only). **Clinical discussion and payment happen off-platform** (a deliberate HIPAA posture) — **no Stripe Connect, no Commission, no Payout.** Providers are monetized by a **Provider Subscription** (individual / small-business self-serve) or a sales-led corporate **Contact-Us** custom contract. Schema shape: `(role=provider, specialty=...)`.

> "Provider" vs "Caregiver" fork on **discovery, booking, money, and compliance** (ADR-0011): Caregiver = Commission + Connect + same-day Payout + Job chain + hourly Sessions; Provider = Subscription + off-platform payment + slot-pick consultations + no Session. The signup UI uses the client's 3-tab vocabulary directly: **"I'm a Parent / I'm a Caregiver / I'm a Provider"** (the third tab moved from "Specialist" to "Provider" on 2026-05-30, ADR-0011).

### Parent
The demand side. An adult account holder who books supply for one or more children. There is **no Child entity** (ADR-0012); a Parent holds a single family-level **Parent profile** (see below), and the number/ages of children are captured **ad-hoc per Booking**.

### Parent profile
A single **family-level** record under a Parent account (ADR-0012 — replaces the removed multi-Child model):

- **Bio** — free-text family info.
- **Preferences** — a checklist of desired Caregiver traits (e.g. non-smoker, pet-friendly).
- **Safety Behaviors** — a **fixed checklist** of atypical behaviour patterns (aggression, self-injurious behaviour, wandering / elopement, etc. — final list from Ci'erro) the family wants supply to be aware of. **Sensitive child data:** stored only after an explicit, timestamped consent (see § Sensitive-data consent); `safety_behaviors_consent_at` is held alongside.
- **`default_address`** (optional) — pre-fills the per-transaction `service_address` (see § Service address & distance).

There is **no persisted neurodivergence/diagnosis field** anywhere — the only persisted sensitive child data is the consented Safety Behaviors checklist. The number and ages of children appear only as ad-hoc `child_count` + `child_ages` on Offers / Bookings / Jobs. Profile **visibility** to supply is progressive (see § Parent-profile visibility).

### Verification
The set of checks a supply member must clear before they can be activated and listed in search. **Per-role** (ADR-0011), driven by the state-agnostic Verification workflow deep module:

**All supply (Caregiver and Provider)** require: email verification, **phone verification** (`phoneVerified` — phone is *optional on the sign-up form* but a verified phone is a **hard activation gate**, because the booking-request SMS is the most critical notification — ADR-0015 / client #1), government ID upload, and **Checkr standard-package background screening** — county criminal (7-year) + national criminal database + national sex offender registry + SSN trace (see ADR-0007), ~$30/check charged at **$35**. This is **marketplace-grade screening, applicable in any US state**. State statutory regimes (e.g., Florida's AHCA/DCF Level 2 clearinghouse for licensed child-care *facility* personnel) do **not** apply to Our Haven's supply, who operate as independent in-home contractors; marketing copy must not conflate marketplace-grade with statutory state-level screening. The integration sits behind a **vendor-agnostic background-check interface** so a second vendor — or voluntary statutory uploads where a member holds an existing state clearance — can be added by configuration.

**Providers (clinical)** additionally require: professional license number, issuing state board, license document upload, and proof of liability insurance — verified manually by admin against the relevant **state professional license register** via the **per-state license-board adapter** (which knows the state's boards by specialty, the public register URL/API, and whether it's API-callable or human-portal-only). No third-party verification vendor in v1. **The adapter slate is populated at launch for the priority Provider-supply states**; Providers from states outside the slate are accepted at sign-up but route to a "verification pending — your state is not yet supported" holding state until the relevant adapter ships.

**Caregivers** may **optionally** add **Credentials** (see below) — never an activation gate. Babysitter/Nanny may carry a self-attested "Tax-credit-friendly" (W-10) badge and (rarely) a state home-childcare registration (FCCH). These are search-discoverability aids, not activation gates.

### Credentials (Caregiver)
The umbrella for a Caregiver's professional qualifications (ADR-0015 / client #9): `type ∈ {title, certification, training}`. Added during sign-up or from the profile; **admin-verified** and **hidden from the public profile until approved** (shown to the Caregiver as "Pending review"). Admin **rejects clinical-sounding titles** (e.g. "Pediatric Nurse") to protect the Caregiver/Provider line. Credentials are **optional** and never gate activation. (Automated certification verification is post-v1 — certs are admin-verified manually in v1.)

### Ages served & behaviour-comfort (Caregiver)
Two **person-level** Caregiver profile fields (ADR-0015 / client #8): **`ages_served`** (the age range of children the Caregiver works with) and **`behaviour_comfort[]`** (the atypical behaviour patterns the Caregiver is comfortable supporting). `behaviour_comfort` draws from the **same fixed Safety-Behaviors taxonomy** a Parent picks their child's behaviours from — so the two are **matchable**. This is the Caregiver's own capability data, so no consent gate. Both are search filters (see § Search & filters). Automated match-scoring (caregiver comfort ⊇ child's behaviours) is **deferred** — v1 is display + filter only.

### CDCTC-eligibility & state childcare licensure (Babysitter / Nanny only)
Parents claiming the federal **Child and Dependent Care Tax Credit (CDCTC)** on **IRS Form 2441**, or using a **Dependent Care FSA**, must collect the Caregiver's TIN/SSN via **IRS Form W-10**. Surfaced as a **"Tax-credit-friendly" badge** on Babysitter and Nanny profiles: a Caregiver who self-attests they will issue Form W-10 on request gets the badge; Parents can filter by it. **Self-attestation only in v1** — no document upload, no admin verification.

Separately, the small minority of Caregivers who operate a **state-licensed home-based childcare program** (FL DCF Family Child Care Home, CA DSS Family Child Care Home, TX HHSC Registered/Licensed Child-Care Home, NY OCFS Family Day Care, etc.) may upload their state registration certificate as an optional credential; admin verifies via the per-state childcare-licensure adapter and surfaces a **"State-registered home childcare" badge** (state agency named on the badge). Activation is **not** gated on either badge.

### Search & filters (v1)
A single **unified search** surface across both supply roles — Caregivers (Babysitter / Tutor / Nanny) and clinical Providers (by specialty). A Caregiver result leads to **Message / Book-request**; a Provider result leads to **Book-a-consultation**. **v1 filters:** Category/specialty, ZIP code + radius (default 5 miles), date/time (intersected with supply Availability), hourly Rate ceiling, minimum star Rating, Tax-credit-friendly toggle (Babysitter/Nanny only), **age range served** (both roles), and **Caregiver behaviour-comfort** (over the shared Safety-Behaviors taxonomy — ADR-0016 / client #8). **Provider-specific filters** unlock for clinical Providers (license type, in-person vs telehealth, age range served).

**Ranking** is hybrid: `0.5 × distance_proximity + 0.3 × rating + 0.2 × recency_active_in_last_7_days`. Editorial / featured slots and admin-driven boosting are deferred. **Supply gender** as a filter is **deferred** (protected class under Title VII and state civil-rights acts); a supply member may still disclose gender on their own profile.

### Notifications
Multi-channel transactional notification system — push (mobile via **Expo Push**, which wraps FCM on Android + APNs on iOS; web via VAPID web push, best-effort), email (all surfaces, via **Resend**), SMS (all surfaces, via **Twilio**). *(Email vendor is Resend per PRD-0001 v1.7 § Implementation Decisions; push is Expo Push per ADR-0010 — Expo SDK 56 includes the push runtime, removing the Firebase dependency on mobile.)*

**SMS is reserved for urgent events only**, and is **mandatory** (no opt-out) for:
- **Booking request received → Caregiver** (the single most critical notification; if it doesn't reach the Caregiver quickly, the marketplace stalls). Deep-links into the Caregiver's Schedule tab.
- **Job awarded → Caregiver** (Application accepted, Booking being created — same urgency).
- **Consultation booked → Provider** (a slot was filled — the Provider's most time-sensitive event).
- **Cancellation inside the 24h window → both sides.**

Push + email (not SMS) covers: **new Application on Parent's Job**, **counter-Offer received**, **Offer expired**, **Job expiring in 48h with no Applications → Parent**, **Job expired with no award → Parent**, **Session start reminder** (1h before). In-app notification inbox is **deferred**. Marketing messages require a separate opt-in distinct from transactional notifications.

### Authentication
**Identity provider:** **Supabase Auth**, US-region project (co-located with Supabase Postgres + Realtime + Storage), per ADR-0010.

**Account roles.** Each account is permanently **one role** — **Parent**, **Caregiver**, or **Provider** — chosen at sign-up via the **3-tab role-pick** screen: *"I'm a Parent / I'm a Caregiver / I'm a Provider"* (ADR-0011 — three flat top-level roles; the former Parent/Provider-with-`kind` model is gone). A Caregiver then picks one or more **`categories[]`**; a Provider picks a **`specialty`**. A user who wants two roles maintains two accounts with different emails (single-account dual-role is deferred — ADR-0005).

**Parent:** Sign in with Apple + Google + email/password (Apple required by App Store rules when any third-party social login is offered). **Phone is optional at sign-up**; it is collected and verified at the **Subscription paywall step** (which fires on first attempt to message, send a Book-request, post a Job, or book a Provider consultation — see § Subscription), to support cancellation SMS + new-device MFA. Pre-paywall Parents have no phone on file and are never SMS-pinged.

**Supply (Caregiver & Provider):** Sign in with Apple + Google + email/password (Apple mandatory on mobile when social login is offered; not offered on web). The **same RN/Expo app renders the supply onboarding on web and the run-the-day surfaces on mobile** — there is no separate web portal. **Phone is optional on the sign-up form** but a verified phone (`phoneVerified`) is a hard activation gate (see § Verification). Heavy onboarding that links out to **Stripe-hosted** flows (Caregiver Connect KYC, bank-detail changes, withdrawals; Provider Subscription) opens in an in-app browser.

**MFA posture:**
- **Parent:** device-trust model — SMS OTP on new-device / suspicious sign-in; falls back to **email OTP** when no phone is on file (pre-paywall Parents). Not required every login.
- **Caregiver:** SMS OTP on new-device sign-in plus **step-up MFA** for payout-sensitive actions (changing bank details, initiating withdrawals — Stripe-hosted, web-side orchestration).
- **Provider:** SMS OTP on new-device sign-in. No payout-sensitive step-up (Providers have no Payouts).
- **Admin (Trust & Safety, etc.):** TOTP MFA mandatory on every sign-in.

### Sensitive-data consent (Safety Behaviors)
The **Safety Behaviors** checklist on the family Parent profile is **sensitive information about a child** (ADR-0012 — re-anchored from the removed Child profile). No single US statute imposes a UK-GDPR-Article-9-style "explicit consent" requirement, but **COPPA**-aware best practice, **HIPAA**-adjacent prudence, and the **state-privacy patchwork**'s sensitive-data provisions all point to the same UX pattern: a **discrete, explicit Parent-consent step** with a timestamp before any Safety Behaviors can be saved, re-prompt on material privacy-policy changes, and full erasure on account deletion **or** consent withdrawal. This is non-optional. The platform deliberately avoids becoming a **HIPAA Business Associate** by *not* requiring Providers to upload clinical notes through the platform; clinical notes stay in the Provider's own EHR, and the platform handles only what the Parent chooses to disclose.

**Pre-signup questionnaire.** During Parent sign-up, a brief multi-choice questionnaire (neurotypical/neurodivergent + child-age-band + focus-area hints) tailors the initial browse experience. The questionnaire is **ephemeral**: answers shape only the first browse session and are **not persisted** anywhere server-side. The explicit consent moment is tied to **editing Safety Behaviors**, a separate intentional step.

### Privacy counsel
External **US privacy counsel** with **national scope**, selected in Phase 0 / Milestone 0. Required before launch given Our Haven processes children's information, runs systematic message monitoring, and operates across the federal floor + state-privacy patchwork.

### Privacy Impact Assessment (PIA)
A mandatory pre-launch document covering the multi-state US privacy patchwork. Drafted with US privacy counsel, reviewed by Ci'erro's lawyers, signed off before launch. Carries state-specific appendices that the state-privacy-patchwork module surfaces per user residence.

### Data residency
All personal data is processed in **US regions**. Vendor settings (Supabase → US-region project; Fly.io → `iad`; Vercel → US-region for the admin surface; Daily.co → US rooms; Checkr → US) are configured at project setup. A vendor data-flow inventory is maintained as a Privacy Policy appendix.

### Retention policy
- **Account data:** 30-day soft-delete grace period after deletion request, then hard-delete.
- **Booking + payment records:** retained **7 years** pseudonymized ("Deleted user {id}") — aligned with IRS recordkeeping.
- **Message content:** **3 years** post last activity, then hard-delete unless flagged in an active investigation. **Job descriptions, Application proposals, and Offer `scope_note`s follow the same rule** (same disclosure surface).
- **Background-check raw details:** **6 months** maximum (FCRA disposal-rule best practice), then hard-delete. The cleared/not status remains on the account.
- **Sensitive data (Safety Behaviors + `safety_behaviors_consent_at`):** deleted on account deletion **or** explicit consent withdrawal. There are no per-child records to erase.
- **State-specific deletion-right SLAs** (CCPA 45-day window, FDBR response window, etc.) are honored at the API layer via the state-privacy-patchwork module, on top of the underlying retention rules.

### Booking
A scheduled engagement between a Parent and a supply member. **Caregiver** Bookings trace back to a **Job, an Application, and an accepted Offer** (see § Job / § Application / § Offer) — for Direct-Message Bookings the Job + single Application are materialised lazily at acceptance. **Provider** consultation Bookings **bypass the Job chain entirely** — they are slot-pick schedule entries with no Job, Application, Offer, payment intent, Commission, or Payout (off-platform).

A **Caregiver** Booking is **hourly**; its price is the **Agreed Rate** from the accepted Offer (the Published Rate at creation is also snapshotted for audit). It may also carry an optional **`tipAmount`** (post-session gratuity — 100% to the Caregiver, no Commission; ADR-0018), a transient **`pendingTimeChange`** while a Parent's shorten request awaits approval (ADR-0014 amended), an **`offerId`** back-link to the Book-request that materialised it (so withdrawing that Offer cascade-cancels the Booking), a **`service_address`** (revealed to the Caregiver at `accepted`), ad-hoc **`child_count` + `child_ages`**, and a nullable **Booking Series FK** (set on recurring occurrences). A **Provider** consultation Booking carries a null payment intent, null Job ID, and a display-only session-Rate snapshot.

A planned Booking carries a **concrete date + start–end time** (ADR-0014); the Morning/Afternoon/Evening band is *derived* from the window for availability matching, not stored as the primary field.

### Booking Series
A **recurring Caregiver arrangement** (ADR-0014 — Caregiver only). Carries Parent ID, Caregiver ID, Category, the recurrence rule (start date + weekdays + start–end time + end date), the **Agreed Rate** (applied per occurrence), and the set of materialised occurrence Booking FKs. On award/acceptance it materialises **every occurrence up front as its own ordinary Booking**, each running the standard Booking state machine independently (own hours-confirmation, payment, dispute, cancel). The Series itself holds **no lifecycle state**. Cancelling one occurrence leaves the rest; cancelling the Series cancels all still-upcoming occurrences. A Series materialised from a recurring Book-request carries an **`offerId`** back-link. *(A **multi-day one-off** bundle is **not** a Series — it is several independent one-off Bookings, one per date, with no Series FK; ADR-0014 amended v1.7.)*

### Booking states
`requested` (Posted-Job only — Parent awarded; Caregiver has 24h to confirm) → `accepted` | `declined` | `expired` (24h auto-decline, Posted-Job only) → `in-progress` (hourly, after session start) → `awaiting-confirmation` (hourly — Caregiver proposed final hours; Parent has the **~24h review window** to confirm or dispute) → `completed` | `disputed` | `cancelled`. **Direct-Message Bookings skip `requested`** — born in `accepted` at the moment the recipient accepts a Book-request (the click is the commitment). **Provider** consultations take the path `accepted → completed` (auto-complete after the slot) — no in-progress / awaiting-confirmation / dispute, null payment. **Adjust-time** is a sub-state on `accepted` (extend mutates duration immediately; shorten writes a transient `pendingTimeChange` the Caregiver approves/declines; it resolves back to plain `accepted`).

### Session
The actual hours worked during an **hourly Caregiver** Booking. The Caregiver marks in-progress at start and proposes final hours at the end; the Parent has the **~24h review window** to confirm or dispute, otherwise it auto-confirms and payment captures. **Provider** consultations have no Session.

### Rate
- **Published Rate.** What a supply member displays, set by them. A **Caregiver** publishes an hourly Rate **per category** they offer (ADR-0015 — drives the Offer pre-fill + the search Rate-ceiling filter for that category; a no-category-filter search compares the **lowest** and shows "from $X"). A **Provider** publishes a per-session consultation Rate that is **display-only** (payment off-platform — no on-platform charge, Commission, or Payout). Babysitter/Nanny Rates may include an optional **per-child surcharge** (snapshotted into each Offer's `computed_total` at send time).
- **Agreed Rate.** The Rate baked into a specific Caregiver Booking via the accepted Offer — the input to the Pricing & Commission calculator. v1 pricing is **negotiable** (subject to the Caregiver's `negotiable` toggle — see § Offer).

**Tutor** and clinical **Provider** engagements are **single-child only** (Tutor enforced as `child_count == 1` at Booking creation; consultations are inherently single-engagement). Our Haven does not set or cap Rates.

### Parent-profile visibility
The family Parent profile and the booking's child detail reveal to supply **progressively** (ADR-0012 / ADR-0016):

- **Before applying / on a received Book-request:** a verified in-category Caregiver sees the parent-disclosed **Safety-Behaviors subset** + **child count + ages** + **approximate distance** (ZIP-centroid) + area. **Bio + Preferences** stay hidden.
- **On engagement** (an Application filed for a Posted Job, or the first Book-request in a Direct-Message thread): **Bio + Preferences** reveal.
- **At `accepted`:** the **exact service address** appears on the Booking detail (see § Service address & distance).

The disclosed Safety-Behaviors subset is a **parent-selected** subset under an extended, explicit consent warning at compose time (the Parent must choose a subset *or* explicitly choose to disclose none — no silent default; ADR-0016 / v1.7). Providers don't see the Parent profile pre-consultation — they see only the Parent's aggregate Rating + count when a slot is booked. There are **no per-child notes** anywhere.

### Service address & distance
The **`service_address`** is set on the transaction (Job compose / Book-request), optionally pre-filled from the Parent profile's `default_address` (ADR-0016 / client #3+#4). Pre-acceptance, the open-Job and Book-request cards show only an **approximate ZIP-centroid distance + area**; the **exact address** appears on the Booking detail once the Booking reaches `accepted`. (The standalone search-radius control was dropped from Post-a-Job in v1.7 — location is the ZIP, proximity comes from this distance.)

### Job
A Parent's posted request describing a need for a **Caregiver** (Caregiver-only — clinical Providers are slot-booked and never posted to). The **canonical anchor** for every Caregiver Booking (ADR-0006, narrowed by ADR-0011): every Caregiver Booking traces back to a Job, an Application, and an accepted Offer. Two paths:

- **Posted Job.** Parent composes a Job (Category, ZIP, scope free-text, **concrete schedule**, optional budget hint, child **count + ages + disclosed Safety-Behaviors subset**, `service_address`), publishes it; verified in-category Caregivers apply.
- **Direct-Message Job.** Parent opens a chat with a specific Caregiver and exchanges messages + structured **Book-requests**. The Job does **not** exist pre-acceptance; on Accept the system **atomically materialises** Job + single Application + Booking. Plumbing — neither party sees a Job UI for Direct-Message.

**Concrete schedule** (ADR-0014): **one-off** = a single date + start–end window (or **several dates each with a window** for a multi-day one-off — posted as **one Job per date**, v1.7); **recurring** = an anchored rule (start date + weekdays + time window + end date), previewing the occurrence dates it generates. **Job states:** `draft → open → (awarded | expired | cancelled) → closed`. Posted Jobs auto-expire 14 days after publishing with no award; Direct-Message Jobs are born in `awarded`. **Caps:** a Job stops accepting Applications at **15** (Parent UX protection). Posting requires an active Parent Subscription. A Job may carry an optional **`dispute`** for a Parent's post-hoc billing dispute on a past Job (ADR-0013 amended v1.7). The `radius` field was **dropped** (ADR-0014 amended v1.7).

### Application
A Caregiver's response to an open Job (Caregiver-only). Carries the Caregiver's first Offer + a free-text proposal. One Caregiver may file at most one Application per Job, for the Job's single service **category** (a multi-category Caregiver applies in the relevant one). Each Application spawns a Message thread anchored to the Job ID. Filing requires the Caregiver's Verification to be `cleared` and consumes one of the Caregiver's **30 monthly application allowances** (calendar-month, reset on the 1st; re-tunable post-launch). **States:** `submitted → (countered | awarded | declined | withdrawn | expired)`. `awarded` transitions the Job to `awarded` and creates a Booking in `requested` (or a Booking Series for a recurring Job) with the Agreed Rate.

### Offer
A structured price-and-scope proposal sent inside a Message thread (Caregiver-only — Provider consultations are fixed-price slot-picks with no Offer). **Either party can send.** Carries: `proposed_rate`, `scope_type` (`hourly` only — the `per_session` variant retired with the off-platform Provider tier), `scope_quantity`, the **proposed date + start–end time** (or a recurrence rule; or **`slots[]`** for a multi-day one-off), ad-hoc `child_count` + `child_ages` (on Parent-sent Offers), `safety_behaviors[]` (disclosed subset), `service_address`, optional free-text `scope_note` (≤280 chars), `computed_total` (snapshot of `proposed_rate × scope_quantity` + per-child surcharge at send time), `per_child_surcharge_snapshot`, `valid_until` (default 72h), `sender` (`parent` | `caregiver`), an anchor (`job_id` or pre-acceptance `thread_id`), a `supersedes` FK (counter-Offer chain), and an `offerId` referenced by any Bookings/Series it materialises.

**UI labelling:** the domain term is **Offer**; the parent-facing button renders as **"Book" / "Send Booking Request"**, the Caregiver-facing acceptance as **"Accept Booking"** (or **"Counter" / "Decline"**). An Offer renders as an **Offer bubble** with **Accept / Counter / Decline** pills. **States:** `pending → (accepted | countered | declined | expired | withdrawn)`. **Accept** creates a Booking with `agreed_rate = proposed_rate` (one Booking per slot for a multi-day `slots[]` Offer — no Series). **Counter** is **gated by the counterparty Caregiver's `negotiable` flag** — when off, only Accept/Decline are valid and the Direct-Message composer **locks** `proposed_rate` to the published per-category Rate (ADR-0017). **Withdraw** is sender-initiated (from `pending` or `accepted`); withdrawing an already-`accepted` Offer **cascade-cancels** every Booking/Series it materialised (via `offerId`, ADR-0014 amended). The `scope_note` passes through the **Disintermediation detector**; structured numeric fields bypass it.

### negotiable (Caregiver setting)
A person-level **`negotiable`** boolean on the Caregiver profile (default **on**, ADR-0017). When **off**, the **Counter** affordance is hidden on both sides — the Direct-Message rate locks to the Caregiver's published per-category Rate, and a Parent reviewing the Caregiver's Application gets **Accept / Decline only**. Providers are unaffected.

### Availability
A **general weekly summary** — there is no slot-pick flow for Caregivers (per-slot calendars are explicitly not in v1). **Forks by role** (ADR-0011):

- **Caregiver:** a 7-day × 3-band toggle **grid** (Morning / Afternoon / Evening) + a ≤200-char free-text note + a **`paused`** boolean (paused Caregivers don't appear in search). Renders to Parents as a short string (e.g. "Mon–Fri 3–5 PM"). Search date/time intersects the grid only. No slot-blocking — booking commitments materialise via Direct-Message → Book-request → Accept.
- **Provider:** publishes bookable **consultation slots** (slot-pick, resurrected for the Provider role only). Booking an open slot holds it and creates a per-session Provider Booking (null payment); cancellation releases it.

### Adjust booked time
On an `accepted`, non-consultation Booking, a Parent may change the time (ADR-0014 amended v1.7): **extending applies immediately** (re-authorizes the larger total; updates `durationHours`/`endMin`), while **shortening sends the Caregiver a `pendingTimeChange` proposal** to **approve or decline** (it reduces their agreed pay). The Parent can rescind a pending shorten. This is a duration change, not a cancellation — the cancellation-policy calculator is not involved.

### Message
A communication between a Parent and a supply member. **Threads anchor** either to a **`job_id`** (Posted-Job Applications; post-acceptance Direct-Message threads) or to a **`thread_id`** only (pre-acceptance Direct-Message). At Direct-Message acceptance the thread rebinds `thread_id → job_id` atomically with Job + Application + Booking creation. Live delivery is via **Supabase Realtime** row-level subscriptions on the `messages` table.

Every message — including an Offer's `scope_note` — passes through **disintermediation detection** (regex for phone numbers, emails, social handles, payment-app names, address-like patterns). Detected substrings are **redacted** before delivery; the unredacted original is queued for Trust & Safety. Structured Offer fields bypass the detector.

> **User-facing privacy copy states only the active mechanics — redaction + Trust & Safety review.** Messages *are* encrypted in transit and at rest (a real backend property disclosed in the Privacy Policy), but this is **no longer a user-facing claim** (an "encrypted/private" promise sits awkwardly beside T&S monitoring, and the prototype had shown a false "E2E" badge). **E2EE is explicitly out of scope.** *(v1.5, 2026-06-10 — see PRD story 19.)*

### Video call
An embedded video call between a Parent and a supply member via **Daily.co** (US-region rooms). Triggered **ad-hoc** from the chat thread by either party (ADR-0008); lives as a "Join video call" bubble for the counterparty until expiry (~30 min). No scheduling flow. The platform logs the **generation** of a call link (timestamp, thread ID, initiator, participants) for Trust & Safety; it does **not** record call content. Inherits the messaging Subscription gate.

### Trust & Safety
A specific admin role authorized to access Message content. Two modes: a **flagged-thread queue** (messages/Offer `scope_note`s that tripped disintermediation detection) and **investigation access** (on-demand thread pull when a safety/fraud report is filed). Every access is audit-logged with admin ID, thread ID, timestamp, mode, and — for investigation access — a free-text reason.

### Cancellation policy
A single platform-wide rule in v1 (per-supply policies deferred). **Parent-initiated** on a **Caregiver** Booking: free if ≥24h before start, 50% of estimated charge inside 24h, 100% inside 2h or after start; fees flow to the Caregiver (less Commission). **Caregiver-initiated** cancellation is free in v1 but tracked — repeats surface to admin review and affect search ranking. A **Provider** consultation cancellation (either party) has **no fee math** — it just releases the held slot and notifies.

### No-show
**Caregiver no-show:** Parent receives a full refund; the Caregiver is auto-flagged (two flagged → manual review; three → suspension). **Parent no-show:** the Caregiver reports within 2h of scheduled start; the Parent has 24h to contest; if uncontested, the Caregiver receives 50% of the estimated total. A **Provider** consultation no-show carries **no payment consequence** — it's a supply-quality flag only (off-platform).

### Rating
A 1–5 star score + optional text, submitted by one party about the other after a Booking enters `completed`. Both sides may rate within a **14-day window**, submitted **blind** and revealed mutually (Airbnb-style). Display is **asymmetric**: supply Ratings (Parent → Caregiver/Provider) are **public** on the profile (aggregate + count + full text); Parent Ratings (supply → Parent) are visible **only to supply** evaluating a request, and only as **aggregate stars + count** (text internal to admin/ranking). A Rating tied to a Booking under active Dispute is withheld from public display until the dispute resolves.

### Dispute
A formal charge/billing challenge (Caregiver Bookings only — Provider consultations carry no on-platform money to dispute). **The single ~24h review window is the sole payout-holding window** (ADR-0013): a Dispute filed **inside** the `awaiting-confirmation` / confirm-hours window **auto-holds the Caregiver's Payout** and routes to the admin queue. The old separate 7-day post-completion dispute window is **retired**. The same "Dispute charge & billing" action is also reachable **outside** the window — on `accepted` and `completed` Bookings and on past Jobs (`Job.dispute`) — but these are **admin escalations** (platform-absorbed refund / Stripe clawback as an exception), **not** automatic holds (ADR-0013 amended v1.7). Disputes are an in-app flow, resolved by admin decision (final, except where overridden by a Stripe chargeback).

### Tip (post-session gratuity)
An optional **`tipAmount`** a Parent may add after rating a completed **Caregiver** Booking (also editable later from the Booking detail; setting `0` clears it) — ADR-0018. It is **100% pass-through to the Caregiver with no Commission** (the Pricing & Commission calculator's `application_fee` skim does not apply); it appears as an additive line on the Caregiver's Payout. A tip never blocks rating, payout, or completion, and is independent of the ~24h review window. **Caregiver Bookings only** — Provider consultations carry no on-platform money to tip. Tips are Caregiver income for 1099-K purposes; they are not platform revenue and create no platform sales-tax nexus.

### Sales tax model (US-national)
Our Haven is a **marketplace agent**, not a deemed supplier. **Stripe Tax** handles per-state nexus tracking, taxability decisions, and filing prompts. Registrations are pursued **as nexus is established**, not preemptively. Exposure: (1) **Parent Subscription** — taxability of digital/access subscriptions varies by state (Stripe Tax decides per subscriber residence); (2) **Commission** — generally a B2B service to the Caregiver, taxability varies by state; (3) **the Booking itself** — Our Haven does **not** collect sales tax on Bookings (childcare/tutoring/clinical services are generally exempt; supply members are responsible for any exposure on their own services). **Provider consultations are off-platform** and carry no Commission, so no platform tax line. **Form 1099-K** issuance to **Caregivers** is handled by Stripe Connect automatically.

### Commission
The percentage of every **Caregiver** Booking that Our Haven retains — skimmed from the Caregiver's Rate via Stripe Connect's application fee (the Parent pays the displayed Rate; the Caregiver receives Rate × (1 − Commission)). The exact percentage is a business decision (target 15–20%), not yet set. **Tips are exempt** (ADR-0018). **Provider consultations carry no Commission** (off-platform). _Avoid_: service fee, take rate, platform fee.

### Subscription
Two products (ADR-0011), both sold on **web** (Stripe-hosted checkout / Stripe billing) to avoid iOS/Android in-app-purchase rules; the app reads status but does not sell it:

- **Parent Subscription** — a recurring payment held by a Parent that unlocks **full search** (lifting the preview blur), **messaging**, **sending Book-requests**, **posting Jobs**, and **booking Provider consultations**. Without it, a Parent has a free browse account showing a **blur-to-unblur preview** (1–2 full profiles per category, the rest as blurred cards conveying marketplace depth) and can read profiles, but cannot message, send Book-requests, post Jobs, or book consultations. **The gate fires identically on first attempt at any of those four actions**; phone collection + verification happens in the same paywall step.
- **Provider Subscription** — the clinical tier's listing fee (individual / small-business self-serve via Stripe billing, Provider as a Customer; large corporations submit a **Contact-Us** intake for a sales-led custom contract — intake form only in v1). Lists the Provider in search and enables consultation Bookings.

_Avoid_: membership, plan, premium.

### Payout
Funds transferred from Our Haven to a **Caregiver** after a completed Booking, routed via **Stripe Connect** (same-day target once the ~24h review window closes clean). A Caregiver must have a connected Stripe account before receiving Payouts. **Providers receive no Payouts** (clinical fees are off-platform). _Avoid_: disbursement, transfer, settlement.

## Resolution history

- **Provider taxonomy — flattened to three roles (2026-05-30, ADR-0011).** **Supersedes** the earlier two-level model (the 2026-05-08 four-category enum and the 2026-05-19 `kind` ∈ {caregiver, specialist} sub-umbrella). The supply side is now three **flat top-level roles** `{parent, caregiver, provider}`; the `kind` discriminator is removed; **"Provider" names the clinical tier** (was "Specialist"), and **Caregiver** is a peer top-level role, not a sub-umbrella. Schema: `(role=caregiver, categories=[...])` or `(role=provider, specialty=...)`. The two supply roles fork on discovery, booking, money, and compliance (Caregiver = payment rail; Provider = off-platform SaaS).
- **Child entity removed (2026-05-30, ADR-0012).** No Child profiles; a family-level **Parent profile** (Bio + Preferences + fixed Safety Behaviors checklist + consent timestamp) replaces it. Children appear ad-hoc as `child_count` + `child_ages` per Booking. No persisted neurodivergence/diagnosis field.
- **Single ~24h review window + same-day payout (2026-05-30, ADR-0013; amended v1.7).** The `awaiting-confirmation` window is the sole dispute-bearing, payout-holding state; the old 7-day window is retired. A wider self-serve dispute surface (on `accepted`/`completed`/past-Job) was added as admin escalations, not auto-holds.
- **Concrete parent-specified scheduling + recurring Booking Series (2026-06-10, ADR-0014; amended v1.7).** Book-requests/Jobs carry a real date + start–end window (one-off) or a recurrence rule (recurring → a Booking Series of per-occurrence Bookings). v1.7 added **multi-day one-off** bundles (`slots[]` → one Booking per date, no Series) and **adjust-booked-time** (extend immediate / shorten needs Caregiver approval).
- **Multi-category Caregiver (2026-06-17, ADR-0015).** `categories[]` with a per-category Rate; `phoneVerified` activation gate; **Credentials** umbrella; `ages_served` + `behaviour_comfort`.
- **Pre-application Safety-Behaviors disclosure (2026-06-17, ADR-0016; strengthened v1.7).** A parent-selected Safety-Behaviors subset + child count + ages is shown to in-category Caregivers before they apply; `service_address` reveals at `accepted`; ZIP-centroid distance pre-accept. v1.7 requires an **explicit disclose-or-none** choice at compose.
- **Caregiver negotiation toggle (2026-06-17, ADR-0017).** Person-level `negotiable` boolean (default on); when off, Counter is hidden and the Direct-Message rate locks.
- **Post-session tipping (2026-06-23, ADR-0018).** Optional, commission-exempt, 100% to the Caregiver; Caregiver Bookings only.
- **Slot-pick + Direct-Message materialisation (2026-05-19).** Slot-pick removed for Caregivers; replaced by Direct-Message → Book-request → Accept lazy materialisation. (Slot-pick later resurrected for the **Provider** role only — ADR-0011.)
- **Video calls — Daily.co embedded, ad-hoc, either party (2026-05-19, ADR-0008).**
- **Launch jurisdiction — US-national from day one (2026-05-26, ADR-0009, supersedes ADR-0003).**
- **Platform stack — Supabase + Fly.io + Vercel (2026-05-27, ADR-0010, supersedes the Firebase/GCP stack in ADR-0004 §§4–7).**
- **Naming collision flagged (open).** The client calls the Posted-Job path "Direct Booking" and the search→message path "Search & Message"; code keeps **Direct-Message** for the search→message path. Client-facing copy must be reconciled to one vocabulary before launch.
