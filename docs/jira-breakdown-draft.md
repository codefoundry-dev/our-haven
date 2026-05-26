# JIRA breakdown draft — Our Haven v1 (OH project)

> **Status:** draft for review (2026-05-26). Not yet published to JIRA.
> **Source:** PRD-0001 v1.3, project-plan.md v1.3, CONTEXT.md (current), ADR-0001 through ADR-0009.
> **Scope:** Full v1 — Phases 0 through 4 (Discovery → Mobile go-live + soft launch).
> **Approach:** **One Epic per Phase** + tracer-bullet vertical-slice **Stories** under each Epic. Phases 5 (Launch Support), 6 (Web build-out), 7 (Maintenance) are deferred from this batch.
> **HITL** = human-in-the-loop (needs architectural decision, design review, or stakeholder sign-off). **AFK** = independently implementable and mergeable.

---

## Phase Epics (5)

| Key (draft) | Summary |
|---|---|
| E0 | Phase 0 — Discovery & Design Directions (Week 1) |
| E1 | Phase 1 — Figma Prototype & Project Plan (Week 2) |
| E2 | Phase 2 — Backend Foundation & Provider Web Portal (Weeks 3–8) |
| E3 | Phase 3 — Parent + Provider Mobile App on RN/Expo (Weeks 9–17) |
| E4 | Phase 4 — Testing, App Store Submission & Launch (Weeks 18–19) |

Each Epic carries: labels `phase-0` / `phase-1` / `phase-2` / `phase-3` / `phase-4` plus `needs-triage`. Description links the relevant ADR(s) and the PRD section.

---

## Phase 0 — Discovery (7 Stories, all HITL)

| # | Summary | Type | Blocked by | Labels |
|---|---|---|---|---|
| 0.1 | Confirm US-national launch posture + priority Specialist-supply state slate + marketing posture | HITL | — | `phase-0` `client-decision` `needs-triage` |
| 0.2 | Confirm Subscription price + Commission % + Job-board caps (15/Job, 30/Provider/mo) | HITL | — | `phase-0` `client-decision` `needs-triage` |
| 0.3 | Confirm vendors — Checkr (background), Daily.co (video), Stripe Connect Express US (payments) | HITL | — | `phase-0` `client-decision` `needs-triage` |
| 0.4 | Confirm App Store listing posture (single vs dual) + Subscription-gate posture on Job posting (hard vs soft) | HITL | — | `phase-0` `client-decision` `needs-triage` |
| 0.5 | Engage US national-scope privacy counsel; scope = multi-state PIA, Privacy Policy with per-state appendices, ToS, classification addendum pattern, Job-compose consent text | HITL | — | `phase-0` `legal` `needs-triage` |
| 0.6 | Confirm sales-tax registration sequencing (pre-register priority states vs reactive nexus prompts via Stripe Tax) | HITL | 0.1, 0.5 | `phase-0` `legal` `needs-triage` |
| 0.7 | Brand assets handoff + draft 2–3 design directions + sign-off in writing before Phase 1 | HITL | — | `phase-0` `design` `needs-triage` |

**User stories covered:** Phase 0 questions Q1–Q14 in PRD-0001 § Further Notes.

---

## Phase 1 — Figma Prototype (3 Stories)

| # | Summary | Type | Blocked by | Labels |
|---|---|---|---|---|
| 1.1 | Build full Figma prototype — Parent shell + Provider mobile shell + Provider web portal + admin dashboard | HITL | 0.7 | `phase-1` `design` `needs-triage` |
| 1.2 | Finalize project plan with hard dates + final fixed-price quote | HITL | 1.1 | `phase-1` `planning` `needs-triage` |
| 1.3 | Phase 1 demo + scope lock + sign-off from Ci'erro | HITL | 1.2 | `phase-1` `client-decision` `needs-triage` |

---

## Phase 2 — Backend Foundation & Provider Web Portal (18 Stories)

> All Phase 2 Stories assume Phase 1 scope lock (1.3) and ADR-0004 backend stack (Node.js + TypeScript + OpenAPI + Postgres + Firestore + Cloud Run + Firebase Auth, US-region).

| # | Summary | Type | Blocked by | Labels |
|---|---|---|---|---|
| 2.1 | Backend skeleton — Node.js + TS + OpenAPI source-of-truth + Postgres (Cloud SQL) + Firestore (`nam5`) + Cloud Run + Cloud Storage + Cloud Tasks/Scheduler scaffold; US-region pinning; signed-URL upload helper | AFK | 1.3 | `phase-2` `backend` `infra` `needs-triage` |
| 2.2 | Firebase Auth integration — US identity pool; email/password + Google + Apple; admin TOTP MFA mandatory; Provider step-up MFA scaffold for payout-sensitive endpoints | AFK | 2.1 | `phase-2` `backend` `auth` `needs-triage` |
| 2.3 | Provider web portal sign-up — 3-tab role-pick (Parent / Caregiver / Specialist); role permanence enforcement; account creation with `kind` + `caregiver_category` or `specialty` + resident `state` field | AFK | 2.2 | `phase-2` `provider-web` `needs-triage` |
| 2.4 | Provider Verification — email + phone + ID upload; signed-URL storage; admin views uploads; **Verification state machine deep module** (state-agnostic, consumes results not vendor APIs) | AFK | 2.3 | `phase-2` `provider-web` `backend-deep-module` `needs-triage` |
| 2.5 | Checkr standard-package integration — initiate screening, $35 Stripe charge to Provider, webhook ingestion, status pipe to admin; **vendor-agnostic background-check adapter** so a second vendor or statutory-clearance upload path can slot in by config | AFK | 2.4 | `phase-2` `backend` `vendor-checkr` `needs-triage` |
| 2.6 | **Per-state license-board adapter slate** — populated for the ~12 priority Specialist-supply states from 0.1; admin manual verification flow consuming adapter URL/API; "verification pending — state not yet supported" holding state for unsupported states | AFK | 2.4, 0.1 | `phase-2` `backend` `state-adapter` `needs-triage` |
| 2.7 | Per-state home-childcare-licensure adapter — optional state-registered home childcare badge with admin verification (FL DCF FCCH / CA DSS / TX HHSC / NY OCFS / etc.) | AFK | 2.6 | `phase-2` `backend` `state-adapter` `needs-triage` |
| 2.8 | Provider profile builder + Published Rate (hourly Caregiver / per-session Specialist) + optional per-child surcharge (Babysitter/Nanny) + Availability summary (7×3 grid + free-text note + `paused`) + W-10 tax-credit self-attest toggle | AFK | 2.3 | `phase-2` `provider-web` `needs-triage` |
| 2.9 | Stripe Connect Express US onboarding — KYC linkout + webhook + step-up MFA on bank-detail changes & withdrawals; Form 1099-K issuance via Stripe | AFK | 2.2 | `phase-2` `backend` `vendor-stripe` `needs-triage` |
| 2.10 | Stripe Tax integration — per-state nexus tracking + per-state taxability decisions on Subscription + Commission; active across all 50 states at launch | AFK | 2.9, 0.6 | `phase-2` `backend` `vendor-stripe` `needs-triage` |
| 2.11 | Backend deep modules — **Booking lifecycle state machine** + **Cancellation policy calculator** + **Pricing & Commission calculator** (Agreed Rate input); property-based tests via fast-check | AFK | 2.1 | `phase-2` `backend-deep-module` `needs-triage` |
| 2.12 | Backend deep modules — **Job + Application + Offer state machines** + **Application-quota tracker** (per-Provider 30/mo + per-Job 15 cap); atomic Job-Application-Booking materialisation on Direct-Message Book-request acceptance | AFK | 2.11 | `phase-2` `backend-deep-module` `needs-triage` |
| 2.13 | Backend deep modules — **Disintermediation detector** (regex categories; Messages + Offer scope_note) + **Search ranking scorer** (0.5 distance + 0.3 rating + 0.2 recency) + **Rating reveal logic** (blind mutual reveal + asymmetric display) | AFK | 2.1 | `phase-2` `backend-deep-module` `needs-triage` |
| 2.14 | Backend deep module — **Retention/erasure planner** + Cloud Scheduler periodic jobs (30d soft-delete, 7y financial pseudonymization, 3y messages, 6mo bg-check raw); **state-privacy patchwork module** routing per-state deletion-right SLAs (CCPA 45d, FDBR response window, etc.) | AFK | 2.1, 0.5 | `phase-2` `backend-deep-module` `state-adapter` `compliance` `needs-triage` |
| 2.15 | Notifications dispatcher — FCM (mobile push) + VAPID (web push) + SendGrid (email) + Twilio (SMS); channel matrix per event; SMS-mandatory for Booking-request and Job-awarded events | AFK | 2.1 | `phase-2` `backend` `notifications` `needs-triage` |
| 2.16 | Admin dashboard — Provider review queue with Checkr results + per-state license adapter context + decisions captured with timestamp + audit log | AFK | 2.5, 2.6, 2.7 | `phase-2` `admin-web` `needs-triage` |
| 2.17 | Admin dashboard — platform metrics (sign-ups, active Subscriptions, cancellations, Bookings, Jobs posted, Applications filed, Award rate, Provider quota-hit rate) | AFK | 2.16 | `phase-2` `admin-web` `metrics` `needs-triage` |
| 2.18 | Admin dashboard — Trust & Safety role; flagged-thread queue surfacing Messages + Offer scope_notes; investigation-access on demand with free-text reason; audit log on every access | AFK | 2.13, 2.16 | `phase-2` `admin-web` `trust-and-safety` `needs-triage` |

**User stories covered:** PRD-0001 stories 3, 40–49, 63–72, 99, plus all Implementation Decisions / Backend deep modules.

---

## Phase 3 — Parent + Provider Mobile App on RN/Expo (25 Stories)

> All Phase 3 Stories assume Phase 2 demo-ready API + backend deep modules. RN/Expo single binary with role-aware shells; the role-pick screen is shared infrastructure.

### Parent shell (15 Stories)

| # | Summary | Type | Blocked by | Labels |
|---|---|---|---|---|
| 3.1 | RN/Expo app skeleton + Firebase Auth client + 3-tab role-pick screen + ephemeral preview questionnaire (state-only, not persisted) | AFK | 2.2 | `phase-3` `mobile-rn` `shared-shell` `needs-triage` |
| 3.2 | Parent sign-up — Sign in with Apple + Google + email/password; phone optional at sign-up; email verification | AFK | 3.1 | `phase-3` `mobile-rn` `parent` `needs-triage` |
| 3.3 | Sensitive-info consent screen + Child profile CRUD (age + special-needs flags + notes); timestamped consent; full erasure on withdrawal | AFK | 3.2 | `phase-3` `mobile-rn` `parent` `compliance` `needs-triage` |
| 3.4 | Search surface — 4 Category tiles + filter sheet (ZIP/radius/date/Rate ceiling/Rating/Tax-credit-friendly/per-category specialty + Specialist-only sub-filters); hybrid ranking; preview gating (1–2 per category) | AFK | 2.13, 3.2 | `phase-3` `mobile-rn` `parent` `search` `needs-triage` |
| 3.5 | Provider profile view + Availability summary read-only + Ratings display (Provider-public, Parent-aggregate-only) + Message CTA | AFK | 3.4 | `phase-3` `mobile-rn` `parent` `needs-triage` |
| 3.6 | Subscription paywall — fires on first attempt to Message / send Book-request / post Job; web-checkout integration + phone collection/verification + Stripe Subscription webhook + status sync back to mobile | AFK | 2.9, 3.5 | `phase-3` `mobile-rn` `parent` `subscription` `needs-triage` |
| 3.7 | Messaging — thread anchoring (job_id or thread_id); Firestore live listeners; Disintermediation redaction at delivery; Job-context strip | AFK | 2.13, 3.6 | `phase-3` `mobile-rn` `messaging` `needs-triage` |
| 3.8 | Offer composer + Book-request flow (Parent-sent Offers carry `attached_child_ids`) + inline Offer bubble UI with Accept/Counter/Decline; per-child surcharge snapshotted at send | AFK | 3.7, 2.12 | `phase-3` `mobile-rn` `offers` `needs-triage` |
| 3.9 | Direct-Message Book-request acceptance — atomic Job+Application+Booking materialisation; thread rebinds thread_id → job_id; Booking born in `accepted` state | AFK | 3.8 | `phase-3` `mobile-rn` `parent` `needs-triage` |
| 3.10 | Post-a-Job composer (multi-step) + draft autosave + one-time consent warning with timestamped acknowledgement; Subscription gate fires on Publish if unsubscribed | AFK | 3.6, 2.12 | `phase-3` `mobile-rn` `parent` `jobs` `needs-triage` |
| 3.11 | My Jobs list (Open/Awarded/Past/Drafts) + Job detail (Parent view with Applications list + sort + Edit/Close) + Application detail (Provider profile + live Offer card + message link) + Award flow (attach Child + confirm payment → Booking in `requested`) | AFK | 3.10 | `phase-3` `mobile-rn` `parent` `jobs` `needs-triage` |
| 3.12 | Booking payment lifecycle — Stripe authorize-at-booking + capture-at-session-end (hourly) or capture-at-booking (Specialist per-session); 3DS opportunistic; Session confirmation (24h dispute/auto-confirm via Cloud Tasks); Cancellation policy preview + execution | AFK | 2.11, 3.11 | `phase-3` `mobile-rn` `parent` `payments` `needs-triage` |
| 3.13 | Dispute filing flow — 7-day post-completion window; admin queue routing; Payout pause | AFK | 3.12 | `phase-3` `mobile-rn` `parent` `disputes` `needs-triage` |
| 3.14 | Two-way Ratings — 1–5 stars + optional text; 14-day window; blind mutual reveal; asymmetric display | AFK | 3.12 | `phase-3` `mobile-rn` `ratings` `needs-triage` |
| 3.15 | Daily.co ad-hoc embedded video from chat thread (either party initiates); audit log of link generation; ~30 min link validity | AFK | 3.7 | `phase-3` `mobile-rn` `messaging` `vendor-daily` `needs-triage` |

### Provider mobile companion (8 Stories)

| # | Summary | Type | Blocked by | Labels |
|---|---|---|---|---|
| 3.16 | Provider role mobile sign-up (Apple/Google/email) + role-pick mapping kind + caregiver_category / specialty + resident state | AFK | 3.1, 2.3 | `phase-3` `mobile-rn` `provider` `needs-triage` |
| 3.17 | Provider mobile onboarding stack — Category, profile, Rate + per-child surcharge, ID upload (camera), Checkr initiation (WebView), Specialist license form (state-board selector driven by adapter slate); linkout-to-web pattern with signed handoff token for Stripe KYC + license docs + insurance + state home-childcare registration | AFK | 3.16, 2.5, 2.6, 2.7 | `phase-3` `mobile-rn` `provider` `web-linkout` `needs-triage` |
| 3.18 | Provider mobile shell — Opportunities / Schedule / Messages / Account bottom nav; pre-activation empty states explaining onboarding blockers | AFK | 3.16 | `phase-3` `mobile-rn` `provider` `needs-triage` |
| 3.19 | Opportunities tab — open Jobs feed (rank: recency + distance + Specialist sub-category filter) + My Applications (date-grouped) + monthly quota subheader (N/30) + Job filter sheet + Job detail (Provider view) | AFK | 3.18, 2.12 | `phase-3` `mobile-rn` `provider` `jobs` `needs-triage` |
| 3.20 | Provider Application composer + first Offer composer (shared with Parent Offer composer) + Application withdrawal + Application detail with edit/withdraw | AFK | 3.19, 3.8 | `phase-3` `mobile-rn` `provider` `jobs` `needs-triage` |
| 3.21 | Schedule tab — Today view + sticky Active-session banner with elapsed timer + pending Book-requests deep-link to thread + pending awarded Bookings (24h confirm) + Upcoming view + mobile-native Availability editor (7×3 grid + note + paused toggle) | AFK | 3.18, 3.8 | `phase-3` `mobile-rn` `provider` `schedule` `needs-triage` |
| 3.22 | Active session controls — Mark in-progress (transitions Booking to `in-progress`) + End session & Propose hours (transitions to `awaiting-confirmation`) | AFK | 3.21, 2.11 | `phase-3` `mobile-rn` `provider` `schedule` `needs-triage` |
| 3.23 | Provider Account tab — Profile/Rate/Availability mobile-native edits + Verification docs / Bank details / Withdraw routed via linkout-to-web + read-only Payouts list + notifications preferences | AFK | 3.18 | `phase-3` `mobile-rn` `provider` `needs-triage` |

### Cross-cutting (2 Stories)

| # | Summary | Type | Blocked by | Labels |
|---|---|---|---|---|
| 3.24 | Notification channel matrix — Parent + Provider; push (FCM) + email (SendGrid) + SMS (Twilio) routing per event; SMS-mandatory for Booking-request received & Job-awarded (Provider) and inside-24h cancellation (both); marketing opt-in separate from transactional | AFK | 2.15, 3.2, 3.16 | `phase-3` `mobile-rn` `notifications` `needs-triage` |
| 3.25 | No-show flows — Provider no-show (Parent full refund + admin flag, 2 flagged → manual review, 3 → suspension); Parent no-show (Provider reports within 2h + Parent 24h contest + 50% payout if uncontested) | AFK | 3.12, 2.16 | `phase-3` `mobile-rn` `bookings` `needs-triage` |

**User stories covered:** PRD-0001 stories 1–39, 50–62, 78–115 (Parent + Provider mobile + cross-cutting).

---

## Phase 4 — Testing, App Store Submission & Launch (7 Stories)

| # | Summary | Type | Blocked by | Labels |
|---|---|---|---|---|
| 4.1 | QA testing across iOS + Android, **both roles tested separately**; golden-path + edge-case + regression matrix; bug-fix sweep | AFK | 3.25 (all Phase 3 done) | `phase-4` `qa` `needs-triage` |
| 4.2 | PIA (multi-state US privacy patchwork) authored by US privacy counsel + reviewed by Ci'erro's lawyers + signed off | HITL | 0.5, 2.14 | `phase-4` `legal` `compliance` `needs-triage` |
| 4.3 | Privacy Policy (with per-state appendices + vendor data-flow inventory + sensitive-info consent + Job-description disclosure paragraph) + Terms of Service (with per-state classification addendum pattern) lawyer sign-off | HITL | 4.2 | `phase-4` `legal` `compliance` `needs-triage` |
| 4.4 | App Store submission + listing copy (consumer-marketplace shape, national posture) + Apple review remediation | HITL | 4.1, 4.3 | `phase-4` `release` `needs-triage` |
| 4.5 | Play Store submission + listing copy + Google review remediation | HITL | 4.1, 4.3 | `phase-4` `release` `needs-triage` |
| 4.6 | Production environment cut — promote from staging to prod + smoke checks + admin dashboard handoff to Ci'erro + known-issues log | AFK | 4.1 | `phase-4` `release` `infra` `needs-triage` |
| 4.7 | National launch marketing assets + PR plan (per Phase 0 marketing posture) + Phase 4 demo Zoom kickoff with Ci'erro | HITL | 4.4, 4.5, 4.6, 0.1 | `phase-4` `marketing` `client-decision` `needs-triage` |

**User stories covered:** PRD-0001 cross-cutting compliance stories 73–77 (handled by 4.2 + 4.3 + 4.6) + § Mandatory pre-launch deliverables.

---

## Summary

- **Total tickets:** 5 Epics + 60 Stories = **65 issues**
- **HITL count:** ~14 (mostly Phase 0 client decisions, Phase 1 sign-off, Phase 4 release + legal gates)
- **AFK count:** ~46 (most Phase 2 + Phase 3 implementation work)
- **Critical dependency chains:**
  - Backend skeleton (2.1) → Auth (2.2) → Provider sign-up (2.3) → Verification (2.4) → Checkr + state adapters (2.5/2.6/2.7) → Admin review queue (2.16)
  - Backend deep modules (2.11/2.12/2.13/2.14) feed every mobile slice in Phase 3
  - RN/Expo skeleton (3.1) → role-aware sign-up branches (3.2 Parent, 3.16 Provider) → role-specific surfaces
  - Phase 3 must complete before QA (4.1); legal sign-off (4.2/4.3) gates App Store / Play Store submission (4.4/4.5)
- **Labels strategy:** every ticket gets `needs-triage` + the relevant `phase-N` label. Additional category labels: `backend`, `backend-deep-module`, `mobile-rn`, `parent`, `provider`, `admin-web`, `provider-web`, `messaging`, `jobs`, `offers`, `subscription`, `payments`, `state-adapter`, `compliance`, `legal`, `client-decision`, `design`, `qa`, `release`, `marketing`, `vendor-checkr`, `vendor-stripe`, `vendor-daily`, `notifications`, `trust-and-safety`, `infra`, `auth`, `metrics`, `search`, `ratings`, `disputes`, `schedule`, `bookings`, `web-linkout`, `shared-shell`, `planning`.

## Questions for you before I publish

1. **Granularity check:** Phase 2 has 18 Stories and Phase 3 has 25. Phase 3 in particular is large because RN/Expo Parent + Provider companion + cross-cutting is a lot. Want me to merge any of these further, or are they at the right size?
2. **Dependency rigor:** I've put "blocked by" links on the obvious chains, but I could be looser (only mark hard blockers) or tighter (mark soft sequencing too). Default = obvious chains only. OK?
3. **Are any Phase 0 questions you want broken out as separate tickets** rather than bundled (0.1 currently bundles 3 client decisions, 0.2 bundles 3, 0.3 bundles 3)? Each is independently HITL but they tend to come up in one Zoom.
4. **Phase 5 / 6 / 7** — should I add a tiny placeholder Epic for each (no Stories yet) so the backlog reflects the full project, or leave them off until they're closer?
5. **Assignee / Sprint / Fix version** — should I set any of these on creation, or leave triage to do it?
