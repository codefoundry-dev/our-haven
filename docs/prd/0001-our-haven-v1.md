# PRD — Our Haven v1

**Status:** draft v1.3 (not yet published to issue tracker)
**Owner:** JD, The Codefoundry
**Last revised:** 2026-05-26 (v1.3 — **US-national launch pivot per ADR-0009**: Miami soft-launch concentration dropped; FL-board-eccentric Specialist verification genericized to per-state license adapter slate; per-state compliance adapters promoted from Phase-2-add to core v1; state-privacy patchwork module replaces FDBR-only framing; sales-tax registrations pursued as nexus develops via Stripe Tax; cross-platform mobile stack switches from Flutter to **React Native + Expo**. Prior revisions 2026-05-19 (v1.2), 2026-05-18 (v1.1), 2026-05-11 (v1.0a).)

> Domain language follows `CONTEXT.md`. Architectural framing follows ADR-0001 (marketplace billing), ADR-0002 (Provider portal web-only — **superseded** by ADR-0005), ADR-0003 (Miami/Florida launch jurisdiction — **superseded** by ADR-0009; bg-check sub-decision was partially superseded by ADR-0007), ADR-0004 (backend stack and cross-platform API), **ADR-0005 (Provider mobile companion supersedes web-only)**, **ADR-0006 (Job-posting + negotiable pricing — slot-pick path superseded 2026-05-19)**, **ADR-0007 (Checkr standard background screening)**, **ADR-0008 (Daily.co embedded video, ad-hoc, either-party)**, and **ADR-0009 (US-national launch from day one; per-state compliance adapters are core v1)**.

---

## Problem Statement

Parents across the United States looking for childcare and child-development support — Babysitters, Tutors, Nannies, and Specialists — face a fragmented, unverified market. Existing options (Care.com, agency listings, word-of-mouth Facebook groups, neighborhood referrals) range from un-vetted to expensive, and none of them are built around the specific needs of families with neurodivergent children, where matching a Provider to a child's profile is a clinical judgement, not a search-and-click.

Providers — particularly licensed Specialists — also face friction on the supply side: there is no national marketplace that combines **marketplace-grade Checkr background screening** (county criminal + national sex offender + SSN), license cross-checking against the **right state professional board** for each Specialist's resident state (with per-state license-board adapters built in), and Stripe-handled Payouts in one place. They lose time and money setting up their own websites, vetting prospects, and chasing payment.

The result: Parents settle for Providers who are convenient rather than appropriate; Providers churn through admin overhead instead of doing their work.

## Solution

Our Haven is a **US-national** two-sided marketplace from day one (per ADR-0009 — supersedes the ADR-0003 Miami/Florida soft-launch posture), built on a state-pluggable compliance core so the platform routes verification, sales-tax, classification-addendum, and privacy-rights surfaces per the user's resident state without engineering rework as supply emerges from new states.

**A single React Native + Expo mobile app serves both Parents and Providers** in role-aware shells; the role is chosen at sign-up via a **3-tab role-pick screen** — *"I'm a Parent / I'm a Caregiver / I'm a Specialist"* (refined 2026-05-19). The Caregiver and Specialist tabs both map to `role=provider`; the tab choice sets the Provider's `kind` field. Provider has a two-level taxonomy: `kind=caregiver` (with `caregiver_category` in Babysitter / Tutor / Nanny) or `kind=specialist` (with `specialty` in SLP / ABA / OT / Psychology / etc.). Parents discover, message, book, video-call, and pay vetted Providers. Providers run the day-to-day workflow on mobile (accept Bookings, manage Availability, apply to Jobs, message, complete Sessions). The **web portal remains the system of record** for heavy onboarding (Stripe Connect KYC, license uploads) and Payout management; the mobile companion links out to web in an in-app browser for those tasks.

**Every Parent-Provider transaction traces back to a canonical chain: Job → Application → Offer → Booking** (per ADR-0006). Two paths produce Jobs (refined 2026-05-19): Parents may **post a Job** describing what they need (Providers in the matching Category and area apply with a structured Offer); OR Parents may **open a Direct-Message chat** with a specific Provider, negotiate via free-text + structured **Book-requests** (the parent-facing UI label for an Offer), and on acceptance the system **lazily materialises** Job + Application + Booking atomically. The earlier slot-pick (per-slot calendar) entry path is **removed** — Provider profiles now display only a general weekly availability summary (Day × Morning/Afternoon/Evening grid + free-text note). **Pricing is negotiable** — either side can send a Book-request/Offer; Offers carry Accept/Counter/Decline pill buttons; acceptance creates a Booking with the Agreed Rate baked in. Posted-Job Bookings start in `requested` (Provider has 24h to confirm); Direct-Message Bookings start in `accepted` directly (the accepting click is the commitment).

An **admin dashboard** runs Provider review, Trust & Safety message access, dispute resolution, and platform metrics.

The marketplace runs on a **Parent Subscription** (web-billed; unlocks search, messaging, booking, and Job posting) plus a **percentage Commission** skimmed from each Booking via Stripe Connect's application fee. Provider classification (1099 independent contractor under IRS common-law test as the federal baseline, with **per-state classification addenda** for AB5/ABC-test states), the US privacy patchwork (federal floor: COPPA + HIPAA-adjacent + FCRA; **state-privacy patchwork module** routing CCPA/CPRA + VCDPA + CPA + CTDPA + UCPA + FDBR + OCPA + TDPSA + others per user state), explicit Parent consent for Child special-needs flags, and **Stripe Tax** per-state nexus + 1099-K reporting are first-class concerns built into v1, not afterthoughts.

A public Parent web app ships in Phase 6 from the same React Native codebase (via React Native Web).

## User Stories

### Parent — discovery & onboarding

1. As a Parent, I want to sign up for an account using Sign in with Apple, Google, or email and password, so that I can choose the auth method I trust. *(v1.1: preceded by the cross-cutting role-pick step from story 78.)*
2. As a Parent, I want to verify my email at sign-up (phone optional at this step), so that I can finish onboarding quickly and start browsing — and then provide and verify my phone at the moment I commit to a Booking or post a Job, so that the platform has a contact channel for booking-critical SMS (cancellations, new-device MFA) only when I'm actually using money-spending features. *(v1.2 (2026-05-19): phone shifted from sign-up to paywall — see `CONTEXT.md` § Authentication / Parent (mobile).)*
3. As a Parent, I want to see and explicitly accept a sensitive-information consent screen before I can record special-needs flags or notes on a Child profile, so that my child's sensitive data is handled with COPPA-aware, HIPAA-adjacent, and FDBR-compliant care.
4. As a Parent, I want to add multiple Child profiles to my account — each with age, special-needs flags, and notes — so that I can book different Providers appropriate for each child.
5. As a Parent, I want to be prompted to add a payment method at the **paywall moment** — when I first try to send a Message, send a Book-request, or post a Job — not during initial sign-up, so that I can browse the marketplace freely first and only commit my payment info once I'm ready to act. *(v1.2 (2026-05-19): moved from sign-up to the combined paywall step alongside phone verification + Stripe Subscription checkout. See `CONTEXT.md` § Subscription and DESIGN.md §5.1.11.)*
6. As a Parent, I want to be able to see a 1–2 Provider preview without paying, so that I can evaluate the marketplace before committing to a Subscription.
7. As a Parent, I want to subscribe to Our Haven via a web checkout (linked from the mobile app), so that I can unlock full search, messaging, booking, **and Job posting** *(v1.1: Subscription gate now extends to Job posting per ADR-0006)*.
8. As a Parent, I want my Subscription status to be reflected in the mobile app immediately after I complete the web checkout, so that I can use the unlocked features without re-launching.
9. As a Parent, I want to apply a discount code to my Subscription, so that I can take advantage of launch promotions.

### Parent — search & filters

10. As a Parent, I want to search for Providers by Category (Babysitter / Tutor / Nanny / Specialist), so that I can narrow to the kind of help I need.
11. As a Parent, I want to filter by ZIP code and radius, so that I can find Providers near me.
12. As a Parent, I want to filter by date and time intersected with each Provider's published Availability, so that I only see Providers who can actually work my window.
13. As a Parent, I want to set an hourly Rate ceiling, so that I only see Providers I can afford.
14. As a Parent, I want to filter by minimum star Rating, so that I avoid unproven supply.
15. As a Parent, I want to filter for "Tax-credit-friendly" Babysitters and Nannies (Providers who will issue IRS Form W-10 on request), so that I can claim the Child and Dependent Care Tax Credit (CDCTC) or use a Dependent Care FSA.
16. As a Parent searching within the Specialist category, I want Specialist-specific filters (license type, in-person vs telehealth, age range served), so that I can match clinical fit before contacting anyone.
17. As a Parent, I want search results ranked by a hybrid of distance, Rating, and recent activity, so that the most useful Providers surface first without me sorting manually.

### Parent — messaging & video

18. As a Parent, I want to message a Provider before booking, so that I can ask questions and assess fit.
19. As a Parent, I want my messages to be encrypted in transit and at rest, so that my conversations stay private.
20. As a Parent, I want to be told (in the Privacy Policy) that the Trust & Safety team can access message content for fraud and safety review, so that I'm fully informed.
21. As a Parent, I want the platform to redact phone numbers, emails, social handles, and payment app names automatically before they reach the recipient, so that I'm protected from off-platform pressure that strips marketplace safeguards.
22. As a Parent, I want to start a video call with a Provider directly from our chat thread at any time, so that I can verify identity or talk through a question before — or after — committing to a Booking. *(v1.2 (2026-05-19): replaces the prior "schedule a video interview before booking" wording — calls are now ad-hoc, in-chat, either-party-initiated, embedded via Daily.co. See ADR-0008. A sibling Provider-initiator story to be added during the PRD v1.1 revision pass.)*

### Parent — Booking lifecycle

23. As a Parent, I want to see a Provider's **general weekly availability** (e.g., "Mon–Fri 3–5 PM" or "Weekends, mornings") on their profile, so that I can gauge whether their schedule overlaps mine before investing time in a chat. *(v1.2 (2026-05-19): replaces the prior slot-pick calendar story — Availability is now a Day × Morning/Afternoon/Evening grid + free-text note; there is no per-slot calendar and no tap-to-book. See `CONTEXT.md` § Availability and DESIGN.md §5.4.2.)*
24. As a Parent, I want to **open a Direct-Message chat** with a specific Provider (from search results or their profile) and exchange free-text messages and structured **Book-requests** with them, so that I can negotiate scope, time, and rate before any Booking exists. When either party hits **Accept** on a Book-request, the system materialises Job + Application + Booking atomically; the Booking is born in `accepted` state directly. *(v1.2 (2026-05-19): replaces slot-pick. The pre-acceptance thread is anchored to `thread_id`; on acceptance it rebinds to `job_id`. See `CONTEXT.md` § Job / § Message / § Booking states and ADR-0006 (revised).)*
25. As a Parent, I want to attach one or more of my Child profiles to a Booking, so that the Provider knows who they're caring for. *(v1.1: for posted Jobs, Child profile attachment happens at **Award time** rather than at compose time — see story 88.)*
26. As a Parent booking a Tutor or Specialist, I want to be limited to a single Child per Booking, so that the engagement model is honest about clinical 1:1 reality.
27. As a Parent booking a Babysitter or Nanny for multiple Children, I want to see and pay any per-child surcharge transparently, so that there are no billing surprises. *(v1.1: per-child surcharge is snapshotted into the Offer's `computed_total` at send time; subsequent Provider profile changes don't affect in-flight Offers.)*
28. As a Parent, I want my card to be authorized at booking but not charged until the Session is complete (for hourly Bookings), so that I'm not paying upfront for hours that may not happen. *(v1.1: authorization amount derives from the **Agreed Rate** on the accepted Offer, not the Provider's Published Rate.)*
29. As a Parent booking a Specialist per-session, I want to be charged the fixed Rate at booking time, so that the engagement is locked in.
30. As a Parent, I want to receive a push notification and an email when a Provider accepts, declines, or lets my request expire, so that I know the status without having to check.
31. As a Parent, I want to receive a push reminder one hour before my Booking starts, so that I don't forget.
32. As a Parent, I want to be notified after a Session ends to confirm or dispute the hours the Provider proposed, with a clear 24-hour window, so that I'm protected from over-billing without being a permanent gatekeeper.
33. As a Parent, I want any 3DS step-up challenge (applied opportunistically by Stripe for fraud reduction, not on every payment) to be handled smoothly, so that my card actually works on first try.
34. As a Parent, I want to be able to cancel a Booking and see exactly what I'll be charged based on how close to start time I am, so that I can make an informed decision.

### Parent — ratings & disputes

35. As a Parent, I want to rate a Provider 1–5 stars with optional text in the 14 days after a Booking completes, so that I can share my experience.
36. As a Parent, I want my rating to stay blind until the Provider also submits or the window closes, so that retaliation isn't a concern.
37. As a Parent, I want to see other Parents' star ratings and text reviews on a Provider's profile, so that I can make informed choices.
38. As a Parent, I want to file a Dispute within 7 days of a Booking completing, so that I have recourse if something went wrong.
39. As a Parent, I want a clear no-show flow if a Provider doesn't turn up, so that I get a refund quickly without arguing.

### Provider — onboarding & verification

40. As a Provider, I want to sign up using either the web portal (email/password or Sign in with Google) **or** the mobile companion app (Apple, Google, or email/password), so that I can choose the surface I discovered Our Haven on. *(v1.1: previously web-only per ADR-0002; now dual-surface per ADR-0005. Heavy onboarding steps (Stripe Connect KYC, license uploads) remain web-only — the mobile companion links out for those.)*
41. As a Provider, I want to be guided through a category-aware onboarding flow (Babysitter / Tutor / Nanny / Specialist), so that I'm only asked for documents relevant to my work.
42. As any Provider, I want to upload my government ID and complete a **Checkr standard-package background screening** (county criminal 7-year + national criminal database + national sex offender registry + SSN trace) at sign-up, charged at **$35** to me with a small platform margin, so that I'm verified before I can appear in search. *(Multi-state coverage out of the box per ADR-0007 / ADR-0009.)*
43. As a Specialist, I want to additionally provide my professional license number, issuing **state board** (auto-selected per my resident state from the per-state license-adapter slate), license document, and liability insurance certificate, so that my clinical credentials are properly verified against the correct state register. *(v1.3 (2026-05-26): genericized from FL-only enumeration per ADR-0009. The per-state license adapter populates board options for the priority Specialist-supply state slate at launch; states outside the slate route to a "verification pending — your state is not yet supported" holding state.)*
44. As a Babysitter or Nanny, I want to opt into the **"Tax-credit-friendly" badge** by self-attesting that I will issue **IRS Form W-10** on request, so that Parents claiming the CDCTC or using a Dependent Care FSA can find me. (Optionally, if I operate a **state-licensed home-based childcare program** — e.g., a Family Child Care Home registered with my state's child-care licensing agency — I want to upload my state registration to display a separate "State-registered home childcare" badge, with the specific state agency named on the badge.)
45. As a Provider, I want to see clear status tracking on each verification step, so that I know what's blocking my activation.
46. As a Provider, I want to set my own Rate (hourly for Babysitter/Tutor/Nanny; per-session for Specialist), so that I can price fairly for my market.
47. As a Babysitter or Nanny, I want to set an optional per-child surcharge, so that multi-child Bookings reflect the actual workload.
48. As a Provider, I want to publish my Availability calendar from either the web portal or the mobile companion (whichever is convenient), so that Parents only see slots I can actually work. *(v1.1: editor now exists on both surfaces per ADR-0005; data is the same calendar in the system of record.)*
49. As a Provider, I want to onboard onto Stripe Connect Express through a hosted KYC flow, so that I can receive Payouts without manual paperwork.

### Provider — Booking lifecycle

50. As a Provider, I want to receive an SMS, email, and push notification (mobile and web) the moment a Parent submits a Booking request, so that I can respond within the 24-hour window. *(v1.1: SMS deep-links into the mobile companion's Schedule tab when installed; falls back to the web portal otherwise.)*
51. As a Provider, I want to see the Child profile information appropriate to the Booking (age + special-needs flag presence at request time; full notes after acceptance — full notes pre-accept for Specialists), so that I can decide whether to accept while respecting privacy. *(v1.2: applies identically to Direct-Message Book-requests carrying `attached_child_ids` on a Parent-sent Offer and to Awarded Posted-Job Applications.)*
52. As a Provider, I want to accept or decline a Booking request from either the mobile companion or the web portal, so that I'm only committed to work I can actually do. *(v1.1: action available on both surfaces per ADR-0005.)*
53. As a Provider, I want my Direct-Message chat threads to surface pending Book-requests prominently (Schedule tab badge + chat-list highlight + push/SMS), so that I can act on time-sensitive incoming opportunities without a slot-blocking mechanism. *(v1.2 (2026-05-19): the prior "slot-blocked-on-request" mechanism is removed with slot-pick. The replacement is visibility-driven — Book-requests carry `valid_until` (default 72h) and surface as actionable bubbles; if multiple Parents send overlapping requests, the Provider picks one by accepting it (acceptance materialises the Booking; competing Book-requests remain `pending` until they expire or the Provider declines them).)*
54. As a Provider running an hourly Booking, I want to mark a Session in-progress at start time and propose final hours when finished — both actions reachable from my phone — so that the Parent is billed accurately. *(v1.1: Active session is mobile-native on the companion app since the Provider is on-site with their phone.)*
55. As a Provider, I want my Payout to release after the Parent confirms the proposed hours (or the 24h auto-confirm window passes), so that I'm paid promptly.
56. As a Provider, I want to receive an email when a Payout lands in my Stripe account, so that I have an accurate record.
57. As a Provider, I want a step-up MFA challenge when I change my bank details or initiate a withdrawal, so that my Payouts can't be hijacked by an attacker who got my password.

### Provider — messaging, ratings, support

58. As a Provider, I want to message a Parent before, during, and after a Booking, from either the mobile companion or the web portal, so that I can coordinate logistics. *(v1.2 (2026-05-19): threads anchor either to a `job_id` (Posted-Job Applications and post-acceptance Direct-Message threads) or to a `thread_id` only (pre-acceptance Direct-Message threads). v1.3 (2026-05-27, ADR-0010): live delivery is now via **Supabase Realtime** subscriptions on the `messages` Postgres table — both surfaces share the same row-level-subscription infrastructure. Replaces the originally specified Firestore listener fan-out.)*
59. As a Provider, I want to rate a Parent 1–5 stars with optional text after a completed Booking (visible only to other Providers, aggregate-only), so that I can warn peers about problem clients without exposing them publicly.
60. As a Provider considering a Booking request, I want to see the Parent's aggregate Rating and count, so that I can avoid known-bad actors.
61. As a Provider, I want to file a Dispute or report a Parent no-show through a clear in-app flow, so that I'm not left out of pocket.
62. As a Provider, I want my access to message threads through the portal to be unaffected by the Trust & Safety team's audit-logged access to the same threads, so that I retain my normal experience while the platform stays accountable.

### Admin / Trust & Safety

63. As an admin, I want to log into the dashboard with mandatory TOTP MFA, so that admin access is hardened.
64. As an admin reviewing the Provider queue, I want to see **Checkr standard-package screening results** (criminal + sex offender + SSN), license verifications (Specialists), and (where applicable) state home-childcare registration certificates side-by-side with the Provider's profile, so that I can approve or reject efficiently.
65. As an admin, I want to manually verify a Specialist's license against the relevant **state public register** — routed by the Specialist's resident state via the per-state license adapter, which surfaces the right state board URL/API for the Specialist's specialty (e.g., CA Board of Behavioral Sciences, FL DOH MQA portal, NY Office of the Professions, TX state boards, etc.) — and record my verification decision with a timestamp, so that there's a clear audit trail. *(v1.3 (2026-05-26): genericized from FL-only enumeration per ADR-0009.)*
66. As a Trust & Safety reviewer, I want a flagged-thread queue showing all messages that tripped disintermediation detection, so that I can investigate proactively.
67. As a Trust & Safety reviewer, I want to access a specific message thread on demand when a Parent or Provider files a safety/fraud report, with a free-text reason captured at access time, so that the audit log records why I looked.
68. As a compliance reviewer, I want every Trust & Safety thread access logged with admin ID, thread ID, timestamp, mode (queue vs investigation), and reason, so that the platform can demonstrate proportionate access during a privacy-counsel review or a Florida Attorney General / FDBR inquiry.
69. As an admin handling a Dispute, I want to see the full Booking history (states, Session hours proposed/confirmed, payment timeline), so that I can resolve it fairly.
70. As an admin resolving a Dispute, I want to release, partially refund, or fully refund the held Payout, so that the resolution flows through Stripe immediately.
71. As an admin, I want to view platform metrics (sign-ups, active Subscriptions, cancellations, Bookings) on a dashboard, so that I can monitor health.
72. As a Trust & Safety reviewer, I want to suspend a Provider account pending review when no-show flags hit threshold (or after a serious incident), so that supply quality stays high.

### Cross-cutting / compliance

73. As a Parent, I want to delete my account and see my data soft-deleted for 30 days (recoverable), then hard-deleted (with financial records retained 7 years pseudonymised), so that my FDBR right-to-delete and CDCTC-aligned record retention are both honored.
74. As a Parent, I want to withdraw my sensitive-information consent and have all special-needs flags and notes deleted from my Child profiles, so that I retain control over sensitive data about my child.
75. As a Provider, I want my background-check raw details retained for no more than 6 months and then hard-deleted (with my cleared/not status remaining on my account), so that FCRA disposal-rule best practice is honored.
76. As a marketing recipient, I want a separate explicit opt-in for promotional messages distinct from transactional ones (CAN-SPAM-compliant for email; TCPA-compliant for SMS), so that I can opt out of marketing without losing booking-critical notifications.
77. As any user, I want 3DS step-up challenges to be applied opportunistically to high-risk card-not-present transactions for fraud reduction, so that the platform balances payment friction against fraud loss without imposing an SCA-style universal challenge.

### Cross-cutting — role pick + Provider mobile companion (v1.1 — 2026-05-18, ADR-0005)

78. As a new user signing up, I want a **3-tab role-pick** at the very first step — "I'm a Parent / I'm a Caregiver / I'm a Specialist" — so that subsequent screens are scoped to my role (and, for Provider tabs, my `kind`) and the account's role is recorded permanently. *(v1.2 (2026-05-19): refined from the prior two-pill "Parent or Provider?" chooser. Caregiver and Specialist tabs both map to `role=provider`; the tab choice sets the Provider's `kind` field. See `CONTEXT.md` § Authentication / Account roles + § Provider.)*
79. As a Provider, I want to sign up via the mobile app using Sign in with Apple, Sign in with Google, or email/password, so that I can complete sign-up on the device I discovered Our Haven on rather than being forced to a web browser.
80. As a Provider, I want my mobile companion to surface a clear "Finish on web →" linkout when an action lives on the web portal (Stripe Connect KYC, license/insurance document upload, FCCH registration upload, bank-detail changes, withdraw funds), opening an in-app browser with a signed handoff token, so that I'm never stranded mid-flow.
81. As a Provider on mobile, I want my bottom navigation to be Opportunities / Schedule / Messages / Account, with badges for new Jobs in the feed and items awaiting action, so that the surfaces that matter to my day are one tap away.
82. As a Provider, I want a sticky in-progress Session banner at the top of my Schedule tab — with an elapsed timer and a one-tap "End session & propose hours" action — so that closing out a Session is friction-free even when I'm on-site with a child.
83. As a Provider in pre-activation state (verification not cleared), I want my Opportunities tab to render a helpful empty state explaining which onboarding step is blocking me, so that I know exactly what to do next.

### Parent — Jobs (v1.1 — 2026-05-18, ADR-0006)

84. As a Parent with an active Subscription, I want to post a Job describing what I need (Category, scope, dates, free-text description, optional budget hint), so that qualified Providers can come to me rather than me hunting through profiles.
85. As a Parent without an active Subscription, I want the "Post a Job" entry-point to route me to the same Subscription gate as the rest of the gated marketplace, so that the commercial model is consistent across surfaces.
86. As a Parent composing a Job, I want to be shown a one-time consent warning that my description will be visible to every Provider who views the Job, and to acknowledge it before I can proceed, so that I'm deliberate about what I include about my child. The acknowledgement is timestamped to the Job record.
87. As a Parent, I want to save a Job as a draft and come back to finish it later, so that long clinical Job descriptions don't have to be written in one sitting.
88. As a Parent, I want to see a list of Applications on each of my posted Jobs — Provider name, rating, verification badges, proposed Offer total, application status pill — so that I can shortlist efficiently.
89. As a Parent reviewing an Application, I want to see the Provider's profile, the full proposal text, the live Offer with Accept / Counter / Decline buttons, and a message link, so that I have everything I need to choose without round-tripping screens.
90. As a Parent, I want to award a Job to a chosen Provider — at which point I attach the Child profile(s) and confirm the payment method, and the system creates a Booking in `requested` state with the Agreed Rate from the accepted Offer — so that the canonical Booking flow takes over from there.
91. As a Parent, I want awarding to automatically decline other open Applications on that Job (with auto-notifications to those Providers), so that the Job clearly closes and other applicants can free up to apply elsewhere.
92. As a Parent, I want to edit or close a Job at any point before it's awarded, so that I can revise scope or stop the Job if I no longer need it. Closing surfaces a confirmation modal because it withdraws all open Applications.
93. As a Parent, I want to be notified (push + email) when one of my Jobs is two days from expiring with no awarded Application, so that I can edit, repost, or accept that no match was found.
94. As a Parent, I want my posted Job to stop accepting new Applications once 15 have been filed, so that I'm not flooded by an unreviewable volume.

### Provider — Jobs & Opportunities (v1.1 — 2026-05-18, ADR-0006)

95. As a verified Provider, I want to browse a feed of open Jobs in my Category and service radius, ranked by recency and distance, so that I can find work that fits me.
96. As a Provider considering a Job, I want to see the Job description, scope, posted-time, ZIP/radius, optional budget hint, the Parent's first name + aggregate Rating, and a running count of how many Providers have already applied (N/15), so that I can decide whether it's worth my time.
97. As a Specialist Provider, I want my open-Jobs feed to filter to Jobs whose Specialist focus matches my sub-category (SLP / OT / ABA / Psychology / etc.), so that I don't see opportunities I'm not licensed for.
98. As a Provider, I want to file an Application that carries a free-text proposal plus a first Offer (Rate + scope_quantity + optional scope_note + computed_total + valid_until), so that the Parent sees both my pitch and a concrete commercial proposal in one act.
99. As a Provider, I want my Application to count against my monthly cap of 30 Applications (calendar-month, reset on the 1st), with a visible running total, so that I can pace my applications and am never surprised when I hit the cap.
100. As a Provider, I want a Job that has reached its 15-Application cap to surface with its Apply button disabled, so that I don't waste time writing a proposal for a Job I can't apply to.
101. As a Provider, I want to withdraw my Application before the Parent awards or declines, so that I can pull out cleanly if my availability changes.
102. As a Provider whose Application was Awarded, I want to be notified via SMS + push + email and routed straight to the new Booking in `requested` state, so that I can confirm the slot/time without delay.

### Negotiable pricing & Offers (cross-cutting v1.1 — 2026-05-18, ADR-0006)

103. As either party in a thread (Parent or Provider), I want to send a structured Offer at any time before a Booking is created, so that pricing conversations are concrete and binding rather than implied in chat.
104. As either party receiving an Offer, I want to see Accept / Counter / Decline pill buttons inline in the message thread, so that I can act on the Offer without leaving the conversation.
105. As either party, I want to counter an Offer with a new Offer that may revise Rate, scope_quantity, or scope_note, so that we can converge on terms through the same thread.
106. As either party, I want every Offer to carry a `valid_until` timestamp (default 72 hours), so that negotiations don't drag indefinitely and price contexts don't drift while one side is unresponsive.
107. As either party, I want the per-child surcharge baked into an Offer's `computed_total` at send time to be **snapshotted** from the Provider's profile, so that subsequent profile changes don't retroactively alter in-flight Offers.
108. As either party, I want the free-text `scope_note` field on an Offer to pass through the same Disintermediation detector that runs on messages (redacting phone numbers, emails, social handles, payment-app references), so that the negotiation channel can't be used as a workaround for off-platform fraud. Structured numeric fields (`proposed_rate`, `computed_total`, `scope_quantity`) bypass the detector.
109. As a Trust & Safety reviewer, I want Offer bubbles to be reviewable in the same thread surface I use for messages, with the same audit-log shape, so that the access policy stays consistent across Messages and Offers.
110. ~~As a Parent picking a slot from a Provider's Availability calendar, I want the system to auto-create a Job behind the scenes carrying the Provider's Published Rate as the auto-Offer, so that the slot-pick UX is unchanged for me even though every transaction now traces through a canonical Job → Application → Offer chain.~~ **Superseded 2026-05-19** — slot-pick is removed; the canonical chain is now materialised lazily at Direct-Message Book-request acceptance (see story 24). The Job → Application → Offer → Booking invariant is preserved without the slot-pick entry path.

### v1.2 additions (2026-05-19 client sync)

111. As a Parent during sign-up, I want a brief multi-choice **preview questionnaire** (neurotypical/neurodivergent, child's age band, optional diagnosis hints) to tailor the initial browse experience, so that I see relevant Providers immediately without having to filter manually. **The questionnaire is ephemeral** — answers are used only to shape the first browse session and are **not persisted** to a Child profile. *(v1.2: the explicit Child-profile consent moment described in story 3 stays separate from this questionnaire. See `CONTEXT.md` § Sensitive-data consent / pre-signup questionnaire.)*

112. As a Parent sending a **Book-request** inside a Direct-Message chat, I want to attach one or more Child profiles to the Book-request, so that the Provider sees who the booking is for (age + special-needs marker pre-accept; full notes post-accept; full notes pre-accept for Specialists) and can decide whether to accept on a clinical-fit basis. *(v1.2: the Offer schema extends with `attached_child_ids` for Parent-sent Offers; § Child profile visibility on Booking requests in `CONTEXT.md` now covers both Posted-Job Award and Direct-Message acceptance.)*

113. As a Provider, I want to **start a video call** with a Parent directly from our chat thread at any time, so that I can introduce myself face-to-face on incoming Book-requests or check in with families I'm already serving. (Sibling of Parent story 22; symmetric initiation per ADR-0008.)

114. As a Parent during sign-up, I want to pick my role via a **3-tab screen** — "I'm a Parent / I'm a Caregiver / I'm a Specialist" — with the Caregiver and Specialist tabs leading to category/specialty selection, so that the choice maps directly to my mental model of the marketplace. (Refines story 78; the underlying account role remains Parent / Provider with `kind` derived from the tab choice.)

115. As an unsubscribed Parent, I want the **Subscription paywall to fire only at the moment I attempt to send a Message, send a Book-request, or post a Job** — not at sign-up, not at search, not at profile view — so that I can fully evaluate the marketplace (preview-gated to 1–2 Providers per category) before committing to a recurring payment. *(v1.2: refines the Subscription gate position. Phone collection + verification happens in the same paywall step. See `CONTEXT.md` § Subscription + § Authentication.)*

## Implementation Decisions

### Backend stack and cross-platform communication

Per ADR-0004 (Node + TS + Fastify + OpenAPI-first + Postgres-as-system-of-record, §§1–3 + §8 carried forward) and **ADR-0010** (platform stack — supersedes ADR-0004 §§4–7):

- **Backend runtime: Node.js + TypeScript.** Best SDK fit for Stripe Connect, Stripe Tax, Twilio, SendGrid, Supabase, Daily.co, and Checkr (the v1 background-check vendor). Backend ↔ web frontend share types via OpenAPI codegen.
- **API protocol: OpenAPI-first REST + JSON.** The OpenAPI spec is the source of truth; typed TypeScript clients are generated for the React Native mobile app, the Provider web portal, and the admin dashboard. CI fails on spec drift.
- **Data plane (single store, ADR-0010):**
  - **PostgreSQL on Supabase** is the system of record for everything — Bookings, Sessions, Payments, Ratings, Verifications, message content (for retention/audit), audit logs, retention bookkeeping.
  - **Supabase Realtime** delivers live messaging by subscribing to row inserts on the `messages` table. New Messages are written to Postgres canonically (disintermediation-redacted) and the Realtime stream broadcasts the redacted row to subscribed clients — no separate write-fanout layer.
- **Hosting (ADR-0010):** Backend (Fastify) runs on **Fly.io `iad`** (Ashburn, VA). **Supabase US-region project** hosts Auth + Postgres + Realtime + Storage. **Vercel US-region** hosts the Provider web portal and admin dashboard (both Next.js). US data residency under ADR-0009 is enforced by region configuration on every service.
- **Background jobs: `pgmq`** for delayed jobs (Booking 24h expiry, Session 24h auto-confirm, Dispute window expiry, retention/erasure scheduled runs) and **`pg_cron`** for periodic tasks — both first-class Supabase Postgres extensions. Time-delayed work MUST go through `pgmq` — in-process timers are forbidden because Fly.io may restart instances during deploys or scale events.
- **File storage: Supabase Storage** for ID uploads, license documents, state home-childcare registration certificates, and profile photos. Clients upload via signed URLs issued by the backend; downloads are also via short-lived signed URLs scoped to the requesting actor's permissions.

### Cross-platform communication shape

- **Parent + Provider React Native app** → backend over **HTTPS REST** using the generated TypeScript client. Auth via **Supabase access token** in the `Authorization` header; the backend's auth plugin verifies the JWT locally with the project JWT secret on every request. **Live messaging** events delivered via Supabase Realtime row-level subscriptions (`@supabase/supabase-js`), not polled over REST.
- **Provider web portal (Next.js on Vercel)** → backend over **HTTPS REST** using the generated TypeScript client. Auth via Supabase access token (email/password or Google). Live messaging via Supabase Realtime web SDK. **Step-up MFA** required at the backend for payout-sensitive endpoints (changing bank details, initiating withdrawals).
- **Admin dashboard (Next.js on Vercel)** → backend over **HTTPS REST** using the same generated TypeScript client (different auth scope). **Mandatory TOTP MFA** enforced server-side on every request (not just at sign-in) for sensitive operations.
- **Stripe webhooks** → dedicated backend endpoint with Stripe signature verification → translated into Booking lifecycle / Subscription / Payout events for the deep modules.
- **Background-check webhooks (Checkr in v1)** → dedicated backend endpoint with vendor signature verification → translated into Verification workflow events. Endpoint is implemented behind a vendor-agnostic interface so a second-state vendor can be added in Phase 2.
- **Daily.co webhooks** (optional, for call telemetry) → dedicated backend endpoint.
- **Outbound notifications** flow out through the Notifications dispatcher: Expo Push (mobile push via FCM/APNs), VAPID web push (Provider portal + admin), SendGrid (email), Twilio (SMS).

### Modules

The implementation is organized as **thirteen deep modules** (pure logic, simple interfaces, isolated tests) plus integration modules wrapping external SDKs. The original v1 set of nine modules is preserved verbatim; **four new modules** (Job / Application / Offer / Application-quota tracker) are added in v1.1 per ADR-0006.

**Deep modules:**

- **Booking lifecycle state machine.** Encodes the `requested → accepted | declined | expired → in-progress → awaiting-confirmation → completed | disputed | cancelled` graph. Inputs: current Booking + event. Outputs: next state + side-effects to enqueue. Independent of Stripe, persistence, and UI. *(v1.1: state machine unchanged; the new Job / Application / Offer modules feed into this machine at the `requested` entry point only.)*
- **Availability summary.** *(Rewritten 2026-05-19 — the prior per-slot calendar module is removed.)* A small pure module operating on the Provider's `availability_grid` (7-day × 3-band Morning/Afternoon/Evening boolean matrix) + `availability_note` (≤200 chars free text) + `paused` boolean. Functions: render-to-string (e.g., "Mon–Fri 3–5 PM"), intersect-with-search-query (a Parent's date/time filter intersects with the grid's day-band cells), is-paused (Providers with `paused=true` do not appear in search). No slot CRUD, no block-on-request semantics, no automatic release. See `CONTEXT.md` § Availability.
- **Pricing & commission calculator.** Given the **Agreed Rate** (from the accepted Offer), hours, child count, per-child surcharge, Commission %, and category, produces Parent charge + Provider Payout amount + platform Commission + (optional) sales-tax breakdown delegated to Stripe Tax. Per ADR-0001. *(v1.1: input source flips from `published_rate` to `agreed_rate`; arithmetic unchanged.)*
- **Cancellation policy calculator.** Given a Booking and a cancellation timestamp, produces refund and charge amounts under the v1 platform-wide rule (free ≥24h, 50% inside 24h, 100% inside 2h or after start). *(v1.1: refund math operates on the Booking's `agreed_rate` exactly as before; no module change.)*
- **Disintermediation detector.** Regex-based scanner over message text. Outputs redacted text + match metadata (categories matched, original spans). Does not depend on storage; storage of original is the queue module's job. *(v1.1: now also invoked on every Offer's `scope_note` field at submit time.)*
- **Search ranking scorer.** `0.5 × distance_proximity + 0.3 × rating + 0.2 × recency_active_in_last_7_days` over a candidate Provider list, after filter intersection.
- **Rating reveal logic.** Given two-side Rating submission state and the 14-day window position, outputs visibility per Provider profile and per Parent-facing-Provider surface (asymmetric).
- **Verification workflow.** Per-`kind` state machine for Provider verification — **Caregivers** (kind=caregiver, Babysitter/Tutor/Nanny) and **Specialists** (kind=specialist) both require email + phone + ID + **Checkr standard-package background screening** (county criminal 7-year + national criminal database + national sex offender registry + SSN trace; ~$30/check, charged at $35 to the Provider; see ADR-0007). Specialists additionally require professional license + issuing state board (routed via the **per-state license-board adapter** for the Specialist's resident state) + insurance. Babysitter/Nanny optionally carry a self-attested "Tax-credit-friendly" (W-10) badge and (rarely) a state home-childcare registration. State-pluggable: the screening step delegates to the vendor-agnostic background-check adapter (Checkr in v1); license verification delegates to the per-state license-board adapter; the deep module itself remains state-agnostic — it consumes verification *results*, not vendor APIs. Specialists from states outside the launch adapter slate route to a "verification pending — state not yet supported" holding state.
- **Retention/erasure planner.** Given an account-deletion or consent-withdrawal event, outputs the set of records to soft-delete, pseudonymize, hard-delete, or retain — driven by a retention policy table (account 30d soft-delete; financial 7y pseudonymized; messages 3y; background-check raw 6mo; sensitive data on event). *(v1.1: Job descriptions follow the same retention rule as Messages — 3 years post last activity — since the disclosure surface is the same.)*

**New in v1.1 (deep modules, per ADR-0006):**

- **Job lifecycle state machine.** Encodes the `draft → open → (awarded | expired | cancelled) → closed` graph. Inputs: current Job + event. Outputs: next state + side-effects (notification dispatch, Application auto-decline-on-award, Booking creation). Pure; independent of persistence and UI. Slot-pick auto-Jobs enter `open` directly with one auto-Application already filed.
- **Application lifecycle state machine.** Encodes `submitted → (countered | awarded | declined | withdrawn | expired)`. Inputs: current Application + event. Outputs: next state + side-effects. Coordinates with the Job state machine when its Application is awarded (Job transitions in lockstep). Per-Job application count is exposed as a derived value for the 15-cap gate.
- **Offer state machine.** Encodes `pending → (accepted | countered | declined | expired)`. Inputs: current Offer + event. Outputs: next state + side-effects (notify counterparty; on accept, transition Application + create Booking with `agreed_rate = proposed_rate`; on counter, supersede previous Offer). Pure; per-child surcharge is provided as an input snapshot at creation time and held immutable for the Offer's lifetime.
- **Application-quota tracker.** Per-Provider monthly cap accounting. Inputs: Provider ID + current month + event (Application filed). Outputs: remaining-quota count + boolean "can-file". Storage is a simple counter per Provider per month with a monthly reset job. Pure logic; the storage layer is a thin adapter. v1 cap is 30; configurable per Provider (admin override) for re-tuning.

**Integration modules** (thin wrappers over external SDKs; not tested in v1):

- Auth (Supabase Auth + MFA orchestration; US-region project)
- Background-check verification (Checkr **standard-package** wrapper + status polling, behind a vendor-agnostic interface; see ADR-0007)
- Stripe Connect (Connect Express US onboarding + payment intent with `application_fee_amount`)
- Stripe Subscription (web-hosted Parent Subscription + status webhook)
- Stripe Tax (sales-tax computation hookup; nexus tracking across US states as expansion proceeds)
- Daily.co video (room creation + token issuance; US rooms)
- Notifications dispatcher (event → channel matrix → Expo Push / web push / SendGrid / Twilio)
- Disintermediation queue + Trust & Safety audit log (flagged-thread persistence + access logging)
- Messaging (Supabase Realtime row-level fan-out over the `messages` table; encrypted at rest + transport)
- Admin dashboard surfaces (review queues, metrics, T&S thread viewer)

**UI surfaces:** Parent Flutter app (iOS / Android), Provider web portal, admin dashboard.

### Interfaces (high-level)

- The Booking lifecycle state machine is consumed by the API layer, which translates HTTP/RPC events into state-machine inputs and persists the resulting transitions. The state machine itself does no I/O.
- The Pricing calculator is consumed by both the Booking creation path (to compute the authorization amount and display the charge) and the Session-completion path (to compute the final capture amount). The same module produces the Parent-visible charge, the Provider-visible Payout, the platform Commission split, and any applicable sales-tax lines (delegated to Stripe Tax).
- The Disintermediation detector is consumed at message-submit time, before persistence. The redacted message is what the recipient ever sees; the unredacted original goes to the flagged-thread queue.
- The Rating reveal logic is queried at every read — Provider profile views, Parent-facing-Provider surfaces — with the current submission state passed in. No background "reveal job" needs to flip visibility.
- The Retention/erasure planner is invoked on a scheduled job and on direct user actions (account delete, consent withdrawal); it emits the action plan that the persistence layer executes.

### Architectural decisions

- **Stripe Connect Express (US entity)** is the marketplace billing rail (ADR-0001). All Booking payments flow through Connect with `application_fee_amount` skimmed from the **Agreed Rate** (from the accepted Offer; previously the Provider's Published Rate). Parent Subscription is sold only on web (Stripe-hosted page) to avoid iOS / Android in-app-purchase rules; the mobile app reads Subscription status but does not sell it. Form 1099-K issuance to Providers is handled automatically by Stripe.
- **Provider portal is web-primary, with a mobile companion** in v1 (ADR-0005, supersedes ADR-0002). The single Flutter binary serves both Parents and Providers in role-aware shells; the role is chosen at sign-up and is permanent per account. Heavy Provider onboarding (Stripe Connect KYC, license uploads) and Payout management remain web-only — the mobile companion links out to the web portal in an in-app browser for those tasks. Run-the-day tasks (accept/decline Bookings, manage Availability, apply to Jobs, message, complete Sessions) are mobile-native. SMS-on-Booking-request and SMS-on-Job-awarded are both mandatory in v1 because they're the most time-sensitive Provider events.
- **Job is the canonical anchor object** (ADR-0006). Every Booking traces back to Job → Application → Offer; slot-pick auto-creates a hidden Job carrying the Provider's Published Rate as the auto-Offer. Pricing is negotiable via the Offer primitive (Accept / Counter / Decline pill buttons inline in the message thread). Per-Job cap is 15 Applications; per-Provider monthly cap is 30 Applications. Posting a Job requires an active Parent Subscription; applying to a Job requires the Provider's Verification to be `cleared`.
- **US-national launch jurisdiction from day one** (ADR-0009, supersedes ADR-0003). Checkr standard-package screening (multi-state) / **per-state license-adapter slate** populated at launch for priority Specialist-supply states / federal compliance floor (COPPA + HIPAA-adjacent + FCRA + IRS + Title VII + CAN-SPAM + TCPA) + **state-privacy patchwork module** (CCPA/CPRA + VCDPA + CPA + CTDPA + UCPA + FDBR + OCPA + TDPSA + others routed per user state) / 3DS-optional payment posture / **Stripe Tax** for per-state nexus + taxability on Subscription and Commission / **per-state classification addenda** on Provider Terms for AB5/ABC-test states. Per-state compliance adapters are **core v1 deliverables, not Phase 2** — exercised at launch rather than abstract hooks.
- **Supabase Auth (US-region project)** is the identity provider per ADR-0010 (supersedes Firebase Auth from ADR-0004). Parent: Sign in with Apple + Google + email/password, device-trust SMS OTP. Provider: email/password + Google, web-side step-up MFA on payout actions. Admin: TOTP MFA mandatory.
- **Daily.co** is the embedded video provider (US rooms).
- **All vendor configurations pin US data residency**; documented in the Privacy Policy vendor data-flow inventory appendix.

### Schema-shape implications (no specific column names)

- A Booking carries Category, Parent ID, Provider ID, attached Child IDs, planned slot (with the Provider's home state captured for per-state compliance routing), state, payment intent ID, **Agreed Rate** (from the accepted Offer), **Published Rate snapshot** (the Provider's profile Rate at the moment of Booking creation, for audit), **Job ID** (every Booking now has one), and (for hourly) Session sub-record with proposed hours + confirmed hours + confirmation timestamp.
- The Tutor / Specialist single-child constraint is enforced at the Booking creation API boundary, not by trusting clients.
- Disintermediation flagged threads carry the unredacted original, the redacted delivered text, the match metadata, and an FK to the message **or to the Offer** (since Offer `scope_note` is detector-eligible); T&S audit logs reference both admin ID and thread ID with timestamp + mode + reason. Thread ID keys off Job ID — every thread is anchored to a Job.
- Rating storage carries submission timestamp + reveal timestamp; reveal timestamp is computed by the rating-reveal module on read (no batch job).
- Retention is driven by a policy table with per-record-type rules; the planner produces actions, the persistence layer applies them. Job descriptions follow the Message-content retention rule (3 years post last activity) because the disclosure surface is the same; Application proposals and Offer `scope_note` fields follow the same rule.
- **Job** carries: Parent ID, Category, scope description (free text), structured logistics (ZIP, radius, date/time window), optional budget hint, state, consent-acknowledgement timestamp, posted-at timestamp, expires-at timestamp, awarded-Application FK (nullable), `entry_path` enum (`posted` | `direct_message`). *(v1.2: replaces the prior `is_auto` boolean which was tied to slot-pick auto-Jobs — that path is removed.)*
- **Application** carries: Job FK, Provider ID, free-text proposal, current-Offer FK, state, filed-at timestamp.
- **Offer** carries: Application FK, sender (parent | provider), `proposed_rate`, `scope_type`, `scope_quantity`, optional `scope_note`, `computed_total`, `per_child_surcharge_snapshot`, `valid_until`, state, supersedes-Offer FK (nullable, for counter-Offer chain), sent-at timestamp.
- **Application-quota counter** keyed by (Provider ID, year-month); incremented on Application filing; reset by monthly scheduled job. Admin override path supported but not exposed in v1 UI.

## Testing Decisions

### What makes a good test (in this codebase)

- **Test external behavior, not implementation details.** A test for the Booking lifecycle should assert that "an `accepted` Booking with a Parent-cancellation event 1 hour before start produces a 100%-charge cancellation," not that any specific function was called along the way. Tests that assert on internals make refactoring expensive and don't catch real regressions.
- **Tests are fast because deep modules are pure.** No database, no Stripe sandbox, no Supabase emulator in the deep-module test paths. Inputs in, outputs out, milliseconds per test.
- **Integration modules are not unit-tested in v1.** They wrap external SDKs and are mostly glue; testing them directly tends to retest the SDK. End-to-end smoke tests at the API boundary cover what matters there post-launch.
- **Property-based tests where they fit** — particularly Pricing and Cancellation calculators (numeric invariants like "Parent charge ≥ Provider Payout" or "cancellation refund + cancellation fee = original authorized amount"). The Booking state machine is also a natural fit for state-transition properties ("from any state, applying an `expire` event when the request is older than 24h reaches `expired` or no-op").

### Modules to test in v1

All thirteen deep modules (nine original + four added in v1.1):

1. **Booking lifecycle state machine** — exhaustive coverage of the state graph; round-trip and illegal-event tests.
2. **Availability calendar** — slot CRUD, block-on-request, automatic release, query intersection.
3. **Pricing & commission calculator** — base + per-child surcharge, Commission skim, optional sales-tax line delegation to Stripe Tax, rounding, edge cases (zero hours, fractional hours). *(v1.1: tests updated to use `agreed_rate` as the input field; arithmetic invariants unchanged.)*
4. **Cancellation policy calculator** — boundary tests at 2h, 24h, and after-start; refund/charge invariants.
5. **Disintermediation detector** — coverage of each pattern category; redaction-correctness; false-positive curation. *(v1.1: test fixtures extended to cover Offer `scope_note` inputs alongside Message inputs.)*
6. **Search ranking scorer** — score-stability, filter-match correctness, edge cases (no matches, ties).
7. **Rating reveal logic** — all four window/submission combinations across Provider-facing and Parent-facing surfaces.
8. **Verification workflow** — per-Category coverage; transition tests; optional W-10 / FCCH badge flows; per-state adapter contract (Florida adapter + stub second-state adapter).
9. **Retention/erasure planner** — every retention rule; consent-withdrawal coverage; financial-record pseudonymization.
10. **Job lifecycle state machine** — exhaustive state graph coverage (draft → open → awarded/expired/cancelled → closed); **Direct-Message Job entry path** *(v1.2 — replaces slot-pick auto-Job: a Direct-Message Job is created directly in `awarded` state at Book-request acceptance, atomically with its single Application + Booking)*; awarded-side-effect verification (auto-decline other Applications for Posted Jobs; Booking creation with correct `agreed_rate`); 14-day expiry path (Posted Jobs only); cap-reached behavior (Job at 15 Applications rejects new ones, Posted Jobs only).
11. **Application lifecycle state machine** — state graph coverage (submitted → countered/awarded/declined/withdrawn/expired); coordination with Job state machine; lockstep transitions on Award.
12. **Offer state machine** — pending → accepted/countered/declined/expired; counter-Offer chain (supersedes pointer); `valid_until` expiry path; `per_child_surcharge_snapshot` immutability across Offer lifetime; on-accept side-effects (Application transitions, Booking creation with `agreed_rate = proposed_rate`).
13. **Application-quota tracker** — per-Provider counter increments correctly; monthly reset boundary tests; cap-reached returns can-file=false; admin override re-enables filing; concurrent-filing race (counter is authoritative; quota is enforced server-side).

### Prior art for the tests

The codebase is greenfield Flutter (only `lib/main.dart` exists today). There is no prior testing pattern to follow. Per ADR-0004, the **deep modules live in pure TypeScript packages on the backend**; client-side calculations on the Flutter app go through the same API rather than re-implementing logic in Dart, so the deep modules are tested once in TypeScript using **Vitest** (or Jest if the team prefers). Flutter widget and integration tests use `flutter test`. State-machine and calculator tests lean on table-driven patterns; the Disintermediation detector uses a curated fixture set of message strings (extended in v1.1 to include Offer `scope_note` fixtures); the Booking, Job, Application, and Offer state machines and the Retention planner are all natural fits for property-based tests via `fast-check`. The Verification workflow's per-state adapter contract is tested via a Florida adapter fixture plus a stub second-state adapter, to keep the pluggability honest.

## Out of Scope

- ~~Provider Flutter / native mobile app~~ — **superseded in v1.1**: a Provider mobile companion ships in v1 per ADR-0005, with heavy onboarding (Stripe Connect KYC, license uploads) and Payout management staying web-only. The mobile companion links out to web for those tasks.
- Live-in / salaried Nanny contract abstraction (Nannies in v1 are modeled as long-engagement hourly Bookings).
- Per-Provider cancellation policies (single platform-wide rule in v1).
- Referral system and targeted/cohort promotions (discount codes via Stripe Promotion Codes only in v1).
- Editorial / featured search slots and admin-driven Provider boosting.
- Provider gender as a search filter (federal Title VII and Florida Civil Rights Act protected class; deferred pending product/legal review).
- Automated Specialist license verification via third-party vendor (manual admin verification against the FL DOH MQA portal in v1).
- In-app notification inbox.
- Multi-currency or multi-language. v1 is USD-only and English-only across all 50 US states. **Multi-state US launch is in scope for v1** per ADR-0009 — the per-state compliance adapters (background-check, license-board lookup, sales-tax taxability, classification-addendum surfacing) are core v1 deliverables and exercised at launch, not Phase 2 hooks. International launch (UK, EU, Canada, etc.) is a full re-platforming, not a Phase 2 add.
- ML-based intent detection in messaging (regex-only disintermediation in v1).
- AI-generated Parent profiles from Provider reviews.
- Custom matching/recommendation algorithm beyond the v1 hybrid scorer.
- Custom in-app video call feature (Daily.co embedded suffices for v1).
- Deep behavioural analytics (basic metrics in v1; user-flow analytics deferred until key metrics defined).
- iOS/Android in-app purchase for the Parent Subscription (sold on web only).

**Added in v1.1 (Phase 2 candidates per ADR-0006):**

- **Direct invite to apply.** Parent reaches out to a saved or specific Provider asking them to apply to a posted Job. v1 Jobs are closed-list — applications come only from Providers who chose to apply via the open feed.
- **Per-Provider application credits / pay-per-lead.** Thumbtack-style supply-side economics where Providers pay per Application. v1 controls spam via the 30-Application monthly cap; the richer commercial mechanism is deferred for post-launch evaluation based on observed Provider behavior.
- **Partial-award Jobs.** A Parent awards multiple Providers from a single Job (e.g. weekend Nanny rotation). v1 supports the same outcome via multiple Jobs.
- **Single-account dual-role users.** A user who is both a Provider and a Parent on Our Haven (e.g. a Babysitter who also wants to book a Tutor for her own child). v1 requires two accounts with different emails; dual-role per account is deferred because it materially complicates Stripe identity (Connect Express + Customer on one account), consent posture, and MFA orchestration.
- **Two-stage Job disclosure.** A "public brief" (sanitised) visible in the feed plus a "detailed brief" (full child context) unlocked by the Parent for shortlisted Providers. v1 uses free-text Parent-controlled disclosure with a one-time consent warning; the two-stage model is the privacy-correct Phase 2 architecture.
- **Role-switching post-sign-up.** A Parent who later wants to become a Provider (or vice versa) currently needs a second account; v1 has no in-app role conversion path.
- **In-thread Offer history view.** Beyond seeing the currently-active Offer bubble, v1 doesn't surface a structured "all past Offers in this thread" timeline; each Offer is visible inline in the thread but not aggregated separately.

## Further Notes

- **Items still requiring Ci'erro / Phase 0 input** (questions to ask the client):
  1. *(v1.3 — replaces the Miami/Florida confirmation question)* Confirm **US-national launch from day one** per ADR-0009 — no soft-launch metro, no single-state geofence, per-state compliance adapters core in v1.
  2. *(v1.3 — replaces the Miami-Dade vs tri-county question)* Which **priority Specialist-supply states** should the per-state license-board adapter slate cover at launch? Working slate proposal: **CA, FL, TX, NY, IL, GA, NC, PA, OH, AZ, WA, MA** (12 states ≈ ~60% of US population). Specialists from states outside the slate are accepted at sign-up but route to "verification pending — your state is not yet supported."
  3. *(v1.3 — replaces the neighborhood-seeding question)* Marketing-spend posture at launch — uniform across 50 states, or weighted toward priority metros (NYC / LA / Chicago / Houston / Phoenix / Philadelphia / Miami / etc.)? Affects Phase 4 marketing-asset budget and PR plan.
  4. What monthly Parent Subscription price (USD) do you want to launch with, and do you want an annual option at launch or post-launch?
  5. What Commission percentage should we skim per Booking via Stripe Connect (our working range is 15–20%)?
  6. Do you approve Checkr as the v1 background-check vendor for the **standard-package screening** (criminal + sex offender + SSN; per ADR-0007), or do you want us to evaluate alternatives (e.g. Sterling, GoodHire) before contracting? JD also has an open action with Checkr to ask about startup-discount pricing — the published $35-to-Provider price holds regardless of the underlying cost.
  7. Which US privacy counsel firm do you want to engage for the multi-state PIA, Privacy Policy (with per-state appendices), ToS, and 1099 Provider classification language (federal baseline + per-state addendum pattern) — and by when can we get them retained so the pre-launch deliverables aren't blocked?
  8. What incentive (if any) do you want to offer Parents for leaving feedback after their first completed Booking — account credit, discount on next Subscription cycle, or no incentive in v1?
  9. *(v1.3 — replaces the FL DOR-specific question)* Counsel guidance on **state sales-tax registration sequencing** — Stripe Tax monitors per-state nexus and surfaces registration prompts as thresholds are crossed; do you want to pre-register in priority states, or register reactively as Stripe flags nexus?
  10. Do you want a launch promo discount code wired up for the Subscription at go-live, and if so what value (e.g. first month free, 50% off month one)?
  11. **(v1.1)** Do you confirm the 30-Applications-per-Provider-per-month and 15-Applications-per-Job caps as launch defaults, re-tunable based on 90-day post-launch data? Lower caps will protect Parent UX more aggressively at the cost of supply-side engagement; higher caps risk Job-feed flooding before we have ranking signal to manage it.
  12. **(v1.1)** Privacy counsel must review the Job-compose consent text and the auditability of the timestamped acknowledgement before launch. Free-text Job descriptions are a new disclosure surface for child information; the Privacy Policy needs a new paragraph describing how descriptions are visible to Providers and how Parents retain control over what they include. Can counsel be briefed on this specifically in their first engagement?
  13. **(v1.1)** Do you want the Subscription gate on Job posting to be a hard wall (current decision per ADR-0006 — preview Parents can see the "Post a Job" button but tapping routes to Subscription gate), or a softer "post your first Job free" trial? The hard wall is the v1 default; the soft wall is a Phase 0-able commercial decision that should be made before launch copy is finalized.
  14. **(v1.1)** Provider mobile companion App Store / Play Store posture: do you want a single store listing (one binary, two roles, listing copy is consumer-marketplace-shaped) or two separate listings (Parent app + Provider app, materially more release-engineering)? ADR-0005 assumes one — confirming the assumption holds before listing copy is drafted.
- **Mandatory pre-launch deliverables:** PIA (Privacy Impact Assessment covering the multi-state US privacy patchwork — CCPA/CPRA, VCDPA, CPA, CTDPA, UCPA, FDBR, OCPA, TDPSA, plus federal floor) authored by US privacy counsel and reviewed by Ci'erro's lawyers; Privacy Policy with vendor data-flow inventory appendix, sensitive-information consent text (COPPA-aware + HIPAA-adjacent), and **per-state appendices** surfaced by the state-privacy-patchwork module; Terms of Service signed off by lawyers; US Provider classification language (1099 independent contractor under IRS common-law test as federal baseline, **per-state classification addendum pattern** for AB5/ABC-test states like CA, MA, NJ); Stripe Connect Express US account active and **Stripe Tax** wired up across all US states with nexus-tracking enabled; Apple Developer + Google Play Developer accounts active; US data residency configured on every vendor.
- **Timeline (per the rewritten project plan):** 16 weeks contract-to-web-app-live (13 weeks to mobile stores + 3 weeks for web), plus 60-day launch-support window.
- **Notification-channel costs to model post-launch:** Twilio SMS to US numbers at ~$0.0075/SMS plus carrier fees is the heaviest variable cost (Provider Booking-request SMS is mandatory in v1); budget ~$100/month in v1 with a re-evaluation gate above that. US SMS is materially cheaper than the UK baseline the original plan assumed.
- **Provider gender / religious filters** were specifically excluded from v1 search filters as protected-class / sensitive-attribute decisions (federal Title VII; various state civil-rights acts); these are a product/legal call before they're a build call.
- **Card-name-mismatch detection is a soft signal**, not a hard block — the original plan language ("card name must match account name") was softened during discovery to avoid excluding legitimate Parents (couples, name changes, family-funded accounts) while still flagging mismatched accounts for higher fraud scrutiny on early Bookings.
