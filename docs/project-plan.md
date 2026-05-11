# Project Plan

**Client:** Ci'erro Kennedy
**Prepared by:** JD, The Codefoundry
**Date:** 5 de mayo de 2026
**Last revised:** 2026-05-11 (jurisdiction pivot from UK to Miami/Florida — see ADR-0003; post-discovery grilling output in `CONTEXT.md` and `docs/adr/`)

---

## Project Overview

- A two-sided marketplace mobile app connecting parents with vetted Providers — Babysitters, Tutors, Nannies, and Specialists (speech, ABA, occupational therapy, and other licensed clinical services)
- Inclusive offering for families with neurodivergent and neurotypical children
- Phase 1 categories: **Babysitter, Tutor, Nanny, Specialist**
- **Mobile app for Parents** (iOS and Android), **web portal for Providers**, plus admin dashboard for the Our Haven team
- Built on Flutter so a public web app for Parents can be added later from the same codebase
- **Launch jurisdiction: Miami, Florida** (pending final client confirmation in Phase 0); Florida statewide compliance with state-pluggable adapters for near-term US expansion. Currency USD; subject to a sectoral US patchwork — Florida Digital Bill of Rights (FDBR), COPPA, HIPAA-adjacent prudence for special-needs notes, FIPA breach notification, IRS / Florida 1099 worker classification, and Florida sales tax (largely exempt for in-scope services). See ADR-0003

---

## Project Phases

### Phase 0 — Discovery & Design Directions (Week 1)

- **Demo:** Discovery document and design direction options
- **Deliverable:** Loom video walkthrough of the discovery document and 2-3 design direction concepts (mood boards, color application, typography samples, sample screen styles)
- **Sign-off:** Ci'erro reviews and picks a direction in writing before Phase 1 begins

**Activities:**

- Lock final feature list
- **Confirm Miami / Florida as launch market** (working assumption; if it changes to another US state, the per-state compliance adapters re-point; if it changes outside the US, the work re-platforms)
- **Confirm background-check vendor** (working assumption: **Checkr**, Florida Level 2 fingerprint screening + National Sex Offender Registry)
- Confirm embedded video provider (working assumption: Daily.co — US rooms)
- **Confirm Stripe Connect Express (US entity)** as the account type (commission-skim marketplace model; Form 1099-K reporting handled by Stripe)
- **Confirm US privacy counsel** (boutique privacy firm or larger firm's privacy practice)
- Confirm soft-launch neighborhood emphasis within Miami-Dade (or tri-county Dade/Broward/Palm Beach)
- **Florida Department of Revenue sales-tax registration call** (counsel-confirmed; likely not required for v1 service mix, but the call goes on the record)
- Brand assets handoff from Ci'erro's marketing person
- Draft 2-3 distinct design directions

---

### Phase 1 — Figma Prototype & Project Plan (Week 2)

- **Demo:** Clickable Figma prototype of the full app and detailed project plan with weekly timelines
- **Deliverable:** Zoom call walkthrough of the Figma prototype where Ci'erro can click through every screen, plus the detailed project plan document with week-by-week milestones, demo dates, and final fixed-price quote

**Activities:**

- Build full Figma prototype based on chosen design direction
- Map every screen for Provider web portal, Parent mobile app, and admin dashboard
- Finalize project plan with hard dates
- Deliver final fixed-price quote based on what is actually being built

---

### Phase 2 — Provider Web Portal & Backend Foundation (Weeks 3–7)

> Timeline expanded from 4 weeks to 5 weeks to absorb differentiated Specialist verification, Stripe Tax setup, and Provider-side notification plumbing.

- **Demo:** Working Provider sign-up flow on staging
- **Deliverable:** Zoom call walkthrough where Ci'erro creates a test Provider account, uploads documents, completes a real Florida Level 2 background screening, and reviews the admin dashboard

**Activities:**

- Provider sign-up flow with **category-aware document set** (Babysitter / Tutor / Nanny / Specialist)
- Provider Verification: email verification, phone verification, government ID upload, **Florida Level 2 Background Screening** (FBI + FDLE fingerprint-based check against the AHCA / DCF Care Provider Background Screening Clearinghouse) plus a National Sex Offender Registry check, via **Checkr** (per-check cost ~$50–80 + small platform markup, paid by the Provider at sign-up). Background-check integration is wrapped behind a vendor-agnostic per-state adapter for Phase 2 US expansion
- **Specialist additional verification:** professional license number + issuing Florida board (FL Board of SLP & Audiology / Occupational Therapy Practice / Psychology / Behavior Analysis / Medicine / Osteopathic Medicine / Nursing), license document upload, liability insurance certificate — verified manually by admin against the FL DOH MQA license verification portal (no third-party verification vendor in v1). License-board lookup wrapped in a per-state adapter (Florida first)
- **Babysitter / Nanny tax-credit badge:** self-attestation toggle for issuing IRS Form W-10 → "Tax-credit-friendly" badge surfaced on profile. Optional: **Family Child Care Home (FCCH)** registration upload under FL DCF licensing → admin verification → "DCF-registered FCCH" badge
- Profile builder, including Rate setting (hourly + optional per-child surcharge for Babysitter/Nanny; per-session for Specialist), Availability calendar, certifications upload
- Stripe Connect Express (US entity) onboarding for Providers; Form 1099-K issuance handled automatically by Stripe
- **Stripe Tax integration** for Subscription and Commission sales-tax computation (Florida v1 is largely non-taxable for in-scope services; the integration is wired up so US-expansion states light up by configuration)
- Admin dashboard v1: Provider review queue (background-check results, license verification for Specialists, FCCH certificate verification, approve/reject), basic metrics (sign-ups, active Subscriptions, cancellations, Bookings)
- Trust & Safety admin role with audit-logged thread access (flagged-thread queue + on-demand investigation access)
- Authentication (Firebase Auth, US region): email/password + Sign in with Google for Provider web portal; admin TOTP MFA mandatory; Provider step-up MFA on payout-sensitive actions
- Provider-side notification plumbing: web push + email (SendGrid) + SMS (Twilio) for Booking-request, cancellation, and session-reminder events

---

### Phase 3 — Parent Mobile App, Search & Booking (Weeks 8–11)

> Timeline expanded from 3 weeks to 4 weeks to absorb the notification matrix, sensitive-information consent flow, embedded video, and the full Booking lifecycle (request-to-accept + Availability + Session confirmation + dispute path).

- **Demo:** End-to-end Parent journey on TestFlight
- **Deliverable:** TestFlight (iOS) and Google Play Internal Testing (Android) builds installed on Ci'erro's phone (if no developer accounts yet, will send an APK) plus Loom video walkthrough showing Parent sign-up → search → preview → subscribe → message → book → pay

**Activities:**

- Flutter Parent app build
- Parent account with multiple Child profiles (one Parent account holds all Children — each Child has their own profile with age, special-needs flags, and notes)
- **Sensitive-information explicit consent flow** at sign-up for processing special-needs flags / notes (COPPA-aware + HIPAA-adjacent + FDBR-aligned; timestamped, re-prompt on material privacy-policy changes, full erasure on consent withdrawal)
- Authentication (Firebase Auth, US region): Sign in with Apple + Sign in with Google + email/password; phone verified once at sign-up; device-trust SMS OTP only on new-device or suspicious sign-in
- Parent verification at sign-up (email + phone) and **payment method capture with cardholder-name soft-signal fraud check** (mismatch flags the account for additional review on early Bookings; does not hard-block)
- Location-based search with v1 filters: Category, ZIP code + radius (default 5 miles), date/time intersected with Provider Availability, hourly Rate ceiling, minimum star Rating, Tax-credit-friendly toggle (Babysitter/Nanny only — Form W-10 self-attested), per-category specialty
- Hybrid ranking: `0.5 × distance + 0.3 × rating + 0.2 × recency-active`
- Preview gating (1–2 Providers visible without Subscription)
- **Parent Subscription** billed only on web (Stripe-hosted page) — not via iOS/Android in-app purchase. Discount codes via Stripe Promotion Codes apply to Subscription only
- Standard encrypted messaging (in transit and at rest) with regex-based **disintermediation detection** (phone numbers, email addresses, social handles, payment app names, address-like patterns) → matched substrings **redacted** in delivered message; unredacted original queued for Trust & Safety review. Disclosed in Privacy Policy
- Booking lifecycle: **Availability calendar with block-on-request semantics**, **request-to-accept** flow (24h Provider response window, auto-decline on expiry), **single-child constraint for Tutor/Specialist** (multi-child supported for Babysitter/Nanny with optional per-child surcharge)
- Payments: **authorize at booking, capture at session end** for hourly Bookings; capture at booking time for per-session Specialist Bookings. Stripe Connect `application_fee_amount` skims platform Commission from the Provider's Rate. **3DS is supported but not mandatory** — applied opportunistically by Stripe for fraud reduction on high-risk transactions (no PSD2-style universal SCA requirement in the US)
- **Session confirmation flow:** Provider proposes final hours; Parent has 24h to dispute, otherwise auto-confirms and Payout releases
- **Cancellation policy** (single platform-wide rule for v1): free ≥24h before start, 50% inside 24h, 100% inside 2h or after start. Free Provider-initiated cancellation but tracked
- **No-show flows** (Provider no-show → Parent full refund + admin flag; Parent no-show → Provider receives 50% of estimated total if uncontested)
- **Dispute** flow with 7-day post-completion window (in-app, not email-the-team)
- **Two-way Ratings** (1–5 stars + optional text) with 14-day window post-completion, **mutual blind reveal** (Airbnb-style), asymmetric display (Provider Ratings public with text; Parent Ratings visible only to Providers, aggregate-only, no text)
- All Providers start fresh — no review imports from other platforms
- App-feedback collection from Parents after first Booking (incentive structure to be confirmed by Ci'erro)
- **Embedded video** (Daily.co) for Parent ↔ Provider interview calls
- Notifications matrix:
  - Parent: push + email for Booking accepted/declined/expired, new message, session start reminder, awaiting-confirmation notice; push + email + SMS for cancellations inside the 24h window
  - Provider: SMS + email + web push for new Booking request (mandatory; no v1 opt-out); SMS for session start reminder; email for Payout received, background-check status, Verification approved
  - Marketing/promotional messages require a separate explicit opt-in distinct from transactional
- **Promotions:** discount codes only (Stripe Promotion Codes wrapper, applies to Subscription). Referral system and targeted/cohort promotions are deferred to post-launch and quoted separately

---

### Phase 4 — Testing, App Store Submission & Soft Launch (Weeks 12–13)

- **Demo:** Apps live in App Store and Play Store
- **Deliverable:** App deployed and live in the Apple App Store and Google Play Store, plus a Zoom call kickoff with Ci'erro to walk through the live production environment, admin dashboard access, and known issues log

**Activities:**

- QA testing across iOS and Android
- Bug fixes
- App Store submission (1–7 day review window)
- Play Store submission
- Marketing assets for store listings
- **PIA (Privacy Impact Assessment, FDBR data-protection-assessment-aligned)** authored by US privacy counsel, reviewed by Ci'erro's lawyers, signed off before launch
- **Vendor data-flow inventory** appendix to Privacy Policy (lists every US-region vendor and what personal data flows through them)
- Soft-launch marketing focused on Miami-Dade — the app is available throughout Florida from day one, but marketing and outreach concentrate on the Miami metro to seed early Provider and Parent supply

---

### Phase 5 — Launch Support (60 days post-launch)

- **Demo:** Weekly bug fix reports
- **Deliverable:** Bi-weekly Loom updates summarizing fixes shipped, plus a monthly Zoom call to review metrics from the admin dashboard and prioritize the next round of fixes

**Activities:**

- Monitor real-world usage
- Fix bugs
- Address App Store review issues if rejected
- Monitor Provider onboarding speed
- Support Ci'erro through her marketing push

---

### Phase 6 — Public Web App Build-Out (Weeks 14–16)

- **Demo:** Public-facing web app live at Our Haven's domain
- **Deliverable:** Web app deployed to production at the live domain, plus a Zoom call walkthrough showing Parents and Providers signing up, logging in, and using the app from a browser

**Activities:**

- Spin up web build from existing Flutter codebase (Parent web experience; Provider web portal already exists from Phase 2)
- Adapt layouts for desktop and tablet screens
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
    - **Checkr** Florida Level 2 background-screening fees (~$50–80/check + fingerprinting where required, passed through to Providers with platform markup)
    - Stripe transaction fees (standard US rates) + Stripe Tax (~0.5% per taxable transaction) + Stripe Connect Express (Form 1099-K issuance included)
    - Daily.co per-participant-minute fees (~$0.004/min/participant; US rooms)
    - Twilio SMS fees (~$0.0075/SMS to US numbers + carrier fees)
    - SendGrid email (volume-based)
    - US privacy counsel retainer or per-engagement fees (replaces the UK fractional-DPO retainer; Phase 0 firm-pick determines structure)
    - Hosting and infrastructure costs (estimated separately at end of discovery; GCP US region — `us-east1` default, `us-east4` fallback)

---

## Scope Lock

- Scope locked at end of Phase 1
- Any new features after Phase 1 require a written change order with separate quote
- Items explicitly out of scope for v1:
    - AI-generated parent profiles from Provider reviews
    - Custom matching/recommendation algorithm (v1 uses the hybrid scoring formula above)
    - Custom in-app video call feature (Daily.co embedded video is in v1; a fully integrated custom video solution is a future add-on, quoted separately)
    - Deep user analytics and behavioural tracking (basic metrics in v1; user flow analytics deferred until key metrics are defined)
    - Provider mobile app (Provider portal is web-only in v1 — see ADR-0002)
    - Live-in / salaried Nanny contract abstraction (Nannies in v1 are modeled as long-engagement hourly Bookings)
    - Per-Provider cancellation policies (single platform-wide policy in v1)
    - Referral system and targeted/cohort promotions
    - Editorial / featured search slots and admin-driven Provider boosting
    - Provider gender as a search filter (federal Title VII / Florida Civil Rights Act protected class — deferred pending product/legal review)
    - Automated Specialist license verification via third-party vendor (manual admin verification in v1)
    - In-app notification inbox

---

## Dependencies on Ci'erro

These items must be delivered on time or the timeline shifts:

- Brand assets (fonts, colors, logo files) by end of Phase 0
- Apple Developer and Google Play accounts registered and verified by end of Week 2
- Stripe account set up by end of Week 2 (Stripe Connect Express, US entity)
- **Florida Department of Revenue position** confirmed by Ci'erro's tax counsel before launch (likely no sales-tax registration required for the v1 service mix, but the call goes on the record)
- **US privacy counsel engagement** confirmed by end of Phase 1
- **Soft-launch neighborhood / tri-county emphasis decision** by end of Phase 0
- **App-feedback-after-first-booking incentive structure** decision by end of Phase 1
- **Miami / Florida launch confirmation** (or alternative US-state call) by end of Phase 0
- Privacy Policy drafted by Ci'erro's lawyers before Phase 4 launch (must include disclosure that the Trust & Safety team can access message content, plus the vendor data-flow inventory and the sensitive-information consent text — COPPA-aware + HIPAA-adjacent + FDBR-aligned)
- Lawyer sign-off on Terms of Service before Phase 4 launch
- **US Provider classification language** drafted by Ci'erro's lawyers before launch (1099 independent contractor under IRS common-law test + Florida-specific factors)
- Background-check vendor (Checkr) confirmed by JD during Phase 0

---

## Timeline Summary

> **Total project length: 16 weeks** from contract signing to web app live (13 weeks to mobile app stores, plus 3 weeks for web app build-out). This is **2 weeks longer** than the original 14-week estimate; the expansion absorbs the discovery output (Florida-specific verification, full Booking lifecycle, FDBR/PIA/COPPA-aware privacy work, notification matrix).

- **Plus:** 60 days of launch support after mobile go-live
- **Plus:** Optional ongoing maintenance after launch support ends

**Key dates locked at Phase 1:**

- Phase 0 demo (end of Week 1)
- Phase 1 demo and final quote (end of Week 2)
- Phase 2 demo (end of Week 7)
- Phase 3 demo on TestFlight (end of Week 11)
- App Store submission (Week 12)
- Mobile apps live in stores (end of Week 13)
- Web app live (end of Week 16)
