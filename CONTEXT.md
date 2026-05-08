# Our Haven — Domain Context

A two-sided marketplace mobile app connecting parents with vetted childcare and child-development professionals.

## Geographic scope (v1)

**United Kingdom only.** Currency is **GBP**. Data residency in the UK / EU. Subject to **UK GDPR** and the **Data Protection Act 2018**, **PSD2 / FCA Strong Customer Authentication** for payments, and UK-specific Provider classification law. Background checks are run via **DBS** (Enhanced DBS + Children's Barred List for child-facing roles).

> ⚠ **Pending client confirmation.** The UK base is the working assumption per the JD↔Ci'erro discussion on 2026-05-08, but Ci'erro has not formally confirmed. If the base country changes, vendor selection (background check, license verification per category), language, and Provider classification work must be re-scoped per the new jurisdiction.

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

**All categories** require: email verification, phone verification, government ID upload, and an **Enhanced DBS check + Children's Barred List check** (the legal standard for UK roles in regulated activity with children — Standard or Basic DBS is insufficient). Run via a UK DBS API vendor; final vendor confirmed by JD in Phase 0 (working assumption: uCheck). Per-check cost ~£40–55 + small platform markup, paid by the Provider at sign-up.

**Specialists** additionally require: professional registration number, issuing UK regulator, license document upload, and proof of liability insurance — verified manually by admin against the relevant public register (**HCPC** for SLT/OT/Psychology, **GMC** for doctors, **NMC** for nurses, **UK-SBA / BACB international** for ABA/BCBA). ABA practitioners get a higher manual scrutiny bar because ABA is not statutorily regulated in the UK. No third-party verification vendor in v1; license verification is absorbed by the platform.

> ⚠ Verification details (DBS specifically) are contingent on UK as the launch country. If launch location changes, this section is re-scoped per the new jurisdiction's equivalent regime.

### Ofsted registration (Nanny only)
Nannies working in a Parent's home are **exempt from compulsory Ofsted registration** but may voluntarily join the **Ofsted Voluntary Childcare Register (VCR)**. VCR-registered status enables Parents to use Tax-Free Childcare and employer childcare vouchers — a real financial benefit. Surfaced as an **optional profile badge** (upload VCR certificate → admin verifies → "Ofsted-registered" badge displayed; Parents can filter by it). Activation is **not** gated on VCR.

### Search & filters (v1)
Single unified search surface across all Provider categories. **v1 filters:** Category, postcode + radius (default 5 miles), date/time (intersected with Provider Availability), hourly Rate ceiling, minimum star Rating, Ofsted-registered toggle (Nanny only), and a per-category specialty field (free-text + small canned set; primarily relevant for Tutor and Specialist). **Specialist-specific filters** unlock when Category = Specialist (license type, in-person vs telehealth, age range served).

**Ranking** is hybrid: `0.5 × distance_proximity + 0.3 × rating + 0.2 × recency_active_in_last_7_days`. Editorial / featured slots and admin-driven boosting are deferred to post-launch.

**Provider gender** as a filter is **deferred** to post-launch — it is a UK protected characteristic and exposing it on every profile carries a higher product/legal call than is appropriate for v1.

### Notifications
Multi-channel transactional notification system — push (Parent mobile via Firebase Cloud Messaging), web push (Provider portal, best-effort), email (both, via SendGrid), SMS (both, via Twilio).

**SMS is reserved for urgent events only**:
- **Booking request received → Provider** (the single most critical notification in the system; if it doesn't reach the Provider quickly, the marketplace stalls). **Mandatory** in v1; no Provider opt-out.
- **Cancellation inside the 24h window → both sides.**
- **Session start reminder → Provider** (1h before).

In-app notification inbox is **deferred** to post-launch. Marketing messages require a separate opt-in distinct from transactional notifications, surfaced from sign-up.

### Authentication
**Identity provider:** Firebase Auth, EU-region data residency (UK GDPR-compliant).

**Parent (mobile):** Sign in with Apple + Sign in with Google + email/password. Apple is required by App Store rules whenever a third-party social login is offered. Phone is verified once at sign-up; not used as primary auth.

**Provider (web portal):** Email/password + Sign in with Google. Apple sign-in is not offered on web (no policy mandate).

**MFA posture:**
- **Parent:** device-trust model — SMS OTP only triggered on new-device sign-in or suspicious-sign-in heuristics. Not required on every login.
- **Provider:** SMS OTP on new-device sign-in plus **step-up MFA** for payout-sensitive actions (changing bank details, initiating withdrawals).
- **Admin (Trust & Safety, etc.):** TOTP MFA mandatory on every sign-in.

### Article 9 consent
Special-needs flags and notes on Child profiles are **special category data** under UK GDPR Article 9, requiring **explicit Parent consent**. Sign-up flow captures a discrete consent step with timestamp; consent is re-prompted on material privacy policy changes; full erasure runs on Parent account deletion. This is non-optional — without consent, special-needs flags cannot be stored.

### Data Protection Officer (DPO)
External fractional DPO-as-a-service (e.g., DPO Centre, GRCI Law). Required before launch given Our Haven processes special category data about children and runs systematic message monitoring. Budget ~£300/month ongoing. Engaged in Phase 0 / 1.

### DPIA (Data Protection Impact Assessment)
A mandatory pre-launch document — required under UK GDPR for the trigger combination here (special category data + large-scale message monitoring + children's data). Drafted by the DPO, reviewed by Ci'erro's lawyers, signed off before Phase 4 launch.

### Data residency
All personal data is processed in **UK or EU regions**. Vendor settings (Firebase Auth → `europe-west`; Daily.co → EU rooms; cloud hosting → UK/EU region; DBS vendor → UK by default) are configured at project setup, not after launch. A vendor data-flow inventory is maintained as a Privacy Policy appendix.

### Retention policy
- **Account data:** 30-day soft-delete grace period after deletion request, then hard-delete.
- **Booking + payment records:** retained **6 years** (UK accounting law) in pseudonymized form (deleted user → "Deleted user {id}") regardless of account deletion.
- **Message content:** **3 years** post last activity, then hard-delete unless flagged in an active investigation.
- **DBS check raw details:** **6 months** maximum (per DBS guidance), then hard-delete. The cleared/not status remains on the Provider account.
- **Special category data (special-needs flags + notes):** deleted on account deletion **or** on explicit consent withdrawal.

> ⚠ DPO, DPIA, data residency, and retention policy are framed for **UK GDPR**. If launch location changes, this section is re-scoped per the new jurisdiction's data protection regime.

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

### VAT model
Our Haven is an **agent**, not a deemed supplier — Parents pay Providers for Bookings via Stripe; Providers pay Our Haven a Commission for marketplace services. VAT applies in three places:

1. **Parent Subscription** — standard-rated 20% VAT (digital service supplied by Our Haven).
2. **Commission** — standard-rated 20% VAT (B2B service to the Provider; VAT-registered Providers can reclaim, others bear it).
3. **The Booking itself** — VAT treatment depends on the Provider's category and own registration status: Babysitter/Nanny welfare services and HCPC-registered Specialist clinical services are typically VAT-exempt; sole-trader Tutor private tuition is exempt; limited-company Tutors are standard-rated. Our Haven does **not** collect VAT on Bookings — that's the Provider's responsibility.

Operationally: voluntary VAT registration before launch (lets Our Haven reclaim input VAT). Stripe Tax integration computes and applies VAT on Subscription and Commission charges automatically. Tutor profiles default to a sole-trader VAT-exempt assumption with a self-declaration toggle for limited-company status; limited-company Tutors carry their own VAT compliance.

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
