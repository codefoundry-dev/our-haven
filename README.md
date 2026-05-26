# Our Haven — Parent Mobile App

A React Native (Expo) application for the Parent-facing side of **Our Haven**, a two-sided marketplace connecting families in Miami/Florida with vetted childcare and child-development professionals — Babysitters, Tutors, Nannies, and Specialists (SLP, OT, ABA, and similar licensed clinical roles).

## What this repo is

This is the **React Native + Expo codebase** for the Parent mobile app (iOS + Android). It ships search, messaging, booking, payments, and video interviews. A public Parent web build is added in Phase 6 from the same codebase via React Native Web.

The Provider portal and admin dashboard are **not** in this repo — they are web-only surfaces backed by the same Node.js/TypeScript backend.

## Architecture overview

| Layer | Technology |
|---|---|
| Mobile (Parent) | React Native + Expo (TypeScript), this repo |
| Backend API | Node.js + TypeScript, OpenAPI-first REST |
| Auth | Firebase Auth (US region) |
| Database | PostgreSQL (Cloud SQL) — system of record; Firestore — real-time messaging fan-out |
| Payments | Stripe Connect Express (US entity) — commission marketplace + Parent Subscription |
| Background screening | Checkr — standard package (county criminal + national sex offender + SSN trace); see ADR-0007 |
| Video | Daily.co (US rooms) |
| Notifications | FCM (push), SendGrid (email), Twilio (SMS) |
| Hosting | GCP Cloud Run — `us-east1` (default), `us-east4` (fallback); Firestore `nam5` |

The app communicates with the backend over HTTPS REST using a generated TypeScript client (OpenAPI codegen). Live messaging events arrive via Firestore document listeners, not polled REST.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) (LTS) and npm
- [Expo CLI](https://docs.expo.dev/get-started/installation/) — invoked via `npx expo`
- Xcode (iOS) or Android Studio (Android) for native simulators; or the Expo Go app on a physical device
- A Firebase project configured for the US region with the `google-services.json` / `GoogleService-Info.plist` files placed in the standard locations

### Install dependencies

```
npm install
```

### Run

```
npm start
```

For a specific platform:

```
npm run ios       # iOS simulator
npm run android   # Android emulator
npm run web       # Web (React Native Web)
```

## Project documentation

| Document | Purpose |
|---|---|
| [`CONTEXT.md`](CONTEXT.md) | Domain glossary — canonical terms used in code, schemas, and admin UI |
| [`docs/prd/0001-our-haven-v1.md`](docs/prd/0001-our-haven-v1.md) | Full v1 PRD — problem, user stories, modules, compliance, out-of-scope |
| [`docs/project-plan.md`](docs/project-plan.md) | Phase-by-phase delivery plan and timeline |
| [`docs/adr/`](docs/adr/) | Architectural Decision Records |

Key ADRs:

- **ADR-0001** — Marketplace billing: Stripe Connect Express + web-only Parent Subscription
- **ADR-0002** — Provider portal is web-only in v1 (no Provider mobile binary) — **superseded by ADR-0005**
- **ADR-0003** — Launch jurisdiction: Miami/Florida; state-pluggable compliance adapters for Phase 2 US expansion (bg-check sub-decision **partially superseded by ADR-0007**)
- **ADR-0004** — Backend stack (Node.js/TS) and cross-platform API (OpenAPI-first REST + codegen)
- **ADR-0005** — Provider mobile companion supersedes the web-only v1 (one mobile binary, role-aware shells)
- **ADR-0006** — Job-posting marketplace + negotiable pricing via structured Offers (slot-pick path **superseded 2026-05-19** — Direct-Message + lazy Job materialisation replaces it)
- **ADR-0007** — Background screening: Checkr standard package, not statutory Florida Level 2
- **ADR-0008** — Embedded video calls via Daily.co — ad-hoc, in-chat, either party

## Compliance context

Our Haven launches in **Florida** under a US sectoral compliance patchwork: FDBR, COPPA posture for children's data, HIPAA-adjacent prudence for special-needs notes, FIPA breach notification, and Florida sales-tax rules. Every vendor is pinned to a US region. See ADR-0003 and `CONTEXT.md` for details.
