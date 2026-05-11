# Backend stack and cross-platform API — Node + TypeScript, OpenAPI-first REST, Postgres + Firestore split, GCP `us-east`

**Status:** accepted (2026-05-08; region updated 2026-05-11 to track the Miami/Florida pivot in ADR-0003)

## Context

Our Haven v1 has three clients — the Parent Flutter mobile app, the Provider web portal, and the admin dashboard — plus several inbound webhook integrations (Stripe, the chosen background-check vendor — Checkr in v1 — optionally Daily.co). They all need to talk to the same backend with the same authentication model and the same data integrity guarantees.

The PRD originally hand-waved at "the API layer" without naming a stack. That was a real gap: the backend language, the API protocol, the database, the hosting region, and the messaging real-time path are not interchangeable choices — each ripples into vendor SDK fit, US data-residency posture and FDBR data-flow inventory (ADR-0003), audit-log durability for the PIA, and the typed-client experience across two languages (Dart for Flutter, TypeScript for the two web surfaces).

## Decision

The v1 backend stack:

1. **Node.js + TypeScript** as the backend runtime and language.
2. **OpenAPI-first REST + JSON** as the API protocol; the OpenAPI spec is the source of truth for typed Dart clients (Flutter) and typed TypeScript clients (Provider web portal + admin dashboard).
3. **PostgreSQL as the system of record** (Bookings, Sessions, Payments, Ratings, Verifications, retention/audit logs).
4. **Firestore as a real-time fan-out for messaging events only** — messages are persisted to Postgres for retention/audit; the chat surface listens to Firestore for live delivery.
5. **GCP Cloud Run + Cloud SQL (Postgres) + Cloud Storage**, all in **`us-east1`** (South Carolina) — the default v1 region; `us-east4` (Northern Virginia) is the documented fallback if any required GCP feature is missing in `us-east1`. **Firestore** is configured for **`nam5`** US multi-region. This satisfies US data residency under ADR-0003 and gives reasonable latency to Miami.
6. **Cloud Tasks** for delayed jobs (Booking 24h expiry, Session 24h auto-confirm, retention scheduled runs), **Cloud Scheduler** for periodic jobs.
7. **Firebase Authentication ID tokens** for client→backend auth; the Firebase Admin SDK verifies tokens server-side on every request.
8. **Stripe and Checkr webhooks** terminate on dedicated signed-payload endpoints and are translated into Booking lifecycle / Verification workflow events for the deep modules. (The background-check webhook endpoint is generic over the vendor — Checkr in v1, with the option to swap vendors per state via the per-state adapter pattern in ADR-0003.)

## Why

- **Node + TypeScript has the best SDK fit for this specific integration list** — Stripe Connect, Stripe Tax, Twilio, SendGrid, Firebase Admin, Daily.co, Cloud Tasks, Checkr (and the major US background-check vendors generally). Choosing a language that requires hand-rolled clients for any of these costs more than the language choice itself.
- **TypeScript also matches the Provider web portal and admin dashboard** (both will be TS web apps). Backend ↔ web frontend share types via the OpenAPI codegen step; tribal knowledge transfers freely between surfaces.
- **OpenAPI-first REST** is the only protocol that produces typed clients in **both Dart (Flutter) and TypeScript (web)** without bespoke effort. tRPC was considered but breaks for Flutter — no native client; GraphQL adds operational complexity (caching, N+1, schema evolution) that doesn't pay off at v1 scale.
- **Postgres** is required for the audit trail that the PIA will reference, for the 7-year financial-record retention with pseudonymization, for relational integrity across Bookings/Sessions/Payouts, and for the Booking lifecycle state machine's transactional needs. NoSQL alternatives are not credible for a financial marketplace under FDBR / FIPA / COPPA-aware audit pressure.
- **Firestore for messaging real-time only** — the Flutter and web SDKs both natively support live document listeners, which is exactly what live chat needs. Building this on top of a self-managed WebSocket layer would consume real engineering time. Firestore is system-of-truth for the *live event stream*, not for retention; Postgres remains the canonical message store.
- **GCP `us-east1`** (with `us-east4` as the documented fallback) keeps all personal data inside US borders, satisfies ADR-0003's US-residency posture, and co-locates Firebase Auth, Cloud Run, Cloud SQL, Cloud Storage, Cloud Tasks, and Firestore in a single project — simpler IAM, simpler billing, simpler data-flow inventory for the PIA / FDBR DPA. Latency to Miami is acceptable from either region; `us-east1` is the cheapest with the broadest feature coverage.
- **Cloud Run scale-to-zero** keeps hosting costs low at v1 scale (a marketplace seeding the Miami metro) without the operator burden of Kubernetes.
- **Firebase Auth ID tokens** mean the auth system from ADR-0001/PRD already terminates correctly at the backend; no separate JWT issuance pipeline needed.

## Considered alternatives

- **Python (FastAPI) backend.** Strong ecosystem but second-tier SDK fit for this specific marketplace stack; team-language alignment with the TypeScript web surfaces is lost.
- **Go backend.** Excellent for performance and concurrency; SDK coverage for niche US background-check vendors is weaker than Node/TS; team-language alignment lost.
- **Dart backend (Dart Frog / Serverpod).** Tempting for code-share with Flutter, but the ecosystem maturity for Stripe Connect's nuanced flows, Twilio, and US background-check vendor APIs is limited and would slow development.
- **tRPC.** Cleaner for the web surfaces but no Dart client; would force Flutter onto a separate REST surface — splitting the contract.
- **GraphQL.** Operational complexity (caching layer, schema federation, N+1) without a clear v1 win; the query flexibility argument doesn't apply when the same team controls both server and clients.
- **Postgres-only (no Firestore).** Workable for chat via WebSockets + a pub/sub layer (e.g., Postgres `LISTEN/NOTIFY` + a relay), but the engineering cost is real and Firestore is already paid for inside the Firebase project.
- **Firestore as system-of-record.** Wrong for relational financial data and audit trails; serious retention complexity (Firestore retention is per-document, not policy-driven), and the COPPA/HIPAA-adjacent audit posture wants a single relational system of record.
- **AWS or Azure hosting.** Both viable in US regions (`us-east-1` / `East US 2`); chosen against because GCP keeps Firebase + storage + DB + scheduler in one billing/IAM surface, simplifying the PIA / FDBR data-flow inventory.
- **Self-hosted WebSocket layer for messaging.** Real engineering cost without a meaningful win over Firestore listeners at v1 scale.

## Consequences

- **The OpenAPI spec is a load-bearing artifact.** It must be kept in sync with backend handlers; CI should fail on drift. Dart and TypeScript clients are regenerated on every spec change.
- **Two data stores means a write-fanout pattern for messages.** A new Message is written to Postgres (system of record) inside the same transaction as the Booking-related side-effect, then mirrored to Firestore for fan-out. The fan-out is best-effort with retry; Postgres remains canonical. Disintermediation redaction happens before either write.
- **The PIA and Privacy Policy data-flow inventory must list Firestore explicitly** alongside Postgres — both store personal data. Firestore's `nam5` US multi-region is the correct configuration under ADR-0003; the historical UK / `eur3` configuration the original v1 plan would have required is no longer relevant.
- **Background jobs are not durable inside a single Cloud Run instance.** Anything time-delayed (Booking 24h expiry, Session auto-confirm) MUST go through Cloud Tasks; in-process `setTimeout` is forbidden because Cloud Run instances scale to zero.
- **The deep modules from the PRD (Booking lifecycle, Pricing, Cancellation, Disintermediation detector, Search ranking scorer, Rating reveal, Verification workflow, Retention planner, Availability calendar) live in pure TypeScript packages**, importable from the Cloud Run backend and unit-testable in isolation with Vitest or Jest. They do not import the database, Stripe, or any SDK directly — those are passed in as collaborators at the API-handler layer.
- **Webhook endpoints (Stripe, Checkr, Daily.co) all verify signatures** before translating to internal events. A failure to verify is a 400, not a 401, and is logged for security review. The Checkr-specific endpoint is implemented behind a vendor-agnostic background-check webhook interface so a second-state vendor can be added in Phase 2 without re-routing.
- **Provider web portal and admin dashboard share the TypeScript client** generated from the OpenAPI spec; they may share component libraries but are separate deployable apps with separate auth scopes (Provider tokens vs. admin tokens with TOTP MFA).
- **Migration off any of these decisions is non-trivial:** swapping Postgres → another RDBMS is the cheapest; swapping Firebase Auth → another IDP cascades into both clients; swapping GCP → another cloud cascades into residency configuration on every vendor. These are all "year-or-more" reversals, hence this ADR.
