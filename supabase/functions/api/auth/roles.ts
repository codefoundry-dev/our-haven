// Ported verbatim from apps/backend/src/auth/roles.ts — the 3 flat roles
// (ADR-0011) and provider kinds. Pure, dependency-free; re-authored here with
// explicit-.ts hygiene so the Edge tree is self-contained on Deno.
export type Role = 'parent' | 'provider' | 'admin';
export type ProviderKind = 'caregiver' | 'specialist';

const ROLES: ReadonlySet<Role> = new Set(['parent', 'provider', 'admin']);
const PROVIDER_KINDS: ReadonlySet<ProviderKind> = new Set(['caregiver', 'specialist']);

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && ROLES.has(value as Role);
}

export function isProviderKind(value: unknown): value is ProviderKind {
  return typeof value === 'string' && PROVIDER_KINDS.has(value as ProviderKind);
}
