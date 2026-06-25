# @our-haven/mobile — unified app (web + iOS + Android)

The single RN/Expo codebase that renders **web and mobile** for all three roles
(Parent / Caregiver / Provider). The supply-onboarding "web portal" **is** this
app on web — there is no separate Next.js portal (ADR-0005, ADR-0010).

This README covers **OH-176 — the shared app skeleton**: design tokens, UI
primitives, the Supabase auth client, role-pick + role-claim, and the
role-aware navigation shells. Per-role feeds and the deeper onboarding flows are
downstream M2+ tickets.

## Stack

- **Expo SDK 56** + **React Native Web** (`react-native-web`) — one codebase, three targets.
- **expo-router** (file-based routing) with a root auth gate + headless role-aware tabs.
- **@supabase/supabase-js** — auth + session (AsyncStorage on native, localStorage on web).
- **@our-haven/openapi-types** — request/response types generated from the backend OpenAPI spec (ADR-0004), so the API client can't drift from the contract.

## Setup

```bash
# from the repo root
npm install
cp apps/mobile/.env.example apps/mobile/.env   # then fill in the values
```

Environment (`apps/mobile/.env`, git-ignored — only `EXPO_PUBLIC_*` reach the bundle):

| var | what |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL (Project Settings → API) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `EXPO_PUBLIC_API_URL` | Backend base URL. Role-claim posts to `${EXPO_PUBLIC_API_URL}/v1/auth/role-claim`. With the Supabase Edge host this is typically `https://<project-ref>.functions.supabase.co/api` (the API app is mounted under the `/api` function slug — confirm against the OH-174/175 deploy). |

If the Supabase vars are missing the app still boots; auth is disabled and the
sign-in/up screens show a configuration notice.

## Run

```bash
# from the repo root
npm run mobile        # expo start (choose web / iOS / Android)
npm run mobile:web    # web only
npm run mobile:ios
npm run mobile:android

# checks
npm run typecheck --workspace=@our-haven/mobile
```

## Auth + routing

The root layout (`src/app/_layout.tsx`) gates on session state:

- **anon** → `(auth)` — `role-pick` → `sign-up` / `sign-in`.
- **authed, no role** → `role-claim` — sets the permanent role via `POST /v1/auth/role-claim`.
- **authed, role set** → `(app)` — the role-aware tab shell (custom `BottomNav`).

Role is **permanent** (ADR-0011) and lives in the access token's
`app_metadata.role`. After claiming, the client refreshes the session so the new
claim lands in the JWT.

### Role-claim by role

`POST /v1/auth/role-claim` takes permanent extra data for the supply roles
(`categories` for Caregiver, `specialty` for Provider) plus a resident `state`:

- **Parent** claims end-to-end (role-pick → sign-up → role-claim → app). ✅
- **Caregiver / Provider** (OH-183): after sign-up they land on `SupplyOnboarding`
  — Caregiver multi-selects categories (Babysitter / Tutor / Nanny), Provider
  picks a specialty, both choose their state — then claim. The claim also writes
  the `providers` row. ✅ Rates, verification, and Stripe/subscription are later
  M2 tickets.

## Web build & deploy (live deploy deferred — OH-176 AC #4)

```bash
npm run build:web --workspace=@our-haven/mobile   # → apps/mobile/dist/
```

`vercel.json` is provided as a starting point (static export → `dist/`). To go
live on staging: connect a Vercel project rooted at `apps/mobile`, set the
`EXPO_PUBLIC_*` env vars in the project, and deploy. (Verify the workspace
install resolves `@our-haven/openapi-types` in Vercel's monorepo build.)

## Design reference

UI is ported from the Claude Design project **"Our Haven mobile"**
(`claude.ai/design`, also mirrored in `.design-bundle/`). Tokens come from
`tokens.jsx`; screens from `screens/*.jsx`. Match visual output, not the
prototype's internal structure; where design and the PRD/CONTEXT disagree, the
PRD wins.

## Deferred to downstream M2+ tickets

- Full sign-up wizard (email-OTP, phone verify, ZIP profile, Stripe payment).
- OAuth (Apple / Google) sign-in.
- Per-tab feeds (home, search, bookings, messages, schedule, …).
- Live staging deploy.
