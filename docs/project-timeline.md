## Project Overview

- A marketplace mobile app connecting parents with vetted caregivers, tutors, nannies, and providers (speech, ABA, therapy, and professional service specialists)
- Inclusive offering for families with neurodivergent and neurotypical children
- Phase 1 services: babysitting, tutoring, nanny, and providers
- Mobile app for parents and caregivers (iOS and Android) plus admin dashboard for the Our Haven team
- Built on Flutter so a public web app can be added later from the same codebase

---

## Project Milestones

### Milestone 0 — Discovery & Design Directions (Week 1)

- **Demo:** Discovery document and design direction options
- **Deliverable:** Loom video walkthrough of the discovery document and 2-3 design direction concepts (mood boards, color application, typography samples, sample screen styles)
- **Sign-off:** Ci'erro reviews and picks a direction in writing before Milestone 1 begins

**Activities:**

- Lock final feature list
- Confirm Checkr (or alternative) as background check vendor and per-check cost
- Research and confirm embedded video provider (Zoom, Google Meet, or alternative)
- Confirm Stripe account type required (standard or Connect)
- Brand assets handoff from Ci'erro's marketing person
- Draft 2-3 distinct design directions

---

### Milestone 1 — Figma Prototype & Project Plan (Week 2)

- **Demo:** Clickable Figma prototype of the full app and detailed project plan with weekly timelines
- **Deliverable:** Zoom call walkthrough of the Figma prototype where Ci'erro can click through every screen, plus the detailed project plan document with week-by-week milestones, demo dates, and final fixed-price quote

**Activities:**

- Build full Figma prototype based on chosen design direction
- Map every screen for caregiver web portal, parent mobile app, and admin dashboard
- Finalize project plan with hard dates
- Deliver final fixed-price quote based on what is actually being built

---

### Milestone 2 — Caregiver Web Portal & Backend Foundation (Weeks 3–6)

- **Demo:** Working caregiver sign-up flow on staging
- **Deliverable:** Zoom call walkthrough where Ci'erro creates a test caregiver account, uploads documents, completes a real Checkr background check, and reviews the admin dashboard

**Activities:**

- Caregiver sign-up flow
- Caregiver verification: email verification, phone verification, ID upload, background check via Checkr
- Profile builder (babysitter, tutor, nanny, provider categories)
- Document upload for certifications
- Checkr API integration for background checks
- Admin dashboard v1 (caregiver review queue with approve/reject, plus basic metrics: sign-ups, active subscriptions, cancellations, bookings)
- Stripe subscription page on web
- Authentication

---

### Milestone 3 — Parent Mobile App, Search & Booking (Weeks 7–9)

- **Demo:** End-to-end parent journey on TestFlight
- **Deliverable:** TestFlight (iOS) and Google Play Internal Testing (Android) builds installed on Ci'erro's phone (if no developer accounts yet, will send an APK) plus Loom video walkthrough showing parent sign-up → search → preview → subscribe → message → book → pay

**Activities:**

- Flutter parent app build
- Family account with multiple child profiles (one parent account holds all children — each child has their own profile with age, special needs flags, and notes)
- Parent verification: email verification and phone verification at sign-up; verified payment method required before booking (card name must match account name)
- Location-based search with filters
- Preview gating (1-2 caregivers visible without subscription)
- Standard encrypted messaging (in transit and at rest) with number/word detection — Our Haven team can access message content for fraud detection and safety
- Booking flow
- In-app payment via Stripe web redirect
- Two-way ratings
- Caregivers cannot import reviews from other platforms — all caregivers start fresh
- App feedback collection from parents after first booking (incentive structure to be defined)
- Video call scheduling for parent-caregiver interviews (embedded third-party video — provider TBD)
- Promotions system: discount codes, referral system, and targeted promotions (final scope to be confirmed during discovery)

---

### Milestone 4 — Testing, App Store Submission & Soft Launch (Weeks 10–11)

- **Demo:** Apps live in App Store and Play Store
- **Deliverable:** App deployed and live in the Apple App Store and Google Play Store, plus a Zoom call kickoff with Ci'erro to walk through the live production environment, admin dashboard access, and known issues log

**Activities:**

- QA testing across iOS and Android
- Bug fixes
- App Store submission (1-7 day review window)
- Play Store submission
- Marketing assets for store listings
- Soft launch marketing focused on one geographic area — the app is available everywhere from day one, but marketing and outreach concentrate on a single market to seed early caregiver and parent supply

---

### Milestone 5 — Launch Support (60 days post-launch)

- **Demo:** Weekly bug fix reports
- **Deliverable:** Bi-Weekly Loom updates summarizing fixes shipped, plus a monthly Zoom call to review metrics from the admin dashboard and prioritize the next round of fixes

**Activities:**

- Monitor real-world usage
- Fix bugs
- Address App Store review issues if rejected
- Monitor caregiver onboarding speed
- Support Ci'erro through her marketing push

---

### Milestone 6 — Public Web App Build-Out (Weeks 12–14)

- **Demo:** Public-facing web app live at Our Haven's domain
- **Deliverable:** Web app deployed to production at the live domain, plus a Zoom call walkthrough showing parents and caregivers signing up, logging in, and using the app from a browser

**Activities:**

- Spin up web build from existing Flutter codebase
- Adapt layouts for desktop and tablet screens
- Connect to existing backend, authentication, and Stripe flows
- QA across major browsers (Chrome, Safari, Firefox, Edge)
- Domain setup and SSL
- Sitemap and basic SEO

---

### Milestone 7 — Ongoing Maintenance

- **Demo:** Monthly health report
- **Deliverable:** Monthly Loom video covering platform health, security updates, fixes shipped, and recommendations
- New features quoted separately

---

### Additional Costs Outside Scope

- New feature development after launch (quoted separately)
- Third-party service costs paid directly by Ci'erro:
    - Apple Developer account (~$99/year)
    - Google Play Developer account (~$25 one-time)
    - $Checkr per-check fees (passed through to caregivers with platform markup)
    - Stripe transaction fees (standard rates)
    - Hosting and infrastructure costs (estimated separately at end of discovery)

---

## Scope Lock

- Scope locked at end of Milestone 1
- Any new features after Milestone 1 require a written change order with separate quote
- Items explicitly out of scope for v1:
    - AI-generated parent profiles from caregiver reviews
    - Custom matching/recommendation algorithm
    - Custom in-app video call feature (embedded third-party video calls are in v1; a fully integrated custom video solution is a future add-on, quoted separately)
    - Deep user analytics and behavioural tracking (basic metrics in v1; user flow analytics deferred until key metrics are defined)
    

---

## Dependencies on Ci'erro

These items must be delivered on time or the timeline shifts:

- Brand assets (fonts, colors, logo files) by end of Milestone 0
- Apple Developer and Google Play accounts registered and verified by end of Week 2
- Stripe account set up by end of Week 2 (account type — standard or Connect — to be confirmed by JD)
- Privacy Policy drafted by Ci'erro's lawyers before Milestone 4 launch (must include disclosure that the team can access message content)
- Lawyer sign-off on Terms of Service before Milestone 4 launch
- Caregiver classification language drafted by Ci'erro's lawyers before launch
- Background check vendor decision confirmed by JD during Milestone 0

---

## Timeline Summary

- **Total project length:** 14 weeks from contract signing to web app live (11 weeks to mobile app stores, plus 3 weeks for web app build-out)
- **Plus:** 60 days of launch support after mobile go-live
- **Plus:** Optional ongoing maintenance after launch support ends

**Key dates locked at Milestone 1:**

- Milestone 0 demo (end of Week 1)
- Milestone 1 demo and final quote (end of Week 2)
- Milestone 2 demo (end of Week 6)
- Milestone 3 demo on TestFlight (end of Week 9)
- App Store submission (Week 10)
- Mobile apps live in stores (end of Week 11)
- Web app live (end of Week 14)