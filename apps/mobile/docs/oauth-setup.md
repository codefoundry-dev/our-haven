# Parent sign-up — Apple / Google OAuth (OH-199)

The app code for Apple + Google sign-in/sign-up is wired (`src/auth/oauth.ts`,
`src/components/ui/OAuthButtons.tsx`). It is **inert until the providers are
enabled in the Supabase dashboard** — that step needs the org's Apple/Google
developer accounts and the Supabase project owner, so it lives here rather than
in code (same posture as the EAS credential and Edge-secret follow-ups).

Email/password sign-up, email verification, and "no phone at sign-up" already
shipped earlier; this ticket adds the social-login providers.

## How the flow works

- **Web** — `signInWithOAuth({ provider, options: { redirectTo: origin } })`
  performs a full-page redirect to the provider and back to the app origin. The
  web Supabase client is created with `detectSessionInUrl: true`
  (`src/auth/supabase.ts`), so the returning hash is exchanged for a session
  automatically and the auth gate routes on.
- **Native** — opens the provider in an `ASWebAuthenticationSession` (iOS) /
  Chrome Custom Tab (Android) via `expo-web-browser`, then completes the session
  from the returned deep link. Uses the client's default **implicit** flow
  (tokens in the URL fragment), kept deliberately so existing email-confirmation
  links are unaffected.

The chosen role can't ride in `user_metadata` the way the password sign-up does
(no user exists until the provider returns), so it is stashed locally
(`src/auth/pendingRole.ts`) before leaving and read back on `role-claim`. OAuth
emails from Apple/Google are pre-verified, so the "email verified" criterion is
met by construction.

## Dashboard / provider configuration (one-time)

1. **Supabase → Authentication → Providers**
   - Enable **Google**: paste the OAuth **Client ID** + **Client secret** from
     Google Cloud Console.
   - Enable **Apple**: configure the **Services ID**, **Team ID**, **Key ID**,
     and signing key.

2. **Google Cloud Console → Credentials → OAuth client → Authorized redirect URIs**
   - Add `https://<project-ref>.supabase.co/auth/v1/callback`
     (current project ref: `rtamfcbkrtztxbbkvwpz`).

3. **Apple Developer → Services ID → Return URLs**
   - Add the same `https://<project-ref>.supabase.co/auth/v1/callback`.

4. **Supabase → Authentication → URL Configuration → Redirect URLs** (allowlist;
   GoTrue ignores any redirect not listed and falls back to the Site URL):
   - Web prod origin — the deployed Vercel domain (e.g. `https://<app>.vercel.app`).
   - Web dev — `http://localhost:8081` (Expo web dev server).
   - Native — `ourhaven://auth/callback` (the app `scheme` in `app.json`).

## Notes / follow-ups

- Native OAuth needs the custom `ourhaven://` scheme, which is only stable in a
  **dev client or a production build** — not Expo Go (the Expo Go `exp://`
  redirect URL is documented as non-stable). The credential-gated EAS binaries
  (OH-198) cover this.
- Apple's App Store guidelines prefer a **native** "Sign in with Apple" button
  for iOS. This uses the web-based OAuth flow (no `expo-apple-authentication`
  dependency, to honor the lockfile-exact CI constraint). Swapping iOS to the
  native button is a follow-up to schedule with the first iOS binary.
