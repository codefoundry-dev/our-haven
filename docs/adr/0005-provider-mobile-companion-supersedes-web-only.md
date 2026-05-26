# Provider mobile companion ships alongside the web portal; supersedes ADR-0002

**Status:** accepted (2026-05-18) — **supersedes ADR-0002** (web-only Provider portal in v1)

## Context

ADR-0002 (2026-05-08) decided that Providers would interact with Our Haven exclusively through a **web portal** in v1, with a Provider mobile app deferred to a post-launch phase. The reasoning was sound for the shape of the product at that time: Provider tasks were almost entirely keyboard-and-screen (profile edits, license uploads, Stripe Connect KYC, Payout reconciliation), the single mobile-urgent task (accepting an incoming Booking request) was reachable via the mandatory SMS notification, and bundling Providers into the Parent Flutter binary risked App Store dual-role review friction and roughly doubled Phase 3 surface work.

Two things have changed since:

1. **The marketplace model itself is being extended (see ADR-0006).** Providers now apply to **Jobs** that Parents post, in addition to the existing Availability/slot-pick path. Applying to a Job is a *run-the-day, on-the-move* task — Providers will read a Job posted at 2pm while between sessions, write a short proposal, send an Offer, and move on. That is a phone task, not a desktop task. Without a mobile companion, the new Job-board surface would launch onto a web portal that Providers don't reliably open during the day.
2. **The Provider acquisition channel argument has hardened.** Real-world Provider discovery happens on phones — App Store search, friend-referral, scanning a QR code in marketing materials. Forcing a "you must finish sign-up in a web browser" detour at the top of the funnel costs measurable installs and is an avoidable friction.

This ADR revises ADR-0002 in light of those changes. It does **not** discard ADR-0002's reasoning — it carries forward the parts that still apply.

## Decision

1. **A Provider mobile companion ships in v1**, distributed in the same Flutter binary as the Parent app.
2. **Role is chosen at sign-up** via an explicit "Are you a Parent or a Provider?" step. The account is permanently one role; users wanting both maintain two accounts with different emails. A single-account dual-role model is deferred past v1.
3. **The web portal remains the system of record.** Anything a Provider can do on mobile, they can also do on web; the reverse is not true. Web is a superset.
4. **The web/mobile split for Provider tasks is:**
   - **Mobile-native** (full UX in the app): sign-up + auth (Apple + Google + email/password); email + phone verification; government ID upload (phone camera); Florida Level 2 background-screening consent + initiation; Specialist license-number form entry; Tax-credit self-attestation; Published Rate + per-child surcharge management; Availability calendar editing; Job opportunities feed; Job application composer with Offer; Booking inbox (accept / decline); active-session controls (mark in-progress, propose final hours); messaging (including Offer bubbles); rate-a-Parent; Dispute filing; no-show reporting; profile photo + bio editing; Payout history (read-only); Notifications, Privacy, Account.
   - **Mobile linkout-to-web** (mobile shows status, action opens an in-app browser to the web portal): **Stripe Connect Express KYC onboarding**; **bank-detail changes**; **withdraw funds**; **Specialist license document + insurance certificate upload**; **FCCH registration upload**. These are bounced to web because the web is genuinely the better tool (Stripe's hosted KYC, admin-correspondence review queues, step-up MFA orchestration).
   - **Web-exclusive in v1**: none. Every Provider task is either mobile-native or has a mobile linkout to web.
5. **Bottom navigation on the Provider mobile shell:** *Opportunities / Schedule / Messages / Account*. The Parent shell remains *Home / Bookings / Messages / Account*. Each user sees one shell, determined by their account role.
6. **Notifications:** SMS-on-Booking-request to the Provider remains mandatory (`CONTEXT.md` § Notifications); SMS now also covers **Job-awarded → Provider** (same urgency profile — a Booking is imminent). The Provider mobile companion is the primary deep-link target for both, with web-portal fallback.

## Why

- **The new Job-board surface (ADR-0006) is fundamentally a mobile-shaped task on the supply side.** Providers will read Jobs and apply between sessions — they don't open a laptop for this. Launching ADR-0006 onto a web-only Provider surface would predictably under-perform.
- **The original ADR-0002 concerns are addressed, not ignored:**
  - *Stripe Connect onboarding is web-native* — preserved. The mobile companion **does not embed** Stripe KYC; it links out to Stripe's hosted page in an in-app browser, exactly as ADR-0002 implied was correct.
  - *App Store dual-role review risk* — addressed by the role-fork-at-sign-up shape (Decision #2). App Store reviewers create one test account per role and see one shell each; the marketplace pattern they evaluate is the same as DoorDash, Lyft, Airbnb, where account identity carries the role. The pattern explicitly rejected in ADR-0002 (single binary with role-permissioned UI shown to the same account) is **also** rejected here — a Provider account never sees the Parent shell and vice versa.
  - *Phase 3 timeline integrity* — re-evaluated in the context of ADR-0006. The Job-board build is sized so that the Provider mobile surface is delivered as part of the same workstream, not as a separately-scoped addition. Heavy web-only Provider features (KYC, document review correspondence) absorb no new mobile build.
  - *Heavy doc upload workflow* — preserved on web by Decision #4's linkout pattern. The admin↔Provider correspondence on a license review never crosses to mobile; the workflow stays on one surface.
- **Parent App Store posture is unchanged.** From an App Store reviewer's perspective, a Parent test account still sees a consumer marketplace app with Subscription via Stripe web checkout — exactly the shape Phase 4 was set up to ship.
- **Provider data residency, MFA posture, and Verification rules carry over from `CONTEXT.md` unchanged.** The mobile companion is an additional surface, not a different identity or compliance regime.

## Considered alternatives

- **Hold the line on ADR-0002 (Provider remains web-only).** Cheapest in v1 build terms; loses the Provider acquisition channel on mobile; predictably under-performs ADR-0006 because Job-board engagement on the supply side requires a mobile surface. Rejected.
- **Provider mobile-only, deprecate the web portal.** Considered and rejected for the same reasons ADR-0002 originally pointed to: Stripe Connect KYC, license-document review correspondence, and Payout management are genuinely web-shaped tasks that don't belong in a mobile binary. The web portal stays.
- **Two separate Flutter apps (Parent app + Provider app), two App Store listings.** Rejected — doubles the release engineering, store-listing copy, review cycles, and analytics surface for no behavioural benefit over the single-binary role-fork pattern. ADR-0002 originally considered the single-binary path and rejected it on dual-role review risk; that risk is mitigated here by the sign-up-time role fork, which the App Store treats as identity-carries-role (the well-trodden marketplace pattern).
- **Single Flutter binary with a runtime role-switcher visible to one account.** Rejected — re-introduces every dual-role concern (a single test account that can switch into "Provider mode" is exactly the merchant-bait-and-switch pattern Apple scrutinises). The role-permanent-per-account decision is what unlocks the single-binary path safely.
- **Embed Stripe Connect KYC natively in the mobile companion.** Rejected — Stripe's KYC requirements change frequently; rebuilding the hosted flow natively means stale UI within months and substantial maintenance load. Linking out to Stripe's hosted page is what Stripe themselves recommend for Connect Express.

## Consequences

- **ADR-0002 is superseded but its split survives.** The web portal is still the system of record; mobile is additive. Provider workflows that were specified as web-only in ADR-0002 are now web-primary with selective mobile companion surfaces.
- **`CONTEXT.md` § Authentication adds the Provider mobile auth set** (Apple + Google + email/password) and the role-fork-at-sign-up decision; § Notifications adds the Provider mobile push channel and the Job-awarded SMS event.
- **PRD-0001 user stories 40 (Provider sign-up on web portal), 48 (publish Availability), 50–54 (Booking inbox flow), 58 (messaging) are partially superseded** — these now describe surfaces that exist on **both** web and the mobile companion. A v1.1 PRD revision must record the surface-availability mapping per story before scope-lock.
- **App Store submission posture:** the binary now ships with two role-distinct shells. Internal release-management must include test accounts for both roles in every App Store review submission; failing to do so risks an under-tested-review rejection.
- **Phase 3 scope grows.** The Provider mobile build is real work — new role-fork sign-up, new Provider bottom nav, new Opportunities/Schedule/Messages/Account screens, new Stripe Connect linkout pattern, new Offer-bubble component (shared with Parent side). It does **not** double the surface (most components — bottom nav, app bar, message bubble, Offer bubble, photo capture, OTP — are reused from the Parent side), but it is a Phase 3 line-item that did not exist on 2026-05-08.
- **Provider mobile companion has no "deferred features" exit ramp.** Anything on the web-only list (KYC, license upload, withdraw) is a *first-class linkout from mobile*; the mobile shell must render a clear "Finish on web →" affordance for each, and the web portal's deep-link handling must support being opened in an in-app browser session from a signed-in mobile context.
