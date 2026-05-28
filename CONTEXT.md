# Our Haven — Domain Context

A two-sided marketplace mobile app connecting parents with vetted childcare and child-development professionals.

## Geographic scope (v1)

**US-national launch from day one.** No soft-launch metro, no single-state geofence. Currency is **USD**. Data residency in US regions (Supabase US-region project for Auth + Postgres + Realtime + Storage; Fly.io `iad` for the Fastify backend; Vercel US-region for the Next.js web surfaces — per ADR-0010, which supersedes the originally specified GCP `us-east1` / `us-east4` + Firestore `nam5` stack from ADR-0004). Compliance design rests on a **federal floor** — **COPPA** for processing of children's information, **HIPAA**-adjacent prudence for special-needs notes (with Specialists treated as the covered entity for clinical notes, not Our Haven), **FCRA** disposal-rule best practice for background-check raw data, the **IRS 20-factor / common-law test** for Provider classification, **Title VII** for protected-class search-filter posture, **CAN-SPAM** / **TCPA** for transactional vs. marketing notification separation, and **IRS Form W-10 / Form 2441** for CDCTC eligibility — plus a **state-privacy patchwork module** that adapts per the user's state of residence (notably **CCPA/CPRA** in CA, **VCDPA** in VA, **CPA** in CO, **CTDPA** in CT, **UCPA** in UT, **FDBR** in FL, **OCPA** in OR, **TDPSA** in TX, plus other state laws phasing in). Background screening is run via **Checkr's standard package** (county criminal 7-year + national criminal database + national sex offender registry + SSN trace) — ~$30 per check, charged at **$35** to the Provider with a small platform margin. This is **marketplace-grade screening, applicable in any US state**; see **ADR-0007** for the screening posture and **ADR-0009** for the US-national launch decision (supersedes ADR-0003).

**Per-state compliance adapters are core v1 deliverables, not Phase 2.** Background-check integration, Specialist license-board lookup, sales-tax taxability decisions, and Provider classification-addendum surfacing are all wrapped behind vendor-agnostic / state-pluggable adapters that are exercised at launch (not abstract Phase 2 hooks). The Verification workflow deep module remains state-agnostic — it consumes verification *results*, not vendor APIs. Provider sign-up accepts any US state; the Provider's `state` field drives per-state adapter routing. Out-of-US sign-ups are rejected with a "we're not yet available outside the US" message.

> The Florida soft-launch posture from ADR-0003 (Miami-Dade marketing concentration, FL-statewide geofence, FL-board-eccentric Specialist verification) is **superseded by ADR-0009 (2026-05-26)**. Federal compliance design and vendor choices (Checkr, Stripe Connect Express US, Daily.co US rooms) are unchanged. The platform stack (Firebase Auth + GCP Cloud Run + Firestore + Cloud SQL + Cloud Storage + Cloud Tasks) was subsequently re-architected to **Supabase + Fly.io + Vercel** per **ADR-0010 (2026-05-27)**; data-residency remains US-only.

## Glossary

### Provider
The supply side of the marketplace. An adult who offers services to families through the platform. *Provider* is the umbrella domain term — the **account role** — used in code, admin tools, contracts, and internal docs.

Every Provider account has a **`kind`** — exactly one of two sub-umbrellas (refined 2026-05-19 per client sync):

- **Caregiver** — non-clinical childcare. The Provider then picks a **`caregiver_category`**:
  - **Babysitter** — short-engagement childcare, typically by-the-hour, no live-in expectation.
  - **Tutor** — academic instruction. Subject-matter focus rather than caregiving.
  - **Nanny** — long-engagement childcare, recurring or live-in arrangements.
- **Specialist** — licensed or credentialed clinical/professional services. The Provider picks a **`specialty`** (speech-language pathology, ABA, occupational therapy, psychology, and similar). Distinct from Caregiver in liability profile and verification depth — Specialists require license + insurance verification that Caregivers do not — and differ on pricing model (per-session, not hourly), child-profile visibility (full notes pre-accept), and engagement rules (single-child only).

Phase 1 ships both kinds. Schema shape: `(role=provider, kind=caregiver, caregiver_category=...)` or `(role=provider, kind=specialist, specialty=...)`.

**"Caregiver" is a canonical domain term** (sub-umbrella under Provider) — reversing the prior glossary rule that banned it. The signup UI uses the client's 3-tab vocabulary directly: "I'm a Parent / I'm a Caregiver / I'm a Specialist". The word **Provider** remains canonical for the umbrella role; it is the term used in admin UI, system metrics, and any place where the distinction between Caregiver and Specialist is not relevant.

### Parent
The demand side. An adult account holder who books Providers for one or more children. A single Parent account can hold multiple **Child profiles**.

### Child profile
A record under a Parent account representing one child, with age, special-needs flags, and notes. Bookings are made *by* a Parent *for* one or more Child profiles. A Child is not an account holder and never authenticates.

### Verification
The set of checks a Provider must clear before they can be activated and listed in search.

**All Providers (both kinds)** require: email verification, phone verification, government ID upload, and **Checkr standard-package background screening** — county criminal (7-year) + national criminal database + national sex offender registry + SSN trace (see **ADR-0007**). Per-check cost ~$30; charged at **$35** to the Provider at sign-up (small platform margin). This is **marketplace-grade screening, applicable in any US state**. State-level statutory regimes (e.g., Florida's AHCA/DCF Level 2 clearinghouse governing licensed child-care *facility* personnel) do **not** apply to Our Haven's Providers, who operate as independent in-home contractors; marketing copy must not conflate marketplace-grade with statutory state-level screening (UDAP / state consumer-protection exposure). The integration sits behind a **vendor-agnostic background-check interface** so a second vendor — or voluntary statutory uploads where a Provider holds an existing state clearance — can be added by configuration.

**Providers of `kind=Specialist`** additionally require: professional license number, issuing state board, license document upload, and proof of liability insurance — verified manually by admin against the relevant **state professional license register** via the **per-state license-board adapter** (the adapter knows the state's boards by specialty, the public register URL or API, and whether the register is API-callable or human-portal-only). Examples of state-board mappings the adapter populates: CA Board of Behavioral Sciences / CA Board of Psychology / CA Board of Registered Nursing / CA Medical Board / CA Speech-Language Pathology & Audiology Board; FL Department of Health (DOH) MQA boards (SLP & Audiology, Occupational Therapy Practice, Psychology, Behavior Analysis, Medicine, Osteopathic Medicine, Nursing); NY Office of the Professions boards; TX state boards; etc. No third-party verification vendor in v1; license verification is absorbed by the platform via admin manual lookup against the adapter's register pointer. **The per-state adapter slate is populated at launch for the priority Specialist-supply states**; Specialists from states outside the launch slate are accepted at sign-up but route to a "verification pending — your state is not yet supported" holding state until the relevant adapter ships.

> Verification details (Specialist license boards, FCCH-style state childcare licensure pathways) vary by US state. Checkr's standard package is multi-state and does not re-point per state. License-board lookup and the optional state-childcare-licensure pathway are wrapped behind per-state adapters that are exercised at launch.

### CDCTC-eligibility & state childcare licensure (Babysitter / Nanny only)
Parents claiming the federal **Child and Dependent Care Tax Credit (CDCTC)** on **IRS Form 2441**, or using a **Dependent Care Flexible Spending Account (FSA)**, must collect the Provider's TIN/SSN via **IRS Form W-10** (Dependent Care Provider's Identification and Certification). Surfaced as a **"Tax-credit-friendly" badge** on Babysitter and Nanny profiles: a Provider who self-attests they will issue Form W-10 on request gets the badge; Parents can filter by it. **Self-attestation only in v1** — no document upload, no admin verification. The badge is a search-discoverability aid, not a tax-validity guarantee.

Separately, the small minority of Providers who operate as a **state-licensed home-based childcare program** (e.g., Florida DCF Family Child Care Home, California DSS Family Child Care Home, Texas HHSC Registered/Licensed Child-Care Home, NY OCFS Family Day Care, etc.) may upload their state registration certificate as an optional credential. Admin verifies via the per-state childcare-licensure adapter and surfaces a **"State-registered home childcare" badge** (with the specific state agency named on the badge). Most v1 Providers are in-home Nannies/Babysitters and are exempt from state home-childcare licensing thresholds; licensed-home operators are surfaced for the families who specifically want them. Activation is **not** gated on either badge.

### Search & filters (v1)
Single unified search surface across all Provider categories. **v1 filters:** Category, ZIP code + radius (default 5 miles), date/time (intersected with Provider Availability), hourly Rate ceiling, minimum star Rating, Tax-credit-friendly toggle (Babysitter/Nanny only — Form W-10 self-attested), and a per-category specialty field (free-text + small canned set; primarily relevant for Tutor and Specialist). **Specialist-specific filters** unlock when `kind = specialist` (license type, in-person vs telehealth, age range served).

**Ranking** is hybrid: `0.5 × distance_proximity + 0.3 × rating + 0.2 × recency_active_in_last_7_days`. Editorial / featured slots and admin-driven boosting are deferred to post-launch.

**Provider gender** as a filter is **deferred** to post-launch — gender is a protected class under federal Title VII and a range of state civil-rights acts, and exposing it as a primary filter on every profile carries a higher product/legal call than is appropriate for v1. The platform may still surface gender on the Provider's own profile if they choose to disclose, without offering it as a search facet.

### Notifications
Multi-channel transactional notification system — push (Parent mobile via **Expo Push** which wraps FCM on Android + APNs on iOS; Provider mobile companion via the same Expo Push; Provider web portal via VAPID web push, best-effort), email (all surfaces, via SendGrid), SMS (all surfaces, via Twilio). *(Originally Firebase Cloud Messaging; replaced by Expo Push per ADR-0010 — Expo SDK 56 already includes the push runtime, removing the Firebase dependency on mobile.)*

**SMS is reserved for urgent events only**:
- **Booking request received → Provider** (the single most critical notification in the system; if it doesn't reach the Provider quickly, the marketplace stalls). **Mandatory** in v1; no Provider opt-out. Deep-links into the Provider mobile companion's Schedule tab when installed; falls back to web portal otherwise.
- **Job awarded → Provider** (the Provider's Application has been accepted and a Booking is being created — same urgency profile as a Booking request; deep-links into the Schedule tab).
- **Cancellation inside the 24h window → both sides.**
- **Session start reminder → Provider** (1h before).

Push + email (not SMS) covers: **new Application on Parent's Job**, **counter-Offer received** (either side), **Offer expired**, **Job expiring in 48h with no Applications → Parent**, **Job expired with no award → Parent**. In-app notification inbox is **deferred** to post-launch. Marketing messages require a separate opt-in distinct from transactional notifications, surfaced from sign-up.

### Authentication
**Identity provider:** **Supabase Auth**, US-region project (co-located with Supabase Postgres + Realtime + Storage). Per ADR-0010, replacing the originally specified Firebase Auth US identity pool from ADR-0004.

**Account roles.** Each account is permanently one role — **Parent** or **Provider** — chosen at sign-up via the **3-tab role-pick** screen (refined 2026-05-19): *"I'm a Parent / I'm a Caregiver / I'm a Specialist"*. The Caregiver and Specialist tabs both map to `role=provider`; the tab choice sets the Provider's `kind` field (see § Provider). A user who wants both roles maintains two accounts with different emails. A single-account dual-role model is deferred past v1 (see **ADR-0005**).

**Parent (mobile):** Sign in with Apple + Sign in with Google + email/password. Apple is required by App Store rules whenever a third-party social login is offered. **Phone is optional at sign-up** (refined 2026-05-19) — the Parent can complete onboarding with email + password (or SSO) only. Phone is collected and verified at the **Subscription paywall step** (which fires on first attempt to message a Provider, send a Book-request, or post a Job — see § Subscription), to support cancellation SMS + new-device MFA. Pre-paywall Parents have no phone on file; the platform never SMS-pings them.

**Provider (mobile companion):** Sign in with Apple + Sign in with Google + email/password. Same App Store rule applies on mobile — Apple is mandatory when any third-party social login is offered. The mobile companion is an additional surface for the Provider; the web portal remains the system of record for KYC, license uploads, and Payout management. See **ADR-0005** for the mobile / web split.

**Provider (web portal):** Email/password + Sign in with Google. Apple sign-in is not offered on web (no policy mandate). Mobile parity is achieved via the mobile companion above, not via web.

**MFA posture:**
- **Parent:** device-trust model — SMS OTP triggered on new-device sign-in or suspicious-sign-in heuristics; falls back to **email OTP** when the account has no phone on file (i.e., pre-paywall Parents — see § Authentication / Parent (mobile)). Not required on every login.
- **Provider:** SMS OTP on new-device sign-in plus **step-up MFA** for payout-sensitive actions (changing bank details, initiating withdrawals). Payout-sensitive actions remain web-only — the Provider mobile companion links out to the web portal in an in-app browser for these actions (the MFA orchestration is web-side).
- **Admin (Trust & Safety, etc.):** TOTP MFA mandatory on every sign-in.

### Sensitive-data consent (special-needs flags)
Special-needs flags and notes on Child profiles are **sensitive information about a child**. No single US statute imposes a UK-GDPR-Article-9-style "explicit consent" requirement on this data, but **COPPA**-aware best practice, **HIPAA**-adjacent prudence (since these notes can shade into health information), and the **state-privacy patchwork**'s sensitive-data provisions (CCPA/CPRA, VCDPA, CPA, CTDPA, UCPA, FDBR, OCPA, TDPSA, and others) all point to the same UX pattern: a **discrete, explicit Parent-consent step** at sign-up with a timestamp, re-prompt on material privacy policy changes, and full erasure on Parent account deletion or consent withdrawal. This is non-optional — without consent, special-needs flags cannot be stored. The platform deliberately avoids becoming a **HIPAA Business Associate** by *not* requiring Specialists to upload clinical notes through the platform; clinical notes stay in the Specialist's own EHR, and the platform handles only what the Parent chooses to disclose.

**Pre-signup questionnaire (refined 2026-05-19).** During Parent sign-up, a brief multi-choice questionnaire collects neurotypical/neurodivergent + child-age-band + diagnosis hints to tailor the initial browse experience (e.g., surfacing Specialists when the Parent indicates neurodivergent). The questionnaire is **ephemeral**: answers are used only to shape the first browse session and are **not persisted** to any Child profile. The discrete, explicit consent moment described above remains tied to *Child profile creation*, which is a separate intentional step the Parent takes later. This split keeps the COPPA / FDBR / HIPAA-adjacent consent posture intact while letting the questionnaire stay low-friction.

### Privacy counsel
External **US privacy counsel** with **national scope** (boutique privacy firm or larger firm's privacy practice — selected in Phase 0). Required before launch given Our Haven processes children's information, runs systematic message monitoring, and operates across the federal floor + state-privacy patchwork (COPPA, HIPAA-adjacency, FCRA, CCPA/CPRA, VCDPA, CPA, CTDPA, UCPA, FDBR, OCPA, TDPSA, plus other state laws phasing in).

### Privacy Impact Assessment (PIA)
A mandatory pre-launch document covering the multi-state US privacy patchwork. Drafted in collaboration with US privacy counsel, reviewed by Ci'erro's lawyers, signed off before Phase 4 launch. Covers the trigger combination here: sensitive information about children + large-scale message monitoring + sectoral overlap with HIPAA and COPPA + state-privacy-law data-protection-assessment requirements where applicability thresholds are crossed (notably CCPA's risk-assessment provisions, CPA + CTDPA + VCDPA's data-protection-assessment requirements, FDBR's data-protection-assessment requirements). The PIA carries state-specific appendices that the state-privacy-patchwork module surfaces per user residence.

### Data residency
All personal data is processed in **US regions**. Vendor settings (Supabase → US-region project for Auth + Postgres + Realtime + Storage; Fly.io → `iad` Ashburn, VA for the Fastify backend; Vercel → US-region for the Next.js web surfaces; Daily.co → US rooms; Checkr → US by default) are configured at project setup, not after launch. A vendor data-flow inventory is maintained as a Privacy Policy appendix. *(Per ADR-0010, replacing the originally specified Firebase Auth + GCP `us-east1` / `us-east4` + Firestore `nam5` + Cloud Storage + Cloud Tasks stack from ADR-0004.)*

### Retention policy
- **Account data:** 30-day soft-delete grace period after deletion request, then hard-delete.
- **Booking + payment records:** retained **7 years** in pseudonymized form (deleted user → "Deleted user {id}") regardless of account deletion — aligned with IRS recordkeeping recommendations for taxpayer records (7-year retention covers the basic 3-year limit and the 6-year "substantial understatement" window with margin) and the longer civil-claim statute-of-limitations exposure across US states.
- **Message content:** **3 years** post last activity, then hard-delete unless flagged in an active investigation.
- **Background-check raw details:** **6 months** maximum (vendor-recommended; aligned with FCRA disposal-rule best practice for non-needed consumer report information), then hard-delete. The cleared/not status remains on the Provider account.
- **Sensitive data (special-needs flags + notes):** deleted on account deletion **or** on explicit consent withdrawal.
- **State-specific deletion-right SLAs** (e.g., CCPA's 45-day verifiable-consumer-request response window, FDBR's response window) are honored at the API layer via the state-privacy-patchwork module, sitting **on top** of the underlying retention rules above.

### Booking
A scheduled engagement between a Parent and a Provider for one or more Child profiles. **Every Booking traces back to a Job, an Application, and an accepted Offer** (see § Job, § Application, § Offer) — there is no path from Parent to Booking that bypasses these objects, though for Direct-Message Bookings the Job and single Application are materialised lazily at the moment of acceptance and not visible to either party until then (see § Job).

In Phase 1 a Booking is either **hourly** (any Caregiver — Babysitter, Tutor, Nanny) or **per-session** at a fixed price (Specialist). The Booking's price is the **Agreed Rate** from the accepted Offer; the Provider's Published Rate at creation time is also snapshotted onto the Booking for audit purposes but does not drive the math (see § Rate). Live-in / salaried **Nanny contract** arrangements are deferred past Phase 1 — in v1, a Nanny engagement is modeled as a long-running hourly Booking (potentially recurring), not as a separate contract concept.

### Job
A Parent's posted request describing a need for a Provider. The Job is the **canonical anchor object** for every Parent-Provider transaction in v1: every Booking traces back to a Job, an Application, and an accepted Offer (see **ADR-0006**). A Job comes into being one of two ways:

- **Posted Job.** Parent composes a Job (Category, ZIP, scope, free-text description, optional budget hint), publishes it, and Providers in the matching Category and area can apply. This is the Job-board flow.
- **Direct-Message Job.** Parent opens a chat with a specific Provider (from search results or a Provider's profile) and exchanges messages and structured Book-requests (Offers — see § Offer). The Job does **not** exist while the chat is in pre-acceptance state. At the moment one party hits Accept on a Book-request, the system **atomically materialises** a Job + a single Application carrying the accepted Offer + a Booking. The Parent and Provider never see the Job UI for Direct-Message; it is plumbing that unifies the schema (refined 2026-05-19 per client sync — replaces the prior slot-pick model).

**Job states:** `draft → open → (awarded | expired | cancelled) → closed`. Posted Jobs auto-expire 14 days after publishing with no award. Direct-Message Jobs skip `draft` and `open` and are born in `awarded` state at acceptance time, with one Application already filed (the accepted Book-request's Offer).

**Caps in v1:** a Job stops accepting new Applications at **15 Applications** (Parent UX protection). Posting a Job requires an active Subscription (see § Subscription). The Job description is free-text — Parents are warned at compose time that the description is visible to all Providers viewing the Job; structured Child profile attachment happens at Award time, not at Job-compose time (see § Child profile visibility on Job posts).

### Application
A Provider's response to an open Job. Carries the Provider's first Offer (price + scope, see § Offer) and a free-text proposal. One Provider may file at most one Application per Job. Each Application creates a Message thread between the Parent and the applying Provider, anchored to the Job ID; subsequent negotiation (counter-Offers) flows through this thread.

Filing an Application requires the Provider's Verification to be `cleared` (same gate as appearing in search) and consumes one of the Provider's monthly application allowances. The v1 cap is **30 Applications per Provider per calendar month**, reset on the 1st; expected to be re-tuned within 90 days of launch based on observed usage.

**Application states:** `submitted → (countered | awarded | declined | withdrawn | expired)`. `awarded` is set when the Parent accepts the Application's current Offer; this transitions the parent Job to `awarded` and creates a Booking in `requested` state with the Agreed Rate from the accepted Offer (see § Booking, § Booking states).

### Offer
A structured price-and-scope proposal sent inside a Message thread. **Either party can send.** An Offer carries: `proposed_rate`, `scope_type` (hourly | per_session), `scope_quantity` (hours or session count), free-text `scope_note` (≤280 chars), `computed_total` (snapshot of `proposed_rate × scope_quantity` plus the Provider's published per-child surcharge at send time), `valid_until` (default 72h from send), `sender` (parent | provider), and an anchor — either `job_id` (Posted-Job flow and post-acceptance Direct-Message) or `thread_id` (pre-acceptance Direct-Message). The Provider's published per-child surcharge is **baked into `computed_total` at send time** — subsequent changes to the published surcharge do not affect in-flight Offers.

**UI labelling (refined 2026-05-19).** The domain term is **Offer**; the parent-facing button is rendered as **"Book"** or **"Send Booking Request"**, and the Provider-facing acceptance button is **"Accept Booking"** (or **"Counter"** / **"Decline"**). "Offer" remains canonical in code, schema, admin UI, and internal docs. Only the parent-mobile button labels diverge.

An Offer renders in the message thread as an **Offer bubble** with **Accept / Counter / Decline** pill buttons. Accept creates a Booking with `agreed_rate = proposed_rate`. Counter sends a new Offer back (the previous Offer is marked `countered`). Decline closes the Offer without further action. An Offer that is neither actioned nor countered before `valid_until` enters `expired`.

The free-text `scope_note` is **subject to the same Disintermediation detector** that runs on every Message — phone numbers, emails, social handles, and payment app names are redacted before delivery (see § Message). Dollar amounts inside `scope_note` are not flagged. The structured fields (`proposed_rate`, `computed_total`, `scope_quantity`) bypass the detector — they are typed numbers, not free text.

### Availability
A **general weekly summary** published by a Provider on their profile, indicating roughly when they are open to receive Booking requests (refined 2026-05-19 per client sync — per-slot calendars are explicitly **not** in v1; there is no slot-pick flow). Two fields:

- **Structured grid.** A 7-day × 3-band toggle grid (Morning / Afternoon / Evening per day) the Provider sets on their profile. Renders to Parents as a short string (e.g., "Mon–Fri 3–5 PM" or "Weekends, mornings"). The band-to-clock mapping is platform-defined (e.g., Morning = 6 AM–12 PM, Afternoon = 12 PM–6 PM, Evening = 6 PM–10 PM) and not Provider-tunable in v1.
- **Free-text note.** ≤200 chars, surfaced under the grid (e.g., "Flexible weekends, last-minute OK").

Search filtering by date/time intersects with the structured grid only; the free-text is unindexed. There is no slot-blocking mechanism — booking commitments materialise via the Direct-Message → Book-request → Accept flow (see § Job, § Offer), not via picking a slot on a calendar. The Provider can mark themselves **`paused = true`** on their profile to suspend new Book-requests without editing the grid; paused Providers do not appear in search.

### Booking states
A Booking moves through: **requested** (Posted-Job only — Parent has awarded the Application; Provider has 24h to confirm or it auto-declines) → **accepted** | **declined** | **expired** (24h auto-decline, Posted-Job only) → **in-progress** (hourly Bookings only, after session start) → **awaiting-confirmation** (hourly only, Provider proposed final hours, Parent has 24h to dispute) → **completed** | **disputed** | **cancelled**. **Direct-Message Bookings skip `requested`** — they are born in `accepted` state at the moment the recipient hits Accept on a Book-request inside the chat (the recipient's click is the commitment; both parties have committed by then). Per-session Specialist Bookings skip in-progress / awaiting-confirmation and move directly from accepted to completed.

### Session
The actual hours worked during an hourly Booking (Babysitter, Tutor, Nanny). Distinct from the Booking itself: a Booking has a planned duration; a Session has an actual duration. The Provider proposes the Session's final hours at the end; the Parent has 24h to dispute, otherwise it auto-confirms and payment captures. Specialist Bookings have no Session — they're billed on the per-session Rate at booking time.

### Rate
The price for a Booking. v1 distinguishes two related concepts:

- **Published Rate.** The Rate a Provider displays on their profile, set by the Provider. Acts as the **guide price** that Parents see while browsing, and the **default starting value** the Book-request composer pre-fills (refined 2026-05-19 — slot-pick auto-Offer behaviour is removed with slot-pick itself; Published Rate is now a UI default, not an auto-quoted Offer). Drives the Search Rate-ceiling filter. Caregivers publish an hourly Rate; Specialists publish a per-session Rate.
- **Agreed Rate.** The Rate baked into a specific Booking via the accepted Offer (see § Offer). Distinct from Published Rate because v1 pricing is **negotiable** — Parent and Provider may exchange Offers in their Message thread before a Booking is created; the accepted Offer's `proposed_rate` becomes the Agreed Rate and is the input to the Pricing & Commission calculator. The Published Rate is snapshotted onto the Booking at creation time for audit purposes but does not drive the math.

Our Haven does not set or cap Published Rates in Phase 1. **Babysitter** and **Nanny** Published Rates may include an optional **per-child surcharge** — a flat hourly uplift added for each Child beyond the first on a Booking, set on the Provider profile and snapshotted into each Offer's `computed_total` at Offer-send time. **Tutor** and **Specialist** Bookings are **single-child only** (enforced at Booking creation); a Parent who wants two children seen creates two separate Bookings.

### Child profile visibility on Booking requests
At Booking-creation time — **whether from a Posted-Job Award or from a Direct-Message Book-request acceptance** (refined 2026-05-19) — the Provider sees each attached Child's **age** and a marker indicating whether special-needs notes exist, but not the notes themselves. Full Child profile notes unlock for the Provider once the Booking is `accepted`. **Exception:** Providers of `kind=Specialist` see full Child profile notes pre-accept, because clinical fit must be assessed before acceptance; this is consistent with Specialist Bookings being single-child. For Direct-Message Book-requests, the Parent attaches Child profile(s) at Book-request compose time (Offer carries `attached_child_ids` for Parent-sent Offers); the Provider sees the same age + flag-marker preview as a Posted-Job Application carries.

### Child profile visibility on Job posts
Posted Jobs do **not** carry structured Child profile attachments. The Parent describes the need in **free text**; at compose time, the Parent acknowledges a one-time consent warning that the description is visible to every Provider who views the Job. Structured Child profile attachment happens **at Award time** — when the Parent accepts an Application's Offer, the Award flow prompts the Parent to attach the Child profile(s), at which point the existing pre-accept visibility rules in § Child profile visibility on Booking requests apply to the awarded Provider only.

The Parent's free-text disclosure is auditable (the consent acknowledgement is timestamped to the Job record); structured special-needs flags never reach any Provider until they are the awarded Provider and the Booking is being created.

### Message
A communication between a Parent and a Provider inside the app. **Message threads anchor in one of two ways** (relaxed 2026-05-19): a thread is either **anchored to a Job ID** (Posted-Job Applications spawn a thread per Application; Direct-Message threads rebind to `job_id` at acceptance) **or anchored only to a `thread_id`** (pre-acceptance Direct-Message conversations between a Parent and a specific Provider). At Direct-Message acceptance, the thread rebinds from `thread_id` to `job_id` atomically with Job + Application + Booking creation.

Messages are encrypted in transit and at rest, but are accessible to Our Haven's Trust & Safety role for fraud and safety review (disclosed in the Privacy Policy). Every message — including the free-text `scope_note` field on Offers (see § Offer) — passes through **disintermediation detection** — regex-based scanning for phone numbers, email addresses, social handles, payment app names (Venmo, Zelle, Cashapp, PayPal, etc.), and address-like patterns. Detected substrings are **redacted** before delivery; the unredacted original is queued for Trust & Safety review. Detection runs on every message, not only the first. Structured Offer fields (`proposed_rate`, `computed_total`, `scope_quantity`) bypass the detector — they are typed numbers, not free text.

### Video call
An embedded video call between a Parent and a Provider, conducted inside the app via **Daily.co** (US-region rooms). Triggered **ad-hoc** from the chat thread app bar by either party (refined 2026-05-19 — see **ADR-0008**); lives as a *"Join video call"* bubble in the thread for the counterparty until expiry (~30 min). No scheduling flow in v1.

**Audit posture.** The platform logs the **generation** of a call link — timestamp, thread ID, initiator, participants — for Trust & Safety review. The platform does **not** record call content. Privacy Policy disclosure: *"Video calls are conducted via Daily.co. Call content is not stored or monitored by Our Haven; only the timestamp and participants of call invitations are logged."*

Video inherits the **messaging Subscription gate** — a Parent who can reach a chat thread can also initiate a call from it. No separate gate.

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

### Sales tax model (US-national)
Our Haven is a **marketplace agent**, not a deemed supplier — Parents pay Providers for Bookings via Stripe; Providers pay Our Haven a Commission for marketplace services. **Stripe Tax** handles per-state nexus tracking, per-state taxability decisions, and per-state filing prompts. Sales-tax registrations are pursued **as nexus is established** in each state, not preemptively at launch. Sales-tax exposure breaks down as:

1. **Parent Subscription** — Taxability of digital/access subscriptions varies by state. Stripe Tax decides per the subscriber's state of residence and collects where applicable (e.g., TX, PA, WA, others); does not collect where the state treats SaaS-style access as non-taxable.
2. **Commission** — Generally a B2B service to the Provider; taxability varies by state. Stripe Tax handles per-state decisions.
3. **The Booking itself** — Taxability varies wildly by state and category: childcare and personal services to children are generally not subject to sales tax in most US states; private tutoring is mostly exempt; licensed clinical services (SLP, OT, ABA, psychology) are typically exempt as professional medical services in most states. Our Haven does **not** collect sales tax on Bookings — Providers are responsible for any sales-tax exposure on their own services where it applies.

Operationally: **Stripe Tax** is integrated at launch and active across all US states. State sales-tax registrations are filed as Stripe Tax surfaces nexus prompts. **Form 1099-K** issuance to Providers is handled by Stripe Connect automatically; Providers are responsible for their own income-tax filings (federal + state-resident filings).

### Commission
The percentage of every Booking that Our Haven retains. Skimmed from the Provider's Rate via Stripe Connect's application fee — the Parent pays exactly the displayed Rate, the Provider receives Rate × (1 - Commission). The exact percentage is a business decision (target 15–20%) and is not yet set.
_Avoid_: Service fee, take rate, platform fee

### Subscription
A recurring payment held by a **Parent** (not a Provider) that unlocks **full search results (lifts the preview cap), in-app messaging, sending Book-requests, and posting Jobs**. Without an active Subscription a Parent has a free browsing account that can view a gated preview of search results (one to two Providers per category) and read Provider profiles, but cannot message, send Book-requests, or post Jobs. **The gate fires identically on first attempt at any of those three actions** (refined 2026-05-19) — tap Send Message, tap Book, or tap Post-a-Job → web-hosted Stripe checkout → return to app, originally-attempted action completes. Phone collection (see § Authentication / Parent (mobile)) happens in this same paywall step. Sold via Stripe through a web-hosted checkout (not through iOS/Android in-app purchase). Providers do **not** subscribe; Provider-side revenue is the Commission skim on each Booking.
_Avoid_: Membership, plan, premium

### Payout
Funds transferred from Our Haven to a Provider after a completed booking, routed via **Stripe Connect**. Our Haven retains a platform commission on each booking. A Provider must have a connected Stripe account before they can receive Payouts.
_Avoid_: Disbursement, transfer, settlement

## Flagged ambiguities

- **Provider taxonomy (resolved 2026-05-08, refined 2026-05-19).** The original project plan used "caregiver" as the umbrella and "providers" as a peer to babysitter/tutor/nanny. The 2026-05-08 resolution made **Provider** the umbrella account role with a flat four-category enum (Babysitter / Tutor / Nanny / Specialist) and banned "caregiver" as a domain term. The 2026-05-19 client sync refined this into a two-level hierarchy: **Caregiver** is a canonical sub-umbrella (Provider `kind`) covering Babysitter / Tutor / Nanny; **Specialist** is the peer sub-umbrella with a `specialty` field. Schema: `(role=provider, kind, [caregiver_category|specialty])`. The "caregiver" word ban is **lifted**. See the updated Provider, Verification, Search & filters, Booking, and Child profile visibility entries above. An ADR will follow once the rest of the May-19 grilling resolves.
- **Parent onboarding sequence (resolved 2026-05-19).** New Parent flow: (1) 3-tab role-pick — "I'm a Parent / I'm a Caregiver / I'm a Specialist"; (2) ephemeral preview-shaping questionnaire (neurotypical/neurodivergent, child age, diagnosis hints — *not persisted*; see § Sensitive-data consent / pre-signup questionnaire); (3) account creation via email + password or Apple/Google SSO — **phone optional at this step**; (4) free browse with gated preview (one–two Providers visible per category); (5) **Subscription paywall fires on first attempt to send a Message, send a Book-request, or post a Job** — same gate for all three actions, routed through web-hosted Stripe checkout. Phone collection + verification happens in the paywall step (for cancellation SMS + new-device MFA — see § Authentication). Pre-paywall Parents get email-OTP MFA only. See updated § Authentication, § Subscription, § Sensitive-data consent entries above.
- **Video calls — Daily.co embedded, ad-hoc, either party (resolved 2026-05-19, see ADR-0008).** The 2026-05-19 client sync briefly mentioned "Zoom or Google Meet" as the v1 video provider — a regression against the existing JD-side commitment to **Daily.co embedded video** (already plumbed in PRD-0001 § External services, `CONTEXT.md` § Data residency, DESIGN.md §5.4.5). Resolution: Daily.co stays. The prior "scheduled pre-booking interview" UX is replaced with **ad-hoc, in-chat, either-party-initiated** calls; DESIGN.md §5.4.4 / §5.5.2 rewritten accordingly. Audit logs call-link generation only — no content recording. See § Video call and ADR-0008.
- **Slot-pick deprecation + Direct-Message Job materialisation (resolved 2026-05-19).** The original v1 design had two Booking entry paths: posted Jobs and **slot-pick** (Parent picks a slot on a Provider's per-slot calendar; the system auto-creates a Job + Application carrying the Provider's Published Rate). The 2026-05-19 client sync killed slot-pick — Provider profiles now display a general weekly availability grid + free-text note (see § Availability), not a per-slot calendar. The replacement entry path is **Direct-Message**: Parent and Provider chat freely with pre-Job threads (the Message invariant is relaxed accordingly — see § Message); either party sends a structured Book-request (the parent-facing label for an Offer — see § Offer); the recipient hits Accept; the system materialises Job + Application + Booking **atomically** in one transaction. The Booking is born in `accepted` state (no `requested` interim — see § Booking states), the Job is born in `awarded` state (skips `draft`/`open` — see § Job), and the thread rebinds from `thread_id` to `job_id` at acceptance. Posted-Job flow is unchanged. **ADR-0006 needs revision** to remove the slot-pick path and document the lazy-materialisation pattern. **PRD-0001 stories** tied to slot-pick need rewriting; the Provider Schedule tab simplifies (no pending-slot queue — the "pending" surface lives in Messages as incoming Book-requests).
- **Launch jurisdiction pivot — second revision (resolved 2026-05-26).** The 2026-05-08 discovery landed on the United Kingdom as the launch base; on 2026-05-11 Ci'erro pivoted to **Miami, Florida** with Florida statewide compliance and Phase-2 US-expansion intent (ADR-0003); on 2026-05-26 the launch posture pivoted again to **US-national from day one** (ADR-0009 supersedes ADR-0003) — no soft-launch metro, no single-state geofence, per-state compliance adapters (background-check, license-board lookup, sales-tax taxability, classification addenda) are **core v1 deliverables, not Phase 2**. Federal compliance design (COPPA, HIPAA-adjacent, FCRA, IRS, Title VII, CAN-SPAM, TCPA) and vendor choices (Checkr, Stripe Connect Express US, Stripe Tax, Daily.co US rooms, GCP US-regions, Firebase Auth US identity pool) carry over from ADR-0003 unchanged. FL-board-eccentric specifics in the glossary above (Specialist verification boards, FCCH licensure) have been genericized to per-state adapter framing. See **ADR-0009** for the full rationale.
- **Model evolution: Provider mobile companion + Job-board + negotiable pricing (2026-05-18).** The original v1 design (per PRD-0001 and ADR-0002) had Providers exclusively on the web portal, Bookings created exclusively via slot-pick from Provider Availability, and Rates set unilaterally by Providers. On 2026-05-18 the model was extended:
  1. Providers now also have a **mobile companion app** (same Flutter binary, role-based shells, role chosen at sign-up). Web portal remains the system of record for KYC, license uploads, and Payout management.
  2. Parents can **post Jobs**; Providers in the matching Category and area can **apply**.
  3. Pricing is **negotiable** via a new **Offer** object — a structured price-and-scope proposal that travels in the Message thread with Accept / Counter / Decline buttons.
  4. Every transaction (slot-pick or posted Job) traces back to a canonical **Job → Application → Offer → Booking** chain. Slot-pick auto-creates a Job under the hood.

  See **ADR-0005** (Provider mobile companion supersedes ADR-0002) and **ADR-0006** (Job-posting model + negotiable pricing). PRD-0001 stories 23–34, 40, 48, 50–54 are partially superseded by these ADRs; the PRD will need a v1.1 revision before scope-lock.
