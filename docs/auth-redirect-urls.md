# Auth redirect URLs (Supabase URL allow-list)

GoTrue only honors an `emailRedirectTo` / `redirectTo` / OAuth `redirectTo` if the
URL matches an entry in **Supabase → Authentication → URL Configuration →
Redirect URLs**. Anything that doesn't match falls back to the **Site URL**, which
silently breaks the flow (the link lands on the site root instead of the intended
screen).

Linked project: **`rtamfcbkrtztxbbkvwpz`**.
Production web origin: **`https://our-haven-web.vercel.app`** (Vercel project
`our-haven-web`, root dir `apps/mobile`).

## Required allow-list entries

Wildcards are used so one entry per origin covers every route — the password
reset path (`/reset-password`), OAuth/email-confirmation (which redirect to the
bare origin), and any route added later.

```
https://our-haven-web.vercel.app/**
https://*-codefoundry.vercel.app/**
http://localhost:8081/**
ourhaven://**
```

- `https://our-haven-web.vercel.app` — canonical production alias.
- `https://*-codefoundry.vercel.app` — the `*-codefoundry` production aliases and
  Vercel preview deployments.
- `http://localhost:8081` — Expo web dev server (default Metro web port; adjust if
  you run it elsewhere).
- `ourhaven://` — native deep-link scheme (`app.json` → `scheme`), used by the
  native password-recovery and OAuth callbacks.

Exact (non-wildcard) equivalents, if you prefer them over `/**`:
`https://our-haven-web.vercel.app/reset-password`,
`http://localhost:8081/reset-password`, `ourhaven://reset-password`.

## Where these URLs come from in code

- `apps/mobile/src/auth/AuthProvider.tsx` — `emailRedirectTo` (sign-up
  confirmation) and `recoveryRedirectTo` (`…/reset-password` on web,
  `ourhaven://reset-password` on native, via `Linking.createURL`).
- `apps/mobile/src/auth/oauth.ts` — OAuth `redirectTo` (bare origin on web,
  `Linking.createURL('auth/callback')` on native).

## Verify (password reset, web)

1. On `https://our-haven-web.vercel.app`, Sign in → **Forgot password?** → submit
   your email.
2. Open the emailed link. It should land on **`/reset-password`** showing the "Set
   a new password" form — not bounce to role-pick / role-claim.
3. If it lands on the site root instead, the URL didn't match the allow-list —
   re-check the entries above.

## Note

This config lives in the GoTrue auth settings, not in the database or a committed
file, so it can't be applied from a migration or the Supabase MCP tools — it's set
in the dashboard (or via the Management API `PATCH /v1/projects/{ref}/config/auth`
`uri_allow_list` with a personal access token).
