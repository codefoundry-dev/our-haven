# PRD — Our Haven v1

**Status:** draft (not yet published to issue tracker)
**Owner:** JD, The Codefoundry
**Last revised:** 2026-05-11 (jurisdiction pivot from UK to Miami/Florida — see ADR-0003)

> Domain language follows `CONTEXT.md`. Architectural framing follows ADR-0001 (marketplace billing), ADR-0002 (Provider portal web-only), ADR-0003 (Miami/Florida launch jurisdiction), and ADR-0004 (backend stack and cross-platform API).

---

## Problem Statement

Parents in the Miami metro looking for childcare and child-development support — Babysitters, Tutors, Nannies, and Specialists — face a fragmented, unverified market. Existing options (Care.com, agency listings, word-of-mouth Facebook groups, neighborhood referrals) range from un-vetted to expensive, and none of them are built around the specific needs of families with neurodivergent children, where matching a Provider to a child's profile is a clinical judgement, not a search-and-click.

Providers — particularly licensed Specialists — also face friction on the supply side: there is no Miami/Florida-focused marketplace that handles **Florida Level 2 background screening**, license cross-checking against Florida professional boards (FL Board of Behavior Analysis, FL Board of Speech-Language Pathology and Audiology, FL Board of Occupational Therapy Practice, FL Board of Psychology, FL Board of Nursing, FL Board of Medicine), and Stripe-handled Payouts in one place. They lose time and money setting up their own websites, vetting prospects, and chasing payment.

The result: Parents settle for Providers who are convenient rather than appropriate; Providers churn through admin overhead instead of doing their work.

## Solution

Our Haven is a **Miami/Florida-focused** two-sided marketplace, built with state-pluggable compliance so adjacent US states are a Phase 2 add rather than a re-platforming exercise. Parents use a **Flutter mobile app** to discover, message, book, video-interview, and pay vetted Providers across four categories. Providers use a **web portal** to onboard (with Florida Level 2 background screening + per-category license verification against Florida public boards), publish an Availability calendar with their own Rate, accept Booking requests, message, complete Sessions, and receive Payouts via Stripe Connect. An **admin dashboard** runs Provider review, Trust & Safety message access, dispute resolution, and platform metrics.

The marketplace runs on a **Parent Subscription** (web-billed; unlocks search, messaging, booking) plus a **percentage Commission** skimmed from each Booking via Stripe Connect's application fee. Provider classification (1099 independent contractor under IRS common-law test + Florida factors), the US privacy patchwork (FDBR + COPPA + HIPAA-adjacent prudence + FIPA), explicit Parent consent for Child special-needs flags, and Stripe Tax / 1099-K reporting are first-class concerns built into v1, not afterthoughts.

A public Parent web app ships in Phase 6 from the same Flutter codebase.

## User Stories

### Parent — discovery & onboarding

1. As a Parent, I want to sign up for an account using Sign in with Apple, Google, or email and password, so that I can choose the auth method I trust.
2. As a Parent, I want to verify my email and phone number once at sign-up, so that the platform knows I'm reachable for booking-critical communication.
3. As a Parent, I want to see and explicitly accept a sensitive-information consent screen before I can record special-needs flags or notes on a Child profile, so that my child's sensitive data is handled with COPPA-aware, HIPAA-adjacent, and FDBR-compliant care.
4. As a Parent, I want to add multiple Child profiles to my account — each with age, special-needs flags, and notes — so that I can book different Providers appropriate for each child.
5. As a Parent, I want to add a payment method during onboarding before booking, so that the booking flow itself is friction-free later.
6. As a Parent, I want to be able to see a 1–2 Provider preview without paying, so that I can evaluate the marketplace before committing to a Subscription.
7. As a Parent, I want to subscribe to Our Haven via a web checkout (linked from the mobile app), so that I can unlock full search, messaging, and booking.
8. As a Parent, I want my Subscription status to be reflected in the mobile app immediately after I complete the web checkout, so that I can use the unlocked features without re-launching.
9. As a Parent, I want to apply a discount code to my Subscription, so that I can take advantage of launch promotions.

### Parent — search & filters

10. As a Parent, I want to search for Providers by Category (Babysitter / Tutor / Nanny / Specialist), so that I can narrow to the kind of help I need.
11. As a Parent, I want to filter by ZIP code and radius, so that I can find Providers near me.
12. As a Parent, I want to filter by date and time intersected with each Provider's published Availability, so that I only see Providers who can actually work my window.
13. As a Parent, I want to set an hourly Rate ceiling, so that I only see Providers I can afford.
14. As a Parent, I want to filter by minimum star Rating, so that I avoid unproven supply.
15. As a Parent, I want to filter for "Tax-credit-friendly" Babysitters and Nannies (Providers who will issue IRS Form W-10 on request), so that I can claim the Child and Dependent Care Tax Credit (CDCTC) or use a Dependent Care FSA.
16. As a Parent searching within the Specialist category, I want Specialist-specific filters (license type, in-person vs telehealth, age range served), so that I can match clinical fit before contacting anyone.
17. As a Parent, I want search results ranked by a hybrid of distance, Rating, and recent activity, so that the most useful Providers surface first without me sorting manually.

### Parent — messaging & video

18. As a Parent, I want to message a Provider before booking, so that I can ask questions and assess fit.
19. As a Parent, I want my messages to be encrypted in transit and at rest, so that my conversations stay private.
20. As a Parent, I want to be told (in the Privacy Policy) that the Trust & Safety team can access message content for fraud and safety review, so that I'm fully informed.
21. As a Parent, I want the platform to redact phone numbers, emails, social handles, and payment app names automatically before they reach the recipient, so that I'm protected from off-platform pressure that strips marketplace safeguards.
22. As a Parent, I want to schedule and join a video interview with a Provider before booking, so that I can meet them face-to-face for high-trust roles like Nanny or Specialist.

### Parent — Booking lifecycle

23. As a Parent, I want to view a Provider's Availability calendar and select a slot, so that I'm not requesting times the Provider has already blocked off.
24. As a Parent, I want my slot selection to send a Booking request to the Provider (not auto-confirm), so that I'm matched with a Provider who's actually engaged.
25. As a Parent, I want to attach one or more of my Child profiles to a Booking, so that the Provider knows who they're caring for.
26. As a Parent booking a Tutor or Specialist, I want to be limited to a single Child per Booking, so that the engagement model is honest about clinical 1:1 reality.
27. As a Parent booking a Babysitter or Nanny for multiple Children, I want to see and pay any per-child surcharge transparently, so that there are no billing surprises.
28. As a Parent, I want my card to be authorized at booking but not charged until the Session is complete (for hourly Bookings), so that I'm not paying upfront for hours that may not happen.
29. As a Parent booking a Specialist per-session, I want to be charged the fixed Rate at booking time, so that the engagement is locked in.
30. As a Parent, I want to receive a push notification and an email when a Provider accepts, declines, or lets my request expire, so that I know the status without having to check.
31. As a Parent, I want to receive a push reminder one hour before my Booking starts, so that I don't forget.
32. As a Parent, I want to be notified after a Session ends to confirm or dispute the hours the Provider proposed, with a clear 24-hour window, so that I'm protected from over-billing without being a permanent gatekeeper.
33. As a Parent, I want any 3DS step-up challenge (applied opportunistically by Stripe for fraud reduction, not on every payment) to be handled smoothly, so that my card actually works on first try.
34. As a Parent, I want to be able to cancel a Booking and see exactly what I'll be charged based on how close to start time I am, so that I can make an informed decision.

### Parent — ratings & disputes

35. As a Parent, I want to rate a Provider 1–5 stars with optional text in the 14 days after a Booking completes, so that I can share my experience.
36. As a Parent, I want my rating to stay blind until the Provider also submits or the window closes, so that retaliation isn't a concern.
37. As a Parent, I want to see other Parents' star ratings and text reviews on a Provider's profile, so that I can make informed choices.
38. As a Parent, I want to file a Dispute within 7 days of a Booking completing, so that I have recourse if something went wrong.
39. As a Parent, I want a clear no-show flow if a Provider doesn't turn up, so that I get a refund quickly without arguing.

### Provider — onboarding & verification

40. As a Provider, I want to sign up for the web portal using email/password or Sign in with Google, so that I can get started without installing an app.
41. As a Provider, I want to be guided through a category-aware onboarding flow (Babysitter / Tutor / Nanny / Specialist), so that I'm only asked for documents relevant to my work.
42. As any Provider, I want to upload my government ID and complete a **Florida Level 2 Background Screening** (FBI + FDLE fingerprint-based check against the AHCA / DCF Care Provider Background Screening Clearinghouse) plus a National Sex Offender Registry check at sign-up, so that I'm verified to Florida childcare standards.
43. As a Specialist, I want to additionally provide my professional license number, issuing Florida board (FL Board of Speech-Language Pathology and Audiology / Occupational Therapy Practice / Psychology / Behavior Analysis / Medicine / Osteopathic Medicine / Nursing), license document, and liability insurance certificate, so that my clinical credentials are properly verified.
44. As a Babysitter or Nanny, I want to opt into the **"Tax-credit-friendly" badge** by self-attesting that I will issue **IRS Form W-10** on request, so that Parents claiming the CDCTC or using a Dependent Care FSA can find me. (Optionally, if I operate a **Family Child Care Home** under FL DCF licensing, I want to upload my FCCH registration to display a separate "DCF-registered FCCH" badge.)
45. As a Provider, I want to see clear status tracking on each verification step, so that I know what's blocking my activation.
46. As a Provider, I want to set my own Rate (hourly for Babysitter/Tutor/Nanny; per-session for Specialist), so that I can price fairly for my market.
47. As a Babysitter or Nanny, I want to set an optional per-child surcharge, so that multi-child Bookings reflect the actual workload.
48. As a Provider, I want to publish my Availability calendar, so that Parents only see slots I can actually work.
49. As a Provider, I want to onboard onto Stripe Connect Express through a hosted KYC flow, so that I can receive Payouts without manual paperwork.

### Provider — Booking lifecycle

50. As a Provider, I want to receive an SMS, email, and web push notification the moment a Parent submits a Booking request, so that I can respond within the 24-hour window.
51. As a Provider, I want to see the Child profile information appropriate to the Booking (age + special-needs flag presence at request time; full notes after acceptance — full notes pre-accept for Specialists), so that I can decide whether to accept while respecting privacy.
52. As a Provider, I want to accept or decline a Booking request, so that I'm only committed to work I can actually do.
53. As a Provider, I want a slot blocked from other Parents the moment a request lands on it, so that I'm not double-booked while deciding.
54. As a Provider running an hourly Booking, I want to mark a Session in-progress at start time and propose final hours when finished, so that the Parent is billed accurately.
55. As a Provider, I want my Payout to release after the Parent confirms the proposed hours (or the 24h auto-confirm window passes), so that I'm paid promptly.
56. As a Provider, I want to receive an email when a Payout lands in my Stripe account, so that I have an accurate record.
57. As a Provider, I want a step-up MFA challenge when I change my bank details or initiate a withdrawal, so that my Payouts can't be hijacked by an attacker who got my password.

### Provider — messaging, ratings, support

58. As a Provider, I want to message a Parent before, during, and after a Booking, so that I can coordinate logistics.
59. As a Provider, I want to rate a Parent 1–5 stars with optional text after a completed Booking (visible only to other Providers, aggregate-only), so that I can warn peers about problem clients without exposing them publicly.
60. As a Provider considering a Booking request, I want to see the Parent's aggregate Rating and count, so that I can avoid known-bad actors.
61. As a Provider, I want to file a Dispute or report a Parent no-show through a clear in-app flow, so that I'm not left out of pocket.
62. As a Provider, I want my access to message threads through the portal to be unaffected by the Trust & Safety team's audit-logged access to the same threads, so that I retain my normal experience while the platform stays accountable.

### Admin / Trust & Safety

63. As an admin, I want to log into the dashboard with mandatory TOTP MFA, so that admin access is hardened.
64. As an admin reviewing the Provider queue, I want to see Florida Level 2 background screening results, license verifications, and (where applicable) FCCH registration certificates side-by-side with the Provider's profile, so that I can approve or reject efficiently.
65. As an admin, I want to manually verify a Specialist's license against the relevant Florida public register (FL DOH MQA portal for the SLP / OT / Psychology / Behavior Analysis / Medicine / Osteopathic Medicine / Nursing boards) and record my verification decision with a timestamp, so that there's a clear audit trail.
66. As a Trust & Safety reviewer, I want a flagged-thread queue showing all messages that tripped disintermediation detection, so that I can investigate proactively.
67. As a Trust & Safety reviewer, I want to access a specific message thread on demand when a Parent or Provider files a safety/fraud report, with a free-text reason captured at access time, so that the audit log records why I looked.
68. As a compliance reviewer, I want every Trust & Safety thread access logged with admin ID, thread ID, timestamp, mode (queue vs investigation), and reason, so that the platform can demonstrate proportionate access during a privacy-counsel review or a Florida Attorney General / FDBR inquiry.
69. As an admin handling a Dispute, I want to see the full Booking history (states, Session hours proposed/confirmed, payment timeline), so that I can resolve it fairly.
70. As an admin resolving a Dispute, I want to release, partially refund, or fully refund the held Payout, so that the resolution flows through Stripe immediately.
71. As an admin, I want to view platform metrics (sign-ups, active Subscriptions, cancellations, Bookings) on a dashboard, so that I can monitor health.
72. As a Trust & Safety reviewer, I want to suspend a Provider account pending review when no-show flags hit threshold (or after a serious incident), so that supply quality stays high.

### Cross-cutting / compliance

73. As a Parent, I want to delete my account and see my data soft-deleted for 30 days (recoverable), then hard-deleted (with financial records retained 7 years pseudonymised), so that my FDBR right-to-delete and CDCTC-aligned record retention are both honored.
74. As a Parent, I want to withdraw my sensitive-information consent and have all special-needs flags and notes deleted from my Child profiles, so that I retain control over sensitive data about my child.
75. As a Provider, I want my background-check raw details retained for no more than 6 months and then hard-deleted (with my cleared/not status remaining on my account), so that FCRA disposal-rule best practice is honored.
76. As a marketing recipient, I want a separate explicit opt-in for promotional messages distinct from transactional ones (CAN-SPAM-compliant for email; TCPA-compliant for SMS), so that I can opt out of marketing without losing booking-critical notifications.
77. As any user, I want 3DS step-up challenges to be applied opportunistically to high-risk card-not-present transactions for fraud reduction, so that the platform balances payment friction against fraud loss without imposing an SCA-style universal challenge.

## Implementation Decisions

### Backend stack and cross-platform communication

Per ADR-0004:

- **Backend runtime: Node.js + TypeScript.** Best SDK fit for Stripe Connect, Stripe Tax, Twilio, SendGrid, Firebase Admin, Daily.co, Cloud Tasks, and Checkr (the v1 background-check vendor). Backend ↔ web frontend share types via OpenAPI codegen.
- **API protocol: OpenAPI-first REST + JSON.** The OpenAPI spec is the source of truth; typed Dart clients are generated for the Parent Flutter mobile app, typed TypeScript clients are generated for the Provider web portal and admin dashboard. CI fails on spec drift.
- **Database split:**
  - **PostgreSQL** is the system of record for everything — Bookings, Sessions, Payments, Ratings, Verifications, message content (for retention/audit), audit logs, retention bookkeeping. Hosted on Cloud SQL.
  - **Firestore** is a real-time fan-out for messaging events only. New Messages are written to Postgres canonically, then mirrored to Firestore so chat surfaces (Flutter and web) can use native live document listeners. Disintermediation redaction runs before both writes; Firestore stores only the redacted form delivered to the recipient.
- **Hosting: GCP Cloud Run + Cloud SQL + Cloud Storage + Firestore + Firebase Auth, all in a US region (`us-east1` South Carolina, with `us-east4` Northern Virginia as documented fallback; Firestore on `nam5` US multi-region).** US data residency under ADR-0003 is enforced by region configuration on every service.
- **Background jobs: Cloud Tasks** for delayed jobs (Booking 24h expiry, Session 24h auto-confirm, Dispute window expiry, retention/erasure scheduled runs) and **Cloud Scheduler** for periodic tasks. Time-delayed work MUST go through Cloud Tasks — in-process timers are forbidden because Cloud Run scales to zero.
- **File storage: Google Cloud Storage US bucket** for ID uploads, license documents, FCCH certificates, and profile photos. Clients upload via signed URLs issued by the backend; downloads are also via short-lived signed URLs scoped to the requesting actor's permissions.

### Cross-platform communication shape

- **Parent Flutter app** → backend over **HTTPS REST** using the generated Dart client. Auth via Firebase ID token in the `Authorization` header; the Firebase Admin SDK verifies on every request. **Live messaging** events delivered via Firestore listeners (Flutter `cloud_firestore` SDK), not polled over REST.
- **Provider web portal** → backend over **HTTPS REST** using the generated TypeScript client. Auth via Firebase ID token (email/password or Google). Live messaging via Firestore web SDK. **Step-up MFA** required at the backend for payout-sensitive endpoints (changing bank details, initiating withdrawals).
- **Admin dashboard** → backend over **HTTPS REST** using the same generated TypeScript client (different auth scope). **Mandatory TOTP MFA** enforced server-side on every request (not just at sign-in) for sensitive operations.
- **Stripe webhooks** → dedicated backend endpoint with Stripe signature verification → translated into Booking lifecycle / Subscription / Payout events for the deep modules.
- **Background-check webhooks (Checkr in v1)** → dedicated backend endpoint with vendor signature verification → translated into Verification workflow events. Endpoint is implemented behind a vendor-agnostic interface so a second-state vendor can be added in Phase 2.
- **Daily.co webhooks** (optional, for call telemetry) → dedicated backend endpoint.
- **Outbound notifications** flow out through the Notifications dispatcher: FCM (Parent mobile push), VAPID web push (Provider portal), SendGrid (email), Twilio (SMS).

### Modules

The implementation is organized as **nine deep modules** (pure logic, simple interfaces, isolated tests) plus integration modules wrapping external SDKs:

**Deep modules:**

- **Booking lifecycle state machine.** Encodes the `requested → accepted | declined | expired → in-progress → awaiting-confirmation → completed | disputed | cancelled` graph. Inputs: current Booking + event. Outputs: next state + side-effects to enqueue. Independent of Stripe, persistence, and UI.
- **Availability calendar.** Slot CRUD, block-on-request semantics, automatic release on decline/expire, intersection with Parent search queries. Pure data-structure operations.
- **Pricing & commission calculator.** Given Provider Rate, hours, child count, per-child surcharge, Commission %, and category, produces Parent charge + Provider Payout amount + platform Commission + (optional) sales-tax breakdown delegated to Stripe Tax. Per ADR-0001.
- **Cancellation policy calculator.** Given a Booking and a cancellation timestamp, produces refund and charge amounts under the v1 platform-wide rule (free ≥24h, 50% inside 24h, 100% inside 2h or after start).
- **Disintermediation detector.** Regex-based scanner over message text. Outputs redacted text + match metadata (categories matched, original spans). Does not depend on storage; storage of original is the queue module's job.
- **Search ranking scorer.** `0.5 × distance_proximity + 0.3 × rating + 0.2 × recency_active_in_last_7_days` over a candidate Provider list, after filter intersection.
- **Rating reveal logic.** Given two-side Rating submission state and the 14-day window position, outputs visibility per Provider profile and per Parent-facing-Provider surface (asymmetric).
- **Verification workflow.** Per-Category state machine for Provider verification — Babysitter/Tutor/Nanny require email + phone + ID + **Florida Level 2 background screening**; Specialist additionally requires Florida professional license + issuing FL board + insurance; Babysitter/Nanny optionally carry a self-attested "Tax-credit-friendly" (W-10) badge and (rarely) an FCCH registration. State-pluggable: the screening step delegates to the per-state background-check adapter (Checkr Florida Level 2 in v1).
- **Retention/erasure planner.** Given an account-deletion or consent-withdrawal event, outputs the set of records to soft-delete, pseudonymize, hard-delete, or retain — driven by a retention policy table (account 30d soft-delete; financial 7y pseudonymized; messages 3y; background-check raw 6mo; sensitive data on event).

**Integration modules** (thin wrappers over external SDKs; not tested in v1):

- Auth (Firebase Auth + MFA orchestration; US region)
- Background-check verification (Checkr Florida Level 2 wrapper + status polling, behind a vendor-agnostic interface)
- Stripe Connect (Connect Express US onboarding + payment intent with `application_fee_amount`)
- Stripe Subscription (web-hosted Parent Subscription + status webhook)
- Stripe Tax (sales-tax computation hookup; nexus tracking across US states as expansion proceeds)
- Daily.co video (room creation + token issuance; US rooms)
- Notifications dispatcher (event → channel matrix → FCM / web push / SendGrid / Twilio)
- Disintermediation queue + Trust & Safety audit log (flagged-thread persistence + access logging)
- Messaging (encrypted at rest + transport)
- Admin dashboard surfaces (review queues, metrics, T&S thread viewer)

**UI surfaces:** Parent Flutter app (iOS / Android), Provider web portal, admin dashboard.

### Interfaces (high-level)

- The Booking lifecycle state machine is consumed by the API layer, which translates HTTP/RPC events into state-machine inputs and persists the resulting transitions. The state machine itself does no I/O.
- The Pricing calculator is consumed by both the Booking creation path (to compute the authorization amount and display the charge) and the Session-completion path (to compute the final capture amount). The same module produces the Parent-visible charge, the Provider-visible Payout, the platform Commission split, and any applicable sales-tax lines (delegated to Stripe Tax).
- The Disintermediation detector is consumed at message-submit time, before persistence. The redacted message is what the recipient ever sees; the unredacted original goes to the flagged-thread queue.
- The Rating reveal logic is queried at every read — Provider profile views, Parent-facing-Provider surfaces — with the current submission state passed in. No background "reveal job" needs to flip visibility.
- The Retention/erasure planner is invoked on a scheduled job and on direct user actions (account delete, consent withdrawal); it emits the action plan that the persistence layer executes.

### Architectural decisions

- **Stripe Connect Express (US entity)** is the marketplace billing rail (ADR-0001). All Booking payments flow through Connect with `application_fee_amount` skimmed from the Provider's Rate. Parent Subscription is sold only on web (Stripe-hosted page) to avoid iOS / Android in-app-purchase rules; the mobile app reads Subscription status but does not sell it. Form 1099-K issuance to Providers is handled automatically by Stripe.
- **Provider portal is web-only** in v1 (ADR-0002). No Provider Flutter binary. SMS-on-Booking-request is mandatory because web push alone is unreliable for Provider responsiveness.
- **Miami / Florida launch jurisdiction** (ADR-0003). FL Level 2 background screening / FL DOH licensure boards (SLP / OT / Psychology / Behavior Analysis / Medicine / Nursing) / FDBR + COPPA + HIPAA-adjacent prudence / 3DS-optional payment posture / FL sales tax via Stripe Tax shape every compliance-adjacent module. State-pluggable adapters for background-check and license-board lookup keep Phase 2 US expansion a configuration exercise.
- **Firebase Auth (US region)** is the identity provider. Parent: Sign in with Apple + Google + email/password, device-trust SMS OTP. Provider: email/password + Google, web-side step-up MFA on payout actions. Admin: TOTP MFA mandatory.
- **Daily.co** is the embedded video provider (US rooms).
- **All vendor configurations pin US data residency**; documented in the Privacy Policy vendor data-flow inventory appendix.

### Schema-shape implications (no specific column names)

- A Booking carries Category, Parent ID, Provider ID, attached Child IDs, planned slot (with the Provider's home state captured for per-state compliance routing), state, payment intent ID, and (for hourly) Session sub-record with proposed hours + confirmed hours + confirmation timestamp.
- The Tutor / Specialist single-child constraint is enforced at the Booking creation API boundary, not by trusting clients.
- Disintermediation flagged threads carry the unredacted original, the redacted delivered text, the match metadata, and an FK to the message; T&S audit logs reference both admin ID and thread ID with timestamp + mode + reason.
- Rating storage carries submission timestamp + reveal timestamp; reveal timestamp is computed by the rating-reveal module on read (no batch job).
- Retention is driven by a policy table with per-record-type rules; the planner produces actions, the persistence layer applies them.

## Testing Decisions

### What makes a good test (in this codebase)

- **Test external behavior, not implementation details.** A test for the Booking lifecycle should assert that "an `accepted` Booking with a Parent-cancellation event 1 hour before start produces a 100%-charge cancellation," not that any specific function was called along the way. Tests that assert on internals make refactoring expensive and don't catch real regressions.
- **Tests are fast because deep modules are pure.** No database, no Stripe sandbox, no Firebase emulator in the deep-module test paths. Inputs in, outputs out, milliseconds per test.
- **Integration modules are not unit-tested in v1.** They wrap external SDKs and are mostly glue; testing them directly tends to retest the SDK. End-to-end smoke tests at the API boundary cover what matters there post-launch.
- **Property-based tests where they fit** — particularly Pricing and Cancellation calculators (numeric invariants like "Parent charge ≥ Provider Payout" or "cancellation refund + cancellation fee = original authorized amount"). The Booking state machine is also a natural fit for state-transition properties ("from any state, applying an `expire` event when the request is older than 24h reaches `expired` or no-op").

### Modules to test in v1

All nine deep modules:

1. **Booking lifecycle state machine** — exhaustive coverage of the state graph; round-trip and illegal-event tests.
2. **Availability calendar** — slot CRUD, block-on-request, automatic release, query intersection.
3. **Pricing & commission calculator** — base + per-child surcharge, Commission skim, optional sales-tax line delegation to Stripe Tax, rounding, edge cases (zero hours, fractional hours).
4. **Cancellation policy calculator** — boundary tests at 2h, 24h, and after-start; refund/charge invariants.
5. **Disintermediation detector** — coverage of each pattern category; redaction-correctness; false-positive curation.
6. **Search ranking scorer** — score-stability, filter-match correctness, edge cases (no matches, ties).
7. **Rating reveal logic** — all four window/submission combinations across Provider-facing and Parent-facing surfaces.
8. **Verification workflow** — per-Category coverage; transition tests; optional W-10 / FCCH badge flows; per-state adapter contract (Florida adapter + stub second-state adapter).
9. **Retention/erasure planner** — every retention rule; consent-withdrawal coverage; financial-record pseudonymization.

### Prior art for the tests

The codebase is greenfield Flutter (only `lib/main.dart` exists today). There is no prior testing pattern to follow. Per ADR-0004, the **deep modules live in pure TypeScript packages on the backend**; client-side calculations on the Flutter app go through the same API rather than re-implementing logic in Dart, so the deep modules are tested once in TypeScript using **Vitest** (or Jest if the team prefers). Flutter widget and integration tests use `flutter test`. State-machine and calculator tests lean on table-driven patterns; the Disintermediation detector uses a curated fixture set of message strings; the Booking lifecycle state machine and Retention planner are natural fits for property-based tests via `fast-check`. The Verification workflow's per-state adapter contract is tested via a Florida adapter fixture plus a stub second-state adapter, to keep the pluggability honest.

## Out of Scope

- Provider Flutter / native mobile app (Provider portal is web-only in v1; ADR-0002).
- Live-in / salaried Nanny contract abstraction (Nannies in v1 are modeled as long-engagement hourly Bookings).
- Per-Provider cancellation policies (single platform-wide rule in v1).
- Referral system and targeted/cohort promotions (discount codes via Stripe Promotion Codes only in v1).
- Editorial / featured search slots and admin-driven Provider boosting.
- Provider gender as a search filter (federal Title VII and Florida Civil Rights Act protected class; deferred pending product/legal review).
- Automated Specialist license verification via third-party vendor (manual admin verification against the FL DOH MQA portal in v1).
- In-app notification inbox.
- Multi-currency, multi-language, or simultaneous multi-state US launch. Adjacent US states are a Phase 2 add via the per-state compliance adapters (background check + license boards + sales tax) defined in ADR-0003; v1 is Florida-only. International launch (UK, EU, etc.) is a full re-platforming, not a Phase 2 add.
- ML-based intent detection in messaging (regex-only disintermediation in v1).
- AI-generated Parent profiles from Provider reviews.
- Custom matching/recommendation algorithm beyond the v1 hybrid scorer.
- Custom in-app video call feature (Daily.co embedded suffices for v1).
- Deep behavioural analytics (basic metrics in v1; user-flow analytics deferred until key metrics defined).
- iOS/Android in-app purchase for the Parent Subscription (sold on web only).

## Further Notes

- **Items still requiring Ci'erro / Phase 0 input** (questions to ask the client):
  1. Do you confirm Miami / Florida as the v1 launch jurisdiction, with adjacent US states as a Phase 2 add via per-state compliance adapters?
  2. For the soft launch, should we concentrate supply and demand on Miami-Dade only, or open the launch radius to tri-county (Miami-Dade / Broward / Palm Beach) from day one?
  3. If Miami-Dade only, are there specific neighborhoods (e.g. Brickell, Coral Gables, Coconut Grove, Doral, Aventura) you want us to seed first?
  4. What monthly Parent Subscription price (USD) do you want to launch with, and do you want an annual option at launch or post-launch?
  5. What Commission percentage should we skim per Booking via Stripe Connect (our working range is 15–20%)?
  6. Do you approve Checkr as the v1 background-check vendor for Florida Level 2 screening, or do you want us to evaluate alternatives (e.g. Sterling, GoodHire) before contracting?
  7. Which US privacy counsel firm do you want to engage for the PIA, Privacy Policy, ToS, and 1099 Provider classification language — and by when can we get them retained so the pre-launch deliverables aren't blocked?
  8. What incentive (if any) do you want to offer Parents for leaving feedback after their first completed Booking — account credit, discount on next Subscription cycle, or no incentive in v1?
  9. Has counsel confirmed our Florida Department of Revenue sales-tax registration position (i.e. whether marketplace Commission and/or Provider services are taxable under FL law), and if not, when can we get that call scheduled?
  10. Do you want a launch promo discount code wired up for the Subscription at go-live, and if so what value (e.g. first month free, 50% off month one)?
- **Mandatory pre-launch deliverables:** PIA (Privacy Impact Assessment, FDBR data-protection-assessment-aligned) authored by US privacy counsel and reviewed by Ci'erro's lawyers; Privacy Policy with vendor data-flow inventory appendix and sensitive-information consent text (COPPA-aware + HIPAA-adjacent); Terms of Service signed off by lawyers; US Provider classification language (1099 independent contractor, IRS common-law test + Florida factors) drafted by lawyers; FL Department of Revenue position confirmed; Stripe Connect Express US account active and Stripe Tax wired up; Apple Developer + Google Play Developer accounts active; US data residency configured on every vendor.
- **Timeline (per the rewritten project plan):** 16 weeks contract-to-web-app-live (13 weeks to mobile stores + 3 weeks for web), plus 60-day launch-support window.
- **Notification-channel costs to model post-launch:** Twilio SMS to US numbers at ~$0.0075/SMS plus carrier fees is the heaviest variable cost (Provider Booking-request SMS is mandatory in v1); budget ~$100/month in v1 with a re-evaluation gate above that. US SMS is materially cheaper than the UK baseline the original plan assumed.
- **Provider gender / religious filters** were specifically excluded from v1 search filters as protected-class / sensitive-attribute decisions (federal Title VII; Florida Civil Rights Act); these are a product/legal call before they're a build call.
- **Card-name-mismatch detection is a soft signal**, not a hard block — the original plan language ("card name must match account name") was softened during discovery to avoid excluding legitimate Parents (couples, name changes, family-funded accounts) while still flagging mismatched accounts for higher fraud scrutiny on early Bookings.
