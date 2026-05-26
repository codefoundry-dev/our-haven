> Companion to the [Project Plan](https://www.notion.so/Project-Plan-359f51fd2f92800a9a16c85e1f3b8eb9?pvs=21). The project plan tells you *what* we're building and when. This doc tells you *why it matters*, *what the words mean*, and *where to find things*. Read this first.
> 

## Who this is for

A PM joining the Our Haven pod. You don't need a special needs or childcare background. You do need to understand the trust dynamics of a parent-caregiver marketplace well enough to push back on the client when an idea would hurt safety or conversion. By the end of this doc you should be able to sit in a call with Ci'erro and follow 90% of it.

## The one-paragraph product summary

Our Haven is a mobile marketplace connecting parents with vetted caregivers — babysitters, tutors, nannies, and clinical providers (speech, ABA, therapy). The product is built for families with neurodivergent children, but it serves neurotypical families too. Parents create an account, add their children (each child has age, special needs flags, notes), search caregivers by location and filter, preview a couple of profiles for free, subscribe to unlock the rest, message and book a caregiver, hop on a quick video interview, then pay through Stripe via a web redirect to avoid Apple and Google's ~30% cut. Caregivers sign up on the web, get verified with email, phone, ID upload and a Checkr background check, then appear in search. The app is Flutter so a public web version can spin up from the same codebase in three weeks once mobile is live.

## The client and the situation

**Ci'erro Kennedy** is the founder. She came to us in late April after talking to two other developers who could ship faster and gave fixed-price quotes. She chose us on trust — Jeremy Sackey recommended JD, and that mattered more to her than speed or price. She has been collecting a waitlist on [ourhavenapp.com](http://ourhavenapp.com) for over a month and has teachers and caregivers emailing her directly asking to sign up. She's been promising people the app is coming.

Ci'erro is a clinician by background, which shows up in every conversation — she thinks in safeguarding terms, asks compliance questions her lawyer raised, and reads features through a "will this protect the family" lens. She's also pragmatic about the build: when she found out end-to-end encryption would block the team from doing fraud detection, she dropped the requirement on the spot. When she heard custom matching would slow the build, she agreed to defer it. She will push back when something feels wrong for the user, and she's right often enough that you should hear her out before debating.

Her father, Frank Kennedy Jr., has sat in on at least one call. He listens; he doesn't drive decisions.

She has a marketing consultant working on brand (fonts, colors, logo direction) and a business consultant helping shape pricing and promotions. Her lawyers handle privacy policy, terms of service, and caregiver classification language.

## The mental model

Think of the platform as **three sides of a trust triangle**, plus the safety machinery that keeps the triangle intact.

1. **The Parent** — the buyer. Pays a subscription to unlock the marketplace, then pays per booking. Has one account with multiple child profiles attached. Trusts the platform to have vetted everyone they see.
2. **The Caregiver** — the seller. Could be a babysitter, a tutor, a nanny, or a clinical provider. Pays for their own background check (with our markup). Lives or dies by reviews and visibility.
3. **The Booking** — the transaction. Parent finds caregiver → messages → does a quick video interview → books → pays through Stripe (via web redirect) → care happens → both sides rate each other.

Everything else (verification, background checks, message scanning, ratings, video calls, the admin dashboard) exists to make that triangle safe enough that a parent will hand their special-needs child over to a stranger. That last sentence is the product. Everything Ci'erro decides should be read through it.

## Glossary

These are the words that show up in every call, every Figma frame, every ticket. Learn them.

**Parent / Family Account** — a single account that holds one or more child profiles. The parent is the user; the children are profiles inside that user.

**Child Profile** — age, neurodivergent vs neurotypical flag, optional diagnosis, optional notes. The diagnosis is optional but encouraged because caregivers and providers screen by it.

**Caregiver** — the umbrella term for everyone on the supply side. Subdivided into four categories.

**Babysitter** — short-term, ad-hoc care. Phase 1.

**Tutor** — academic support. Phase 1.

**Nanny** — longer-term, scheduled care. Often the same person who babysat, now hired permanently. Phase 1.

**Provider** — clinical specialists: speech therapy, ABA, occupational therapy, professional services for special-needs children. Phase 1. Providers were added late in scope discussions — Ci'erro flagged them as missing from the original contract and asked for them back in.

**Preview Gating** — the rule that one or two caregivers are visible to anyone who lands on the app, but the rest of the marketplace is locked behind a subscription. Ci'erro pushed for this so parents see proof the supply exists before they pay.

**Verification** — the verification stack we apply to every user. Email and phone for everyone. Payment method matching account name for parents. ID upload (optional but encouraged), email, phone, and Checkr background check for caregivers. The payment-name-matches-account-name rule is a deliberate anti-fraud step: it makes it harder to create a fake parent account using someone else's card.

**Background Check** — run through [Checkr.com](http://Checkr.com). Caregivers pay for their own check; we mark it up. The cost gets confirmed during Phase 0 discovery. Ci'erro is paranoid about background-check timing because if parents land on a half-empty marketplace they'll churn, so we need caregivers verified and live before parents can find an empty store.

**Standard Encryption (in transit and at rest)** — messages are encrypted from hackers but readable by the Our Haven team for fraud detection. **End-to-end encryption is explicitly out of scope** — Ci'erro removed it during the May 6 contract clarification so the team can scan messages.

**Number / Word Detection** — automated scanning of in-app messages for phone numbers, email addresses, or off-platform language. The platform team can also read messages manually for fraud and safety review. This must be disclosed in the privacy policy.

**Preview / Subscribe / Book** — the parent's three-step funnel. Preview a couple of profiles for free. Subscribe to unlock the rest, messaging, and booking. Book a specific caregiver and pay per booking.

**Subscription** — parent-side. The web-redirect model: the mobile app sends the parent to a web page to subscribe, then back into the app. This is how we avoid Apple and Google's ~30% in-app purchase cut. Ci'erro tested this pattern on competitor apps before our call and confirmed she's seen it work.

**Stripe (standard, not Connect)** — payment processor. JD is still confirming whether we need Stripe Connect (for paying caregivers directly) or whether standard Stripe is enough. Ci'erro is setting up the standard account and will add JD; the Connect question gets answered in Phase 0.

**Embedded Video Call** — Zoom, Google Meet, or a comparable provider embedded in the app for the pre-booking interview between parent and caregiver. **We are not building a custom video stack** — Ci'erro initially wanted one, JD explained the cost, she agreed to embedded third-party. Provider choice TBD in Phase 0.

**Two-Way Rating** — both parent and caregiver rate each other after a booking. No imported reviews from other platforms — everyone starts at zero. This was a deliberate decision: Ci'erro briefly wanted caregivers to bring reviews in from elsewhere, JD pointed out the verification problem, she dropped it.

**App Feedback** — separate from caregiver ratings. After a parent's first booking, we prompt them for feedback on the *app itself* (probably with a small incentive — discount or credit). This is Ci'erro's signal mechanism for catching product problems early.

**Promotions System** — discount codes, referral codes, targeted promos. Used to bring people in cheaply at launch (free month, free trial) and re-engage anyone who drops off (dropped subscription, didn't complete onboarding). Final scope confirmed during discovery.

**Admin Dashboard** — internal web tool for the Our Haven team. V1 has: caregiver review queue with approve/reject, basic metrics (sign-ups, active subscriptions, cancellations, bookings), and access to message content for safety review. Deep analytics (funnel tracking, behavioural data) is deferred.

**Soft Launch** — Ci'erro markets to one geographic area at launch (likely Florida — Miami or Fort Lauderdale) even though the app is technically live everywhere. This is a marketing decision, not a technical one. The reason: seed supply and demand in one place before going wide.

**Scope Lock** — the line drawn at the end of Phase 1. After that, new features need a written change order and a separate quote. Locked-out items: AI-generated parent profiles from reviews, custom matching algorithm, custom in-app video, deep behavioural analytics.

## The user types

These are the roles you'll see in stories and tickets.

- **Parent** — daily user of the mobile app. Searches, books, pays, messages, rates.
- **Caregiver (babysitter, tutor, nanny, provider)** — signs up on the web, uses the mobile app once approved. The caregiver onboarding is a web flow because document upload, ID upload, and Checkr work better on a browser than in a mobile sign-up.
- **Our Haven Admin** — Ci'erro and her team. Web-only. Reviews caregiver applications, watches metrics, reads flagged messages, handles disputes.
- **Us (developers)** — platform-level access. Manages infrastructure, ships fixes, never appears in the product itself.

## Where to find what

### Notion (this workspace)

- [**Our Haven parent page**](https://www.notion.so/Our-Haven-34af51fd2f92809a869cea8129a7f586?pvs=21) — project hub. Status, dates, links to everything.
- [**Project Plan**](https://www.notion.so/Project-Plan-359f51fd2f92800a9a16c85e1f3b8eb9?pvs=21) — the 7-phase plan, demos per phase, dependencies on Ci'erro, scope lock items.
- **Weekly updates** — dated child pages under the parent page. Read the latest one before any Ci'erro call.

### Google Drive

- **Our Haven App — Project Plan & Payment Structure** ([link](https://docs.google.com/document/d/1mnDstFU1oeDRmnFzHYG6AuhENRYW6eDJSynogr00_Hc/edit)) — the original proposal document. The Notion project plan supersedes it, but this is the version Ci'erro signed off on.
- Brand assets folder (forthcoming from Ci'erro's marketing consultant — fonts, colors, logo) — Phase 0 deliverable from her side.

### Fathom (call recordings)

Search "Ci'erro" in Fathom. Three calls to date:

- **Apr 28** — proposal walkthrough. Phase 1 scope expanded from babysitters only to babysitters + tutors + nannies. Flutter chosen so web version is cheap to add later. Timeline negotiated from 4 months to 3, with the 4th as a non-negotiable buffer.
- **May 4** — contract finalization. Ci'erro picks us over faster, cheaper competitors on trust. Two-month launch becomes the new aspirational target. Web-redirect payment model agreed.
- **May 6** — contract clarification. End-to-end encryption removed, providers added, video interview moved from custom to embedded third-party, custom matching deferred. **Watch this one first** — it's the clearest single record of what's in and out of scope.

### WhatsApp

Ci'erro prefers WhatsApp for casual back-and-forth. Ask JD for her number.

### Hosting & infra

- **Apple Developer account** — Ci'erro registers (~$99/year).
- **Google Play Developer account** — Ci'erro registers (~$25 one-time).
- **Stripe** — Ci'erro sets up the account, adds JD. Standard vs Connect to be confirmed by JD during Phase 0.
- **Checkr** — JD confirms it's the right vendor and locks the per-check cost during Phase 0.
- **Domain** — [ourhavenapp.com](http://ourhavenapp.com) is already Ci'erro's. The app will sit on that domain.

## Things Ci'erro cares about (and the reasons)

When anyone asks "why are we doing it this way," the answer is usually one of these.

1. **Trust over speed.** She chose us over faster competitors on trust alone. Every product decision needs to reinforce that trust — verification depth, video interviews, two-way ratings, message scanning. Anything that looks like a shortcut around safety will get pushed back.
2. **Special-needs families are more sensitive.** This isn't generic childcare. The parents coming to Our Haven are wary in ways that ordinary parents aren't, and the caregivers will be asked about insurance, diagnoses, and specialisations. Build for the harder case and the easier case takes care of itself.
3. **Avoid the Apple and Google 30% tax.** Hence the web-redirect model for subscriptions. Don't accidentally architect this back in by putting subscription flows inside the mobile app.
4. **The marketplace has to look populated at launch.** Empty marketplaces die. The whole reason the Apr 28 and May 4 calls spent so long on background-check timing is that Ci'erro wants caregivers verified and live *before* parents arrive. The caregiver web flow exists partly to let her start onboarding caregivers ahead of mobile launch.
5. **Optional fields beat mandatory ones.** Caregivers can list occupation, certifications, or insurance — but it's optional. Parents can list child diagnoses — but it's optional. The pattern: encourage disclosure, never require it. Required fields hurt conversion; optional fields signal trust.

## What "good" looks like for the PM role

- Every Friday: a written client update covering what shipped this week, what's coming next, any blockers. Posted in the weekly updates section of Notion *and* sent to Ci'erro on WhatsApp.
- Before any Ci'erro call: re-read the latest Fathom summary, scan the open tickets, write down two or three specific decisions you need from her. She'll come to the call with her own list — match it.
- After any Ci'erro call: within 24 hours, send her a written summary on WhatsApp and update any tickets that changed. She has explicitly said she relies on us holding the record because she may not always write things down.
- When scope changes (and it will — she has new ideas every call), note the change, push it into the project plan as a slip or trim or a Phase 2 item, and flag the impact to her before the next sync. Never absorb scope silently.
- Engineering questions go to JD first. Don't ask Ci'erro to make technical calls; she's non-technical and she hired us partly to take that load off her.
- Compliance questions (privacy policy, terms, caregiver classification) go to Ci'erro's lawyers, not us. We tell her what the product does; her lawyers wrap that in legal language.

## Things that aren't obvious

- **The caregiver web portal ships before the parent mobile app.** This is partly architectural (web is faster for document upload) but mostly operational — Ci'erro needs caregivers onboarded and background-checked before parents arrive, so caregiver sign-up has to be live first. The phased plan reflects this.
- **We're "Florida-first" for marketing, not for the build.** The app works everywhere from day one. Ci'erro concentrates marketing on one geographic area to seed supply and demand. Don't accidentally build geographic gating into the product.
- **Providers (clinical specialists) are in Phase 1.** They were almost left out of the contract. She caught it during the May 6 call and we added them. If anyone designs the caregiver flows as if there are only three categories (babysitter, tutor, nanny), that's wrong — there are four.
- **The caregiver web flow needs to handle the case where someone signs up before the mobile app exists.** Teachers are already emailing Ci'erro asking to be on the platform. We'll likely need a pre-launch caregiver sign-up on the marketing site that feeds into the same system once the real product is live.
- **End-to-end encryption is out. Standard encryption is in.** Don't reintroduce E2EE because it sounds safer — it would break message scanning for fraud detection, which is a more important safety feature here than message privacy.
- **AI-generated parent profiles from reviews, custom matching, and custom video are out of scope for v1.** All three were JD-floated ideas she liked but agreed to defer to keep the timeline tight. Flag them if they creep back in.
- **Marketing wanted orange.** The landing page is orange-heavy and Ci'erro's marketing consultant has been working in that palette. The first round of UI directions JD shared (cream + pink, dark + red, blue + white) did not include orange. If a brand pack lands midway through design, expect colors to change.

## First-week checklist for a new PM

- Read this doc end to end
- Read the Project Plan
- Watch the May 6 Fathom call (`Cierro and The Codefoundry`, 2026-05-06)
- Skim the Apr 28 and May 4 Fathom calls for context
- Open the Our Haven App — Project Plan & Payment Structure doc in Drive to see the contract version Ci'erro signed
- Read whatever Phase 0 discovery docs JD has produced (background-check research, video-provider research, Stripe Connect decision)
- Sit in on the next Ci'erro call as an observer
- By end of week one: draft your first weekly update

## Who to ask

- **Product, scope, client relationship:** JD
- **Engineering, architecture, the codebase:** JD and the lead developer
- **Design, Figma:** check the file directly first, then JD
- **Compliance, privacy policy, terms, caregiver legal classification:** Ci'erro's lawyers (through Ci'erro)
- **Brand, fonts, colors, logo:** Ci'erro's marketing consultant (through Ci'erro)
- **Ci'erro:** only after you've checked with JD that the question is appropriate to bring to the client