/**
 * Role-claim view resolution (OH-183) — the pure decision the role-claim screen
 * renders for the current auth state. The role is INFERRED FROM AUTH: it's the
 * role chosen at sign-up, carried in user_metadata.intended_role.
 *
 * Kept as a dependency-free pure function (type-only Role import) so the routing
 * decision that previously broke — a signed-in Caregiver landing on the role
 * picker instead of onboarding — is trivially verifiable without a renderer.
 *
 *   onboarding   — Caregiver/Provider → SupplyOnboarding (collect categories + state)
 *   claim-parent — Parent has no extra data → claim directly
 *   loading      — session not resolved yet; never flash the picker
 *   pick         — authed but no intended role at all (legacy account) → cards
 */
import type { Role } from '@/lib/roles';

export type RoleClaimView =
  | { kind: 'loading' }
  | { kind: 'onboarding'; role: 'caregiver' | 'provider' }
  | { kind: 'claim-parent' }
  | { kind: 'pick' };

export function resolveRoleClaimView(args: {
  status: 'loading' | 'authed' | 'anon';
  /** isRole(session?.user?.user_metadata?.intended_role) — the sign-up choice. */
  intended: Role | null;
  /** A legacy account's manual pick from the cards; otherwise null. */
  override: Role | null;
}): RoleClaimView {
  const picked = args.override ?? args.intended;
  if (picked === 'caregiver' || picked === 'provider') return { kind: 'onboarding', role: picked };
  if (picked === 'parent') return { kind: 'claim-parent' };
  // No role known yet — wait for the session to resolve before offering the
  // manual picker, so a user who already has a role never sees the cards.
  if (args.status !== 'authed') return { kind: 'loading' };
  return { kind: 'pick' };
}
