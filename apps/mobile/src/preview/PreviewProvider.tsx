/**
 * PreviewProvider — the ephemeral home of the Parent preview-questionnaire
 * answers (PRD-0001 story 111, ADR-0012).
 *
 * EPHEMERAL BY CONSTRUCTION. The answers live in React state for the duration of
 * the app session and nowhere else:
 *   - never written to AsyncStorage / localStorage (no survival across launches),
 *   - never sent to the backend (there is no persisted neurodivergence field),
 *   - cleared the moment the session goes anon (sign-out), so the next account on
 *     the device starts from a blank slate.
 * This is the whole point of the feature: the answers shape the first browse and
 * then evaporate. The store is consumed by ParentHome / Search to order the
 * browse and pre-activate filter chips.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useAuth } from '@/auth/AuthProvider';
import type { PreviewAnswers } from '@/preview/questionnaire';

interface PreviewContextValue {
  /** The shaping inputs, or null when the survey was skipped / not taken. */
  answers: PreviewAnswers | null;
  /** Whether the questionnaire has been answered or skipped this session. */
  completed: boolean;
  /** Finish the survey with answers (null = skipped → no shaping). */
  commit: (answers: PreviewAnswers | null) => void;
  /** Drop the answers (used for sign-out cleanup). */
  clear: () => void;
}

const PreviewContext = createContext<PreviewContextValue | null>(null);

export function PreviewProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [answers, setAnswers] = useState<PreviewAnswers | null>(null);
  const [completed, setCompleted] = useState(false);

  const commit = useCallback((next: PreviewAnswers | null) => {
    setAnswers(next);
    setCompleted(true);
  }, []);

  const clear = useCallback(() => {
    setAnswers(null);
    setCompleted(false);
  }, []);

  // When the session ends (sign-out → anon), wipe the answers so they can't leak
  // into whatever account signs in next. Guarded so it only fires on the
  // authed→anon edge, not on every render while anon.
  const wasAuthed = useRef(false);
  useEffect(() => {
    if (status === 'authed') wasAuthed.current = true;
    if (status === 'anon' && wasAuthed.current) {
      wasAuthed.current = false;
      clear();
    }
  }, [status, clear]);

  const value = useMemo<PreviewContextValue>(
    () => ({ answers, completed, commit, clear }),
    [answers, completed, commit, clear],
  );

  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

export function usePreview(): PreviewContextValue {
  const ctx = useContext(PreviewContext);
  if (!ctx) throw new Error('usePreview must be used within a PreviewProvider');
  return ctx;
}
