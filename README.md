# Our Haven — Parent Mobile App

A Flutter application for the Parent-facing side of **Our Haven**, a two-sided marketplace connecting families in Miami/Florida with vetted childcare and child-development professionals — Babysitters, Tutors, Nannies, and Specialists (SLP, OT, ABA, and similar licensed clinical roles).

## What this repo is

This is the **Flutter codebase** for the Parent mobile app (iOS + Android). It ships search, messaging, booking, payments, and video interviews. A public Parent web build is added in Phase 6 from the same codebase.

The Provider portal and admin dashboard are **not** in this repo — they are web-only surfaces backed by the same Node.js/TypeScript backend.

## Architecture overview

| Layer | Technology |
|---|---|
| Mobile (Parent) | Flutter (Dart), this repo |
| Backend API | Node.js + TypeScript, OpenAPI-first REST |
| Auth | Firebase Auth (US region) |
| Database | PostgreSQL (Cloud SQL) — system of record; Firestore — real-time messaging fan-out |
| Payments | Stripe Connect Express (US entity) — commission marketplace + Parent Subscription |
| Background screening | Checkr — Florida Level 2 (FBI + FDLE fingerprint, NSOR) |
| Video | Daily.co (US rooms) |
| Notifications | FCM (push), SendGrid (email), Twilio (SMS) |
| Hosting | GCP Cloud Run — `us-east1` (default), `us-east4` (fallback); Firestore `nam5` |

The app communicates with the backend over HTTPS REST using a generated Dart client (OpenAPI codegen). Live messaging events arrive via Firestore document listeners, not polled REST.

## Getting started

### Prerequisites

- [Flutter SDK](https://docs.flutter.dev/get-started/install) — see `pubspec.yaml` for the required Dart SDK constraint
- Xcode (iOS) or Android Studio (Android)
- A Firebase project configured for the US region with the `google-services.json` / `GoogleService-Info.plist` files placed in the standard locations

### Install dependencies

```
flutter pub get
```

### Run

```
flutter run
```

For a specific device:

```
flutter run -d <device-id>
```

### Test

```
flutter test
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
- **ADR-0002** — Provider portal is web-only in v1 (no Provider Flutter binary)
- **ADR-0003** — Launch jurisdiction: Miami/Florida; state-pluggable compliance adapters for Phase 2 US expansion
- **ADR-0004** — Backend stack (Node.js/TS) and cross-platform API (OpenAPI-first REST + codegen)

## Compliance context

Our Haven launches in **Florida** under a US sectoral compliance patchwork: FDBR, COPPA posture for children's data, HIPAA-adjacent prudence for special-needs notes, FIPA breach notification, and Florida sales-tax rules. Every vendor is pinned to a US region. See ADR-0003 and `CONTEXT.md` for details.
