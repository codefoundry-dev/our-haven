# Our Haven

Two-sided marketplace connecting US families with vetted childcare and child-development professionals — Caregivers (Babysitter / Tutor / Nanny) and Specialists (SLP, OT, ABA, psychology, and similar). **US-national launch from day one** per ADR-0009 (supersedes ADR-0003's Florida soft-launch).

## Repo layout

This repo is a **monorepo** holding every v1 surface:

```
our-haven/
├── apps/
│   ├── mobile/         React Native + Expo SDK 56 — Parent + Provider mobile app (Phase 3)
│   ├── backend/        Node + TS + Fastify + OpenAPI + Postgres (Phase 2, deploys to Fly.io)
│   └── admin/          Admin dashboard — verification queue, T&S, metrics (Phase 2, not yet scaffolded)
├── packages/
│   ├── openapi-types/  TS types generated from apps/backend/openapi/openapi.yaml — shared by all apps
│   ├── domain/         Pure-TS deep modules (Booking lifecycle, Pricing, Cancellation, Disintermediation, Search ranking, Rating reveal, Verification workflow, Retention planner) — no SDK imports (ADR-0004)
│   └── shared/         Cross-app shared utilities (US states enum, vocabulary constants)
└── docs/               PRD, ADRs, jira breakdown, planning artefacts
```

| Layer | Technology |
|---|---|
| Unified app (Parent / Caregiver / Provider, web + mobile) | React Native + Expo SDK 56 (TypeScript) — `apps/mobile` (renders supply onboarding on web and the run-the-day surfaces on mobile; no separate web portal) |
| Admin dashboard | Next.js (TypeScript), hosted on Vercel — `apps/admin`, TOTP MFA on every sign-in |
| Backend API | Node + TypeScript + Fastify, OpenAPI-first REST, ADR-0004 §§1–3,8 — `apps/backend` |
| Auth | Supabase Auth (US-region project) |
| Database | PostgreSQL on Supabase (`us-east-1`) — system of record + Supabase Realtime for live messaging fan-out |
| File storage | Supabase Storage (US region) — signed-URL uploads for ID docs, license docs, etc. |
| Background jobs | `pgmq` + `pg_cron` on Supabase Postgres — delayed and periodic jobs |
| Payments | Stripe Connect Express (US entity) — commission marketplace + Parent Subscription |
| Tax | Stripe Tax — per-state nexus + taxability decisions on Subscription + Commission |
| Background screening | Checkr — standard package; ADR-0007 |
| Video | Daily.co (US rooms) — embedded, ad-hoc, either party; ADR-0008 |
| Notifications | Expo Push (FCM/APNs), SendGrid (email), Twilio (SMS) |
| Hosting | Fly.io `iad` (Ashburn, VA) for the Fastify backend + Vercel for the Next.js web surfaces + Supabase for Auth/Postgres/Realtime/Storage. Per ADR-0010. |

## Getting started

```bash
# Once, from the repo root
npm install
```

### Mobile (Expo SDK 56 — see https://docs.expo.dev/versions/v56.0.0/ before changing Expo config)

```bash
npm run mobile           # expo start
npm run mobile:ios
npm run mobile:android
npm run mobile:web
```

### Backend

```bash
cp apps/backend/.env.example apps/backend/.env
docker compose -f apps/backend/docker-compose.yml up -d   # local Postgres
npm run backend                                            # http://localhost:8080  (Swagger UI at /docs)
npm run backend:test
```

For the full local Supabase stack (Auth + Storage + Realtime), install the Supabase CLI and run `supabase start` from the repo root instead.

See `apps/backend/README.md` for full details.

### Domain modules (pure-TS, no SDKs)

```bash
npm run domain:test
```

## Project documentation

| Document | Purpose |
|---|---|
| [`CONTEXT.md`](CONTEXT.md) | Domain glossary — canonical terms used in code, schemas, and admin UI |
| [`docs/prd/0001-our-haven-v1.md`](docs/prd/0001-our-haven-v1.md) | Full v1 PRD |
| [`docs/jira-breakdown-draft.md`](docs/jira-breakdown-draft.md) | 5 phase epics + 60 stories with blockers + labels |
| [`docs/adr/`](docs/adr/) | Architectural Decision Records |
| [`DESIGN.md`](DESIGN.md) | Design system / visual direction |

Key ADRs:

- **ADR-0001** — Marketplace billing: Stripe Connect Express + web-only Parent Subscription
- **ADR-0002** — Provider portal is web-only in v1 — **superseded by ADR-0005**
- **ADR-0003** — Launch jurisdiction: Miami/Florida — **superseded by ADR-0009**
- **ADR-0004** — Backend stack (Node + TS) and cross-platform API (OpenAPI-first REST + codegen)
- **ADR-0005** — Provider mobile companion supersedes the web-only v1 (one mobile binary, role-aware shells)
- **ADR-0006** — Job-posting marketplace + negotiable pricing via structured Offers
- **ADR-0007** — Background screening: Checkr standard package, not statutory Florida Level 2
- **ADR-0008** — Embedded video calls via Daily.co — ad-hoc, in-chat, either party
- **ADR-0009** — US-national launch (supersedes ADR-0003)
- **ADR-0010** — Supabase + Fly.io + Vercel platform (supersedes ADR-0004 §§ 4–7 — Firestore, Firebase Auth, GCP hosting)

## Compliance context

Federal floor — COPPA, HIPAA-adjacent, FCRA, IRS (W-10 / 2441 / 1099-K), Title VII, CAN-SPAM, TCPA — plus a per-state-privacy-patchwork adapter layer (CCPA/CPRA, VCDPA, CPA, CTDPA, UCPA, FDBR, OCPA, TDPSA, and others phasing in). All personal data processed in US regions. PIA + Privacy Policy + ToS authored by US privacy counsel before launch (Phase 4). See `CONTEXT.md` § Privacy counsel / PIA / Data residency / Retention policy.
