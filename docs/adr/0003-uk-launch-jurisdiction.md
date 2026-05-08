# UK as launch jurisdiction; vendor and compliance design cascades from this

**Status:** accepted (2026-05-08), *pending final client confirmation in Phase 0*

## Context

The original project plan said the app would be "available everywhere from day one, but marketing and outreach concentrate on a single market." That phrasing is jurisdiction-agnostic, but the rest of the plan named US-shaped vendors (Checkr) and US-shaped compliance items, leaving the actual launch jurisdiction ambiguous. Discovery clarified that this is an EU-based system, with the United Kingdom as the working launch base.

The launch jurisdiction is not a cosmetic detail — it dictates the background-check vendor, the Provider classification regime, the data-protection regime, the regulator landscape for Specialists, and the whole shape of the financial compliance work.

## Decision

**v1 launches in the United Kingdom only.** Currency is **GBP**. The technical and compliance design is shaped specifically for UK regulation:

- **Background check:** Enhanced DBS + Children's Barred List, via a UK DBS API vendor (working assumption uCheck; final vendor confirmed in Phase 0).
- **Specialist license verification:** manual admin verification against UK regulator registers — HCPC (SLT, OT, psychology), GMC (doctors), NMC (nurses), UK-SBA / BACB international (ABA/BCBA).
- **Nanny Voluntary Childcare Register (Ofsted)** surfaced as an optional badge enabling Tax-Free Childcare benefits.
- **Data protection:** UK GDPR + Data Protection Act 2018. External fractional DPO engaged before launch; mandatory DPIA authored before Phase 4 launch; Article 9 explicit consent for Child special-needs flags. UK / EU data residency configured in every vendor (Firebase Auth → `europe-west`; Daily.co → EU rooms; cloud hosting → UK/EU region).
- **Payments:** Stripe Connect Express UK entity; PSD2 / FCA Strong Customer Authentication (3DS) on every Parent payment; UK VAT registration before launch; Stripe Tax integration for Subscription and Commission VAT computation.
- **Provider classification:** UK employment law (worker / self-employed / employee distinctions, post-*Aslam* case law); classification language drafted by Ci'erro's lawyers before launch.
- **Geographic scope at launch:** the app is available throughout the UK from day one; soft-launch marketing concentrates on a single UK city (TBD by Ci'erro in Phase 0).

If the launch base changes (e.g., to a specific EU member state or to multiple jurisdictions), this ADR is superseded and **vendor selection, data-protection regime, regulator surfaces, currency, and payment-compliance design all re-scope per the new jurisdiction.**

## Why

- **EU is not monolithic.** Background check vendors, Specialist regulators, Provider classification regimes, and consent ages all vary per member state. Launching across multiple jurisdictions in v1 multiplies vendor integrations, lawyer engagements, and DPIA work — incompatible with a 16-week timeline.
- **UK has clean public registers** (HCPC / GMC / NMC) for manual Specialist verification — eliminates the need for a paid verification-vendor integration in v1.
- **DBS is the legal standard** for UK roles in regulated activity with children. There is no realistic alternative for a child-facing marketplace in this jurisdiction; "Checkr or alternative" was an ambiguity the discovery resolved.
- **UK-only currency simplification.** Single currency (GBP), single language, no FX work, no multi-currency Stripe configuration. v1 ships meaningfully faster.

## Considered alternatives

- **EU-wide launch (multiple member states from day one).** Multi-vendor, multi-language, multi-classification-regime; doesn't fit 16 weeks.
- **Single EU member state other than UK** (e.g., Spain, Germany, Ireland). Workable but would have shifted vendor selection (Bulletin n°3 / Führungszeugnis-equivalent / Garda vetting) and language work. UK was Ci'erro's working assumption; not a technical preference.
- **US launch** (the implicit reading of the original plan). Inverts the regulatory model entirely (Checkr, US labour law, US tax). Out of scope per the EU-based system framing.

## Consequences

- Every UK-specific design choice in `CONTEXT.md` (DBS, HCPC, Ofsted VCR, UK GDPR, VAT model, PSD2/FCA SCA) is conditional on this ADR. A change in launch jurisdiction is **not** a small change.
- Phase 0 carries a critical confirmation: Ci'erro must formally confirm the UK as launch base. If she names a different jurisdiction, the project re-plans before Phase 1 closes.
- Future readers looking at the codebase and seeing UK-specific vendor integrations should land on this ADR first to understand why the project does not appear locale-agnostic.
- Geofencing of Provider sign-up to the UK is required (and was added to the Phase 2 sign-up activities in spirit) — a Provider sign-up from outside the UK is rejected with a clear "we're not yet operating in [country]" message.
