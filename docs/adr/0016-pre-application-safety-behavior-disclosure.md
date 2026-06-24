# Two-tier Parent-profile visibility: Safety Behaviors disclose pre-application

**Status:** accepted (2026-06-17, client update). **Amends ADR-0012** (no Child entity; family-level Parent profile) — specifically its **single engagement-gate visibility ladder**. Leaves intact: the removal of the Child entity, the consent-to-**store** gate on Safety Behaviors, the bounded fixed-checklist minimization, and the no-notes/no-names/no-diagnosis posture. Pairs with the Caregiver **behaviour-comfort** field (client item #8, `CONTEXT.md` § Search & filters).

> Domain language follows `CONTEXT.md` (§ Parent-profile visibility, § Job, § Sensitive-data consent — all updated 2026-06-17).

## Context

The 2026-06-17 client review asked that **"when caregivers are applying for a job or they receive a booking request, they should be able to see the child's behaviors the parents have set as part of their booking request / open job."** Grounding it in the current model surfaced two different situations:

- **Receiving a Book-request (Direct-Message)** — *already satisfied.* Engagement is defined as the Parent **sending the first Book-request** (`CONTEXT.md` § Parent-profile visibility), so a Caregiver receiving one is already engaged and may see the Parent profile, Safety Behaviors included. The only gap is UI prominence (surface the behaviors on the request card).
- **Applying to a Posted Job** — *a real collision with ADR-0012.* Today Safety Behaviors reveal **only after** the Caregiver files an Application (engagement = applicant), and child **count + ages** are captured at **Award** (PRD story 90), not at compose. A Caregiver therefore applies essentially **blind** to the child detail — they cannot tell whether the engagement involves behaviors they're equipped for until they've already spent one of their capped Applications.

ADR-0012 deliberately engagement-gated the whole Parent profile to **minimize how many Caregivers see sensitive child data**. But the same review introduced a Caregiver **behaviour-comfort** list (#8b) — which is pointless for self-selection if the Caregiver can't see the job's behaviors until *after* applying. The apply decision is precisely where a **safety + fit** judgement should happen. The minimization instinct of ADR-0012 is right; applying it to the *apply-time* decision is the part that's wrong.

## Decision

1. **Split the Parent profile into two visibility tiers.** **Bio + Preferences stay engagement-gated** exactly as in ADR-0012 (reveal on Application filed / first Book-request). **Safety Behaviors disclose earlier**, on a per-transaction, parent-controlled basis.

2. **The Parent discloses a selected subset at compose.** When composing a Posted Job (or a Book-request), the Parent picks a **subset of their Safety-Behaviors checklist** to attach to *that* transaction (pre-filled from their profile checklist; they choose what to show). This is **opt-in**: attach-none → show-none. It is consistent with ADR-0012's model of **per-transaction ad-hoc child data**, and it matches the client's wording ("behaviors the parents have set as part of their open job").

3. **The child-detail bundle moves from Award to compose.** Child **count + ages** join the disclosed Safety-Behaviors subset as a single bundle set at **Job compose** (previously Award, PRD story 90) and carried on the **Book-request** for the Direct-Message path. This is what a Caregiver sees *before* applying.

4. **Bounded audience.** The bundle is visible on the **Job detail** (an intentional open) to **verified, in-category** Caregivers — not to the public and not to search browsers skimming cards.

5. **Behaviors only pre-application — never Bio/Preferences.** Only the safety-relevant subset surfaces early. The Parent's *full* profile checklist and their Bio/Preferences still reveal only on engagement.

6. **Consent: extend the compose warning; leave the storage gate untouched.** The existing one-time, timestamped compose consent warning (PRD story 86, previously about the free-text description) is **extended to cover the structured child detail** (count + ages + behaviors) being shown to Caregivers who view the Job. This is a **disclosure** act and is distinct from — and additional to — the ADR-0012 **consent-to-store** gate on editing the checklist, which is **unchanged in force**.

7. **No automated matching in v1.** Behaviour-comfort vs. disclosed-behaviors is **display only** (a Caregiver reads both and decides). Automated match-scoring / a "good fit" badge is deferred (per #8b) — the ranking formula (distance/rating/recency) is unchanged.

## Why

- **Safety + fit belong at the apply decision.** Knowing a child wanders off or is self-injurious is *more* important before a Caregiver commits than after. Surfacing it late is the riskier design, not the safer one.
- **Parent-controlled disclosure preserves minimization.** The Parent chooses, per job, which behaviors to show; nothing is force-published. Bio/Preferences stay gated. The data shown is still the bounded, name-free, note-free checklist ADR-0012 created.
- **It makes behaviour-comfort (#8b) actually usable.** A Caregiver who declared comfort with wandering / running off can now see which jobs involve it and self-select — the two features are designed as a pair.
- **Bounded, verified audience.** Exposure widens from "applicants" to "verified in-category Caregivers who open the job," not to the public — a contained, already-background-checked population.
- **Consistent with the existing ad-hoc child-data model.** ADR-0012 already puts child count + ages on the transaction; attaching the relevant behaviors to the same transaction is the same shape, not a new sensitive surface.

## Considered alternatives

- **Keep ADR-0012 as-is (reveal only post-application), just make the reveal more prominent.** Rejected — does not deliver apply-time visibility; the Caregiver still applies blind and may burn a capped Application on a poor/unsafe fit. Fails the client's explicit ask.
- **Reveal the whole Parent profile (Bio + Preferences + Safety Behaviors) pre-application.** Rejected — over-exposes non-safety family information to every job viewer and discards ADR-0012's minimization for no safety benefit. Only the safety-relevant subset is needed early.
- **Auto-reveal the profile-level Safety-Behaviors checklist to all job viewers (no per-job parent selection).** Rejected — removes parent control; the Parent can't tailor disclosure to the specific job, and a behavior irrelevant to this engagement leaks anyway.
- **Coarse pre-application signal only** ("this family has safety behaviors: 2"), specifics post-application. Rejected — too vague for a fit/safety judgement; the specific behaviors *are* the decision input. A count without specifics just creates anxiety without enabling self-selection.

## Consequences

- **`CONTEXT.md` updated (2026-06-17):** § Parent-profile visibility (two tiers; per-transaction disclosure), § Job (compose-time child-detail bundle), § Sensitive-data consent (disclosure-vs-storage distinction).
- **Schema deltas (PRD / `app/lib/types.ts`):** `Job` gains `safetyBehaviors: string[]` (the disclosed subset) and its `childCount` / `childAges` (already nullable) are now populated at **compose**; `Offer` gains `safetyBehaviors: string[]` (it already carries `childCount` / `childAges`). `ParentProfile.safetyBehaviors` remains the canonical checklist; the Job/Offer subset is a compose-time **copy**. The compose consent acknowledgement (timestamp) on the Job now covers the bundle, not just the description.
- **PRD-0001 stories to revise:** 86 (compose consent warning → extend to structured child detail), 90 (child capture moves Award→compose), 84 (post-a-Job adds the child-detail bundle + behavior disclosure), 96 (Caregiver Job view shows disclosed behaviors), 51 (Caregiver sees count + ages + behaviors), 112 (Book-request carries behaviors). **New story:** as a Parent I select which Safety Behaviors to disclose on a Job/Book-request at compose, under the consent warning.
- **DESIGN.md:** Job-compose gains a child-detail step (count + ages + a behavior multi-select drawn from the Parent's checklist) behind the extended consent; the Caregiver Job-detail and the Book-request card render the disclosed behaviors.
- **Privacy posture / PIA:** net exposure of Safety Behaviors widens from *applicants* to *verified in-category job-viewers* — bounded, parent-controlled, opt-in. The store-consent gate, bounded checklist, and no-notes/names/diagnosis posture are unchanged. **Flag for the pre-launch PIA + privacy-counsel review** (the PIA already scopes Safety-Behaviors handling).
- **Out of scope / deferred:** automated comfort↔behavior match-scoring (#8b, v2); any pre-application exposure of Bio or Preferences.
