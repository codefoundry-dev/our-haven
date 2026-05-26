# Provider portal is web-only in v1; Provider mobile app deferred

**Status:** superseded by [ADR-0005](./0005-provider-mobile-companion-supersedes-web-only.md) on 2026-05-18. Originally accepted 2026-05-08. The web portal remains the Provider system of record, but a mobile companion now also ships in v1; see ADR-0005 for the revised web/mobile split.

## Context

Our Haven serves two user types — Parents and Providers — with very different daily-use shapes. Parents browse, message, and book on their phone in spare moments. Providers maintain a profile, configure Availability, accept Booking requests, message, complete Sessions, and reconcile Payouts. The original Project Overview line read "Mobile app for parents and caregivers (iOS and Android)", implying both sides get a native app. The phase breakdown told a different story: Phase 2 builds a "Caregiver Web Portal", Phase 3 builds only a "Parent Mobile App", and there is no Provider mobile app anywhere in the timeline.

## Decision

**The Provider portal is web-only for v1. There is no Provider mobile app.** A Provider mobile app may be built post-launch as a separately-quoted phase if response-rate data justifies it.

## Why

- **Provider role shape matches a desktop / web tool.** Profile editing, license uploads, calendar management, Stripe Connect bank-detail entry, and Payout reconciliation are all keyboard-and-screen tasks. The frequent-but-fast Provider interaction — accepting an incoming Booking request — is reachable via the v1 notification matrix (mandatory SMS to Provider on Booking request → Provider opens the link in a browser → accepts in two taps).
- **Stripe Connect onboarding is web-native anyway.** A native mobile flow would still bounce out to Stripe's hosted onboarding pages.
- **Phase 3 timeline integrity.** Phase 3 is 4 weeks (post-discovery expansion). Adding a Provider Flutter app — even sharing a codebase with the Parent app — roughly doubles the user-surface work (separate role-based routing, separate notification handling, separate auth flows, separate App Store submission). It would either push Phase 3 to 7+ weeks or ship two half-baked surfaces.
- **App Store submission risk.** A single-purpose Parent consumer app is straightforward to approve. A dual-role app (Parent + Provider) introduces marketplace-merchant complexity that Apple has historically scrutinised more heavily. v1 keeps the consumer surface clean.
- **Consistency with the marketplace shape from ADR-0001.** Providers in this model are merchants/suppliers paid via commission, not consumer subscribers. Treating the Provider surface as a merchant tool (web) rather than a consumer app is consistent with that role.

## Considered alternatives

- **Provider mobile app shipped in Phase 3.** Doubled scope; unrealistic in 4 weeks.
- **Provider web-first, Provider mobile app as a known Phase 6 deliverable.** Slightly more honest than "deferred indefinitely", but Phase 6 is currently the public Parent web app — adding a Provider mobile app there bloats it to 6+ weeks with no demonstrated need.
- **Single Flutter app with role-based routing (Parent + Provider in one binary).** Simpler than two apps but introduces sign-up forking, role-permissioned UI, and dual-purpose store-listing copy. The store-policy and review burden outweigh the code-sharing savings at v1 scale.

## Consequences

- The Project Overview line was rewritten: "Mobile app for Parents (iOS and Android), web portal for Providers, plus admin dashboard."
- Provider-side notifications must be reliable on web. SMS for Booking requests is **mandatory** (no opt-out in v1) precisely because web push alone is insufficient — see `CONTEXT.md` § Notifications.
- Provider response-rate metrics should be tracked from launch. If the data shows Providers are reliably slow because they're not at a desktop, the case for a Provider mobile app strengthens; without that data, "Providers want a mobile app" is a guess.
- Phase 6 (web app build-out) becomes specifically a *Parent* web experience — the Provider portal already exists from Phase 2.
