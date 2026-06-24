# Multi-category Caregiver — one account, a set of categories, one category per transaction

**Status:** accepted (2026-06-17, client update). **Amends ADR-0011** (three roles; Caregiver/Provider fork) by replacing the Caregiver's single `category` with a set `categories[]`. Does **not** reopen the deferred single-account **multi-role** model (ADR-0005) — this is multi-*category* strictly *within* the Caregiver role. Providers remain single-`specialty`.

> Domain language follows `CONTEXT.md` (§ Caregiver, § Rate, § Authentication — all updated 2026-06-17).

## Context

The 2026-06-17 client review asked that **"a caregiver be able to select multiple profiles when signing up — [tutor, babysitter, nanny]."** A second item in the same review — *"in the caregiver dashboard … filter open jobs by service category since one caregiver can offer multiple services like tutor, babysitter, or nanny"* — confirms the mental model: the client treats one human caregiver as a multi-service supplier, not three separate identities.

The current model assumes the opposite. Grounding in code:

- `app/lib/types.ts` — `Provider.category: CategoryName` is **singular**; `Provider.rate: number` is a **single** number; `UIState.signupDraft.category?: CategoryName` captures **one** category at sign-up.
- `CONTEXT.md` § Caregiver (pre-edit) — *"A Caregiver picks a `category`"*, schema `(role=caregiver, category=...)`.
- ADR-0011 set the flat three-role model with a Caregiver carrying one `category`.

Under that model a caregiver who babysits **and** tutors must run **two accounts**. That means: paying the **$35 Checkr background check twice** for the same person (the check is per-person identity, not per-service — see `CONTEXT.md` § Verification), **split ratings/reputation** across the two accounts, **duplicate profile upkeep**, login juggling, and a parent seeing the same human twice in search with no signal they're the same person. The single-category assumption is the friction; multi-category is the fix the client is asking for.

This is distinct from the deferred **multi-role** question (ADR-0005): combining the **payment-rail Caregiver** business with the **off-platform clinical Provider** business on one login raises Stripe Connect, Commission, HIPAA, and verification questions that ADR-0011 deliberately forked apart. None of that is in play here — Babysitter, Tutor, and Nanny are all the same Caregiver business (same money rail, same verification, same lifecycle), so collapsing them onto one account is cheap and safe.

## Decision

1. **A Caregiver holds a set of `categories`** — `categories ⊆ {babysitter, tutor, nanny}`, minimum one — on a **single account**. This replaces the singular `category` from ADR-0011 for the Caregiver role only. It is **intra-role**: it does **not** reopen single-account multi-*role* (Caregiver + Provider), which stays deferred per ADR-0005. **Providers remain single-`specialty`.**

2. **Every transaction is pinned to exactly one category.** A Booking, Job, Application, and Offer each carry a single `category` drawn from the Caregiver's set. A parent books a Caregiver *as a Tutor* or *as a Babysitter* — never both in one transaction. All category-specific rules resolve off the **transaction's** category, not the Caregiver's full set.

3. **Published Rate is per offered category.** `rate: number` becomes a per-category rate (e.g. Babysitter $25/h, Tutor $45/h) — not one blended rate. The transaction's category selects the rate that pre-fills the Offer and that the search Rate-ceiling filter matches. When a Caregiver appears in a search with **no category filter**, the filter compares against their **lowest** category rate and the card reads **"from $X"** so they aren't unfairly excluded. The **per-child surcharge** (Babysitter/Nanny only) and the **Tutor `child_count == 1`** rule likewise key off the booking's category.

4. **One unified profile + a small per-category block.** A Caregiver keeps a single person-level profile — Bio, weekly Availability, Credentials/badges, Verified status, Ratings, ages-served, behaviour-comfort — with a per-category block holding only what genuinely differs by service: **Published Rate, a short headline, and the category specialty field** (Tutor → subjects; Babysitter/Nanny → a short focus note). **Age range served and behaviour-comfort are person-level**, not per-category (added 2026-06-17, client item #8 — see `CONTEXT.md` § Search & filters). Arriving from a category-filtered search leads with that category's block plus an "Also offers …" chip. Full separate per-category profiles are rejected (see alternatives).

5. **Ratings are aggregate at the person level in v1.** One star rating per Caregiver across all their categories. A per-category breakdown is **deferred** — every Booking records its category, so the data exists to add it later without migration.

6. **Verification is once per person.** ID + Checkr background screening + phone clear the **account**, not each category — a multi-category Caregiver is checked once and is listable in every category they selected once cleared. Optional credential badges (see § Verification / the Credentials decision) attach at the person level.

## Why

- **Kills duplicate accounts and their costs.** One person → one Checkr check ($35, not $70), one reputation, one profile to maintain, one login. The parent sees one human.
- **Honest about real supply.** Many sitters tutor; many nannies sit. The market is multi-service; the model should be too. The client's filter request (#11) only makes sense once a caregiver can hold multiple categories.
- **Cheap to do now.** The hard parts are already category-agnostic at the person level: the Child entity is gone (ADR-0012), pricing takes a plain count, and Booking/Job/Offer already carry a `category` field — they just need to draw it from a set instead of mirroring a single account field.
- **Per-category rate keeps pricing + search honest.** A blended rate would mis-price every booking and corrupt the Rate-ceiling filter; per-category rate costs only extra fields on the profile rate step.
- **Stays inside the safe boundary.** Intra-role only — it does not entangle the Caregiver payment rail with the off-platform clinical Provider tier, so none of ADR-0011's fork concerns reappear.

## Considered alternatives

- **Status quo — separate account per category.** Rejected: duplicate $35 background checks for one person, split ratings, duplicated upkeep, and parents seeing the same human as multiple strangers. This is the friction the client is reporting.
- **Multi-category but a single blended rate.** Rejected: dishonest pricing (tutoring ≠ babysitting hourly) and it breaks the accuracy of the Rate-ceiling filter. Per-category rate is a small cost for correctness.
- **Full separate per-category profiles** (one human, N independent profiles under one login). Rejected: fragments reviews/ratings, multiplies the editing burden, and re-creates most of the "same human looks like strangers" problem inside one account. The unified-profile + per-category-block model captures real variation without the fragmentation.
- **Reopen single-account multi-role (Caregiver + Provider).** Out of scope: ADR-0005 defers it and ADR-0011 forked the two supply businesses for substantive reasons (Stripe Connect/Commission vs. off-platform HIPAA; different verification). Multi-category does not touch that boundary.

## Consequences

- **`CONTEXT.md` updated (2026-06-17):** § Caregiver (categories set + one-category-per-transaction + unified profile/per-category block + aggregate rating), § Rate (per-category Published Rate + "from $X" fallback + surcharge/single-child key off booking category), § Authentication (multi-category clarified as intra-role, distinct from deferred multi-role).
- **Schema deltas (PRD / `app/lib/types.ts`):** `Provider.category: CategoryName` → `categories: CategoryName[]`; `Provider.rate: number` → a per-category rate map (e.g. `rates: Partial<Record<CategoryName, number>>`); per-category `headline` + specialty fields on the profile block; `UIState.signupDraft.category?` → `categories?: CategoryName[]`. Booking / Job / Application / Offer keep their existing single `category` field — its value is now drawn from the Caregiver's set (no shape change). No ratings-schema change in v1 (aggregate retained).
- **PRD-0001 stories to revise:** 41 (role-aware onboarding — Caregiver selects *one or more* categories), 46 (set Rate — *per category*), 95 + 96 (open-Jobs feed spans the Caregiver's categories), 10 + 12 (a multi-category Caregiver surfaces under each of their category filters; "from $X" on no-filter results), 88 + 89 (Application cards carry the Job's category). **New story:** as a Caregiver I select multiple service categories at onboarding and set a Published Rate per category. (Story for the open-Jobs category filter is folded into the #11 filter item.)
- **DESIGN.md:** onboarding category step → **multi-select**; Rate step renders one field **per selected category**; Caregiver profile shows the **per-category block + "Also offers …" chip**; search and the Caregiver Opportunities feed treat category as a facet a multi-category Caregiver matches in more than one of.
- **Out of scope / deferred:** per-category star ratings (v2); single-account multi-role (ADR-0005 still defers); any change to Provider single-`specialty`.
