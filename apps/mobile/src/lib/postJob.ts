/**
 * Post-a-Job compose helpers (OH-209) — the pure logic shared by the native
 * composer (`screens/parent/PostJob`) and the desktop-web wizard
 * (`screens/web/parent/PostJob`): clock/date parsing, the anchored-recurrence
 * occurrence preview (mirrors the domain `expandRecurrence`, ADR-0014 §4), and
 * assembling the `CreateJobBody` from the raw editor state.
 *
 * Kept UI-free (no RN imports) so both surfaces build the same request and show
 * the same occurrence preview. The client validates for UX; the Edge + domain
 * (`job-compose`) are the source of truth.
 */
import type { CreateJobBody } from '@/api/client';

export type JobCategory = 'babysitter' | 'tutor' | 'nanny';
export type ScheduleMode = 'one-off' | 'recurring';

/** A raw, hand-picked date + clock window as the user typed it (pre-parse). */
export interface SlotDraft {
  date: string; // YYYY-MM-DD
  start: string; // '6:00 PM'
  end: string; // '9:00 PM'
}

/** Raw recurring-rule editor state (weekdays 0=Sun..6=Sat). */
export interface RecurrenceDraft {
  startDate: string;
  endDate: string;
  weekdays: number[];
  start: string;
  end: string;
}

export const WEEKDAYS: { value: number; short: string }[] = [
  { value: 0, short: 'Sun' },
  { value: 1, short: 'Mon' },
  { value: 2, short: 'Tue' },
  { value: 3, short: 'Wed' },
  { value: 4, short: 'Thu' },
  { value: 5, short: 'Fri' },
  { value: 6, short: 'Sat' },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** `'6:00 PM'` → minutes-from-midnight, or null if unparseable. */
export function parseClock(input: string): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])\s*$/.exec(input);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const pm = m[3]!.toLowerCase() === 'pm';
  if (h < 1 || h > 12 || min < 0 || min > 59) return null;
  if (h === 12) h = 0;
  if (pm) h += 12;
  return h * 60 + min;
}

/** minutes-from-midnight → `'6:00 PM'` (for occurrence-preview display). */
export function formatMin(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function validDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const [y, mo, da] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, mo! - 1, da!));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo! - 1 && dt.getUTCDate() === da;
}

/**
 * Expand an anchored weekly rule into the concrete occurrence dates it generates
 * — the compose preview (ADR-0014 §4). Mirrors the domain `expandRecurrence`
 * (UTC-based, deterministic); returns [] when the rule is incomplete/invalid.
 */
export function expandOccurrences(rule: RecurrenceDraft): string[] {
  if (!validDate(rule.startDate) || !validDate(rule.endDate)) return [];
  if (rule.weekdays.length === 0) return [];
  const start = Date.parse(`${rule.startDate}T00:00:00Z`);
  const end = Date.parse(`${rule.endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];
  const wanted = new Set(rule.weekdays);
  const out: string[] = [];
  for (let ms = start; ms <= end; ms += DAY_MS) {
    if (wanted.has(new Date(ms).getUTCDay())) out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}

/** Parsed slots for a set of hand-picked dates, or null if any is invalid. */
export function parseSlots(slots: SlotDraft[]): { date: string; startMin: number; endMin: number }[] | null {
  if (slots.length === 0) return null;
  const out: { date: string; startMin: number; endMin: number }[] = [];
  for (const s of slots) {
    const a = parseClock(s.start);
    const b = parseClock(s.end);
    if (!validDate(s.date) || a == null || b == null || b <= a) return null;
    out.push({ date: s.date, startMin: a, endMin: b });
  }
  return out;
}

export interface JobComposeState {
  category: JobCategory;
  mode: ScheduleMode;
  description: string;
  slots: SlotDraft[];
  recurrence: RecurrenceDraft;
  childCount: number;
  childAges: string[];
  disclosed: string[];
  discloseNone: boolean;
  line1: string;
  line2: string;
  city: string;
  stateCode: string;
  postal: string;
  budget: string; // dollars/hour hint (optional)
}

export type BuildJobResult =
  | { ok: true; body: CreateJobBody }
  | { ok: false; reason: string };

/**
 * Assemble the `CreateJobBody` from the editor state (given the acknowledged
 * disclosure consent). Returns a reason on the first invalid field — the same
 * order the composer surfaces per-step errors.
 */
export function buildJobBody(s: JobComposeState, disclosureConsent: boolean): BuildJobResult {
  if (s.description.trim().length === 0) return { ok: false, reason: 'Add a short description of what you need.' };
  if (!/^\d{5}$/.test(s.postal.trim())) return { ok: false, reason: 'Enter a 5-digit ZIP.' };
  if (s.stateCode.trim() !== '' && !/^[A-Z]{2}$/.test(s.stateCode.trim())) {
    return { ok: false, reason: 'State must be a 2-letter code.' };
  }
  const ageStrings = s.childAges.slice(0, s.childCount);
  if (ageStrings.length !== s.childCount || !ageStrings.every((a) => /^\d{1,2}$/.test(a) && Number(a) <= 17)) {
    return { ok: false, reason: 'Enter an age (0–17) for each child.' };
  }
  if (s.category === 'tutor' && s.childCount !== 1) return { ok: false, reason: 'Tutoring is one child per Job.' };
  if (!s.discloseNone && s.disclosed.length === 0) {
    return { ok: false, reason: 'Choose which safety behaviours to disclose, or “Share none”.' };
  }
  if (!disclosureConsent) return { ok: false, reason: 'Acknowledge the disclosure consent to publish.' };

  let schedule: CreateJobBody['schedule'];
  if (s.mode === 'recurring') {
    const startMin = parseClock(s.recurrence.start);
    const endMin = parseClock(s.recurrence.end);
    if (!validDate(s.recurrence.startDate) || !validDate(s.recurrence.endDate)) {
      return { ok: false, reason: 'Enter a valid start and end date.' };
    }
    if (s.recurrence.weekdays.length === 0) return { ok: false, reason: 'Pick at least one weekday.' };
    if (startMin == null || endMin == null || endMin <= startMin) {
      return { ok: false, reason: 'Enter a start and end time (e.g. 3:30 PM).' };
    }
    if (expandOccurrences(s.recurrence).length === 0) {
      return { ok: false, reason: 'This pattern generates no dates in its range.' };
    }
    schedule = {
      kind: 'recurring',
      rule: {
        startDate: s.recurrence.startDate,
        endDate: s.recurrence.endDate,
        weekdays: [...s.recurrence.weekdays].sort((a, b) => a - b),
        startMin,
        endMin,
      },
    };
  } else {
    const parsed = parseSlots(s.slots);
    if (!parsed) return { ok: false, reason: 'Each date needs a valid date and start-before-end time.' };
    schedule = parsed.length === 1 ? { kind: 'one-off', slot: parsed[0]! } : { kind: 'multi-day', slots: parsed };
  }

  const budgetHintCents = s.budget.trim() === '' ? null : Math.round(Number(s.budget) * 100);
  return {
    ok: true,
    body: {
      category: s.category,
      description: s.description.trim(),
      childCount: s.childCount,
      childAges: ageStrings.map((a) => Number(a)),
      safetyBehaviors: (s.discloseNone ? [] : s.disclosed) as CreateJobBody['safetyBehaviors'],
      serviceAddress: {
        line1: s.line1.trim() || null,
        line2: s.line2.trim() || null,
        city: s.city.trim() || null,
        state: s.stateCode.trim() || null,
        postalCode: s.postal.trim(),
      },
      budgetHintCents: budgetHintCents != null && budgetHintCents >= 0 ? budgetHintCents : null,
      disclosureConsent: true,
      schedule,
    },
  };
}
