/**
 * Preview questionnaire — option taxonomy + the pure browse-shaping derivation
 * (PRD-0001 story 111, ADR-0012).
 *
 * The questionnaire is a brief, multi-choice survey shown ONCE during Parent
 * sign-up (age band · neurotypical/neurodivergent · optional focus areas). Its
 * sole purpose is to shape the FIRST browse session — which categories lead and
 * which filter chips light up. Answers are **ephemeral**: held in memory for the
 * session only (see PreviewProvider), never written to the Parent profile or any
 * server-side store. There is no persisted neurodivergence/diagnosis field
 * anywhere (ADR-0012); these chips feed the on-device browse heuristic, full stop.
 *
 * Keeping the derivation here as a dependency-free pure function means "answers X
 * → browse shape Y" is verifiable without rendering anything.
 */
import type { Category } from '@/components/ui/CategoryChip';

// ── Step 1 · child's age band ────────────────────────────────────────────────
export type AgeBand = '0-2' | '3-5' | '6-9' | '10-12' | '13-17' | 'mixed';

export const AGE_BANDS: { id: AgeBand; label: string; wide?: boolean }[] = [
  { id: '0-2', label: '0–2 years' },
  { id: '3-5', label: '3–5 years' },
  { id: '6-9', label: '6–9 years' },
  { id: '10-12', label: '10–12 years' },
  { id: '13-17', label: '13–17 years' },
  { id: 'mixed', label: 'Multiple children, mixed ages', wide: true },
];

// ── Step 2 · neurotypical / neurodivergent ───────────────────────────────────
export type PreviewProfile = 'neurotypical' | 'neurodivergent' | 'unsure';

export const PROFILE_TILES: { id: PreviewProfile; title: string; sub: string }[] = [
  { id: 'neurotypical', title: 'Neurotypical', sub: 'No diagnosed developmental differences.' },
  {
    id: 'neurodivergent',
    title: 'Neurodivergent',
    sub: 'Diagnosed autism, ADHD, learning differences, or similar.',
  },
  { id: 'unsure', title: "I'm not sure yet", sub: "We'll show a balanced mix." },
];

// ── Step 3 · focus areas (optional, multi-select) ────────────────────────────
export type FocusArea =
  | 'autism'
  | 'adhd'
  | 'speech'
  | 'ot'
  | 'learning'
  | 'anxiety'
  | 'afterschool'
  | 'tutoring'
  | 'other';

export const FOCUS_AREAS: { id: FocusArea; label: string }[] = [
  { id: 'autism', label: 'Autism' },
  { id: 'adhd', label: 'ADHD' },
  { id: 'speech', label: 'Speech & language' },
  { id: 'ot', label: 'Occupational therapy' },
  { id: 'learning', label: 'Learning differences' },
  { id: 'anxiety', label: 'Anxiety / behaviour' },
  { id: 'afterschool', label: 'After-school care' },
  { id: 'tutoring', label: 'Academic tutoring' },
  { id: 'other', label: 'Other' },
];

/** The answers captured by the survey. A null field = "left unanswered". */
export interface PreviewAnswers {
  age: AgeBand | null;
  profile: PreviewProfile | null;
  focus: FocusArea[];
}

export const EMPTY_ANSWERS: PreviewAnswers = { age: null, profile: null, focus: [] };

/**
 * Which supply categories a focus area points at. Clinical concerns route to the
 * Provider (clinical) tier; academic/care concerns to the Caregiver categories.
 */
const FOCUS_TO_CATEGORIES: Record<FocusArea, Category[]> = {
  autism: ['Provider'],
  adhd: ['Provider', 'Tutor'],
  speech: ['Provider'],
  ot: ['Provider'],
  learning: ['Provider', 'Tutor'],
  anxiety: ['Provider'],
  afterschool: ['Nanny', 'Babysitter'],
  tutoring: ['Tutor'],
  other: [],
};

/** The four browseable categories, in their default (no-preference) order. */
const DEFAULT_CATEGORY_ORDER: Category[] = ['Babysitter', 'Tutor', 'Nanny', 'Provider'];

export interface BrowseShape {
  /** Categories re-ordered so the most relevant lead. Always all four. */
  categories: Category[];
  /** Filter-chip labels to pre-activate on the first search. */
  chips: string[];
  /** True when any answer actually moved the needle (vs. an empty/skip survey). */
  shaped: boolean;
}

/**
 * Derive the first-browse shape from the (ephemeral) answers. Pure + total:
 * an all-null answer set returns the default order with nothing pre-activated.
 *
 * Heuristic, in priority order:
 *  - focus areas weight categories (clinical concerns → Provider leads);
 *  - a neurodivergent profile nudges Provider up even without a focus area;
 *  - a neurotypical profile keeps the everyday-care order;
 *  - 'unsure' / no profile stays balanced (default order).
 */
export function shapeBrowse(answers: PreviewAnswers | null): BrowseShape {
  if (!answers) return { categories: DEFAULT_CATEGORY_ORDER, chips: [], shaped: false };

  const weight: Record<Category, number> = {
    Babysitter: 0,
    Tutor: 0,
    Nanny: 0,
    Provider: 0,
    Specialist: 0,
  };

  for (const f of answers.focus) {
    // Earlier-listed categories for a focus area weigh slightly more.
    FOCUS_TO_CATEGORIES[f].forEach((cat, i) => {
      weight[cat] += 2 - i * 0.5;
    });
  }

  if (answers.profile === 'neurodivergent') weight.Provider += 1.5;
  if (answers.profile === 'neurotypical') {
    weight.Babysitter += 0.5;
    weight.Nanny += 0.5;
  }

  const shaped =
    answers.focus.length > 0 || answers.profile === 'neurodivergent' || answers.profile === 'neurotypical';

  // Stable sort: by descending weight, falling back to the default order so the
  // result is deterministic when weights tie (important for snapshot/sanity).
  const categories = [...DEFAULT_CATEGORY_ORDER].sort((a, b) => {
    if (weight[b] !== weight[a]) return weight[b] - weight[a];
    return DEFAULT_CATEGORY_ORDER.indexOf(a) - DEFAULT_CATEGORY_ORDER.indexOf(b);
  });

  // The leading category becomes a pre-activated filter chip; a neurodivergent
  // family also gets the "Top-rated" nudge (most likely to want vetted supply).
  const chips: string[] = [];
  if (shaped) chips.push(categories[0]);
  if (answers.profile === 'neurodivergent' && !chips.includes('Top-rated')) chips.push('Top-rated');

  return { categories, chips, shaped };
}

/** A short human summary of the answers, for the "personalised" banner. */
export function summarizeAnswers(answers: PreviewAnswers | null): string | null {
  if (!answers) return null;
  const parts: string[] = [];
  const age = AGE_BANDS.find((a) => a.id === answers.age);
  if (age) parts.push(age.id === 'mixed' ? 'mixed ages' : age.label.replace(' years', ' yrs'));
  if (answers.profile === 'neurodivergent') parts.push('neurodivergent');
  if (answers.profile === 'neurotypical') parts.push('neurotypical');
  if (answers.focus.length) {
    const first = FOCUS_AREAS.find((f) => f.id === answers.focus[0])?.label.toLowerCase();
    if (first) parts.push(answers.focus.length > 1 ? `${first} +${answers.focus.length - 1}` : first);
  }
  return parts.length ? parts.join(' · ') : null;
}
