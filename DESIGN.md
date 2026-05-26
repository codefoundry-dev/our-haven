# Our Haven — Design System

A design specification for the **Our Haven** mobile app (Flutter, iOS + Android). The app serves both **Parents** and **Providers** in a single binary with role-aware shells; the role is chosen at sign-up and is permanent per account (see [ADR-0005](docs/adr/0005-provider-mobile-companion-supersedes-web-only.md)). Defines visual language, component library, and the full page inventory required for v1.

This document is the **source of truth for UI generation**. Any deviation must update this file first.

> Domain language follows [`CONTEXT.md`](CONTEXT.md). Functional scope follows [`docs/prd/0001-our-haven-v1.md`](docs/prd/0001-our-haven-v1.md). Use the canonical domain terms — **Provider**, **Parent**, **Child profile**, **Booking**, **Session**, **Job**, **Application**, **Offer**, **Published Rate**, **Agreed Rate**, **Verification**, **Subscription**, **Payout**, **Specialist**, **Babysitter**, **Tutor**, **Nanny**. Never write "caregiver" in UI copy.

---

## 1. Design Principles

1. **Editorial, not clinical.** Large bold headlines, generous whitespace, full-bleed photography. Childcare is emotional — interfaces should feel calm and considered, not utilitarian.
2. **One bold accent at a time.** **Brand teal (`brand/primary`) is the action color** on every interactive surface — buttons, active states, sent message bubbles, dark featured cards. Cream backgrounds + one pastel category color + teal CTA. Near-black (`ink/primary`) is reserved for **text, headings, icon strokes, and outlines** — it never fills an interactive element. Never compete. *(Refined 2026-05-19 per client sync — was a charcoal-CTA system.)*
3. **Photography carries the trust signal.** A Provider's portrait is the largest element on their card. Verification badges sit on top of the photo, not in a separate strip.
4. **Pills, not rectangles.** Every interactive surface — buttons, chips, cards, avatars, bottom nav icons — uses generous radius (20–32px) or full-pill (999px). Sharp 4px corners are reserved only for inline code (none in this product).
5. **Spec-first, density-aware.** The mobile app must read clearly at arm's length on a 5.4" device. Minimum tap target 44×44pt. Body text never below 15pt.
6. **Calm motion.** Transitions are 200–280ms cubic-bezier(0.2, 0.8, 0.2, 1). No bounce, no spring overshoot. Confirmation feedback is haptic-first.

---

## 2. Visual Foundations

### 2.1 Color tokens

The palette is **warm neutral + one charcoal + a pastel category set**. Cream is the canvas; charcoal is the ink; pastels carry category and status meaning only.

| Token | Hex | Use |
|---|---|---|
| `bg/canvas` | `#F6F1E8` | Default screen background. Warm cream. |
| `bg/surface` | `#FFFFFF` | Cards on the canvas. Default for any elevated container. |
| `bg/surface-alt` | `#FAF6EE` | Inline sub-surfaces, search bars, disabled fields. |
| `ink/primary` | `#161513` | All primary text, headings, icon strokes, outlines. Near-black, never pure `#000`. *(Refined 2026-05-19 — no longer a CTA fill; see `brand/primary`.)* |
| `ink/secondary` | `#5A554C` | Subheads, secondary metadata, inactive icons. |
| `ink/tertiary` | `#9A9489` | Captions, placeholder text, divider replacements. |
| `ink/inverse` | `#FBF7EF` | Text on dark surfaces. Off-white, never pure `#FFF`. |
| `brand/primary` | `#1E7A86` | **The action color** (added 2026-05-19). Primary CTA fill, active state fills (bottom nav, filter chips), sent message bubble fill, dark featured-card fill, toast fill. Pairs with `ink/inverse` (white) label — contrast ~6:1, passes WCAG AA. |
| `brand/primary-soft` | `#E8F2F4` | 8% tint of `brand/primary`. Tinted backgrounds for brand-accented surfaces (active-state outlines, soft hero panels, pressed-state hovers). |
| `accent/cat-babysitter` | `#FFD84D` | Babysitter category. Warm yellow. |
| `accent/cat-tutor` | `#A8D08D` | Tutor category. Sage green. |
| `accent/cat-nanny` | `#F7B7A3` | Nanny category. Soft coral. |
| `accent/cat-specialist` | `#F4C0DC` | Specialist category. Powder pink. |
| `accent/highlight` | `#FFD84D` | Reserved for "Tax-credit-friendly" badge and active calendar slot. |
| `status/success` | `#2F7A4D` | Verification cleared, Booking accepted, Payout sent. |
| `status/warning` | `#C97A2A` | Awaiting confirmation, expiring soon, action required. |
| `status/danger` | `#B23A2F` | Declined, disputed, cancelled. |
| `status/info` | `#3A6FA8` | Informational, in-progress, neutral state. |
| `line/hairline` | `#EAE2D2` | 1px dividers where unavoidable (rare — prefer spacing). |
| `overlay/scrim` | `rgba(22,21,19,0.5)` | Modal scrim. |

**Category accent rule.** A Provider's category color appears in **one place per screen** — a chip on their card, the active tab pill, or the booking detail header band. Never two surfaces at once.

**Dark-mode posture.** Not in v1. Cream canvas is a brand signature; system dark mode reverts to neutral charcoal canvas with the same pastel accents lifted 8% in luminosity. Defer dark theme to Phase 6 web parity.

### 2.2 Typography

Single typeface family: **Inter** (variable, weights 400/500/600/700). Numerals use **tabular figures** on every numeric surface (Rates, dates, Booking counts, OTP).

| Token | Size / Line | Weight | Use |
|---|---|---|---|
| `display/xl` | 56 / 60 | 700 | Hero numerals only — onboarding time/age/big-stat moments. Tight tracking (-2%). |
| `display/lg` | 40 / 44 | 700 | Welcome screens, empty-state headlines. |
| `heading/xl` | 32 / 38 | 700 | Top-of-screen page titles (e.g. "Find Trusted Providers Near You"). Two lines max. |
| `heading/lg` | 24 / 30 | 700 | Section headers ("Choose Your Specialist", "Available Providers"). |
| `heading/md` | 20 / 26 | 600 | Card titles, Provider names on profile, modal titles. |
| `heading/sm` | 17 / 22 | 600 | List-row primary text, dialog titles. |
| `body/lg` | 17 / 24 | 400 | Primary body, message bubbles, paragraph copy. |
| `body/md` | 15 / 22 | 400 | Default body. Form labels above input. |
| `body/sm` | 13 / 18 | 500 | Metadata, captions, helper text. |
| `label/lg` | 15 / 20 | 600 | Primary CTA labels (Sign in, Confirm, Book). |
| `label/md` | 13 / 16 | 600 | Chip/pill text, badge text, tab labels. |
| `label/sm` | 11 / 14 | 600 | Uppercase eyebrow labels (`UTC -4` style), tracking +6%. |
| `mono/md` | 15 / 22 | 500 | OTP codes, booking IDs, dispute IDs. Use `JetBrains Mono` or system mono. |

**Hierarchy rule.** A screen has **one** `heading/xl` and **at most three** `heading/lg`. If you need more, you need a separate screen.

### 2.3 Spacing scale

8pt base grid. Use the named tokens — never raw numbers in code.

| Token | px |
|---|---|
| `space/0` | 0 |
| `space/xs` | 4 |
| `space/sm` | 8 |
| `space/md` | 12 |
| `space/lg` | 16 |
| `space/xl` | 24 |
| `space/2xl` | 32 |
| `space/3xl` | 48 |
| `space/4xl` | 64 |
| `space/5xl` | 96 |

**Screen edge inset:** `space/xl` (24pt) left/right on every screen. Cards inside a screen use `space/lg` (16pt) internal padding.

**Vertical rhythm between sections:** `space/2xl` (32pt). Between a heading and its content: `space/lg` (16pt).

### 2.4 Corner radius

| Token | px | Use |
|---|---|---|
| `radius/sm` | 8 | Inline tags inside dense lists only. |
| `radius/md` | 16 | Inputs, small badges. |
| `radius/lg` | 20 | Default surface — small/medium cards, modal sheets, chips. |
| `radius/xl` | 28 | Large hero cards (Provider profile card, info banner). |
| `radius/2xl` | 36 | Featured/spotlight cards. |
| `radius/pill` | 999 | All buttons, avatars, search bar, bottom-nav icon backgrounds. |

**Rule:** Buttons are always `pill`. Cards are `lg` or `xl`. Avoid mixing `md` cards next to `xl` cards in one section.

### 2.5 Elevation

Shadows are subtle and warm — never blue-tinted. Cards rest on the canvas; they don't float aggressively.

| Token | Spec |
|---|---|
| `elev/0` | None. Default. Most cards have no shadow. |
| `elev/1` | `0 1px 2px rgba(22,21,19,0.04), 0 1px 1px rgba(22,21,19,0.04)`. Resting cards on the home screen. |
| `elev/2` | `0 4px 12px rgba(22,21,19,0.06), 0 2px 4px rgba(22,21,19,0.04)`. Sticky CTAs, bottom nav. |
| `elev/3` | `0 12px 32px rgba(22,21,19,0.10), 0 4px 8px rgba(22,21,19,0.06)`. Bottom sheets, modals. |

### 2.6 Iconography

**Phosphor Icons** (regular weight, 1.5px stroke). Custom icons must match — never mix Material rounded with Phosphor sharp.

| Size | Use |
|---|---|
| 16pt | Inline with body text, chip leading icon. |
| 20pt | Default — form fields, list rows. |
| 24pt | App bar buttons, bottom nav. |
| 32pt | Empty-state hero icon. |

Icons inside a `pill` circular button background are always centered, 20pt. The pill background is 44pt (tap target).

### 2.7 Photography & illustration

- **Provider portraits:** preferred at 4:5 ratio. Cutouts (subject on transparent background composited over a pastel) for hero/featured cards; un-cut headshots for list rows. Faces eye-line at 60% from bottom. No corporate stock — the visual feel should be warm, candid, on-brand for parents.
- **Child profiles:** never show child photos in v1. Use a colored monogram tile (`accent/cat-*` background with the child's first initial in `ink/primary`, `heading/lg`).
- **Empty states:** custom line illustrations on cream, single-color (`ink/secondary`), capped at 240×240pt. No mascots.

---

## 3. Component Library

Each component is described as: **purpose · anatomy · states · spec · do/don't**. Implement once in Flutter as a reusable widget. File path conventions are suggestions, not mandates.

### 3.1 Button — Primary

**Purpose:** the single most important action on a screen.

**Anatomy:** pill-shaped, full-width on forms / inset (24pt edge) on long screens, label centered, optional 20pt leading icon.

**Spec**
- Height: **56pt** (mobile), 48pt (compact dialog).
- Fill: `brand/primary`. Label: `ink/inverse`, `label/lg`.
- Radius: `pill`.
- Pressed: fill darkens to `#175E68` (~10% darker than `brand/primary`) and scales to 0.98 over 120ms.
- Disabled: fill `ink/tertiary`, label `ink/inverse` at 80% opacity. No outline.
- Loading: replaces label with a 20pt inline spinner (`ink/inverse`); button keeps its width.

**Do** — use once per screen for the primary commit action (Sign In, Confirm Booking, Send Request).
**Don't** — use two primary buttons side-by-side. Pair with Secondary instead.

### 3.2 Button — Secondary

**Purpose:** the alternate path to Primary (Cancel, Skip, Use email instead).

**Spec**
- Height: 56pt.
- Fill: `bg/surface` with 1.5pt `ink/primary` outline. Label: `ink/primary`.
- Pressed: fill flips to `brand/primary`, label to `ink/inverse`.
- Used in Sign In ↔ Sign Up onboarding pairing (see [§5.1](#51-onboarding--auth)).

### 3.3 Button — Tertiary (text)

Label-only. Inline `label/lg` in `ink/primary`, underline only on hover (web). Used inside modals and as inline "Edit" / "Remove" affordances.

### 3.4 Button — Icon (circular)

**Purpose:** app-bar actions, top-right cluster (notifications, messages, calendar), bottom-nav items.

**Spec**
- 44pt circle, `bg/surface` fill on canvas; `ink/primary` fill on dark surfaces.
- Icon: 20pt, `ink/primary` (or `ink/inverse` on dark).
- Active state (bottom nav): solid `brand/primary` circle with `ink/inverse` icon — never colored.
- Notification dot: 8pt `status/danger` dot, top-right of the circle, offset -2pt.

### 3.5 Search bar

**Purpose:** the primary entry point on the Home screen and discovery surfaces.

**Anatomy:** pill, height 56pt, leading 20pt search icon, placeholder `body/md` in `ink/tertiary`, optional trailing filter icon button.

**Spec**
- Fill: `bg/surface`. No border. No shadow.
- Focus: 1.5pt `ink/primary` outline; placeholder slides up into a `label/sm` floating label.

### 3.6 Chip — Filter

**Purpose:** quick toggles in the Filter sheet and the Bookings tab strip.

**Spec**
- Pill, height 36pt, horizontal padding 16pt.
- Inactive: `bg/surface-alt`, `ink/secondary`, `label/md`.
- Active: `brand/primary` fill, `ink/inverse` label.
- Removable variant: trailing 14pt × close icon. Tap × to clear that filter.

### 3.7 Chip — Category

**Purpose:** stamps the category on a Provider card, top-left of the image.

**Spec**
- Pill, height 28pt, padding 12pt × 6pt.
- Fill: `accent/cat-*` (the category color).
- Label: `ink/primary`, `label/md`.
- Always overlaid on a photo with `space/md` inset from top-left.

### 3.8 Badge — Verification / Trust

**Purpose:** trust signals on Provider cards and profile headers.

| Variant | Fill | Icon | Label |
|---|---|---|---|
| `verified` | `status/success` @ 12% tint + `status/success` text | Check-circle | "Verified" |
| `tax-credit` | `accent/highlight` | Receipt | "Tax-credit friendly" |
| `fcch` | `bg/surface` with `status/success` 1pt outline | House | "DCF-registered FCCH" |
| `license` | `status/info` @ 12% tint + `status/info` text | Certificate | "FL Licensed" (Specialists only) |
| `top-rated` | `brand/primary` fill + `ink/inverse` text | Star | "Top rated" |

**Spec:** pill, height 28pt, leading 14pt icon, `label/md`. Stack vertically when there are 2+ badges on a card (max 2 visible — overflow as "+1 more" chip).

### 3.9 Avatar

**Single avatar**

- Sizes: `xs` 24pt, `sm` 32pt, `md` 40pt, `lg` 56pt, `xl` 80pt, `hero` 120pt.
- Always `pill` (circular). Fallback to colored monogram tile when no image — Provider's category color, Child's assigned color, Parent's gray (`#D8D2C5`).
- Online dot: 10pt `status/success` dot bottom-right (messaging surfaces only).

**Avatar group**

- Stacked left-to-right with -8pt overlap.
- Max visible: 3. Overflow rendered as a 4th tile: `bg/surface-alt`, `ink/primary`, `label/md` reading `+N`.
- Used on group-Booking child counters and on admin/Provider reviewer lists (not Parent-facing in v1).

### 3.10 Card — Provider

**The canonical Provider summary surface. Used in search results, favorites, recommended lists.**

**Anatomy (vertical, default):**
```
┌─────────────────────────────┐
│   [Category chip TL]        │
│                             │
│        [Provider photo]     │  ← 4:5, fills card width, top corners radius/xl
│                             │
│   [Save icon TR]            │
│                             │
├─────────────────────────────┤
│ Name                  ⭐ 4.9 │
│ Category · neighborhood     │
│                             │
│ [Verified] [Tax-credit]     │
│                             │
│ $35/hr            [→ View]  │
└─────────────────────────────┘
```

**Spec**
- Card: `bg/surface`, `radius/xl`, `elev/1`, padding `space/lg`.
- Photo: full-bleed inside the card's top, 4:5 ratio, top corners share the card radius.
- Name: `heading/md`, single line, truncate.
- Rating: trailing, `body/md` with 16pt star icon.
- Metadata row: `body/sm` in `ink/secondary`.
- Badge row: max 2 visible.
- Rate: `heading/sm`, leading. Trailing chevron arrow in a 36pt pill of `bg/surface-alt`.

**Compact horizontal variant** (used on Home "Recommended" rail): 280×120pt, photo on the left at 1:1, content right.

### 3.11 Card — Featured Provider (hero)

**Used on Home and category landing pages.**

- Full-bleed cutout photograph composited over a `accent/cat-*` pastel background.
- Bottom 35% is an overlaid white card with the Provider's name, role, rate, and a circular arrow CTA. The dark info card variant (**`brand/primary` fill**, white text — refined 2026-05-19, was charcoal) is used on the Subscription-locked preview and the rate detail moment — see [§5.3 Home](#53-home--discovery) and [§5.6 Booking](#56-booking-lifecycle).

### 3.12 Card — Info / Stat banner

**Used for "12+ Scheduled Appointments" style at-a-glance summaries.**

**Spec**
- Card: `bg/surface`, `radius/xl`, padding `space/xl`.
- Headline (the number): `display/lg`, tabular figures.
- Subhead below: `body/md` in `ink/secondary`.
- Trailing top-right: 44pt circular icon button (chevron arrow).
- May contain a nested `radius/lg` row showing the most relevant child item (the next upcoming appointment).

### 3.13 Card — Booking slot / time

**Used on Provider availability calendars and on a Booking detail screen.**

- Two side-by-side cards: `Today` (left, `accent/cat-nanny` / coral fill) and the day-of-week tag (right, `accent/highlight` / yellow fill).
- Each contains a `label/md` eyebrow ("Today" / "Sun"), a `heading/md` content row (date / start–end), and a `label/sm` footer ("Week 12 — 2025" / "12 h 11 min").
- Cards use `radius/lg`, padding `space/lg`, no shadow.

### 3.14 Card — Child profile

**Used on the Children list and selectable in Booking flow.**

**Spec**
- Card: `bg/surface`, `radius/lg`, padding `space/lg`.
- Leading: 56pt monogram avatar in the child's assigned pastel.
- Title: child's first name + age — `heading/sm`.
- Subtitle: special-needs flag indicator only — never the notes content. `body/sm` in `ink/secondary`: "Notes on file" or empty.
- Trailing: chevron when selectable; checkmark when selected during a Booking flow.
- Selected state: `2pt ink/primary` outline, `bg/surface-alt` fill.

### 3.15 Calendar / date selector

Two patterns used:

**Pattern A — Week strip (used on Home, Bookings list).** A horizontal strip of 7 days. Each day is a vertical stack: `label/sm` day-of-week, then `heading/sm` date numeral. The selected day is a `pill` background in `accent/cat-specialist` (powder pink) with `ink/primary` numeral. The "today" indicator is a 4pt dot under the date if not selected.

**Pattern B — Date pills (used in Booking detail, Provider availability).** A horizontal scrolling rail of 44pt × 56pt rounded squares (`radius/lg`), each showing the date numeral. Active date: `ink/primary` fill, `ink/inverse` numeral. Disabled (Provider not available): `ink/tertiary` numeral on `bg/surface-alt`. Header above the rail shows the month name with a forward/back chevron pair.

### 3.16 Bottom navigation

**Purpose:** persistent navigation. 4 destinations only. **Role-aware** — the Parent shell and the Provider shell render different destinations; the active shell is determined by the signed-in account's role (see [§5.1.1a](#511a-role-pick-sign-up-only)).

**Parent shell**
- **Home** (house icon)
- **Bookings** (calendar icon)
- **Messages** (message-circle icon, with unread dot)
- **Account** (person icon)

**Provider shell**
- **Opportunities** (briefcase icon, with badge for new Jobs in feed since last visit, capped at 9+)
- **Schedule** (calendar icon, with badge for items awaiting action — pending accept/decline, propose-hours)
- **Messages** (message-circle icon, with unread dot)
- **Account** (person icon)

**Spec**
- Bar: `bg/surface`, `elev/2`, height 84pt (includes 12pt safe area), horizontal padding `space/xl`.
- Each destination: 44pt circular icon button. Inactive: `bg/surface-alt` background, `ink/primary` icon. Active: **`brand/primary`** filled background, `ink/inverse` icon, slight upward shift -4pt, with a 6pt `accent/highlight` dot beneath.
- No labels under icons. The active icon's identity is unambiguous from its filled state.
- Badge (unread / pending count): 16pt `status/danger` pill anchored top-right of the icon button, `ink/inverse` label/sm digits, max display "9+".
- Bar floats inside the safe area — content can scroll beneath but the bar has its own surface, not transparent.

### 3.17 App bar

**Spec**
- Height: 56pt content + safe-area inset.
- Leading: 44pt circular back button (chevron-left) on cream surface; on dark hero screens, the same button on `bg/surface` with `ink/primary` icon.
- Trailing: cluster of 1–3 circular icon buttons (notifications bell, message, calendar). Spacing 8pt between buttons.
- Title: hidden on Home (the screen's headline is the title), shown as `heading/sm` centered on detail screens.

### 3.18 Tab strip (segmented)

Used inside the Bookings list and Messages list.

- Pill bar `bg/surface-alt`, height 44pt, internal padding 4pt.
- Tabs: equal width, `label/md`. Active tab is a pill `bg/surface` with `elev/1` shadow and `ink/primary` label; inactive tabs `ink/secondary`.

### 3.19 Input field

- Height: 56pt.
- Fill: `bg/surface-alt`. Radius `radius/md`.
- Label: floats above on focus, `label/sm` in `ink/secondary`. Default placeholder is `body/md` in `ink/tertiary`.
- Helper text: `body/sm` below, 4pt margin.
- Error: `status/danger` 1.5pt outline + `body/sm` error message in `status/danger`.

### 3.20 OTP input

Six 56pt × 56pt boxes, `bg/surface-alt`, `radius/md`, `mono/md` text. Auto-advance on input. Focused box: 1.5pt `ink/primary` outline. Used for SMS OTP on phone verification and new-device MFA.

### 3.21 Message bubble

- Sent (by Parent): right-aligned, **`brand/primary` fill** (refined 2026-05-19, was `ink/primary`), `ink/inverse` text, `radius/xl` with the bottom-right corner reduced to `radius/sm`.
- Received: left-aligned, `bg/surface` fill, `ink/primary` text, mirrored corner.
- Max width 78% of screen width. Padding `space/md` × `space/lg`.
- Redaction banner: if the message tripped disintermediation detection, the redacted portion renders as a `bg/surface-alt` pill inline with the text, content replaced with "█ phone hidden" (or category-appropriate label), and a small info-icon tap reveals the policy explanation modal.
- Timestamp + read receipt: below the bubble, `body/sm` in `ink/tertiary`.

### 3.22 Bottom sheet

- Background: `bg/surface`. Top corners `radius/2xl`. `elev/3`.
- Grabber: 4pt × 40pt pill, `ink/tertiary`, centered 8pt from top.
- Title: `heading/md`, padding `space/xl`.
- Snap points: half (50% screen) and full (90% screen). Default opens at half.
- Used for: Filter, Cancel-Booking confirmation, Rate Provider, Child-attach picker, Slot picker, Cancellation cost preview.

### 3.23 Modal dialog

- Card centered, `bg/surface`, `radius/xl`, `elev/3`, max-width 320pt.
- Padding `space/xl`.
- Title: `heading/sm`. Body: `body/md`. Two buttons stacked vertically (Primary then Tertiary) on mobile.
- Used only for destructive confirmations (Delete account, Withdraw consent, Decline booking).

### 3.24 Toast / Snackbar

- Pill, **`brand/primary` fill**, `ink/inverse` text `body/md`, 20pt icon leading.
- Bottom-floating, 16pt above the bottom nav, dismisses after 4s.
- Variants: neutral (default), success (`status/success` icon dot), error (`status/danger` icon dot).

### 3.25 Empty state

- Centered illustration (240×240pt max) + `heading/lg` title + `body/md` description + single primary CTA.
- Used on: empty search results, no bookings yet, no messages, no children added.

### 3.26 Loading

- Skeleton shimmer for list/grid items — `bg/surface-alt` rectangles with `radius/lg`, 1.2s pulse.
- Full-screen loaders are forbidden except on the initial app boot. Use shimmer.

### 3.27 Star rating

- 5 stars, 20pt, `accent/highlight` fill on active, `ink/tertiary` outline on inactive.
- Submission view: 32pt tappable stars in a row, `space/md` gap.
- Display view: inline 16pt, single star + numeric value (e.g. "⭐ 4.9").

### 3.28 Pricing summary

A breakdown block used on Booking confirmation and Subscription checkout.

- Each line: `body/md` label left, `body/md` tabular figure value right.
- Subtotal line is followed by a 1pt `line/hairline` divider.
- Total line: `heading/sm` both sides.
- Tax line shows "Computed by Stripe Tax" inline helper in `body/sm` `ink/tertiary`.

### 3.29 Status pill (Booking lifecycle)

Maps the [PRD-defined Booking states](docs/prd/0001-our-haven-v1.md) to colors:

| State | Fill | Label color | Label |
|---|---|---|---|
| `requested` | `accent/highlight` @ 40% | `ink/primary` | "Awaiting Provider" |
| `accepted` | `status/success` @ 12% | `status/success` | "Accepted" |
| `declined` | `status/danger` @ 12% | `status/danger` | "Declined" |
| `expired` | `bg/surface-alt` | `ink/secondary` | "Expired" |
| `in-progress` | `status/info` @ 12% | `status/info` | "In session" |
| `awaiting-confirmation` | `status/warning` @ 12% | `status/warning` | "Confirm hours" |
| `completed` | `status/success` @ 12% | `status/success` | "Completed" |
| `disputed` | `status/danger` @ 12% | `status/danger` | "Disputed" |
| `cancelled` | `bg/surface-alt` | `ink/secondary` | "Cancelled" |

Pill height 28pt, padding 12pt × 6pt, `label/md`.

### 3.29a Status pill (Job lifecycle)

Used on Parent's My Jobs list, Job detail, and Provider's My Applications list (Job-side state visible to the Provider). See [`CONTEXT.md`](CONTEXT.md) § Job.

| State | Fill | Label color | Label |
|---|---|---|---|
| `draft` | `bg/surface-alt` | `ink/secondary` | "Draft" |
| `open` | `status/info` @ 12% | `status/info` | "Open · {N}/15 applied" |
| `awarded` | `status/success` @ 12% | `status/success` | "Awarded" |
| `expired` | `bg/surface-alt` | `ink/secondary` | "Expired" |
| `cancelled` | `bg/surface-alt` | `ink/secondary` | "Cancelled" |
| `closed` | `bg/surface-alt` | `ink/secondary` | "Closed" |

Same dimensions and typography as [§3.29](#329-status-pill-booking-lifecycle). The `open` pill is the only one that carries a running counter — Parent-side it surfaces application volume at a glance; Provider-side it tells an applicant where they sit in the pack.

### 3.29b Status pill (Application lifecycle)

Used on Parent's Applications-on-this-Job list and Provider's My Applications surface.

| State | Fill | Label color | Label |
|---|---|---|---|
| `submitted` | `status/info` @ 12% | `status/info` | "Submitted" |
| `countered` | `status/warning` @ 12% | `status/warning` | "Counter sent" |
| `awarded` | `status/success` @ 12% | `status/success` | "Awarded" |
| `declined` | `status/danger` @ 12% | `status/danger` | "Declined" |
| `withdrawn` | `bg/surface-alt` | `ink/secondary` | "Withdrawn" |
| `expired` | `bg/surface-alt` | `ink/secondary` | "Expired" |

Same dimensions as above.

### 3.30 Card — Job (Parent-side, on My Jobs list)

**Purpose:** at-a-glance summary of one Job the Parent has posted.

**Spec**
- Card: `bg/surface`, `radius/xl`, `elev/1`, padding `space/lg`.
- Leading top row: Category chip (`accent/cat-*` for the Job's Category) + Job lifecycle status pill ([§3.29a](#329a-status-pill-job-lifecycle)) trailing.
- Title: first line of the Job description, `heading/sm`, single-line truncate.
- Metadata: posted-on date + scope summary ("Babysitter · Saturday afternoons") in `body/sm` `ink/secondary`.
- Application avatar group: avatar group of the applying Providers (max 3 visible, "+N" overflow tile per [§3.9](#39-avatar)). If 0 applications: helper text "No applications yet" in `body/sm` `ink/tertiary`.
- Trailing chevron in 36pt `bg/surface-alt` pill (same as Provider card chevron).

### 3.30a Card — Job opportunity (Provider-side, on Opportunities feed)

**Purpose:** at-a-glance summary of one Job a Provider could apply to.

**Spec**
- Card: `bg/surface`, `radius/xl`, `elev/1`, padding `space/lg`.
- Leading top row: Category chip + posted-time eyebrow ("Posted 2h ago") in `label/sm` `ink/tertiary` right-aligned.
- Title: first line of the Job description, `heading/sm`, two-line truncate (Provider needs more context than Parent does on their own Jobs).
- Scope summary: dates/duration/location (ZIP + radius badge) in `body/sm` `ink/secondary`.
- Budget hint (optional, if Parent provided): `body/sm` "Budget hint: ~$30–40/hr" in `ink/secondary`.
- Footer: application count "{N}/15 applied" in `body/sm` `ink/tertiary` left + "Apply →" tertiary right. Footer becomes "Cap reached" `ink/tertiary` when N=15 (card stays visible but is non-actionable for new applicants).

### 3.31 Card — Application

**Purpose:** one Provider's Application as seen by the Parent on the Job detail screen, or one of the Provider's own past Applications.

**Parent-facing variant** (on Job detail):
- Card: `bg/surface`, `radius/lg`, padding `space/lg`.
- Leading: Provider avatar (`md` 40pt).
- Title row: Provider name `heading/sm` + star rating (`body/sm` + 16pt star) trailing.
- Verification badges row: max 2 visible (per [§3.8](#38-badge--verification--trust)).
- Offer summary block (`bg/surface-alt`, `radius/md`, padding `space/md`): `heading/sm` total ("$120 total"), `body/sm` breakdown ("$30/hr × 4h, 1 child") below.
- Proposal preview: first 3 lines of the Application's free-text proposal in `body/md`, 3-line truncate.
- Trailing chevron — tap opens the Provider profile / Application detail.
- Status pill ([§3.29b](#329b-status-pill-application-lifecycle)) anchored top-right of card.

**Provider-facing variant** (on My Applications list): same shape but leading avatar is the Parent's monogram tile, title is the Job's first description line, status pill reflects this Application's state.

### 3.32 Message bubble — Offer variant

**Purpose:** the binding price-and-scope proposal exchanged in a Message thread. See [`CONTEXT.md`](CONTEXT.md) § Offer.

**Anatomy**
- Wider than a default message bubble — fills 92% of screen width (overrides the 78% standard from [§3.21](#321-message-bubble)).
- Card-like rather than bubble-like: `radius/xl`, internal padding `space/lg`, with the sender alignment (left/right) preserved.
- Sent (by signed-in user): right-aligned, `bg/surface` fill with `ink/primary` 1.5pt outline (instead of solid ink fill — Offers need their internal hierarchy visible, dark fill would crowd it).
- Received: left-aligned, `bg/surface` fill, subtle `ink/tertiary` 1pt outline.

**Internal layout (top-to-bottom)**
- Eyebrow row: `label/sm` "OFFER · from {sender first name}" + valid-until countdown chip right-aligned ("Expires in 14h", `bg/surface-alt`, `body/sm` `ink/secondary`).
- Total: `display/lg` tabular figures ("$120 total"), centered, full-width within the card.
- Breakdown: 2-row mini grid in `body/md` — left col labels ("Rate", "Scope"), right col values tabular ("$30/hr", "4 hours") with per-child surcharge as a 3rd row only when present ("Per-child", "+$5/hr × 0 extra children").
- Optional scope note: free-text in `body/md` `ink/secondary`, italic. If detector redacted any spans, render the redaction marker per [§3.21](#321-message-bubble) policy.
- Action row (pill button trio): **Decline** (tertiary, left) · **Counter** (secondary, center) · **Accept** (primary, right). All three are pill buttons, height 48pt (compact dialog spec), equal width via flex.
- After action, the Offer bubble updates in-place to a status state: a `label/md` eyebrow ("OFFER · accepted by you 3m ago" / "OFFER · countered" / "OFFER · declined" / "OFFER · expired"), the breakdown grays to `ink/tertiary`, and the action row is replaced with a single tertiary "View details" button.

**Accept consequences (UX, not state-machine)**
- A success toast surfaces: "Booking-request accepted — your Booking is being created." *(Refined 2026-05-19.)* If the accepted Offer was thread-anchored (Direct-Message flow), the system atomically materialises Job + Application + Booking and the Booking goes straight to `accepted` (both parties have committed; no `requested` interim). If the accepted Offer was already Job-anchored (Posted-Job flow, Parent Awarding a Provider's Application), the Booking goes to `requested` and the Provider has 24h to confirm slot/time in a follow-up step.

**Counter consequences**
- Tap opens a half-snap bottom sheet — same composer as the inline composer below, but with the prior Offer's fields pre-filled as the starting point. Submit replaces the live Offer in the thread (previous bubble updates to "OFFER · countered").

**Disintermediation**
- Structured fields bypass the detector (numbers, not free text). The `scope_note` runs through the same detector as Messages (per [`CONTEXT.md`](CONTEXT.md) § Message); redacted spans render with the same redaction marker pattern as message bubbles.

---

## 4. Layout Patterns

### 4.1 Standard screen scaffold

```
┌─────────────────────────────┐
│ Status bar (system)         │
├─────────────────────────────┤
│ App bar (56pt + safe area)  │
├─────────────────────────────┤
│                             │
│ Screen content              │
│ (24pt horizontal inset)     │
│                             │
│ ...                         │
│                             │
├─────────────────────────────┤
│ Bottom nav (84pt)           │
└─────────────────────────────┘
```

### 4.2 Discovery scaffold (Home, Search, Category)

A scrolling stack of:
1. **Greeting header** — `body/md` greeting ("Good morning, Adjei") + Parent avatar leading, action cluster trailing.
2. **Hero headline** — `heading/xl` two-line page title.
3. **Stat card / continue card** — the in-progress action (next Booking, pending verification).
4. **Section: Choose your category** — `heading/lg` + grid of category tiles (2×2).
5. **Section: Recommended near you** — horizontal scrolling rail of Provider cards (compact horizontal variant).
6. **Section: Featured this week** — vertical stack of full Provider cards.
7. Bottom-nav offset (96pt blank space at end).

### 4.3 Detail scaffold (Provider profile, Booking detail, Child profile)

A scrolling stack of:
1. **Hero photo** with overlay app-bar (back button + save/share trailing). Photo is the screen's primary identity element — fills width, height ~480pt, no top safe-area inset.
2. **Bottom-overlay info card** (`radius/2xl` top, `bg/surface`, padded `space/xl`) — Provider name, rating, badges, Rate prominently displayed (`display/lg` for the dollar amount).
3. **Below the fold**: tabs (About / Availability / Reviews) or stacked sections — depends on screen.
4. **Sticky CTA bar** at the bottom — primary action (Book, Message). Bar has its own `bg/surface` background and `elev/2` shadow.

---

## 5. Pages

Page inventory required for v1. Each page lists: **purpose · key components · PRD references · key states**.

**Role surfaces.** Sections 5.1–5.10 cover the **Parent** role and shared surfaces (auth, messaging, error/system pages). Section 5.11 covers the **Provider mobile companion**. The role-pick screen ([§5.1.1a](#511a-role-pick-sign-up-only)) determines which shell loads after sign-up; sign-in determines role from the existing account. See [ADR-0005](docs/adr/0005-provider-mobile-companion-supersedes-web-only.md) for the Provider mobile decision and [ADR-0006](docs/adr/0006-job-posting-and-negotiable-pricing.md) for the Job-board flow.

### 5.1 Onboarding & Auth

PRD stories 1–9, 40, 73, 76. Surfaces are **role-aware** from sign-up forward — the role-pick screen ([§5.1.1a](#511a-role-pick-sign-up-only)) decides which onboarding stack the user runs through.

#### 5.1.1 Splash
- App logo centered, cream canvas. Auto-advances to Welcome carousel after auth state hydrates. If an existing signed-in account is detected, routes straight to the role-appropriate Home/Opportunities tab and skips Welcome and role-pick.

#### 5.1.1a Role pick (3-tab, sign-up only)
*(Refined 2026-05-19 — was a two-pill chooser; now a 3-tab pick that maps to the Caregiver / Specialist sub-umbrella under Provider. See `CONTEXT.md` § Authentication / Account roles + § Provider.)*

- Cream canvas. Headline `heading/xl` "What brings you to Our Haven?"
- Three large pill-cards stacked vertically, full-width, separated by `space/xl`:
  - **"I'm a Parent"** — `accent/cat-nanny` (soft coral) fill, `ink/primary` label `heading/md`, supporting line `body/md` "Find, message, and book Caregivers and Specialists for my child."
  - **"I'm a Caregiver"** — `accent/cat-babysitter` (warm yellow) fill, `ink/primary` label `heading/md`, supporting line `body/md` "Babysitter, Tutor, or Nanny. Offer my services, accept Bookings, apply to Jobs."
  - **"I'm a Specialist"** — `accent/cat-specialist` (powder pink) fill, `ink/primary` label `heading/md`, supporting line `body/md` "Licensed clinician — speech, ABA, occupational therapy, psychology. License verification required."
- Each card has a 36pt trailing chevron in a `bg/surface-alt` pill.
- Footer: `body/sm` `ink/tertiary` "Your role is set when you sign up — it can't be changed later. Need both Parent and Provider? You'll need two accounts."
- Routing on tap:
  - **I'm a Parent** → [§5.1.1b Preview questionnaire — step 1](#511b-preview-questionnaire--step-1-childs-age)
  - **I'm a Caregiver** → [§5.1.4 Sign up](#514-sign-up), then [§5.1.13 Provider onboarding](#5113-provider-onboarding) with `kind=caregiver` (the *Choose your category* step inside Provider onboarding scopes to Babysitter / Tutor / Nanny)
  - **I'm a Specialist** → [§5.1.4 Sign up](#514-sign-up), then [§5.1.13 Provider onboarding](#5113-provider-onboarding) with `kind=specialist` (the *Choose your category* step scopes to specialty pick — SLP / ABA / OT / Psychology / etc.)
- This screen is **only shown during sign-up**. Sign-in determines role from the existing account.

#### 5.1.1b Preview questionnaire — step 1 (child's age)
*(New 2026-05-19 — ephemeral preview-shaping survey; Parent path only. Answers stay on the device and **are not saved to any Child profile**. See `CONTEXT.md` § Sensitive-data consent / pre-signup questionnaire.)*

- Cream canvas. **Progress dots** top-center: ● ○ ○ (`brand/primary` filled = active; `ink/tertiary` outline = pending). `label/sm` reads "Step 1 of 3" centered below the dots.
- Top-left: 44pt circular back button to [§5.1.1a Role pick](#511a-role-pick-3-tab-sign-up-only).
- Top-right: tertiary **"Skip — show me everything"** link that bypasses all three questionnaire steps and routes directly to [§5.1.4 Sign up](#514-sign-up) with no preferences captured.
- Headline `heading/xl`: "How old is your child?"
- Subhead `body/md` `ink/secondary`: "We use this to shape what you see first. Your answers stay on this device and aren't saved to your account."
- **Single-select chip grid**, 2-column layout, each chip `radius/lg`, height 56pt, `body/md` label centered. Inactive: `bg/surface-alt`. Selected: `brand/primary-soft` fill + 1.5pt `brand/primary` outline + `ink/primary` label.
  - "0–2 years" · "3–5 years" · "6–9 years" · "10–12 years" · "13–17 years" · "Multiple children, mixed ages"
- Sticky footer: full-width primary "Continue" (`brand/primary` pill, disabled until a chip is selected).

#### 5.1.1c Preview questionnaire — step 2 (neurotypical / neurodivergent)
*(New 2026-05-19 — see §5.1.1b note. Ephemeral.)*

- Same scaffold as §5.1.1b. **Progress dots:** ● ● ○ ("Step 2 of 3").
- Headline `heading/xl`: "Tell us a bit about your child."
- Subhead `body/md` `ink/secondary`: "We use this to surface the right Providers first. This isn't saved to your account or shared with any Provider."
- **Single-select tile picker**, 3 stacked full-width tiles (each `radius/xl`, padding `space/lg`, separated by `space/md`):
  - **"Neurotypical"** — `body/sm` "No diagnosed developmental differences."
  - **"Neurodivergent"** — `body/sm` "Diagnosed autism, ADHD, learning differences, or similar."
  - **"I'm not sure yet"** — `body/sm` "We'll show a balanced mix."
- Each tile: inactive `bg/surface` + 1pt `line/hairline` outline. Selected: `brand/primary-soft` fill + 1.5pt `brand/primary` outline; selected tile shows a 24pt check-circle in `brand/primary` top-right.
- Sticky footer: tertiary **"Back"** bottom-left, primary "Continue" bottom-right (disabled until a tile is selected).

#### 5.1.1d Preview questionnaire — step 3 (focus areas, optional)
*(New 2026-05-19 — see §5.1.1b note. Ephemeral. Genuinely optional — the Continue CTA is enabled even with zero selections.)*

- Same scaffold as §5.1.1b. **Progress dots:** ● ● ● ("Step 3 of 3").
- Headline `heading/xl`: "Any specific focus areas?"
- Subhead `body/md` `ink/secondary`: "Optional — tap any that apply, or skip if you'd rather just browse."
- **Multi-select chip grid**, 2-column, 36pt height, `radius/pill`, `label/md`. Inactive: `bg/surface-alt`. Selected: `brand/primary` fill + `ink/inverse` label.
  - "Autism" · "ADHD" · "Speech & language" · "Occupational therapy" · "Learning differences" · "Anxiety / behaviour support" · "After-school care" · "Academic tutoring" · "Other"
- Below the grid, `body/sm` `ink/tertiary` privacy note: *"These choices stay on this device. They aren't saved to a Child profile, and they aren't visible to any Provider — see Privacy."*
- Sticky footer: tertiary **"Back"**, primary **"See my matches"** (`brand/primary`, always enabled). Tap → routes to [§5.1.4 Sign up](#514-sign-up) (a free browsing account is required to land in the marketplace, per `CONTEXT.md` § Subscription). The ephemeral answers from steps 1–3 are held in the app's onboarding state object and applied to the first marketplace search as sort/filter hints; the object is discarded when the user reaches the marketplace surface (or on app restart, whichever first).

**Implementation note for the engineer.** The questionnaire object schema (in-app state only, never persisted server-side):

```
PreviewPreferences = {
  child_age_band: '0-2' | '3-5' | '6-9' | '10-12' | '13-17' | 'mixed' | null,
  needs_profile: 'neurotypical' | 'neurodivergent' | 'unsure' | null,
  focus_areas: ['autism' | 'adhd' | 'speech' | 'ot' | ...][]
}
```

The marketplace surface reads this object once on first render and translates it into a *sort hint* (e.g., `needs_profile=neurodivergent` boosts Specialists with relevant specialty tags) + a *category nudge* (e.g., `focus_areas=['speech']` surfaces Speech-Language-Pathology Specialists in the first recommended rail). It is **not** persisted to the Parent account, Child profile, or any server-side preferences table — that would re-introduce the consent surface the questionnaire is designed to avoid.

#### 5.1.2 Welcome carousel (3 slides)
- Same for both roles in v1 — Parent-leaning copy (childcare is the consumer-facing pitch) but applies to either side.
- Slide 1: "Trusted childcare in Miami." Hero photo of a Provider with a child (cutout on cream).
- Slide 2: "Babysitters, Tutors, Nannies, Specialists." Four category tiles preview.
- Slide 3: "Verified, vetted, on your schedule." Verification badge close-up.
- Page-indicator dots bottom-center (`ink/primary` active, `ink/tertiary` inactive).
- Trailing top-right "Skip" tertiary button.
- Bottom: primary "Get started" CTA on the final slide → routes to [§5.1.1a Role pick](#511a-role-pick-sign-up-only). "Next" arrow button on slides 1–2.

#### 5.1.3 Sign in
- Headline `heading/xl`: "Welcome back."
- Sign in with Apple (primary, black with Apple logo).
- Sign in with Google (secondary white outline).
- "Continue with email" tertiary.
- Footer: "New to Our Haven? **Sign up**" — text link → routes to [§5.1.1a Role pick](#511a-role-pick-sign-up-only).
- After successful auth the app reads the account's role and routes to the role-appropriate shell. No role choice at sign-in.

#### 5.1.4 Sign up
- Same scaffold as Sign in (Apple → Google → Email). The screen is reached **after** role-pick (Caregiver / Specialist paths) or **after the preview questionnaire** (Parent path). The chosen role + `kind` are carried into account creation.
- Email sign-up opens a **2-step flow**: email + password → email verification. *(Refined 2026-05-19 — phone verification is no longer part of the sign-up flow; it moves to the paywall step where the Parent first commits to a money-spending action — see [§5.1.6 Phone verification](#516-phone-verification-at-paywall) and `CONTEXT.md` § Authentication / Parent (mobile).)*
- **Parent path after sign-up**: lands directly in the marketplace ([§5.3.1 Home](#531-home)) — the preview questionnaire's `PreviewPreferences` object is applied to the first browse render. No phone, no payment, no Subscription required at this point.
- **Caregiver / Specialist path after sign-up**: forks to [§5.1.13 Provider onboarding](#5113-provider-onboarding) with the `kind` value already set (`caregiver` or `specialist`); the *Choose your category* step inside Provider onboarding is scoped accordingly.

#### 5.1.5 Email verification
- `heading/lg` "Check your email", body explanation, 6-box OTP input. "Resend code" tertiary after 30s cooldown.

#### 5.1.6 Phone verification (at paywall)
*(Refined 2026-05-19 — Parent phone is **no longer collected at sign-up**. This screen now fires inside the paywall flow ([§5.1.11 Subscription gate / preview](#5111-subscription-gate--preview)) the first time the Parent attempts to send a Message, send a Book-request, or post a Job. See `CONTEXT.md` § Authentication / Parent (mobile).)*

- Country code picker (US default), phone input, primary "Send code", then 6-box OTP screen.
- Context line above the input `body/md` `ink/secondary`: "We'll text you only for time-critical things — cancellations inside 24 hours, and new-device sign-in checks."
- Provider role: phone is still collected at sign-up (Providers receive Booking-request SMS, which is the most time-sensitive notification in the system per `CONTEXT.md` § Notifications) — this paywall-step variant applies to Parents only.

#### 5.1.7 Sensitive-information consent
- **Critical screen — full attention.** Cream canvas, no other actions.
- `heading/xl`: "About your child's information."
- Body: 3-paragraph plain-English explanation of why special-needs flags require explicit consent and that consent withdrawal deletes the data.
- Two unchecked checkboxes (must check both): "I understand", "I consent".
- Primary "Continue", secondary "I'll decide later" (returns to home without consent recorded; user can record special-needs flags later but is re-prompted).
- Records timestamp on confirmation (PRD story 3, 74).

#### 5.1.8 Parent profile setup
- First name, last name, ZIP code (5-digit input, validation).
- "Save & continue" primary.

#### 5.1.9 Add first Child profile (optional, post-sign-up)
*(Refined 2026-05-19 — this is the **persistent** Child profile creation step, distinct from the ephemeral §5.1.1b–d preview questionnaire. It is **not** part of the initial sign-up flow; it's surfaced as an empty-state prompt the first time the Parent visits the Children list in Account, OR offered at the Book-request composer if the Parent has no Children on file. The persistent path goes through [§5.1.7 Sensitive-information consent](#517-sensitive-information-consent) before any special-needs flags can be stored.)*

- Skippable. Same as the standalone Add Child screen ([§5.2.2](#522-add--edit-child-profile)).
- A Parent can use the marketplace (browse, message, send a Book-request without Child attachment) without ever creating a Child profile — Child attachment becomes required only when the Parent confirms a Book-request payload that requires it. The Book-request composer surfaces an inline "Add a child first" CTA if no Child profile exists yet, which routes through §5.1.7 consent → §5.1.9 add Child → back into the composer with the new Child preselected.

#### 5.1.10 Payment method (at paywall)
*(Refined 2026-05-19 — payment method is **no longer collected during initial sign-up**. This screen now fires inside the paywall flow ([§5.1.11](#5111-subscription-gate--preview)) alongside phone verification ([§5.1.6](#516-phone-verification-at-paywall)) the first time the Parent attempts to send a Message, send a Book-request, or post a Job. See `CONTEXT.md` § Subscription.)*

- Stripe Payment Sheet entry. Body: "Add a card to start your subscription and unlock messaging, booking, and Jobs."
- Primary "Add card" (opens Stripe sheet). No skip option in the paywall context — payment + phone + subscription are a single committed step.

#### 5.1.11 Subscription gate / preview (the paywall)
*(Refined 2026-05-19 — this is now the **single combined paywall step**: phone verification + payment method + Stripe Subscription checkout, fired the first time the Parent attempts to send a Message, send a Book-request, or post a Job. See `CONTEXT.md` § Subscription.)*

- Triggered by tap on any subscription-gated action (Send Message / Book / Post a Job). The originally-attempted action is held in app state and resumed on successful return.
- Headline `heading/xl`: "Unlock the marketplace."
- Subhead `body/md` `ink/secondary`: "You'll start your subscription and verify your phone in one step. Cancel anytime."
- Stat row: "300+ vetted Providers", "Checkr-screened (criminal + sex offender + SSN)", "Encrypted messaging". *(Refined 2026-05-19 — was "Florida Level 2"; see ADR-0007 for why we don't make the statutory-Level-2 marketing claim.)*
- **Paywall step sequence:**
  1. Phone collection + OTP ([§5.1.6 Phone verification (at paywall)](#516-phone-verification-at-paywall)) — for cancellation SMS + new-device MFA.
  2. Payment method ([§5.1.10 Payment method (at paywall)](#5110-payment-method-at-paywall)) — Stripe Payment Sheet.
  3. Stripe-hosted Subscription checkout in an in-app browser. On return, app polls Subscription status and shows confirmation toast, then resumes the originally-attempted action.
- Primary "Continue" pill (`brand/primary`) progresses through the sequence; each substep can be backed out of, but on completion the Parent is committed to all three.
- Tertiary "Not now" returns to the marketplace preview without committing — the originally-attempted action is discarded.

#### 5.1.12 Subscription confirmed
- Confetti-free success state. Large check icon, `heading/xl` "You're in.", primary "Start browsing".

#### 5.1.13 Provider onboarding
- **Reached after** Provider role-pick + Email/Apple/Google auth + email verification + phone verification.
- A vertical progress stack — each step is a tappable row, expanding state varies per row. Header `heading/lg` "Set up your Provider profile." Subhead `body/md` "Complete these steps to start receiving Bookings."
- Step rows (each row: leading 24pt status icon — check-circle done / dot pending / lock blocked; title `heading/sm`; status subtext `body/sm`; trailing chevron):
  1. **Choose your category** — *(Refined 2026-05-19 — kind-aware.)* For `kind=caregiver` (came in via "I'm a Caregiver" tab): single-select tile picker scoped to Babysitter / Tutor / Nanny (Specialist is **not** an option here — Specialists chose the "I'm a Specialist" tab and arrive on a different fork of this step). For `kind=specialist`: single-select tile picker scoped to specialty — SLP / OT / ABA / Psychology / Medicine / Nursing / Other (specifies the Provider's `specialty` field per `CONTEXT.md` § Provider; drives which Florida licensure board the admin verifies against). Sets which onboarding extensions appear and which Jobs the Provider sees.
  2. **Profile basics** — name, headshot capture (mobile camera; required), bio (free text, 500 char), ZIP, languages, specialties (chip selector).
  3. **Set your Published Rate** — hourly Rate (Babysitter/Tutor/Nanny) or per-session Rate (Specialist); per-child surcharge (Babysitter/Nanny only). Helper text: "Parents can negotiate via Offers — this is your guide price."
  4. **Government ID upload** — mobile camera capture, auto-crop, mobile-native (per ADR-0005).
  5. **Background screening (Checkr standard package)** — opens Checkr's hosted flow in an in-app browser. Charged at $35 with a small platform margin. Status reflects back via webhook + mobile poll. *(Refined 2026-05-19 — see ADR-0007; **not** statutory FL Level 2.)*
  6. **Specialist credentials** (visible only when Category = Specialist) — license number + issuing FL board form fields on mobile; license document + insurance certificate upload **opens the web portal** in an in-app browser ([§5.11.2.1](#51121-linkout-to-web--documents--kyc)). Status reflects back when admin approves.
  7. **Tax-credit-friendly self-attestation** (Babysitter/Nanny only; optional) — single toggle with explanation. Adds the badge to the Provider's profile.
  8. **FCCH registration** (rare; optional) — opens web portal for upload.
  9. **Bank details (Stripe Connect Express)** — opens Stripe's hosted KYC in an in-app browser ([§5.11.2.1](#51121-linkout-to-web--documents--kyc)). Status reflects back via webhook + poll.
  10. **Publish your Availability** — link into the [§5.11.3.3 Availability editor](#51133-availability-editor); not strictly required for activation but recommended.
- Sticky footer: progress strip ("3 of 9 complete · 6 to go"), tertiary "Save and continue later".
- Until verification clears, the Provider is in **pre-activation state** — the Opportunities tab shows an empty state ("Your Job feed unlocks once verification clears"), the Schedule tab shows Availability + a "Bookings will appear here" empty state, and Messages is enabled (so the admin can reach out about credentials).
- On the moment verification clears: full-screen success state, `heading/xl` "You're live.", primary "See open Jobs" → routes to Opportunities tab.

### 5.2 Children profiles

PRD stories 4, 25, 26, 74.

#### 5.2.1 Children list
- Bento-style 2-column grid of Child profile cards.
- FAB or top-right "+ Add child" tertiary button.
- Empty state: "Add a profile for each child you want to book for."

#### 5.2.2 Add / Edit child profile
- Multi-step inside a single screen with progress indicator (`label/md` "Step 1 of 3").
- Step 1: First name, age.
- Step 2: Special-needs flags (toggleable tag list — gated by sensitive-information consent state).
- Step 3: Free-text notes (only if any flag is toggled).
- Primary "Save". Secondary "Cancel".

#### 5.2.3 Consent withdrawal flow
- Reached from Account → Privacy.
- Modal dialog confirming consequence (all special-needs flags + notes will be permanently deleted).
- On confirm: server deletes flags, app navigates back to Children list with a confirmation toast.

### 5.3 Home & Discovery

PRD stories 10–17.

#### 5.3.1 Home
- Discovery scaffold ([§4.2](#42-discovery-scaffold-home-search-category)).
- Greeting: "Good morning, {first_name}" + Parent avatar.
- Action cluster: Notifications, Messages, Bookings calendar shortcut.
- Stat card: "Next booking · Tomorrow 9am with {Provider name}" — or empty-state CTA "Find your first Provider".
- Section "Find help for your family" — `heading/xl`. *(Refined 2026-05-19 — the prior "Browse Providers" / "Post a Job" dual-entry section is **removed**; the category grid is now the primary discovery surface, with Post-a-Job demoted to a full-width button beneath the grid.)*
- 2×2 category grid (Babysitter / Tutor / Nanny / Specialist) — each tile is a `radius/xl` card with the category pastel fill, an outline illustration, and the category name `heading/md`. Tap → routes into [§5.3.3 Discovery / Search results](#533-discovery--search-results) with that category preselected as the active filter chip. **Note on hierarchy:** the tiles render the four leaf categories flat (Babysitter / Tutor / Nanny / Specialist) for direct discovery; the Caregiver-vs-Specialist `kind` hierarchy (see `CONTEXT.md` § Provider) lives in the data model and in the search filters, not on the Home grid.
- **"Post a Job" button** — full-width `radius/pill` button directly below the category grid, height 56pt, **`brand/primary` fill** (resolved 2026-05-19 — see §2.1 color tokens), `ink/inverse` `label/lg` reading "Post a Job", 20pt leading briefcase icon. Tap → routes to [§5.10.1 Post a Job (compose)](#5101-post-a-job-compose). For preview-only Parents this routes to the Subscription gate per [§5.1.11](#5111-subscription-gate--preview).
- Section "Recommended near you" — horizontal Provider rail.
- Section "Featured this week" — vertical Provider cards (max 3).
- Section "My open Jobs" (only shown when Parent has ≥1 Job in `open` state) — horizontal rail of Job cards ([§3.30](#330-card--job-parent-side-on-my-jobs-list)), trailing "See all" tile that links to [§5.10.2 My Jobs](#5102-my-jobs).

#### 5.3.2 Category landing
- Same scaffold as Home, scoped to one category.
- Hero card: featured Provider in this category (full-bleed cutout over the category pastel).
- Filter chips row pinned below the hero (Distance, Rate, Available now, Top-rated).
- Vertical Provider card list.

#### 5.3.3 Discovery / Search results

The dedicated discovery surface. Reached from any category tile or the Home search bar — when the user lands here with a category preselected, that category's chip is already active in the filter strip and the Provider list is scoped accordingly. The user can add or remove categories from the strip to widen or narrow the search without leaving the page.

**Layout** — single-column, search-and-filter forward. No hero headline, no 2×2 category grid, no horizontal rails.

A scrolling stack of:
1. **App-bar row** — leading 44pt circular back button (chevron-left), full-width search bar in the middle (preset to the last query or category name), trailing 40pt circular filter icon button (`bg/surface-alt`, opens the Filter sheet).
2. **Filter chip strip** — horizontal scrolling chip row, multi-select. Categories — "Babysitter" / "Tutor" / "Nanny" / "Specialist" — plus contextual chips for active filters carried from the Filter sheet ("Available now", "Top-rated", "Within 10 mi", "Tax-credit"). Active chips use `ink/primary` fill + `ink/inverse` label per [§3.6](#36-chip--filter); inactive chips use `bg/surface-alt`. Each active chip carries a trailing 14pt × close icon for in-place removal. Trailing `label/lg` "Clear all" tertiary right-aligned when ≥1 filter is active.
3. **Results header** — `heading/lg` "{N} providers" left + `label/md` sort selector right ("Best match" / "Closest" / "Lowest rate" / "Top rated"), opens a small action sheet.
4. **Vertical stack of Provider cards** — single-column list using [§3.10 Card — Provider](#310-card--provider). Sorted by hybrid ranking with the user's sort override applied.
5. **Pagination** — infinite scroll; loading sentinel uses a skeleton shimmer ([§3.26](#326-loading)) for the next 3 cards.
6. Bottom-nav offset (96pt blank space at end).

**Multi-select rule.** Adding "Tutor" to an existing "Babysitter" filter widens the result set (union, not intersection) — a Parent can shop across two categories in one pass. The Filter sheet ([§5.3.4](#534-filter-sheet)) governs the structured filters; the chip strip governs categories and quick toggles.

**Empty state.** When the active filter combination returns no Providers: 240×240pt empty-state illustration + `heading/lg` "No matches yet" + `body/md` "Try widening your radius, relaxing the Rate ceiling, or removing a category." + tertiary "Clear all filters".

#### 5.3.4 Filter sheet
- Bottom sheet, opens at 90%.
- Sections:
  - Category (single-select chip row, optional)
  - ZIP code + radius slider (5 / 10 / 25 / 50 miles)
  - Date & time picker (intersected with Availability)
  - Rate ceiling — slider with live tabular dollar readout
  - Minimum rating — 5 star pills (1, 2, 3, 4, 5)
  - Tax-credit-friendly toggle (Babysitter & Nanny only — hidden otherwise)
  - Specialist-specific (unlocks when category=Specialist): License type, In-person/Telehealth, Age range served
- Primary "Show {N} results" button (live count).

#### 5.3.5 Saved Providers (Favorites)
- Vertical Provider card list of saved Providers.
- Empty state: "Tap the bookmark on a Provider's card to save them for later."

### 5.4 Provider profile

PRD stories 18, 22, 35–37.

#### 5.4.1 Provider profile detail
- Detail scaffold ([§4.3](#43-detail-scaffold-provider-profile-booking-detail-child-profile)).
- Hero photo: large cutout on category pastel. Top-overlay back button + share + bookmark.
- Bottom-overlay info card:
  - Category chip + verification badges (vertical stack max 3, "more" chip if overflow).
  - Provider name `heading/xl`, role + ZIP `body/md` in `ink/secondary`.
  - Star rating (16pt) + count.
  - Rate: `display/lg` ($35) + "/hr" suffix `body/md`. For Specialists: "$120 / session".
- Below: tab strip (About / Availability / Reviews).
- About: bio paragraph, specialties (chip list), languages, response time.
- Availability: see [§5.4.2](#542-provider-availability).
- Reviews: list of star + text reviews ([§5.4.3](#543-provider-reviews)).
- Sticky CTA bar: single primary **"Message"** button (refined 2026-05-19 — replaces the prior "Book a slot" CTA; slot-pick is removed per `CONTEXT.md` § Availability and ADR-0006 revision pending). Booking is initiated via a Book-request inside the Direct-Message thread, not from the profile. Tap → routes to a thread with this Provider per [§5.7 Messaging](#57-messaging).

#### 5.4.2 Provider availability
*(Rewritten 2026-05-19 — per-slot calendar removed per `CONTEXT.md` § Availability and the revised ADR-0006; this surface is now a **read-only general weekly summary**, not a booking-action surface. Booking happens via the chat thread + Book-request flow, not from this tab.)*

- **Read-only summary card.** No tappable slots, no booking CTA. The card displays:
  - A **7-day × 3-band toggle grid** rendered as a static lattice: rows are days (Mon–Sun); columns are Morning / Afternoon / Evening. Bands the Provider has marked available render with `brand/primary-soft` fill + small `brand/primary` check; unavailable bands render with `bg/surface-alt` fill, no check. Each cell is 44×36pt; the whole grid sits inside a `radius/xl` card with `space/lg` padding.
  - A short rendered string above the grid (the canonical text summary the search results use), e.g. "Mon–Fri 3–5 PM" or "Weekends, mornings." `body/md` `ink/secondary`.
  - **Band-to-clock mapping reminder** at the bottom of the card in `body/sm` `ink/tertiary`: "Morning 6 AM–12 PM · Afternoon 12 PM–6 PM · Evening 6 PM–10 PM."
  - A **free-text note** under the grid (up to 200 chars; rendered as `body/md` in `ink/primary` if present, hidden if empty). E.g., *"Flexible weekends, last-minute OK."*
  - A **"Paused" pill** in `status/warning` at the top-right if `provider.paused = true` (in which case the Provider also doesn't appear in search; included here as a defensive render in case the Parent reached this profile by a saved link).

- **No date pills, no time-slot grid, no booking CTA.** The pre-2026-05-19 Pattern B date pills and tappable slot grid are removed from this surface — the Parent's path to a Booking is via the "Message" CTA on the profile ([§5.4.1](#541-provider-profile-detail)) which opens a Direct-Message thread; Booking is initiated by a Book-request inside that thread, accepted by the Provider, and materialised as a Job + Application + Booking atomically (see `CONTEXT.md` § Job / § Availability and revised ADR-0006).

- **Provider-side editor for this surface lives in [§5.11.5 Schedule.Availability](#5115-schedulerunavailability)** on the Provider mobile companion — the editor exposes the same 7×3 toggle grid + free-text note + Paused switch.

#### 5.4.3 Provider reviews
- Aggregate header: average stars + total count + breakdown bar (5/4/3/2/1 stars with proportional fill).
- List of individual reviews: reviewer initial avatar, star row, `body/md` review text, `body/sm` date.
- Filter chip: "All / 5⭐ / 4⭐ / 3⭐ / Critical".

#### 5.4.4 Video call (ad-hoc, in-chat)
*(Refined 2026-05-19 — replaces the prior "Schedule video interview" calendar-flow UX; see ADR-0008.)*
- **Triggered from the chat thread** app-bar 44pt video icon ([§5.5.2](#552-message-thread)) — **not** from the Provider profile. Either party (Parent or Provider) may initiate.
- Tap the icon → confirmation modal: *"Start a video call with {counterparty name}? They'll get a Join bubble in this chat and can join immediately."* Two buttons: secondary "Cancel" + primary "Start call".
- On confirm: the initiator is taken straight to the [§5.4.5 Video room](#545-video-interview-room-dailyco); a **"Join video call" bubble** lands in the thread for the counterparty (Offer-bubble-style variant — `ink/primary` outline, `radius/xl`, leading 20pt video icon, label "Join video call now", trailing `body/sm` "Expires in {N} min"). Bubble is valid for ~30 min, then auto-expires (renders disabled with `body/sm` "Call ended").
- No scheduling, no date picker, no calendar invite. v1 is start-now-only.

#### 5.4.5 Video interview room (Daily.co)
- Full-screen Daily.co embed.
- Top-left: minimize button. Top-right: end-call button (red `status/danger` pill).
- Bottom controls: mute, camera, switch-camera, chat — circular icon buttons in a black bar.

### 5.5 Messaging

PRD stories 18–22, 58.

#### 5.5.1 Inbox
- Tab strip: All / Unread.
- List of conversation rows: leading avatar (40pt), Provider name `heading/sm`, latest-message preview `body/md` 1-line truncate in `ink/secondary`, timestamp trailing `body/sm`, unread dot indicator.
- Empty state: "Your conversations will appear here."

#### 5.5.2 Message thread
- App bar: back + counterparty name + counterparty avatar (small) + 44pt video-call button *(refined 2026-05-19 — available in **both** Parent and Provider thread surfaces; either party may initiate per [§5.4.4 Video call (ad-hoc, in-chat)](#544-video-call-ad-hoc-in-chat) and ADR-0008)*.
- **Job context strip** pinned directly below app bar, above the encryption banner: thin `bg/surface-alt` row, `radius/lg`, 56pt height, padding `space/md`. Leading: Job lifecycle status pill ([§3.29a](#329a-status-pill-job-lifecycle)). Content: first line of Job description, `body/md` single-line truncate. Trailing chevron "View Job →" → routes to the Parent's Job detail ([§5.10.3](#5103-job-detail-parent-view)) or Provider's Application detail ([§5.11.4.2](#51142-application-detail-provider-view)). *(Refined 2026-05-19 — strip renders on threads anchored to a Job. **Pre-acceptance Direct-Message threads (no Job yet) render a lighter strip instead**: a `body/sm ink/secondary` line reading *"No active Job — send a Book-request to start one"*. The lighter strip flips to the full Job strip the moment a Book-request is accepted and a Job materialises. See `CONTEXT.md` § Message.)*
- Banner pinned below the Job strip (collapsible): "Messages are encrypted. Sharing phone numbers, emails, or payment apps is auto-redacted to protect you." `body/sm` `ink/secondary`.
- Scrollable message list (message bubbles per [§3.21](#321-message-bubble); Offer bubbles per [§3.32](#332-message-bubble--offer-variant) interleaved inline).
- Composer pinned bottom: text input pill + attachment button + **"Send Offer" pill button** (`ink/primary` outline, `label/md`, opens the Offer composer sheet [§5.5.4](#554-offer-composer)) + send button (circular `ink/primary`).
- Redaction in action: when the user types a phone number, an inline toast appears: "Phone number will be hidden when sent." User can edit or send anyway.

#### 5.5.4 Offer composer
- Half-snap bottom sheet ([§3.22](#322-bottom-sheet)), title `heading/md` "Send an Offer".
- Form fields (vertical stack, all `space/lg` apart):
  - **Rate** — currency input (numeric keyboard). For hourly Providers/Parents: "/hr" suffix; for Specialist Bookings: "/session" suffix. Default to the Provider's Published Rate when the sender is the Provider.
  - **Hours / sessions** — numeric stepper (1–24 hourly; 1–10 sessions).
  - **Per-child surcharge readout** (Babysitter/Nanny only, read-only) — "+$5/hr × 0 extra children" with a tertiary info icon explaining it's snapshotted from the Provider's profile.
  - **Computed total** — `display/lg` tabular figures, recomputed live as Rate × Hours + surcharge.
  - **Note (optional)** — multi-line `body/md` input, 280-char counter top-right of the field. Helper: "Share a quick note. Phone numbers and emails will be hidden."
  - **Valid for** — pill selector ("24h" / "48h" / "72h", default 72h).
- Sticky footer: primary "Send Offer — ${total}" pill.
- Sending posts the Offer bubble ([§3.32](#332-message-bubble--offer-variant)) into the thread.

#### 5.5.3 Disintermediation policy modal
- Triggered from the redaction banner's info icon. Plain-English explanation of why and what is redacted. "Got it" primary.

### 5.6 Booking lifecycle

PRD stories 23–34, 38–39, 61.

#### 5.6.1 Booking compose
*(**Superseded 2026-05-19** — the slot-pick entry path is removed. Book-request composition now happens via [§5.5.4 Offer composer](#554-offer-composer) inside the Direct-Message thread, with the same Provider-profile-snapshot-of-Published-Rate as the starting value plus an `attached_child_ids` selector and the Tutor/Specialist single-child constraint. Section retained as historical reference until the PRD v1.2 revision is fully reflected in the design spec; the original content below describes the slot-pick UX which no longer ships.)*

- ~~Reached from a Provider's availability slot (the slot-pick path; this auto-creates a hidden Job per [`CONTEXT.md`](CONTEXT.md) § Job).~~
- Sections (vertical stack):
  - Slot summary card (date + time + duration).
  - "Children" — selectable Child profile cards. For Tutor/Specialist, only one selectable at a time (UI enforces; subtitle reads "Single-child bookings only").
  - Pricing summary block (live updates with per-child surcharge) using the Provider's **Published Rate** as the starting price. For Specialist: fixed session rate, no surcharge. Helper text below the total: "This is the starting Offer. You can negotiate with the Provider in chat before they accept."
  - Payment method (default card; tap to switch).
  - Cancellation policy summary in a `bg/surface-alt` `radius/lg` info block.
- Sticky primary CTA: "Send Booking request — ${total}".
- On submit: optimistic success toast + transition to Booking detail in `requested` state. A thread opens automatically with the Job context strip ([§5.5.2](#552-message-thread)) visible — the Parent can send an Offer ([§5.5.4](#554-offer-composer)) at any point before the Provider accepts.

#### 5.6.2 Bookings list
- Tab strip: Upcoming / Past / Disputes.
- Date-grouped sections (`heading/sm` headers "This week", "Next week", "May").
- Each row: Provider avatar + name + date/time + status pill ([§3.29](#329-status-pill-booking-lifecycle)).
- Action-required rows (`awaiting-confirmation`, `disputed`) sort to top with a soft `accent/highlight` left-side stripe.

#### 5.6.3 Booking detail
- Detail scaffold.
- Hero: Provider photo + category band.
- Info card: Booking ID `mono/md`, status pill, date, duration, children attached (avatar group), Rate breakdown.
- Timeline: visual progression through the state machine — completed states filled, current state highlighted, future states ghosted.
- Action area depends on state:
  - `requested`: "Cancel request" tertiary.
  - `accepted`: "Cancel booking" (opens cancellation cost preview sheet — [§5.6.5](#565-cancellation-flow)), "Message provider" secondary.
  - `in-progress`: live banner "Session in progress · started 1h 22m ago", no actions.
  - `awaiting-confirmation`: "Confirm hours" primary, "Dispute" tertiary — [§5.6.4](#564-confirm-or-dispute-hours).
  - `completed`: "Rate provider" primary, "File dispute" tertiary (within 7-day window only).
- Disintermediation note: bookings always link to the thread, not phone/email.

#### 5.6.4 Confirm or dispute hours
- Triggered when Provider proposes final hours.
- Sheet: "Provider proposed **{hours_proposed} hours**. Confirm or dispute by **{deadline}** (24h auto-confirm)."
- Buttons: "Confirm" primary, "Dispute" secondary.
- Dispute opens [§5.6.6](#566-dispute-booking).

#### 5.6.5 Cancellation flow
- Bottom sheet with computed cancellation cost per the [v1 cancellation policy calculator](docs/prd/0001-our-haven-v1.md):
  - "Cancel **{N}h** before start — you'll be charged **${refund_calculation}**."
- "Confirm cancellation" primary (`status/danger` border instead of fill for restraint), "Keep booking" tertiary.

#### 5.6.6 Dispute booking
- Form: reason (chip select — overcharged / no-show / safety / quality / other), free-text details, optional photo attachment.
- Disclaimer: "Disputes are reviewed by Our Haven within 3 business days. Your card will not be charged the disputed amount during review."
- Primary "Submit dispute".

#### 5.6.7 No-show flow (Provider didn't show)
- Reached from the in-progress Booking detail after the scheduled start + 15 min grace.
- Banner: "Provider hasn't checked in. Report a no-show?"
- "Report no-show" primary. On submit: full refund initiated, Provider auto-flagged for admin review (PRD §No-show).

#### 5.6.8 Rate Provider (blind submission)
- Reached from completed Booking detail or 14-day-window prompt.
- 5 large star buttons (`label/lg` numeric below each on tap).
- Optional text field — `body/lg`, multi-line, 500 char limit.
- Disclaimer: "Your rating is hidden from {Provider} until they also submit or the 14-day window closes."
- Primary "Submit rating".

#### 5.6.9 Ratings reveal
- Triggered automatically when the second party submits or window closes.
- Modal celebrating mutual feedback (no confetti, calm warm illustration).
- Shows both ratings + text. Buttons: "View provider profile" tertiary, "Done" primary.

### 5.7 Account

PRD stories 73, 74, 76.

#### 5.7.1 Account home
- Top: Parent avatar (`xl`) + name `heading/lg` + email `body/md`.
- List rows (each is a tappable card row with leading icon + label + trailing chevron):
  - Children profiles
  - Subscription
  - Payment methods
  - Notifications
  - Privacy & data
  - Help & support
  - Terms & policies
  - Sign out (tertiary, `status/danger` label)

#### 5.7.2 Subscription
- Hero: current plan card (`bg/surface`, `radius/xl`) — plan name, renewal date, monthly/annual toggle.
- Action: "Manage on web" tertiary that links out to the Stripe-hosted customer portal.
- Cancellation info paragraph.

#### 5.7.3 Payment methods
- Saved cards list — each row: brand logo, last 4 digits, expiry, default badge if applicable, "Remove" tertiary.
- "Add new card" CTA.

#### 5.7.4 Notifications preferences
- Transactional channels (push, email, SMS) — each shown as a row with a switch.
- Marketing opt-in — separate section with its own explicit-opt-in toggle (PRD story 76 — CAN-SPAM / TCPA distinction). Default off.

#### 5.7.5 Privacy & data
- Sensitive-information consent status: shown as a card with timestamp, current state, and a "Withdraw consent" tertiary action.
- "Download my data" CTA — opens a confirmation modal, dispatches an email export request.
- "Delete my account" CTA — opens a destructive confirmation modal:
  - "Your account will be soft-deleted for 30 days, then permanently deleted. Financial records (Bookings, Payouts) are retained 7 years in pseudonymized form per IRS requirements."
  - Confirmation requires typing "DELETE".
  - On confirm: navigate to Sign-in with a soft-delete confirmation toast.

#### 5.7.6 Help & support
- FAQ accordion list.
- "Contact support" tertiary — opens a form (subject + body + attach screenshot).
- App version `mono/md` at bottom.

#### 5.7.7 Terms & policies
- Links to Privacy Policy, Terms of Service, Cookie Policy, Vendor data-flow inventory appendix (PRD pre-launch deliverables).

### 5.8 Notifications (push entry points)

In-app inbox is **deferred** in v1 (PRD §Notifications). Push notifications deep-link directly into:

- Booking request status changes → Booking detail.
- Hours-confirmation prompt → Confirm or dispute hours sheet.
- Booking reminder (1h before) → Booking detail.
- New message → Message thread.
- Payout released (Providers only — not in this app).

A toast indicator is shown when the app is foregrounded and a relevant push arrives.

### 5.9 Error & system pages

#### 5.9.1 Offline
- Full-screen state when network is unreachable. Illustration + "You're offline. We'll reconnect when you're back."
- Auto-dismisses on reconnect.

#### 5.9.2 App update required
- Forced-update screen when API contract changes. Single primary CTA "Update Our Haven" → store link.

#### 5.9.3 Maintenance
- Cream canvas, simple `heading/lg` "We're upgrading something." + estimated time + status link.

#### 5.9.4 Generic error (fallback)
- Reached on unhandled exception. "Something went wrong on our end." + "Try again" primary + "Contact support" tertiary.

### 5.10 Parent — Jobs

Parent-side surfaces for the Job-board flow. See [`CONTEXT.md`](CONTEXT.md) § Job, § Application, § Offer and [ADR-0006](docs/adr/0006-job-posting-and-negotiable-pricing.md).

#### 5.10.1 Post a Job (compose)
- Reached from the Home "Post a Job" tile ([§5.3.1](#531-home)), the My Jobs FAB ([§5.10.2](#5102-my-jobs)), or post-onboarding empty state.
- Multi-step inside a single screen with progress eyebrow `label/md` "Step {N} of 4". Sticky bottom: "Save draft" tertiary left + primary "Next" / "Publish Job" right.
- **Step 1 — Category + scope**
  - Single-select category tile picker (Babysitter / Tutor / Nanny / Specialist).
  - Scope toggle (Babysitter/Tutor/Nanny only): "One-off" vs "Recurring" pill segmented control. Recurring opens a recurring-pattern sub-section (days of week + start/end window).
  - For Specialists: a free-text "specialist focus" chip field (SLP / OT / ABA / Psychology / Other), driven by the same canned set as the search filter ([§5.3.4](#534-filter-sheet)).
- **Step 2 — Description**
  - Free-text input, `body/lg`, multi-line, 1500-char limit with counter top-right.
  - Placeholder text (per category):
    - Babysitter: "Tell Providers about the dates, hours, ages of your children, and anything they should know."
    - Specialist: "Describe what kind of clinical support your child needs. Share enough for a qualified Provider to know if they're the right fit."
  - **Consent warning card** anchored above the input — `bg/surface-alt` `radius/lg` card, `space/lg` padding, leading 20pt info icon, `body/md` copy: "Your Job will be visible to verified Providers in your category and area. Avoid including more about your child than is needed." Two-line acknowledgement checkbox below: "I understand my description will be visible to multiple Providers." Cannot proceed to Step 3 without checking; checkbox state is timestamped to the Job record on publish.
- **Step 3 — Logistics**
  - ZIP code (5-digit input) + radius slider (5 / 10 / 25 / 50 miles).
  - Date / time window — date range picker + start/end time pickers. For recurring scope, this is the overall window.
  - **Budget hint (optional)** — pill toggle "Set a budget hint" → reveals "$" input with helper text "Optional. Shown to Providers as a guide — does not bind the price. Negotiation happens via Offers in chat."
- **Step 4 — Review & publish**
  - Read-only summary card of all fields.
  - Disclosure rail: "Posting a Job uses your active Subscription. Posted Jobs auto-expire after 14 days if nobody is awarded."
  - Primary "Publish Job" — on tap: optimistic success toast "Your Job is live", route to [§5.10.3 Job detail](#5103-job-detail-parent-view).
- **Drafts** save automatically on every step change. Drafts surface in [§5.10.2 My Jobs](#5102-my-jobs) under a "Drafts" section.

#### 5.10.2 My Jobs
- App bar: back + title `heading/sm` "My Jobs" + 44pt "+" icon button trailing (opens [§5.10.1](#5101-post-a-job-compose)).
- Tab strip ([§3.18](#318-tab-strip-segmented)): **Open** / **Awarded** / **Past** / **Drafts**.
- Each tab: vertical stack of Job cards ([§3.30](#330-card--job-parent-side-on-my-jobs-list)), date-grouped where applicable.
- Empty states (per tab): centered illustration + `heading/lg` + body + primary CTA.
  - Open: "No open Jobs yet." → "Post a Job".
  - Awarded: "You haven't awarded a Job yet." → "Browse open Jobs".
  - Past: "Your closed Jobs will appear here."
  - Drafts: "No drafts in progress."

#### 5.10.3 Job detail (Parent view)
- Detail scaffold ([§4.3](#43-detail-scaffold-provider-profile-booking-detail-child-profile)) but no hero photo — Jobs don't have an image. The hero is replaced with an **info banner**: full-width `bg/surface` block (no shadow), padded `space/xl`, with the category chip + Job lifecycle status pill on the top row, the Job description's first line as `heading/xl` (2-line truncate), and scope/logistics summary in `body/md`.
- Action cluster top-right: 44pt overflow menu — Edit (open if status = `draft` or `open`), Close Job (if `open`), Repost (if `expired` or `cancelled`).
- Below the info banner:
  - **Section "Description"** — full Job description body, `body/lg`, with the original publish timestamp `body/sm` `ink/tertiary` below.
  - **Section "{N} Applications"** `heading/lg` + Sort selector ("Newest first" / "Lowest Offer" / "Highest rated"). When N = 0: empty state "No applications yet. Most Providers respond within a day."
  - Vertical list of Application cards ([§3.31](#331-card--application)).
- Sticky CTA bar (only when status = `open`): tertiary "Close Job" left + secondary "Edit" right. No primary CTA at this level — the primary action (Award) happens inside an Application card flow.

#### 5.10.4 Application detail (Parent view)
- Detail scaffold. Hero photo = the Provider's profile photo (4:5, full-bleed).
- Bottom-overlay info card: Provider name `heading/xl`, role + ZIP `body/md`, star rating, verification badges, **Published Rate displayed** `display/lg` ("$30/hr") with helper "Their guide price — negotiate via Offer."
- Below the fold:
  - **Live Offer card** — current Offer for this Application (rendered like an Offer bubble but standalone), with Accept / Counter / Decline pill buttons identical to [§3.32](#332-message-bubble--offer-variant).
  - **Application proposal** — full free-text proposal from the Provider, `body/md`.
  - Tabs: About / Availability / Reviews — same as Provider profile detail ([§5.4.1](#541-provider-profile-detail)).
- Sticky CTA bar: tertiary "Decline" left + secondary "Message" center + primary "Award & continue" right. Tapping "Award & continue" runs [§5.10.5 Award flow](#5105-award-flow).

#### 5.10.5 Award flow
- Reached from "Award & continue" on Application detail, or from accepting an Offer in a thread.
- Full-screen overlay (`bg/canvas`), app bar = back + title `heading/sm` "Awarding {Provider first name}".
- Step 1 — **Attach children**: same selectable Child profile cards as [§5.6.1 Booking compose](#561-booking-compose). Tutor/Specialist single-child enforced. Help text reminds Parent that the attached child's notes are about to become visible to the awarded Provider per [`CONTEXT.md`](CONTEXT.md) § Child profile visibility on Booking requests.
- Step 2 — **Confirm payment method** (default card; tap to switch). Pricing summary block.
- Step 3 — **Review** — read-only summary of Agreed Rate (from Offer), scope, children, total.
- Primary CTA: "Award & create Booking — ${total}". On tap:
  - Parent Job transitions to `awarded`; this Application transitions to `awarded`; other open Applications on this Job transition to `declined` (with an auto-notification to those Providers).
  - A Booking is created in `requested` state and the user is routed to its Booking detail screen ([§5.6.3](#563-booking-detail)) — the awarded Provider now has to confirm the slot/time per the standard Booking flow.

#### 5.10.6 Edit / close Job
- Edit (only available while `open`): re-opens the [§5.10.1](#5101-post-a-job-compose) composer with current fields. Description edits warn the Parent that existing applicants will see an update marker in their thread.
- Close: confirmation modal ([§3.23](#323-modal-dialog)) "Close this Job? Open Applications will be marked withdrawn. This can't be undone." Primary "Close Job" (`status/danger` outline) / tertiary "Keep open".

### 5.11 Provider mobile companion

The Provider role's shell. Reached after Provider role sign-up ([§5.1.1a](#511a-role-pick-sign-up-only)) and onboarding ([§5.1.13](#5113-provider-onboarding)).

Bottom navigation: **Opportunities / Schedule / Messages / Account** (per [§3.16](#316-bottom-navigation)).

PRD stories 40–62 (Provider-side stories). See [ADR-0005](docs/adr/0005-provider-mobile-companion-supersedes-web-only.md) for the web/mobile split and [ADR-0006](docs/adr/0006-job-posting-and-negotiable-pricing.md) for the Job-board surface.

#### 5.11.1 Opportunities

The Provider's primary landing tab. Two inner views via top segmented tab strip ([§3.18](#318-tab-strip-segmented)).

##### 5.11.1.1 Open Jobs feed
- App bar: title `heading/sm` "Opportunities" + 44pt filter icon trailing (opens [§5.11.1.4](#51114-job-filter-sheet)).
- Tab strip pinned below app bar: **Open Jobs** / **My Applications**.
- Subheader strip on Open Jobs tab: `body/sm` `ink/secondary` "{N}/30 applications used this month" with a thin `accent/highlight` progress bar beneath. Subheader becomes `status/warning` text "Monthly cap reached — resets {date}" when N = 30; new applications disabled.
- Vertical stack of Job opportunity cards ([§3.30a](#330a-card--job-opportunity-provider-side-on-opportunities-feed)). Ranking: hybrid of recency, distance-from-Provider-ZIP, and category fit. Specialists see only Jobs in their sub-category.
- Infinite scroll, skeleton shimmer for the next 3 cards.
- Empty state: "No open Jobs in your area right now. We'll notify you when new ones land." Illustration + retry hint.

##### 5.11.1.2 My Applications
- Same tab strip as above; this is the second tab.
- Date-grouped sections (`heading/sm` headers "This week" / "Earlier").
- Each row: Application card ([§3.31](#331-card--application), Provider-facing variant) with the Job's status pill ([§3.29a](#329a-status-pill-job-lifecycle)) and the Application's own status pill ([§3.29b](#329b-status-pill-application-lifecycle)) both visible.
- Action-required Applications (`countered` where the Provider hasn't responded; awaiting Parent action) sort to the top with the same `accent/highlight` left-side stripe used on Action-required Bookings ([§5.6.2](#562-bookings-list)).
- Empty state: "You haven't applied to any Jobs yet." → tertiary "Browse Open Jobs".

##### 5.11.1.3 Job detail (Provider view)
- Same info-banner scaffold as [§5.10.3](#5103-job-detail-parent-view). Read-only.
- "Applications: {N}/15" `body/sm` `ink/tertiary` shown next to the status pill — gives the Provider sight of how crowded the Job is before they invest effort in applying.
- Below the description:
  - **Parent context card** (`bg/surface-alt`, `radius/lg`, `space/lg` padding): Parent's first name + aggregate star Rating (count, no text reviews per [`CONTEXT.md`](CONTEXT.md) § Rating — text reviews of Parents are internal-only).
  - **Apply CTA** sticky bottom — primary "Apply with an Offer", disabled with reason copy if (a) cap reached (b) verification not cleared (c) Job at 15/15 applications. Tap → [§5.11.4.1](#51141-application-composer-provider).
  - If the Provider has already applied: the sticky CTA is replaced with a `bg/surface-alt` row "You applied {N} days ago" + tertiary "View your Application" → [§5.11.4.2](#51142-application-detail-provider-view).

##### 5.11.1.4 Job filter sheet
- Bottom sheet, opens at 90%.
- Sections:
  - Distance from my ZIP (5 / 10 / 25 / 50 miles slider).
  - Recency (last 24h / last 3 days / last 7 days / all).
  - Specialist focus (only when Provider Category = Specialist) — chip multi-select.
- Primary "Show {N} Jobs" with live count.

#### 5.11.2 Account (Provider)

- Top: Provider avatar (`xl`) + name `heading/lg` + Category chip + verification status pill (`status/success` "Verified" or `status/warning` "Pending verification").
- List rows (each: leading icon, label, trailing chevron):
  - **Profile** (photo, bio, languages, specialties) — mobile-native
  - **Published Rate & per-child surcharge** — mobile-native
  - **Availability** → routes into [§5.11.3.3](#51133-availability-editor)
  - **Verification documents** → opens [§5.11.2.1](#51121-linkout-to-web--documents--kyc)
  - **Bank details & withdrawals (Stripe)** → opens [§5.11.2.1](#51121-linkout-to-web--documents--kyc)
  - **Payouts** → [§5.11.2.4](#51124-payouts-read-only)
  - **Notifications**
  - **Privacy & data** (mirrors Parent Privacy in [§5.7.5](#575-privacy--data) — Provider's background-check retention status surfaced, Provider's right-to-delete CTA)
  - **Help & support**
  - **Terms & policies**
  - **Sign out** — `status/danger` label

##### 5.11.2.1 Linkout to web — documents / KYC / withdrawals
- Reached from any of the web-routed Provider Account rows.
- Full-screen confirmation card before launching the in-app browser:
  - Headline `heading/lg`: per task ("Finish KYC on the web portal" / "Upload license document" / "Manage bank details" / "Withdraw funds").
  - Body `body/md`: explains *why* the action lives on web — Stripe-hosted onboarding / admin reviews documents on the web portal / step-up MFA flow lives on web.
  - Primary "Continue to web" pill — opens the in-app browser (`ASWebAuthenticationSession` on iOS; Custom Tabs on Android) pointing at the deep-linked portal URL with a signed handoff token.
  - Tertiary "Not now".
- On return from the in-app browser, the originating Account row updates its status badge (e.g. "KYC complete" / "License under review") via a backend poll.

##### 5.11.2.2 Profile editing
- Standard form fields page. Photo capture via mobile camera (preferred) or library pick. Bio with 500-char counter. Specialty chip selector. Languages multi-select. Save bar pinned bottom.

##### 5.11.2.3 Rate management
- Form: hourly Rate (Babysitter/Tutor/Nanny) or per-session Rate (Specialist) — `display/lg` editable numeric with currency prefix. Per-child surcharge field for Babysitter/Nanny only.
- Helper card: "This is your guide price. Parents can negotiate via Offers — your Published Rate sets the starting point and powers the search Rate-ceiling filter."
- Below: a **last-5-Bookings table** showing Published Rate at time of Booking vs Agreed Rate per Booking — a quick visual on how negotiation has actually moved your prices.

##### 5.11.2.4 Payouts (read-only)
- Header card: balance available, balance pending, next scheduled payout date.
- List of recent payout transactions — each row: date, amount, status pill (Sent / Processing / Failed), trailing chevron opens transaction detail (also read-only).
- Sticky bottom: "Withdraw funds" primary → routes to [§5.11.2.1](#51121-linkout-to-web--documents--kyc) (web for step-up MFA).
- Empty state: "You'll see payouts here after your first completed Booking."

#### 5.11.3 Schedule

Inner top tab strip ([§3.18](#318-tab-strip-segmented)): **Today** / **Upcoming** / **Availability**.

##### 5.11.3.1 Today
- Sticky **active-session banner** at the top when a Session is `in-progress`: `status/info` @ 12% fill, `radius/xl`, `space/lg` padding. Headline `heading/sm` "In session with {Child first name}" + elapsed timer (tabular) + primary "End session & propose hours" pill → [§5.11.3.4](#51134-active-session-controls).
- **Pending action** section (`heading/lg` "Needs your attention") *(refined 2026-05-19)*: incoming Direct-Message Book-requests (rendered as Offer bubbles in Messages, surfaced here as a count badge that deep-links to the relevant chat thread) + awarded Posted-Job Bookings in `requested` state needing 24h confirmation + propose-hours-awaiting items + counter-Offers waiting on the Provider.
- **Today's confirmed Bookings** section (`heading/lg`): chronological list of today's `accepted` Bookings.
- Empty state when nothing today: "Nothing scheduled today. Browse open Jobs?" + tertiary that routes to Opportunities.

##### 5.11.3.2 Upcoming
- Date-grouped list of all `accepted` Bookings beyond today (`heading/sm` group headers "Tomorrow" / "This week" / "Next week" / "{Month}").
- Each row: Parent avatar + Parent first name + date/time + Child count + status pill ([§3.29](#329-status-pill-booking-lifecycle)). Tap → Booking detail (a Provider variant of [§5.6.3](#563-booking-detail)).

##### 5.11.3.3 Availability editor
- Pattern B date pills calendar ([§3.15](#315-calendar--date-selector)) at top.
- Selected date opens a slot grid below: 30-minute increments from 6am to 11pm, each cell tappable to toggle Open / Blocked. Tap-and-drag for ranges.
- Above the calendar: Published Rate chip showing the Provider's current Rate, with "Edit" tertiary → routes to Rate management ([§5.11.2.3](#51123-rate-management)).
- Toolbar: "Apply to weekdays" / "Apply to weekends" / "Repeat weekly" tertiary helpers.
- Save bar pinned bottom — changes are applied on save, not on tap (defensive; calendar tap edits are a high-touch surface).
- Blocked-on-request slots show a subtle padlock icon and are non-editable until the holding Booking-request resolves.

##### 5.11.3.4 Active session controls
- Reached from "Mark in-progress" on a Booking detail at scheduled start time, or from the sticky banner on Today.
- **Mark in-progress** — confirmation half-sheet. Primary "Yes, start session" — transitions the Booking to `in-progress`, starts the session timer.
- **End session & propose hours** — half-sheet:
  - Live timer at top reading elapsed time.
  - Numeric stepper "Hours to bill" prefilled with the timer value, rounded to nearest 0.25.
  - Per-child surcharge readout (read-only — snapshotted from the Booking).
  - Computed total `display/lg`.
  - Note field (optional, `body/md`, 280-char) — "Add a note for the Parent (optional)."
  - Primary "Propose {N} hours — ${total}" pill — transitions the Booking to `awaiting-confirmation` per [`CONTEXT.md`](CONTEXT.md) § Booking states. Parent gets a 24h auto-confirm window.

#### 5.11.4 Application composer & detail (Provider side)

##### 5.11.4.1 Application composer (Provider)
- Reached from the Apply CTA on Job detail ([§5.11.1.3](#51113-job-detail-provider-view)).
- Full-screen form with sticky CTA. Header: Job summary card (`bg/surface-alt`, `radius/lg`) — first line of description + category chip + Parent first name + applications count "{N}/15 applied so far".
- Form sections:
  - **Your proposal** — free-text `body/lg`, multi-line, 1500-char limit with counter. Placeholder: "Tell the Parent why you're a great fit. Mention relevant experience and how you'd approach this." Inline redaction toast if a phone/email/payment-app is typed.
  - **Your Offer** — same composer fields as [§5.5.4 Offer composer](#554-offer-composer). Rate defaults to the Provider's Published Rate; scope_quantity is unconstrained (Provider proposes the duration).
  - **Quota readout** — `body/sm` `ink/tertiary` "{N}/30 applications used this month. Resets {1st}."
- Sticky primary CTA: "Submit Application — ${total}". On submit: Application is filed, opens a thread (anchored to the Job ID) with the proposal as the first message + the Offer bubble immediately following.

##### 5.11.4.2 Application detail (Provider view)
- Same scaffold as [§5.10.4 Application detail (Parent view)](#5104-application-detail-parent-view), mirrored for the Provider.
- Hero: Job category chip + Job description first line as headline (no photo).
- Job context recap card.
- Live Offer card with status — when the Application is in `submitted` or `countered` state, the Provider can edit/withdraw their Offer here (Withdraw routes to a confirmation modal; transitions Application to `withdrawn`).
- Sticky CTA bar: tertiary "Withdraw" left + primary "Message Parent" right.

#### 5.11.5 Provider Messages
- Identical surface to [§5.5 Messaging](#55-messaging) (Inbox + Thread + Offer composer). All threads anchored to a Job ID per [`CONTEXT.md`](CONTEXT.md) § Message. Disintermediation behaves identically — flagged content goes to the Trust & Safety queue regardless of which side sent it.
- One copy difference: the disintermediation policy banner on threads reads "Parents and Providers communicate through Our Haven. Phone numbers, emails, and payment-app references are hidden to protect everyone." (Symmetric framing — the Parent-facing copy in [§5.5.2](#552-message-thread) is also fine; both sides see the same banner.)

---

## 6. Accessibility

- Minimum tap target 44×44pt. Use the icon-button 44pt baseline everywhere.
- Color contrast: WCAG AA — `ink/primary` on `bg/canvas` is 14.5:1; all `ink/secondary` use cases tested at ≥4.5:1.
- Dynamic type: respect system text scaling up to 130%. Layouts must reflow; no fixed-height rows for text content.
- Reader-friendly labels on every icon-only button. Bottom-nav items have semantic labels even though they're visually icon-only.
- Reduced motion: disable scale and translation animations when the OS setting is on. Cross-fade only.
- VoiceOver / TalkBack: every page has a single logical reading order. Headings expose heading semantics.

---

## 7. Implementation Notes (Flutter)

- Use a single `ThemeData` extension exposing the design tokens above. Tokens are accessed as `Theme.of(context).extension<OhTokens>()!.ink.primary`.
- Components live in `lib/ui/components/`; one widget per file. Each widget receives semantic props (`category`, `state`, `size`) — never raw color or radius values.
- Pages live in `lib/ui/pages/<feature>/` — feature folders mirror the [§5 page inventory](#5-pages).
- Photography uses `cached_network_image` with a cream placeholder block.
- Calendar grids use `table_calendar` configured to match Pattern A/B styling above.
- Animation curves use `Curves.fastOutSlowIn` (Flutter's match for the cubic spec in §1).

---

## 8. Open questions

- **Iconography weight final check.** Phosphor `regular` is specified; confirm against final Flutter package availability or substitute Lucide.
- **Saved Providers limit.** PRD doesn't specify a cap; UI assumes unbounded list. Confirm with product before launch.
- **Provider gender on profile.** PRD defers gender as a search filter but allows display on a Provider's profile if they self-disclose. The Provider profile detail screen ([§5.4.1](#541-provider-profile-detail)) does not currently render gender — add as an optional `body/sm` line in the About tab if/when product confirms.
- **Subscription pricing presentation.** PRD §Further Notes lists pricing as a Phase 0 client decision; the Subscription gate screen ([§5.1.11](#5111-subscription-gate--preview)) leaves the price as a token reference until confirmed.
- **Application-cap defaults (15/Job, 30/Provider/month).** Documented in [ADR-0006](docs/adr/0006-job-posting-and-negotiable-pricing.md) as v1 starting numbers re-tunable within 90 days. The UI for raising these later assumes no Parent-facing breakage — confirm cap-raise mechanics don't need a UX change before launch.
- **Pre-activation Provider Job feed treatment.** Per [§5.1.13 Provider onboarding](#5113-provider-onboarding), unverified Providers see an empty Opportunities tab. Confirm whether a "trail breadcrumb" preview of recent Jobs (titles only, no apply) would improve onboarding completion, or whether it crosses into letting unvetted Providers see PII before clearance.
- **Direct-invite-to-apply** (Parent reaches out to a saved Provider to ask them to apply to a posted Job). Deferred to Phase 2 per [ADR-0006](docs/adr/0006-job-posting-and-negotiable-pricing.md); the Saved Providers screen ([§5.3.5](#535-saved-providers-favorites)) leaves room for an "Invite to a Job" affordance when this lands.
- **Provider-side Booking detail view.** The Parent-side Booking detail ([§5.6.3](#563-booking-detail)) is fully specified; the Provider-side variant is implied by [§5.11.3.1 Today](#51131-today) and [§5.11.3.4 Active session controls](#51134-active-session-controls) but is not enumerated as its own sub-page. Decide whether to spec it explicitly in a follow-up pass or treat it as a transparent variant of the Parent surface with role-specific actions only.
