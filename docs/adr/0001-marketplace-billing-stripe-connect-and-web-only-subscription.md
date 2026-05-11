# Marketplace billing — Stripe Connect with commission skim, Parent Subscription billed only via web

**Status:** accepted (2026-05-08; jurisdictional details updated 2026-05-11 to track the Miami/Florida pivot in ADR-0003)

## Context

Our Haven is a two-sided marketplace. Money flows two ways: Parents pay for marketplace access (a recurring Subscription) and pay for Bookings (per-engagement payments to Providers); Our Haven needs to retain revenue from both. Several distinct architectures could satisfy this — a single-sided model where only Providers pay (subscription), a dual-subscription model, an in-app-purchase-driven model, or an agent-style marketplace.

## Decision

1. **Providers receive Booking payments via Stripe Connect Express (US entity).** Our Haven is the platform of record. The Connect `application_fee_amount` parameter skims a percentage Commission from each Booking — the Parent pays exactly the Provider's published Rate; the Provider receives Rate × (1 - Commission). Commission rate target 15–20%, exact value TBD. Form 1099-K issuance to Providers is handled automatically by Stripe Connect.
2. **Parents pay a Subscription to unlock full marketplace access** (search beyond preview, messaging, booking). The Subscription is **billed only on web** (Stripe-hosted page reachable from sign-up flow), not via iOS / Android in-app purchase. Mobile apps read Subscription status but do not sell it.
3. **Providers do not pay a Subscription.** Onboarding cost (Florida Level 2 background screening + Stripe Connect setup) plus the per-Booking Commission is the only Provider-side monetisation surface.
4. **Sales-tax model is marketplace-agent, not deemed-supplier.** Our Haven's tax surface is the platform's own revenue (Subscription + Commission) where it's taxable; Booking gross stays the Provider's surface. In Florida specifically, the Subscription, the Commission, and most in-scope Booking services are not currently sales-taxable; Stripe Tax tracks per-state taxability as US expansion proceeds. See `CONTEXT.md` § Sales tax model.

## Why

- **Stripe Connect Express** delivers US-compliant payouts, KYC, **Form 1099-K issuance**, optional 3DS handling for fraud reduction, and dispute mechanics for free. Building any of these would consume the v1 budget. (3DS is supported but not mandatory in the US — no PSD2/SCA equivalent — so it is applied opportunistically on high-risk transactions rather than universally.)
- **Web-only Subscription billing** sidesteps Apple App Store guideline 3.1.1 (digital subscriptions sold inside an iOS app must use Apple's IAP, with a 15–30% revenue share). Booking payments themselves are *real-world services* exempt from IAP under 3.1.5(a), so they remain in-app via Stripe — but a Subscription is a digital service that would attract the IAP rule. Selling the Subscription only on web is the Spotify/Netflix-style approach now widely accepted post-2024 store-rule changes.
- **Marketplace-agent sales-tax model** keeps Our Haven's tax surface narrow — taxability (where it applies state-by-state) attaches to the platform's own revenue (Subscription + Commission), not the gross Booking flow. The platform is not a deemed supplier for childcare or clinical services intermediation.
- **No Provider Subscription** matches standard marketplace shape (Care.com, Wyzant, Rover) and avoids two churn funnels.

## Considered alternatives

- **Both sides subscribe + Booking commission.** Higher revenue per active user but two churn funnels; Provider-side subscription is unusual in this category and would suppress supply.
- **Provider-only Subscription, free for Parents.** Inverts the standard model; Providers won't pay to be listed in a new marketplace with no Parent demand.
- **In-app purchase for Parent Subscription.** Simpler from a store-policy standpoint but a 30% Apple cut on the highest-margin revenue stream is structurally unattractive; switching later to web-billing is hard once users are accustomed to IAP.
- **Stripe Standard (non-Connect).** Doesn't support marketplace payouts cleanly; Our Haven would have to implement KYC, payout scheduling, and 1099-equivalent reporting itself.

## Consequences

- The Subscription sign-up flow inside the mobile app *cannot* end in a payment screen. It ends in a "continue on web" handoff — added UX friction; mitigation is making the handoff fast and seamless.
- Stripe Connect Express requires Provider-side onboarding (Stripe-hosted KYC); this is built into Phase 2.
- Commission percentage changes are not free — adjusting it requires updating display copy in profile builder, Provider take-home calculators, and accounting reconciliation.
- **Stripe Tax** must be wired up before launch even if Florida-only revenue is currently non-taxable — it's the artifact the platform leans on the moment a second state lights up. **Florida Department of Revenue sales-tax registration** is a Phase 0 counsel-confirmed call (likely not required for the v1 service mix, but the call must be made on the record).
