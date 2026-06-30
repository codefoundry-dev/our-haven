# EAS build pipeline — TestFlight (iOS) + Play Internal (Android)

The unified RN/Expo app (`apps/mobile`) ships to physical devices through **EAS
Build** + **EAS Submit**. This doc covers the one-time setup and the
day-to-day build/submit commands. The config lives in
[`eas.json`](../eas.json); the iOS bundle id and Android package are set in
[`app.json`](../app.json) (`dev.thecodefoundry.ourhaven` — change before the
first store submission if a different identifier is wanted, since it is
permanent once an app record exists).

> Everything below needs the **user's own credentials** (an Expo account, an
> Apple Developer account, and a Google Play service account). None of it can be
> run from CI without those secrets — the commands are listed so they can be run
> from a machine with `eas-cli` authenticated.

## Build profiles (`eas.json`)

| Profile | Distribution | Output | Use |
| --- | --- | --- | --- |
| `development` | internal | iOS Simulator build · Android APK | Local smoke testing on simulators/emulators |
| `preview` | internal | iOS ad-hoc IPA · Android APK | Share an install URL with stakeholders on real devices |
| `production` | store | iOS store IPA · Android AAB | **TestFlight + Play Internal** via EAS Submit |

`cli.appVersionSource` is `remote`, so EAS owns the build number / version code
and `production` bumps them automatically (`autoIncrement: true`). Each profile
declares an `environment` (development/preview/production) so the build pulls the
matching set of [EAS environment variables](https://docs.expo.dev/eas/environment-variables/).

## One-time setup

1. **Install + sign in to EAS CLI** (it is intentionally *not* a repo dependency
   so the lockfile-exact `npm ci` in CI stays untouched):

   ```sh
   npm install -g eas-cli
   eas login
   ```

2. **Link the project** — writes `extra.eas.projectId` (and `owner`) into
   `app.json`:

   ```sh
   cd apps/mobile
   eas init
   ```

3. **Upload the public build-time env vars.** The app inlines
   `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and
   `EXPO_PUBLIC_API_URL` at build time. Push them to each EAS environment so the
   cloud builder has them (they are public values, safe to store):

   ```sh
   eas env:push --environment production   # then preview / development as needed
   ```

   (`EXPO_PUBLIC_API_URL` should point at the Edge `api` function, e.g.
   `https://<project-ref>.functions.supabase.co/api`.)

4. **Configure submit credentials:**

   - **iOS / TestFlight** — fill the `submit.production.ios` block in `eas.json`
     (`appleId`, `ascAppId`, `appleTeamId`), or run `eas submit` interactively and
     let it prompt. EAS manages the signing certificate + provisioning profile.
   - **Android / Play Internal** — create a [Google Play service account](https://expo.fyi/creating-google-service-account),
     download its JSON key to `apps/mobile/credentials/google-play-service-account.json`
     (this path is git-ignored), and grant it release permissions in the Play
     Console. `submit.production.android.track` is already `internal`.

## Build + submit

```sh
cd apps/mobile

# Build production binaries (cloud)
npm run build:ios          # eas build --platform ios --profile production
npm run build:android      # eas build --platform android --profile production
npm run build:all          # both

# Submit the latest build to the stores
npm run submit:ios         # → TestFlight
npm run submit:android     # → Play Internal track

# Internal QA builds (shareable install URL, no store)
npm run build:preview
```

## Automated pipeline (EAS Workflows)

[`.eas/workflows/build-and-submit.yml`](../.eas/workflows/build-and-submit.yml)
builds both platforms on the `production` profile and submits them to TestFlight
+ Play Internal in one run. Trigger it manually or by pushing a `release-*` tag:

```sh
eas workflow:run .eas/workflows/build-and-submit.yml
# or
git tag release-1.0.0 && git push origin release-1.0.0
```

Validate the workflow file after `eas init` (the validator needs the linked
project id):

```sh
eas workflow:validate .eas/workflows/build-and-submit.yml
```
