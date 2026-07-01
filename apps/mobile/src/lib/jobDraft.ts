/**
 * Post-a-Job draft autosave (OH-209) — a single AsyncStorage-stashed snapshot of
 * the composer's editor state so a half-composed Job survives leaving the screen,
 * a cold restart, and (crucially) the **web full-page redirect** to Stripe
 * Checkout when the publish paywall fires and returns (same shape as the OH-204
 * `paywallIntent` stash). The draft is client-side only — a `jobs` row is created
 * solely on publish (CONTEXT § Job draft), so nothing is persisted server-side.
 *
 * The disclosure consent is deliberately NOT stashed: consent is a fresh,
 * intentional act at publish time and must be re-acknowledged, never resumed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { JobComposeState } from '@/lib/postJob';

export interface JobDraft extends JobComposeState {
  savedAt: string;
}

const KEY = 'pendingJobDraft';

/** True when the draft holds enough to be worth resuming (any real input). */
export function draftHasContent(s: JobComposeState): boolean {
  return (
    s.description.trim() !== '' ||
    s.slots.some((sl) => sl.date || sl.start || sl.end) ||
    s.postal.trim() !== '' ||
    s.disclosed.length > 0 ||
    s.recurrence.weekdays.length > 0
  );
}

export async function saveJobDraft(state: JobComposeState): Promise<void> {
  try {
    if (!draftHasContent(state)) {
      await AsyncStorage.removeItem(KEY);
      return;
    }
    const draft: JobDraft = { ...state, savedAt: new Date().toISOString() };
    await AsyncStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Best-effort: a stash failure just means no resume after a cold return.
  }
}

export async function readJobDraft(): Promise<JobDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as JobDraft;
    // Minimal shape guard — a malformed/legacy stash resolves to null.
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.slots)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearJobDraft(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
