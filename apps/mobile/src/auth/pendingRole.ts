/**
 * Pending role stash for OAuth sign-up (OH-199).
 *
 * The password sign-up writes the chosen role into `user_metadata.intended_role`
 * (see AuthProvider.signUp), which the role-claim screen reads back. OAuth can't
 * do that — no user exists until the provider returns — so we stash the choice
 * here before leaving for the provider and read it as a fallback on role-claim.
 *
 * Backed by AsyncStorage, which survives both the web full-page OAuth redirect
 * (localStorage under the hood) and the native browser round-trip. It is cleared
 * once a Parent claims their role, and otherwise overwritten on the next
 * sign-in / sign-up attempt, so a stale value never misroutes a later user.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { isRole, type Role } from '@/lib/roles';

const KEY = 'oh.oauth.pending_role';

/** Stash the sign-up role choice (or clear it when signing in, where role is unknown). */
export async function setPendingRole(role: Role | null): Promise<void> {
  try {
    if (role) await AsyncStorage.setItem(KEY, role);
    else await AsyncStorage.removeItem(KEY);
  } catch {
    // Best-effort: a stash miss just falls back to the role picker on role-claim.
  }
}

/** Read the stashed role, if any. */
export async function getPendingRole(): Promise<Role | null> {
  try {
    const value = await AsyncStorage.getItem(KEY);
    return isRole(value) ? value : null;
  } catch {
    return null;
  }
}

/** Drop the stash once it has been consumed (a Parent has claimed their role). */
export async function clearPendingRole(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore — overwritten on the next attempt regardless.
  }
}
