/**
 * The three flat top-level roles (ADR-0011 — "3-role flatten").
 * A user's role is permanent and set at sign-up; it cannot be changed later.
 *
 * Role string values are the contract with the backend `/v1/auth/role-claim`
 * API (see @our-haven/openapi-types).
 */
import { colors, type ColorToken } from '@/theme/tokens';
import type { IconName } from '@/components/Icon';

export const ROLES = ['parent', 'caregiver', 'provider'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Role-pick card copy + tones (from screens/role-pick.jsx). */
export const ROLE_CARDS: Record<
  Role,
  { title: string; body: string; icon: IconName; tone: ColorToken }
> = {
  parent: {
    title: "I'm a Parent",
    body: 'Find, message, and book Caregivers — and book consultations with clinical Providers — for my family.',
    icon: 'house',
    tone: 'catNanny',
  },
  caregiver: {
    title: "I'm a Caregiver",
    body: 'Babysitter, Tutor, or Nanny. Offer my services, accept Bookings, apply to Jobs, get paid same-day.',
    icon: 'person',
    tone: 'catBaby',
  },
  provider: {
    title: "I'm a Provider",
    body: 'Licensed clinician — speech, ABA, OT, psychology. List your practice and take consultation bookings. License verification required.',
    icon: 'shield',
    tone: 'catSpec',
  },
};

/**
 * Role-aware bottom-nav destinations (from primitives.jsx → BottomNav).
 * Order matters — it's the on-screen order. Each id maps to a route file
 * under app/(app)/.
 *   parent     : Home · Bookings · Messages · Account
 *   caregiver  : Home · Opportunities · Schedule · Messages · Account
 *   provider   : Schedule · Bookings · Messages · Account (consultation-centric)
 */
export type TabId = 'home' | 'opportunities' | 'schedule' | 'bookings' | 'messages' | 'account';

export const ROLE_TABS: Record<Role, { id: TabId; icon: IconName; label: string }[]> = {
  parent: [
    { id: 'home', icon: 'house', label: 'Home' },
    { id: 'bookings', icon: 'calendar', label: 'Bookings' },
    { id: 'messages', icon: 'message', label: 'Messages' },
    { id: 'account', icon: 'person', label: 'Account' },
  ],
  caregiver: [
    { id: 'home', icon: 'house', label: 'Home' },
    { id: 'opportunities', icon: 'briefcase', label: 'Opportunities' },
    { id: 'schedule', icon: 'calendar', label: 'Schedule' },
    { id: 'messages', icon: 'message', label: 'Messages' },
    { id: 'account', icon: 'person', label: 'Account' },
  ],
  provider: [
    { id: 'schedule', icon: 'calendar', label: 'Schedule' },
    { id: 'bookings', icon: 'briefcase', label: 'Bookings' },
    { id: 'messages', icon: 'message', label: 'Messages' },
    { id: 'account', icon: 'person', label: 'Account' },
  ],
};

/** The first tab a role lands on after auth (provider has no Home). */
export function landingTab(role: Role): TabId {
  return ROLE_TABS[role][0].id;
}

/** Tone used for the role pill carried into sign-up (from signup.jsx). */
export const ROLE_PILL_TONE: Record<Role, ColorToken> = {
  parent: 'catNanny',
  caregiver: 'catBaby',
  provider: 'ink', // provider pill is dark in the design
};
