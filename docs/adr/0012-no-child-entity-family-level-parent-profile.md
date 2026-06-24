# No Child entity; a family-level Parent profile (Bio + Preferences + Safety Behaviors)

**Status:** accepted (2026-05-30, client sync). Supersedes `CONTEXT.md` § Child profile, § Child profile visibility on Booking requests, § Child profile visibility on Job posts, and the per-child portions of § Sensitive-data consent, § Rate, § Booking. Independent of ADR-0011 (roles/monetization).

## Context

The model was built around a first-class **Child profile** — a per-child record holding age, special-needs flags, and free-text clinical notes — with an elaborate visibility ladder (age + flag-marker pre-accept; full notes post-accept; full notes pre-accept for the clinical tier) and a consent gate tied to Child-profile creation. The 2026-05-28 client sync judged this an **over-collection / HIPAA-adjacent liability**: the platform was accumulating detailed, diagnosis-shaped records about specific children, most of which a Caregiver never needs and which raise the platform's sensitivity profile under COPPA and the state-privacy patchwork.

No `child_profiles` table had been built yet (the backend's "child" surface area is the unrelated *home-childcare* licensing badge), and the Pricing & commission module already takes a plain **child count**, not child IDs — so removing the entity is largely a docs + future-schema decision rather than a migration.

## Decision

**Remove the Child entity entirely.** No per-child records, no per-child special-needs flags, no free-text clinical notes, and **no persisted neurodivergence/diagnosis field anywhere.** In its place, a single **family-level Parent profile** with three parts:

- **Bio** — free-text family info. Carries a one-time guidance warning ("visible to Caregivers you engage; don't include more about your child than needed") and runs through the **disintermediation detector** (same contact-leak risk as messages / Job descriptions).
- **Preferences** — a checklist of desired Caregiver traits (non-smoker, pet-friendly, …). Not safety-critical; no consent gate. A subset may graduate to search filters post-launch.
- **Safety Behaviors** — a **fixed checklist** (aggression, fecal smearing, spitting, self-injurious behaviour, wandering / running off, …; final list from Ci'erro). **No free text.** This is the client's headline safety feature for Caregivers.

**Children in a transaction** are captured **ad-hoc per Booking**: the Parent enters a **child count + ages** on the Offer/Book-request as plain fields (no entity, no persistent roster). The count drives the per-child surcharge; the ages give the Caregiver real context (toddler vs teen).

**Consent (unchanged in force).** Safety Behaviors are sensitive disability-related data about a child; killing the *entity* does not make the *data* non-sensitive. The explicit consent + withdrawal + erasure moment **re-anchors from Child-profile-creation onto Safety-Behaviors editing**. The de-risking comes from (a) a bounded checklist instead of free-text clinical notes, (b) no per-child records, (c) no persisted diagnosis field, and (d) tight visibility — **not** from dropping consent.

**Visibility.** The whole Parent profile (Bio + Preferences + Safety Behaviors) is **engagement-gated to Caregivers**: it reveals once the Parent has engaged a specific Caregiver — they filed an **Application** on a posted Job, OR the Parent opened the thread / sent the first **Book-request** in the search→message path. Un-engaged Caregivers browsing do not see it. **Providers (clinical) do not see it pre-consultation** — clinical fit is assessed in the off-platform consult (per ADR-0011).

**Preview questionnaire stays ephemeral.** The signup questionnaire (neurotypical/neurodivergent, age band, focus areas) remains browse-shaping only and is discarded after the first session; it is **not** persisted to the Parent profile. Ci'erro's "simplified neurodivergent categories" feed the ephemeral questionnaire chips + the search taxonomy, **not** a stored profile field.

## Why

- **Lower child-PII = stronger COPPA + state-privacy posture.** "2 kids, ages 3–5" + a household-level safety checklist is dramatically less personal information about children than named per-child records with clinical notes.
- **A fixed checklist is honest about its purpose.** Safety Behaviors are a *safety heads-up for the person who will be alone with the child*, not a clinical record. A bounded checklist serves that without inviting diagnosis dumps.
- **It removes the consent surface from the hot path** without removing consent: there's no per-child record to build at signup; consent attaches to the one sensitive control (Safety Behaviors) when the Parent actually edits it.
- **Cheap now, expensive later.** The entity isn't built yet and Pricing already takes a count — so this is the cheapest possible moment to make the call.

## Consequences

- **Accept the loss of per-child precision.** Safety Behaviors are household-level — if one of three children is self-injurious, the flag doesn't say which. This is the deliberate trade for simplicity + minimization; the Caregiver learns specifics in conversation.
- **Single-child rule becomes a count check.** The Tutor single-child constraint is enforced as `child_count == 1` on the Booking, not via child records. (Specialist/Provider consultations are inherently single-engagement per ADR-0011.)
- **Schema:** Offer/Booking gain `child_count` + `child_ages` (ad-hoc); drop `attached_child_ids`. Parent profile gains `bio`, `preferences[]`, `safety_behaviors[]`, `safety_behaviors_consent_at`. No `child_profiles` table is created.
- **Retention/erasure:** the "sensitive data" rule re-targets Safety Behaviors + the consent timestamp (deleted on account deletion or consent withdrawal); Bio follows the free-text-content rule.
- **DESIGN.md:** the Children screens (§5.2) become a **Parent-profile editor** (Bio + Preferences + Safety Behaviors); the "Add Child" step (§5.1.9) is removed; the consent screen (§5.1.7) re-anchors to Safety Behaviors; the Award/Book-request flows capture ad-hoc count + ages instead of attaching Child cards.
- **Future readers:** a childcare app with no Child entity is surprising on purpose — land here to understand that child data is deliberately minimized to a per-booking count/ages + a household safety checklist.
