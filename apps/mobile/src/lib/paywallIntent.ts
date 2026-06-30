/**
 * Paywall intent (OH-204) — what action a Parent was attempting when the
 * subscription gate fired, so the paywall can resume it on return.
 *
 * The gate fires identically on first attempt at any of the four gated actions
 * (CONTEXT § Subscription). Only the consultation resume re-attempts a real
 * backend call (OH-203); the other three return the now-entitled Parent to their
 * action screen (those backends are owned by their own tickets).
 *
 * The intent is stashed in AsyncStorage so it survives the **web full-page
 * redirect** to Stripe Checkout and back (the route params are lost across that
 * navigation — same pattern as OH-199's `pendingRole`). Native keeps it in the
 * route params too; the paywall prefers the param and falls back to the stash.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type PaywallIntent =
  | { kind: 'post-job' }
  | { kind: 'message'; id: string; name?: string }
  | { kind: 'book-request'; id: string }
  | { kind: 'book-consultation'; id: string; slotId: string };

const KEY = 'pendingPaywallIntent';

/** Serialize an intent for a route param (the paywall round-trips it via `i`). */
export function encodeIntent(intent: PaywallIntent): string {
  return JSON.stringify(intent);
}

/** Parse a route-param / stashed intent string; null when absent or malformed. */
export function parseIntent(raw: string | string[] | undefined | null): PaywallIntent | null {
  if (raw == null) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || value.length === 0) return null;
  try {
    const parsed = JSON.parse(value) as { kind?: string };
    return isPaywallIntent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPaywallIntent(value: { kind?: string }): value is PaywallIntent {
  switch (value.kind) {
    case 'post-job':
      return true;
    case 'message':
    case 'book-request':
      return typeof (value as { id?: unknown }).id === 'string';
    case 'book-consultation':
      return (
        typeof (value as { id?: unknown }).id === 'string' &&
        typeof (value as { slotId?: unknown }).slotId === 'string'
      );
    default:
      return false;
  }
}

export async function stashIntent(intent: PaywallIntent): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, encodeIntent(intent));
  } catch {
    // Best-effort: a stash failure just means no resume after a cold web return.
  }
}

export async function readIntent(): Promise<PaywallIntent | null> {
  try {
    return parseIntent(await AsyncStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export async function clearIntent(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
