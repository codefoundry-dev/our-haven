export type Role = 'parent' | 'caregiver' | 'provider' | 'admin';

/**
 * The three sign-up-selectable roles (ADR-0011 — flat `{parent, caregiver,
 * provider}`). `admin` is internal-only (Trust & Safety), provisioned
 * out-of-band, and is never self-assignable via the role-claim endpoint.
 */
export const SIGNUP_ROLES = ['parent', 'caregiver', 'provider'] as const;
export type SignupRole = (typeof SIGNUP_ROLES)[number];

const ROLES: ReadonlySet<Role> = new Set(['parent', 'caregiver', 'provider', 'admin']);

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && ROLES.has(value as Role);
}
