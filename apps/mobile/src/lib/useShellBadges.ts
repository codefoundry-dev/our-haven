/**
 * useShellBadges — per-tab bottom-nav badge counts for the current role
 * (PRD-0001 story 81: "badges for new Jobs in the feed and items awaiting action").
 *
 * The real counts — unfilled Jobs since the last visit, Applications/Offers
 * awaiting the Caregiver's response, unread threads — come from endpoints that
 * aren't wired to the native client yet: there's no GET /v1/jobs list route, and
 * Messaging has no unread state (Inbox.tsx notes the mock's unread badges were
 * placeholders). Until those land, this returns a small placeholder set matching
 * the design mock (screens/provider-opps.jsx: schedule + messages) so the shell's
 * badge *mechanism* is real and in place; swap the constant for live counts when
 * the feed / awaiting-action endpoints exist. Flagged, not blocked (Phase-0 posture).
 *
 * Badges are suppressed until the supply user is activated — a Caregiver who can't
 * yet see Jobs (pre-activation empty state) has nothing to be badged about.
 */
import { useAuth } from '@/auth/AuthProvider';
import { useSupplyActivation } from '@/lib/SupplyActivationProvider';
import type { TabId } from '@/lib/roles';

export type ShellBadges = Partial<Record<TabId, number>>;

/** Placeholder counts pending real endpoints — see the file header. */
const CAREGIVER_PLACEHOLDER: ShellBadges = { schedule: 2, messages: 3 };

export function useShellBadges(): ShellBadges {
  const { role } = useAuth();
  const { activated, loading } = useSupplyActivation();

  if (role !== 'caregiver' || loading || !activated) return {};
  return CAREGIVER_PLACEHOLDER;
}
