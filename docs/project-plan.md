# Project Plan

**Client:** Ci'erro Kennedy
**Prepared by:** JD, The Codefoundry
**Date:** 5 de mayo de 2026
**Last revised:** 2026-05-26 (v1.3 — **US-national launch pivot per ADR-0009**: Miami soft-launch concentration dropped, Florida geofence dropped, per-state compliance adapters promoted from Phase-2-add to core v1 (license boards, sales-tax taxability, classification addenda), Phase 0 + Phase 4 activities rewritten accordingly. Mobile stack switches from **Flutter to React Native + Expo**. Phase 2 timeline absorbs the priority-state license-adapter slate work; phase totals re-baseline at Phase 1. Prior revisions 2026-05-19 (v1.2 — Caregiver/Specialist taxonomy, slot-pick removal, Daily.co ad-hoc video), 2026-05-18 (v1.1), 2026-05-11 (v1.0a).)

---

## Project Overview

- A two-sided marketplace mobile app connecting parents with vetted Providers — Babysitters, Tutors, Nannies, and Specialists (speech, ABA, occupational therapy, and other licensed clinical services)
- Inclusive offering for families with neurodivergent and neurotypical children
- Phase 1 categories: **Babysitter, Tutor, Nanny, Specialist**
- **A single React Native + Expo mobile app serves both Parents and Providers** in role-aware shells; role is chosen at sign-up and is permanent per account (per ADR-0005, supersedes ADR-0002). **Web portal remains the system of record** for heavy Provider onboarding (Stripe Connect KYC, license uploads) and Payout management; the mobile companion handles all run-the-day Provider tasks (accept/decline Bookings, manage Availability, apply to Jobs, message, mark in-progress, propose hours) and links out to web for the rest. **Admin dashboard** stays web-only for the Our Haven team.
- **Provider taxonomy (refined v1.2):** Provider is the umbrella account role. Sub-umbrellas: **Caregiver** (`kind=caregiver`, with `caregiver_category` in Babysitter / Tutor / Nanny) and **Specialist** (`kind=specialist`, with `specialty` in SLP / ABA / OT / Psychology / etc.). Sign-up uses a 3-tab role-pick — "I'm a Parent / I'm a Caregiver / I'm a Specialist".
- **Dual transaction model (refined v1.2):** Parents can **post a Job** describing what they need and let Providers apply, OR Parents can **open a Direct-Message chat** with a specific Provider and negotiate via free-text + structured **Book-requests** (the parent-facing UI label for an Offer). The earlier slot-pick (per-slot calendar) entry path is **removed** — Provider profiles now show only a general weekly availability summary (Day × Morning/Afternoon/Evening grid + free-text note). Every transaction still traces back to a canonical **Job → Application → Offer → Booking** chain; for Direct-Message, the chain is materialised **lazily** the moment a Book-request is accepted. **Pricing is negotiable** — either party can send a Book-request/Offer inside the message thread with Accept / Counter / Decline pill buttons. Posted-Job Bookings start in `requested` (Provider has 24h to confirm); Direct-Message Bookings start in `accepted` (the accepting click is the commitment). See revised ADR-0006.
- Built on React Native + Expo so a public web app for Parents can be added later from the same codebase via React Native Web
- **Launch jurisdiction: US-national from day one** (per ADR-0009 — supersedes the prior Miami/Florida soft-launch posture from ADR-0003). No soft-launch metro, no single-state geofence. Currency USD; English only. Compliance design rests on a **federal floor** (COPPA + HIPAA-adjacent + FCRA + IRS common-law test + Title VII + CAN-SPAM + TCPA + Form W-10 / Form 1099-K) plus a **state-privacy patchwork module** (CCPA/CPRA + VCDPA + CPA + CTDPA + UCPA + FDBR + OCPA + TDPSA + other state laws phasing in) and **per-state compliance adapters** (background-check, license-board lookup, sales-tax via Stripe Tax, classification-addendum surfacing) that are **core v1 deliverables, not Phase 2**. See ADR-0009.

---

## Project Phases

### Phase 0 — Discovery & Design Directions (Week 1)

- **Demo:** Discovery document and design direction options
- **Deliverable:** Loom video walkthrough of the discovery document and 2-3 design direction concepts (mood boards, color application, typography samples, sample screen styles)
- **Sign-off:** Ci'erro reviews and picks a direction in writing before Phase 1 begins

**Activities:**

- Lock final feature list (now includes Job-board + negotiable pricing + Provider mobile companion per ADR-0005 and ADR-0006; **US-national launch posture** per ADR-0009)
- **(v1.3) Confirm US-national launch from day one** per ADR-0009 — no soft-launch metro, no single-state geofence. Replaces the prior Miami/Florida confirmation.
- **(v1.3) Confirm the priority Specialist-supply state slate** for the per-state license-board adapter at launch. Working proposal: **CA, FL, TX, NY, IL, GA, NC, PA, OH, AZ, WA, MA** (12 states ≈ ~60% of US population). Specialists from states outside the slate are accepted at sign-up but route to "verification pending — your state is not yet supported" until that state's adapter ships.
- **(v1.3) Confirm marketing-spend posture at launch** — uniform across 50 states, or weighted toward priority metros (NYC / LA / Chicago / Houston / Phoenix / Philadelphia / Miami / etc.). Affects Phase 4 marketing-asset budget and PR plan.
- **Confirm background-check vendor** (working assumption: **Checkr**, **standard package** — county criminal 7-year + national criminal database + national sex offender registry + SSN trace; ~$30/check, charged at $35 to the Provider; per ADR-0007. Multi-state coverage out of the box. JD to ask Checkr about startup-discount pricing — the $35 published price holds regardless.)
- Confirm embedded video provider (working assumption: Daily.co — US rooms)
- **Confirm Stripe Connect Express (US entity)** as the account type (commission-skim marketplace model; Form 1099-K reporting handled by Stripe; **Stripe Tax** enabled across all US states with nexus-tracking on)
- **Confirm US privacy counsel** (boutique privacy firm or larger firm's privacy practice with **national scope** — counsel must cover the federal floor + state-privacy patchwork) — engagement scope includes the Job-compose consent text (new disclosure surface for child information), the multi-state PIA, and the per-state classification addendum pattern for AB5/ABC-test states.
- **(v1.3) Confirm state sales-tax registration sequencing** — Stripe Tax monitors per-state nexus; pre-register in priority states, or register reactively as Stripe flags nexus thresholds? Replaces the prior Florida-DOR-specific call.
- **(v1.1)** Confirm v1 caps for the Job-board: **15 Applications per Job** and **30 Applications per Provider per calendar month** as launch defaults, re-tunable at 90 days post-launch
- **(v1.1)** Confirm App Store / Play Store posture: **single store listing** (one binary, two roles, consumer-marketplace listing copy) vs. two separate listings
- **(v1.1)** Confirm Subscription-gate posture on Job posting: hard wall (current ADR-0006 decision) vs. soft wall (first Job free, subsequent require Subscription)
- Brand assets handoff from Ci'erro's marketing person
- Draft 2-3 distinct design directions

---

### Phase 1 — Figma Prototype & Project Plan (Week 2)

- **Demo:** Clickable Figma prototype of the full app and detailed project plan with weekly timelines
- **Deliverable:** Zoom call walkthrough of the Figma prototype where Ci'erro can click through every screen, plus the detailed project plan document with week-by-week milestones, demo dates, and final fixed-price quote

**Activities:**

- Build full Figma prototype based on chosen design direction
- Map every screen for **Provider web portal**, **Parent mobile shell** (Home / Bookings / Messages / Account), **Provider mobile companion shell** (Opportunities / Schedule / Messages / Account per ADR-0005), and **admin dashboard**. The mobile prototype includes both the **Direct-Message flow** (Provider profile → Message CTA → chat → Book-request composer → Accept → atomic Job+Application+Booking materialisation) *(v1.2 — replaces the prior slot-pick flow)* and the **Job-board flow** (Parent compose + Provider Opportunities feed + Application composer + Offer composer + Offer bubbles in messaging) per revised ADR-0006
- Finalize project plan with hard dates
- Deliver final fixed-price quote based on what is actually being built

---

### Phase 2 — Provider Web Portal & Backend Foundation (Weeks 3–8)

> **Timeline grown from 5 → 6 weeks (v1.1)** to absorb four new deep modules (Job lifecycle / Application lifecycle / Offer / Application-quota tracker per ADR-0006), schema for Job / Application / Offer / quota-counter, the slot-pick auto-Job plumbing, the Pricing calculator input change (`published_rate` → `agreed_rate`), and the Disintermediation detector extension to Offer `scope_note`.

- **Demo:** Working Provider sign-up flow on staging + Job lifecycle reachable via API
- **Deliverable:** Zoom call walkthrough where Ci'erro creates a test Provider account, uploads documents, completes a real Checkr standard-package background screening, and reviews the admin dashboard; plus a brief API walkthrough showing a posted Job → Application → Offer-accept → Booking-created chain end-to-end on the backend AND a Direct-Message Book-request-accept → atomic Job+Application+Booking materialisation

**Activities:**

- Provider sign-up flow on the web portal with **category-aware document set** (Babysitter / Tutor / Nanny / Specialist)
- Provider Verification: email verification, phone verification, government ID upload, **Checkr standard-package background screening** (county criminal 7-year + national criminal database + national sex offender registry + SSN trace), per-check cost ~$30, charged at **$35** to the Provider at sign-up with a small platform margin. This is marketplace-grade screening (see ADR-0007 for the marketing-honesty constraint against conflating with statutory state-level regimes). Background-check integration is wrapped behind a **vendor-agnostic adapter** so a second vendor — or voluntary statutory uploads where a Provider holds an existing state clearance — can slot in by configuration
- **(v1.3) Specialist additional verification: per-state license-board adapter slate.** Professional license number + issuing **state board** (auto-selected per the Specialist's resident state from the adapter slate) + license document upload + liability insurance certificate — verified manually by admin against the **state public license register** that the adapter resolves to (e.g., CA Board of Behavioral Sciences, CA Board of Psychology, CA Speech-Language Pathology & Audiology Board, CA Medical Board, CA Board of Registered Nursing; FL DOH MQA portal for SLP/OT/Psychology/Behavior Analysis/Medicine/Osteopathic Medicine/Nursing boards; NY Office of the Professions; TX state boards; IL DFPR; etc.). **Launch slate covers ~12 priority states per the Phase 0 confirmation**; Specialists from states outside the slate route to a "verification pending — your state is not yet supported" holding state. No third-party verification vendor in v1.
- **Babysitter / Nanny tax-credit badge:** self-attestation toggle for issuing IRS Form W-10 → "Tax-credit-friendly" badge surfaced on profile. Optional: **state-licensed home-based childcare program** registration upload (e.g., FL DCF Family Child Care Home, CA DSS Family Child Care Home, TX HHSC Registered/Licensed Child-Care Home, NY OCFS Family Day Care, etc.) → admin verification via the per-state childcare-licensure adapter → **"State-registered home childcare" badge** with the specific state agency named
- Profile builder, including **Published Rate** setting (hourly + optional per-child surcharge for Babysitter/Nanny; per-session for Specialist), Availability calendar, certifications upload
- Stripe Connect Express (US entity) onboarding for Providers; Form 1099-K issuance handled automatically by Stripe
- **Stripe Tax integration** for Subscription and Commission sales-tax computation — active across all US states at launch with nexus-tracking on; sales-tax registrations pursued reactively as Stripe Tax surfaces nexus prompts (or pre-emptively in priority states per the Phase 0 confirmation). Bookings are not taxed by Our Haven; Providers are responsible for any sales-tax exposure on their own services.
- Admin dashboard v1: Provider review queue (background-check results, license verification for Specialists, FCCH certificate verification, approve/reject), basic metrics (sign-ups, active Subscriptions, cancellations, Bookings, **Jobs posted, Applications filed, Award rate**)
- Trust & Safety admin role with audit-logged thread access (flagged-thread queue + on-demand investigation access). Flagged-thread queue surfaces both Messages and Offers whose `scope_note` tripped disintermediation
- Authentication (Supabase Auth, US-region project, per ADR-0010 supersedes Firebase Auth from ADR-0004): email/password + Sign in with Google for Provider web portal; admin TOTP MFA mandatory; Provider step-up MFA on payout-sensitive actions
- Provider-side notification plumbing: web push + email (Resend) + SMS (Twilio) for Booking-request, **Job-awarded**, cancellation, and session-reminder events
- **(v1.1) Four new deep modules (per ADR-0006):**
  - **Job lifecycle state machine** (`draft → open → awarded | expired | cancelled → closed`; 14-day auto-expiry; awarded-side-effects)
  - **Application lifecycle state machine** (`submitted → countered | awarded | declined | withdrawn | expired`; per-Job cap at 15)
  - **Offer state machine** (`pending → accepted | countered | declined | expired`; 72h `valid_until` default; on-accept creates Booking with `agreed_rate = proposed_rate`)
  - **Application-quota tracker** (per-Provider monthly cap, default 30, with monthly reset job + admin override path)
- **(v1.1) Existing modules touched:**
  - **Pricing & Commission calculator** — input source flips from `published_rate` to `agreed_rate` (arithmetic unchanged; existing tests amended)
  - **Disintermediation detector** — now also invoked on every Offer's `scope_note` field at submit time
  - **Availability summary** — *(v1.2)* the prior per-slot calendar module is removed; replaced by a small pure module operating on the Provider's 7-day × 3-band Morning/Afternoon/Evening grid + free-text note + paused flag. Render-to-string + intersect-with-search-query + is-paused. No slot CRUD, no block-on-request semantics
- **Schema additions:** Job (Parent FK, Category, scope description, structured logistics, optional budget hint, state, consent-ack timestamp, posted-at, expires-at, awarded-Application FK, `entry_path` enum: `posted` | `direct_message` — *v1.2: replaces the prior `is_auto` boolean*), Application (Job FK, Provider FK, optional free-text proposal — null for Direct-Message, current-Offer FK, state, filed-at), Offer (sender, `proposed_rate`, `scope_type`, `scope_quantity`, optional `scope_note`, optional `attached_child_ids` for Parent-sent Offers — *v1.2*, `computed_total`, `per_child_surcharge_snapshot`, `valid_until`, state, supersedes-Offer FK, sent-at, **anchor: either `job_id` or `thread_id`** — *v1.2: thread-anchored Offers exist pre-acceptance in Direct-Message threads*), Application-quota counter (Provider FK, year-month, count). Booking schema gains `agreed_rate`, `published_rate_snapshot`, and `job_id` columns. Provider schema gains `kind` (caregiver | specialist), `caregiver_category` (nullable, only for kind=caregiver), `specialty` (nullable, only for kind=specialist), `availability_grid` (7×3 boolean matrix), `availability_note` (≤200 char), `paused` boolean

---

### Phase 3a — Parent Mobile App + Parent Job-board surfaces (Weeks 9–13)

> **Timeline grown from 4 → 5 weeks (v1.1)** to absorb the Parent-side Job-board surfaces (Post-a-Job composer, My Jobs list, Job detail with Applications list, Award flow, Edit/Close Job), the new Offer bubble component, the Offer composer sheet, the dual-entry Home tile ("Browse Providers" vs "Post a Job"), and the Subscription-gate extension for Job posting. The role-fork sign-up question is delivered here (the Provider shell ships in Phase 3b).

- **Demo:** End-to-end Parent journey on TestFlight — Direct-Message *and* Job-post paths both working
- **Deliverable:** TestFlight (iOS) and Google Play Internal Testing (Android) builds installed on Ci'erro's phone (if no developer accounts yet, will send an APK) plus Loom video walkthrough showing Parent sign-up (3-tab role-pick + ephemeral questionnaire) → search → preview → message a Provider → paywall + subscribe → exchange Book-request → Provider accepts → Booking materialised in `accepted` AND separately: post a Job → review Applications → counter an Offer → award → Booking created in `requested`

**Activities:**

- Flutter app build — **single binary with role-aware shells** (Parent shell shipped this phase; Provider shell shipped in Phase 3b)
- **Role-pick at sign-up** — first screen after Welcome routes new users to a "Are you a Parent or a Provider?" pill-card chooser; account role is permanent per ADR-0005
- Parent account with multiple Child profiles (one Parent account holds all Children — each Child has their own profile with age, special-needs flags, and notes)
- **Sensitive-information explicit consent flow** at sign-up for processing special-needs flags / notes (COPPA-aware + HIPAA-adjacent + FDBR-aligned; timestamped, re-prompt on material privacy-policy changes, full erasure on consent withdrawal)
- Authentication (Supabase Auth, US-region project, per ADR-0010): Sign in with Apple + Sign in with Google + email/password; phone verified once at sign-up; device-trust SMS OTP only on new-device or suspicious sign-in
- Parent verification at sign-up (email + phone) and **payment method capture with cardholder-name soft-signal fraud check** (mismatch flags the account for additional review on early Bookings; does not hard-block)
- Location-based search with v1 filters: Category, ZIP code + radius (default 5 miles), date/time intersected with Provider Availability, hourly Rate ceiling (operates on **Published Rate**), minimum star Rating, Tax-credit-friendly toggle (Babysitter/Nanny only — Form W-10 self-attested), per-category specialty
- Hybrid ranking: `0.5 × distance + 0.3 × rating + 0.2 × recency-active`
- Preview gating (1–2 Providers visible without Subscription)
- **Parent Subscription** billed only on web (Stripe-hosted page) — not via iOS/Android in-app purchase. **(v1.1)** Subscription unlocks search + messaging + booking + **Job posting**. Discount codes via Stripe Promotion Codes apply to Subscription only
- Standard encrypted messaging (in transit and at rest) with regex-based **disintermediation detection** (phone numbers, email addresses, social handles, payment app names, address-like patterns) → matched substrings **redacted** in delivered message; unredacted original queued for Trust & Safety review. Disclosed in Privacy Policy. **(v1.2)** Threads anchor either to a `job_id` (Posted-Job Applications + post-acceptance Direct-Message threads) or to a `thread_id` only (pre-acceptance Direct-Message threads); the Job-context strip pins at top when present, with a lighter "No active Job — send a Book-request to start one" strip otherwise (DESIGN.md §5.5.2)
- **(v1.1) Offer bubble + Offer composer in messaging.** Inline structured Offers with Accept / Counter / Decline pill buttons. Either party can send. Composer sheet captures `proposed_rate`, `scope_quantity`, optional `scope_note`, `valid_until` (default 72h). Per-child surcharge from the Provider's profile is snapshotted at send time
- Booking lifecycle (**refined v1.2**): **read-only Availability summary** on Provider profiles (Day × Morning/Afternoon/Evening grid + free-text note — no per-slot calendar, no tap-to-book); **Direct-Message Book-request flow** (Parent opens chat → sends Book-request with Child attachment + scope + rate → Provider Accepts → Booking materialised in `accepted` state atomically with Job + Application creation); **Posted-Job Award flow** (Parent awards Application → Booking in `requested` state → Provider has 24h to confirm → `accepted`); **single-child constraint for Tutor/Specialist** (multi-child supported for Babysitter/Nanny with optional per-child surcharge)
- **Parent Job-board surfaces (refined v1.2):**
  - **Home redesigned** — 4 category tiles (Babysitter / Tutor / Nanny / Specialist) as the primary discovery surface; a full-width "Post a Job" pill button directly below the grid; the prior "Browse Providers" / "Post a Job" dual-entry section is removed. See DESIGN.md §5.3.1
  - **Post-a-Job composer** — multi-step (Category + scope, Description with one-time consent warning + acknowledgement, Logistics + ZIP/radius/date-window/optional budget hint, Review + Publish). Drafts saved on every step. The Subscription paywall fires on Publish if the Parent is unsubscribed (same gate as Message and Book actions)
  - **My Jobs list** — Open / Awarded / Past / Drafts tabs
  - **Job detail (Parent view)** — info banner, Applications list (Application cards with status pills), sort selector, Edit/Close actions
  - **Application detail (Parent view)** — Provider profile, full proposal text, live Offer card (Accept / Counter / Decline), tabs (About / Availability / Reviews)
  - **Award flow** — attach Child profile(s), confirm payment, review, "Award & create Booking" → routes to Booking detail in `requested` state
- **(v1.2) Parent Direct-Message surfaces:**
  - **Provider profile "Message" CTA** (replaces "Book a slot") — opens a Direct-Message thread anchored to `thread_id`
  - **Book-request composer** (a sheet from the chat thread composer) — captures `proposed_rate` + `scope_type` + `scope_quantity` + optional `scope_note` + `valid_until` + `attached_child_ids`; renders as an Offer bubble in the thread
  - **Pre-Job thread Job-context strip** — lighter strip reading "No active Job — send a Book-request to start one"; flips to the full Job strip on materialisation
- Payments: **authorize at booking, capture at session end** for hourly Bookings; capture at booking time for per-session Specialist Bookings. Stripe Connect `application_fee_amount` skims platform Commission from the Booking's **Agreed Rate** (per ADR-0006 — was previously the Provider's Published Rate). **3DS is supported but not mandatory** — applied opportunistically by Stripe for fraud reduction on high-risk transactions (no PSD2-style universal SCA requirement in the US)
- **Session confirmation flow:** Provider proposes final hours; Parent has 24h to dispute, otherwise auto-confirms and Payout releases
- **Cancellation policy** (single platform-wide rule for v1): free ≥24h before start, 50% inside 24h, 100% inside 2h or after start. Refund math operates on the Booking's `agreed_rate`. Free Provider-initiated cancellation but tracked
- **No-show flows** (Provider no-show → Parent full refund + admin flag; Parent no-show → Provider receives 50% of estimated total if uncontested)
- **Dispute** flow with 7-day post-completion window (in-app, not email-the-team)
- **Two-way Ratings** (1–5 stars + optional text) with 14-day window post-completion, **mutual blind reveal** (Airbnb-style), asymmetric display (Provider Ratings public with text; Parent Ratings visible only to Providers, aggregate-only, no text)
- All Providers start fresh — no review imports from other platforms
- App-feedback collection from Parents after first Booking (incentive structure to be confirmed by Ci'erro)
- **Embedded video** (Daily.co, US rooms) — **ad-hoc, in-chat, either-party-initiated** per ADR-0008 (v1.2 — replaces the prior "scheduled interview" UX). 44pt video icon in the chat thread app bar; tapping it generates a Daily.co room, posts a "Join video call" bubble to the counterparty, valid ~30 min. Audit logs link generation only — no content recording
- Parent notifications matrix:
  - Push + email for Booking accepted/declined/expired, new message, session start reminder, awaiting-confirmation notice, **new Application on Parent's Job**, **counter-Offer received**, **Offer expired**, **Job expiring in 48h with no Applications**, **Job expired with no award**
  - Push + email + SMS for cancellations inside the 24h window
  - Marketing/promotional messages require a separate explicit opt-in distinct from transactional
- **Promotions:** discount codes only (Stripe Promotion Codes wrapper, applies to Subscription). Referral system and targeted/cohort promotions are deferred to post-launch and quoted separately

---

### Phase 3b — Provider Mobile Companion (Weeks 14–17)

> **New phase introduced in v1.1** per ADR-0005. Ships the Provider role's mobile shell as the second consumer of the same Flutter binary built in Phase 3a. Reuses Phase 3a components heavily (Offer bubble, Job card, Application card, Status pills, Message bubble, Avatar, Bottom navigation, OTP, ID-capture). Adds Provider-specific surfaces: role-aware sign-up branch, Opportunities feed, Schedule with Active-session controls, Provider Account with mobile-native Profile/Rate editing and read-only Payouts, mobile-native Application composer, and the linkout-to-web pattern for Stripe Connect KYC / license uploads / withdraw / bank-detail changes.

- **Demo:** End-to-end Provider journey on TestFlight — Provider signs up on mobile, finishes KYC via in-app browser, browses Opportunities, files an Application, exchanges Offers, accepts a Booking, runs an Active session
- **Deliverable:** TestFlight (iOS) and Google Play Internal Testing (Android) builds — Provider role tested separately from Phase 3a's Parent role. Loom video walkthrough showing Provider mobile sign-up → role-pick → onboarding (with web linkouts) → Opportunities feed → file Application → counter an Offer → accept Award → mark Session in-progress → propose final hours → see Payout in read-only summary

**Activities:**

- **Provider role sign-up flow on mobile** — Apple + Google + email/password (App Store rules require Apple when any social auth is offered). Reuses the role-pick screen shipped in Phase 3a
- **Provider mobile onboarding stack** — Choose Category, Profile basics, Set Published Rate + per-child surcharge, Government ID upload (mobile camera, mobile-native), **Checkr standard-package background screening initiation** (Checkr's mobile-friendly hosted flow in WebView), Specialist license-number form with state-board selector driven by the per-state adapter slate (mobile-native), **Specialist license document + insurance certificate upload — linkout to web portal**, Tax-credit self-attestation, **state home-childcare registration upload — linkout to web**, **Stripe Connect Express KYC — linkout to web** (Stripe's hosted flow in in-app browser), publish Availability (in-app)
- **Provider mobile shell — bottom nav** Opportunities / Schedule / Messages / Account
- **Opportunities tab:**
  - Open Jobs feed (ranking: recency + distance + category fit; Specialists filtered to sub-category)
  - My Applications tab (date-grouped; action-required Applications float to top)
  - Monthly quota subheader ("{N}/30 applications used this month")
  - **Job detail (Provider view)** — read-only Job info, Parent context card, Apply CTA with gate-reason copy when disabled
  - **Application composer (Provider)** — free-text proposal + first Offer composer (same component as Phase 3a Offer composer)
  - **Application detail (Provider view)** — live Offer card with edit/withdraw, message Parent
  - **Job filter sheet** — distance, recency, Specialist focus
- **Schedule tab:**
  - Today view with sticky Active-session banner (elapsed timer, end-session CTA)
  - Pending action section (**v1.2 simplified — slot-pick is removed**): incoming Book-requests in chat threads (rendered as Offer bubbles in Messages, surfaced here as a count badge that deep-links to the relevant thread); awarded posted-Job Bookings in `requested` state needing the Provider's 24h confirmation; propose-hours items; counter-Offers awaiting the Provider
  - Today's confirmed Bookings
  - Upcoming view (date-grouped, beyond today)
  - **Availability editor (v1.2 — rewritten)**: 7-day × 3-band toggle grid (Morning / Afternoon / Evening) + free-text note input (≤200 chars) + a "Paused" switch at the top. No date pills, no time-slot grid. Published Rate chip at top with "Edit" link to Rate management. Saves directly to the Provider's profile (the same summary rendered on the Parent-side profile per DESIGN.md §5.4.2)
  - **Active session controls** — Mark in-progress (transitions Booking to `in-progress`), End session + Propose hours (transitions to `awaiting-confirmation`; Parent has 24h to dispute)
- **Messages tab** — identical surface to Parent messaging (Inbox + Thread + Offer composer); shared **Supabase Realtime** row-level subscription infrastructure (per ADR-0010, supersedes the originally specified Firestore listener fan-out)
- **Account tab:**
  - Profile (photo via mobile camera, bio, languages, specialties) — mobile-native
  - Published Rate + per-child surcharge — mobile-native
  - Availability shortcut → Schedule.Availability
  - **Verification documents** — opens linkout-to-web for license/insurance/FCCH uploads
  - **Bank details & withdrawals (Stripe)** — opens linkout-to-web
  - **Payouts** — read-only summary list on mobile; withdraw routes to web
  - Notifications preferences, Privacy & data (mirrors Parent Privacy), Help & support, Terms & policies, Sign out
- **Mobile linkout-to-web pattern** — confirmation card before each linkout explaining *why* the action lives on web; opens `ASWebAuthenticationSession` (iOS) / Custom Tabs (Android) with a signed handoff token; backend poll updates the originating row's status badge on return
- **Push notification setup (Expo Push, which wraps FCM/APNs)** for Provider mobile — including SMS deep-link target priority shift (mobile companion is primary deep-link destination for Booking-request and Job-awarded SMS; web portal is fallback). Per ADR-0010, replacing the originally specified standalone FCM integration.
- Provider notifications matrix (mobile-side):
  - Push + email + **SMS** for new Booking request (mandatory; no v1 opt-out) — deep-links into Schedule tab
  - Push + email + **SMS** for **Job-awarded** (mandatory) — deep-links into Schedule tab
  - Push + email for new Application status changes (Parent countered, Parent awarded competing Application, Application expired)
  - SMS for session start reminder (1h before)
  - Email for Payout received, background-check status, Verification approved
  - Marketing/promotional opt-in surfaced from sign-up

---

### Phase 4 — Testing, App Store Submission & Soft Launch (Weeks 18–19)

- **Demo:** Apps live in App Store and Play Store
- **Deliverable:** App deployed and live in the Apple App Store and Google Play Store, plus a Zoom call kickoff with Ci'erro to walk through the live production environment, admin dashboard access, and known issues log

**Activities:**

- QA testing across iOS and Android **for both roles** (Parent and Provider). Internal release-management must include test accounts for both roles in every App Store review submission, per ADR-0005
- Bug fixes
- App Store submission (1–7 day review window). Listing copy positions as consumer-marketplace (DoorDash / Lyft / Airbnb pattern — well-trodden review path) per ADR-0005
- Play Store submission
- Marketing assets for store listings (single binary, single listing per store per ADR-0005)
- **PIA (Privacy Impact Assessment, multi-state US privacy patchwork)** authored by US privacy counsel with national scope, reviewed by Ci'erro's lawyers, signed off before launch. Covers federal floor (COPPA + HIPAA-adjacent + FCRA) + state-privacy patchwork data-protection-assessment requirements (CCPA/CPRA risk-assessments, VCDPA/CPA/CTDPA/UCPA/FDBR DPAs where applicability thresholds are crossed) **plus the Job-compose disclosure surface** — free-text Job descriptions visible to multiple Providers, with the one-time consent acknowledgement timestamped to the Job record
- **Vendor data-flow inventory** appendix to Privacy Policy (lists every US-region vendor and what personal data flows through them)
- **Privacy Policy** with state-specific appendices surfaced per user residence (CCPA notice-at-collection, VCDPA / CPA / CTDPA / UCPA consumer-rights surfaces, FDBR surfaces, etc.) + the Job-description disclosure paragraph
- **(v1.3) National marketing launch** — app is available across all 50 US states from day one; marketing posture per the Phase 0 confirmation (uniform vs. priority-metro-weighted). Replaces the prior Miami-Dade soft-launch concentration.

---

### Phase 5 — Launch Support (60 days post-launch)

- **Demo:** Weekly bug fix reports
- **Deliverable:** Bi-weekly Loom updates summarizing fixes shipped, plus a monthly Zoom call to review metrics from the admin dashboard and prioritize the next round of fixes

**Activities:**

- Monitor real-world usage
- Fix bugs
- Address App Store review issues if rejected
- Monitor Provider onboarding speed
- **(v1.1) Monitor Job-board metrics** — Jobs posted, Applications filed, time-to-award, Award rate, Provider quota-hit rate. The 30/Provider and 15/Job caps are explicitly re-tunable at 90 days based on this data
- **(v1.1) Monitor Offer-negotiation patterns** — what % of Bookings involve at least one Offer/counter; whether negotiation is moving prices materially; whether Trust & Safety flags trigger more in Offer `scope_note` than in regular messages
- Support Ci'erro through her marketing push

---

### Phase 6 — Public Web App Build-Out (Weeks 20–22)

- **Demo:** Public-facing web app live at Our Haven's domain
- **Deliverable:** Web app deployed to production at the live domain, plus a Zoom call walkthrough showing Parents and Providers signing up, logging in, and using the app from a browser

**Activities:**

- Spin up web build from existing Flutter codebase (Parent web experience; Provider web portal already exists from Phase 2)
- Adapt Parent layouts for desktop and tablet screens. **(v1.1)** The web Parent experience also gets the Job-board surfaces and Offer-bubble messaging; the Provider web portal from Phase 2 was already a system of record so no additional Provider web surfaces ship here
- Connect to existing backend, authentication, and Stripe flows
- QA across major browsers (Chrome, Safari, Firefox, Edge)
- Domain setup and SSL
- Sitemap and basic SEO

---

### Phase 7 — Ongoing Maintenance

- **Demo:** Monthly health report
- **Deliverable:** Monthly Loom video covering platform health, security updates, fixes shipped, and recommendations
- New features quoted separately

---

### Additional Costs Outside Scope

- New feature development after launch (quoted separately)
- Third-party service costs paid directly by Ci'erro:
    - Apple Developer account (~$99/year)
    - Google Play Developer account (~$25 one-time)
    - **Checkr** standard-package background-screening fees (~$30/check, passed through to Providers at $35 with a small platform margin; per ADR-0007, not statutory FL Level 2)
    - Stripe transaction fees (standard US rates) + Stripe Tax (~0.5% per taxable transaction) + Stripe Connect Express (Form 1099-K issuance included)
    - Daily.co per-participant-minute fees (~$0.004/min/participant; US rooms)
    - Twilio SMS fees (~$0.0075/SMS to US numbers + carrier fees)
    - Resend email (volume-based)
    - US privacy counsel retainer or per-engagement fees (replaces the UK fractional-DPO retainer; Phase 0 firm-pick determines structure)
    - Hosting and infrastructure costs (estimated separately at end of discovery; **Supabase Pro plan** for Auth + Postgres + Realtime + Storage, US-region; **Fly.io shared-CPU machine** in `iad` for the Fastify backend; **Vercel Pro** for the Next.js web surfaces — per ADR-0010, replacing the originally estimated GCP `us-east1` / `us-east4` Cloud Run + Cloud SQL + Firestore stack)

---

## Scope Lock

- Scope locked at end of Phase 1
- Any new features after Phase 1 require a written change order with separate quote
- Items explicitly out of scope for v1:
    - AI-generated parent profiles from Provider reviews
    - Custom matching/recommendation algorithm (v1 uses the hybrid scoring formula above)
    - Custom in-app video call feature (Daily.co embedded video is in v1; a fully integrated custom video solution is a future add-on, quoted separately)
    - Deep user analytics and behavioural tracking (basic metrics in v1; user flow analytics deferred until key metrics are defined)
    - ~~Provider mobile app~~ — **in scope in v1.1 as a mobile companion alongside the web portal per ADR-0005**; ADR-0002 is superseded
    - Live-in / salaried Nanny contract abstraction (Nannies in v1 are modeled as long-engagement hourly Bookings)
    - Per-Provider cancellation policies (single platform-wide policy in v1)
    - Referral system and targeted/cohort promotions
    - Editorial / featured search slots and admin-driven Provider boosting
    - Provider gender as a search filter (federal Title VII / Florida Civil Rights Act protected class — deferred pending product/legal review)
    - Automated Specialist license verification via third-party vendor (manual admin verification in v1)
    - In-app notification inbox

**Added in v1.1 (Phase 2 candidates per ADR-0006):**

- **Direct invite to apply.** Parent reaches out to a saved Provider to ask them to apply to a posted Job. v1 Jobs are closed-list — applications come only from Providers who chose to apply.
- **Per-Provider application credits / pay-per-lead** (Thumbtack model). v1 controls spam via the 30-Application monthly cap; the richer commercial mechanism is deferred for post-launch evaluation.
- **Partial-award Jobs.** A Parent awards multiple Providers from one Job (e.g. weekend Nanny rotation). v1 supports the same outcome via multiple Jobs.
- **Single-account dual-role users.** v1 requires two accounts with different emails for a user who is both a Parent and a Provider.
- **Two-stage Job disclosure** (sanitised public brief + Parent-unlocked detailed brief for shortlisted Providers). v1 uses free-text Parent-controlled disclosure with a one-time consent warning.
- **Role-switching post-sign-up.** v1 has no in-app role conversion path.
- **In-thread Offer history view.** v1 surfaces each Offer inline but doesn't aggregate a structured "all past Offers in this thread" timeline.

---

## Dependencies on Ci'erro

These items must be delivered on time or the timeline shifts:

- Brand assets (fonts, colors, logo files) by end of Phase 0
- Apple Developer and Google Play accounts registered and verified by end of Week 2
- Stripe account set up by end of Week 2 (Stripe Connect Express, US entity) with **Stripe Tax enabled across all US states**
- **(v1.3) State sales-tax registration sequencing decision** by end of Phase 0 — pre-register in priority states or register reactively as Stripe Tax surfaces nexus prompts (replaces the prior Florida-DOR-specific dependency)
- **US privacy counsel engagement (national scope)** confirmed by end of Phase 1 — engagement scope covers the multi-state PIA, Privacy Policy with per-state appendices, ToS, per-state classification addendum pattern, and the Job-compose consent text
- **(v1.3) Priority Specialist-supply state slate confirmation** by end of Phase 0 — working slate: CA, FL, TX, NY, IL, GA, NC, PA, OH, AZ, WA, MA (12 states ≈ ~60% US population). Replaces the prior soft-launch-neighborhood decision.
- **App-feedback-after-first-booking incentive structure** decision by end of Phase 1
- **(v1.3) US-national launch confirmation** by end of Phase 0 per ADR-0009 (replaces the prior Miami / Florida launch confirmation)
- **(v1.3) Marketing-spend posture confirmation** by end of Phase 0 — uniform across 50 states vs. priority-metro-weighted
- Privacy Policy drafted by Ci'erro's lawyers before Phase 4 launch (must include disclosure that the Trust & Safety team can access message content, plus the vendor data-flow inventory and the sensitive-information consent text — COPPA-aware + HIPAA-adjacent + state-privacy-patchwork-aligned). **Must also include the Job-description disclosure paragraph** describing how Job descriptions are visible to all Providers viewing the Job and how Parents retain control over what they include
- Lawyer sign-off on Terms of Service before Phase 4 launch
- **US Provider classification language** drafted by Ci'erro's lawyers before launch (1099 independent contractor under IRS common-law test as federal baseline + **per-state classification addendum pattern** for AB5/ABC-test states — notably CA, MA, NJ, IL — surfaced per the Provider's resident state at Terms acceptance)
- Background-check vendor (Checkr) confirmed by JD during Phase 0
- **(v1.1) Application caps confirmation by end of Phase 0** — 15 Applications per Job and 30 Applications per Provider per month as launch defaults, re-tunable at 90 days
- **(v1.1) Store listing posture confirmation by end of Phase 0** — single binary / single listing per store (ADR-0005 default) vs. two separate listings
- **(v1.1) Subscription-gate posture on Job posting confirmation by end of Phase 0** — hard wall (ADR-0006 default) vs. soft wall (first Job free, subsequent require Subscription)

---

## Timeline Summary

> **Total project length: 22 weeks** from contract signing to web app live (19 weeks to mobile app stores, plus 3 weeks for web app build-out). This is **6 weeks longer** than the v1.0 baseline (16 weeks). The 6-week expansion is driven by the 2026-05-18 model evolution per ADR-0005 (Provider mobile companion) and ADR-0006 (Job-board + negotiable pricing):
>
> - Phase 2: +1 week (4 new backend deep modules + schema + Pricing/Disintermediation module changes)
> - Phase 3a (renamed from Phase 3): +1 week (Parent Job-board surfaces + Offer composer + role-fork sign-up + dual-entry Home tile)
> - Phase 3b: +4 weeks (entirely new — Provider mobile companion shell, Opportunities feed, Application composer, mobile-native Availability + Booking inbox + Active session, web linkout pattern)
>
> Phases 4–6 timing shifts forward by 6 weeks but durations are unchanged.

- **Plus:** 60 days of launch support after mobile go-live
- **Plus:** Optional ongoing maintenance after launch support ends

**Key dates locked at Phase 1:**

- Phase 0 demo (end of Week 1)
- Phase 1 demo and final quote (end of Week 2)
- Phase 2 demo (end of Week 8) — *was end of Week 7*
- Phase 3a demo on TestFlight, Parent role (end of Week 13) — *was end of Week 11 as combined Phase 3*
- **Phase 3b demo on TestFlight, Provider role (end of Week 17)** — *new in v1.1*
- App Store submission (Week 18) — *was Week 12*
- Mobile apps live in stores (end of Week 19) — *was end of Week 13*
- Web app live (end of Week 22) — *was end of Week 16*

**Parallelization note.** Phase 3a and Phase 3b are written as sequential because they share components (Offer bubble, Job card, role-fork sign-up, message bubble) and most teams of this size will hit merge friction running them concurrently. A two-developer split — one on Parent client, one on Provider client — could compress Phases 3a+3b from 9 weeks sequential to ~6 weeks in parallel, saving roughly 3 weeks on total project length. This is a Phase 1 staffing decision, not a default plan.
