/**
 * Disintermediation detector — deep module (OH-180, deepens OH-113).
 *
 * Pure-TS per ADR-0004 (no DB / Supabase / vendor imports; collaborators are
 * injected at the handler layer). Encodes the v1 redaction rules from
 * CONTEXT.md § Message + § Trust & Safety + § Offer.
 *
 * Every Message — and every Offer `scope_note` — passes through regex
 * detection for five contact-info categories:
 *   - phone          NANP-shaped numbers (10 digits, common separators / +1)
 *   - email          standard addr-spec
 *   - social_handle  @handles + "platform: handle" forms
 *   - payment_app    Venmo / Zelle / Cash App / PayPal / … names + $cashtags
 *   - address        street-address-like (number + words + street suffix)
 *
 * Detected substrings are REDACTED before delivery (replaced with
 * `REDACTION_PLACEHOLDER`); the unredacted original + match metadata are
 * queued for the Trust & Safety flagged-thread queue (CONTEXT.md § Trust &
 * Safety). `flagged` is the queue signal.
 *
 * ── Structured-field bypass (CONTEXT.md § Offer) ───────────────────────────
 *   The detector runs ONLY on free text — Message bodies and the Offer's
 *   free-text `scope_note`. An Offer's structured numeric fields
 *   (`proposed_rate`, `computed_total`, `scope_quantity`, child counts/ages,
 *   etc.) bypass it entirely. `scanOffer` encodes that contract: it scans the
 *   note and never looks at the numerics.
 *
 * ── False-positive curation (CONTEXT.md § Message) ─────────────────────────
 *   v1 weighs precision over recall — a redaction marker mid-sentence is more
 *   harmful to a legitimate conversation than an occasional missed evasion.
 *   The patterns are tuned to NOT trip on the things childcare chat is full of:
 *   hourly rates ($35/hr), child counts/ages ("2 kids aged 3 and 7"), clock
 *   times ("3–5 PM"), and years (2026). Known gaps left for a later iteration:
 *   7-digit local numbers, spelled-out obfuscation ("jane at gmail dot com"),
 *   and bare ZIP codes (too price/count-collision-prone to flag in v1).
 *
 * Pure + deterministic: identical input always yields identical output. No I/O,
 * no clock.
 */

export const DISINTERMEDIATION_CATEGORIES = [
  'phone',
  'email',
  'social_handle',
  'payment_app',
  'address',
] as const;
export type DisintermediationCategory = (typeof DISINTERMEDIATION_CATEGORIES)[number];

/** A single detected substring + where it sat in the source text. */
export interface DetectionMatch {
  category: DisintermediationCategory;
  /** The original (unredacted) matched substring — for the T&S queue. */
  value: string;
  /** Inclusive start index into the source text. */
  start: number;
  /** Exclusive end index into the source text. */
  end: number;
}

export interface DetectionResult {
  /**
   * True iff at least one pattern tripped — the signal the handler uses to push
   * the thread onto the Trust & Safety flagged-thread queue.
   */
  flagged: boolean;
  /** Delivery-safe text: every detected span replaced by `REDACTION_PLACEHOLDER`. */
  redacted: string;
  /** Every match in source order (unredacted values) for the T&S queue. */
  matches: readonly DetectionMatch[];
  /** Distinct categories present, in canonical (`DISINTERMEDIATION_CATEGORIES`) order. */
  categories: readonly DisintermediationCategory[];
}

/** What a detected substring is replaced with before delivery. */
export const REDACTION_PLACEHOLDER = '[redacted]';

// ──────────────────────────────────────────────────────────────────────────
// Patterns (curated — see the module doc-comment on precision-over-recall)
// ──────────────────────────────────────────────────────────────────────────

/**
 * NANP phone: optional `+1`, a 3-digit area code (optionally parenthesised),
 * then 3 + 4 digits, with optional ` `, `.`, or `-` separators. The
 * lookbehind/lookahead reject digits on either side so the 10-digit shape is
 * not plucked out of a longer numeric run (IDs, etc.). Requiring the full
 * 10-digit shape is what keeps rates / counts / times / years from tripping it.
 */
const PHONE_RE =
  /(?<!\d)(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;

/** Standard email addr-spec. Detected before social handles so an email's `@`
 *  is never re-counted as a handle. */
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * `@handle` — `@` not preceded by a word char / `@` / `.` (so an email's `@` is
 * excluded), first handle char a letter or `_` (so `@2026` and `$`-amounts do
 * not trip), 2–30 chars total.
 */
const HANDLE_AT_RE = /(?<![\w@.])@[A-Za-z_][A-Za-z0-9._]{1,29}/g;

/**
 * "platform: handle" / "platform = handle" — a known social platform keyword
 * followed by a `:` or `=` and a handle token. Requires the separator, so
 * incidental prose ("snapchat is fun") does not trip; the `@handle` form above
 * already covers "insta @jane".
 */
const HANDLE_PLATFORM_RE =
  /\b(?:instagram|insta|ig|snapchat|snap|telegram|whatsapp|tiktok|facebook|fb|messenger|kik|discord|signal)\b\s*[:=]\s*@?[A-Za-z0-9._]{2,30}/gi;

/** Payment-app brand names. */
const PAYMENT_NAME_RE =
  /\b(?:venmo|zelle|cash\s?app|cashapp|paypal|apple\s?pay|google\s?pay|samsung\s?pay|wise|revolut|chime)\b/gi;

/**
 * Cash App `$cashtag` — `$` + a letter-first token. The letter-first rule is
 * what distinguishes a cashtag (`$JaneDoe`) from a money amount (`$35`), which
 * must NOT be redacted.
 */
const CASHTAG_RE = /(?<![\w$])\$[A-Za-z][A-Za-z0-9_]{1,29}\b/g;

/**
 * Street-address-like: a 1–6 digit house number, up to 5 intervening words,
 * then a street-type suffix. The required suffix is what keeps "3 kids" /
 * "5 PM" / "$35/hr" from tripping it.
 */
const ADDRESS_RE =
  /\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){0,5}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Place|Pl|Way|Terrace|Ter|Circle|Cir|Highway|Hwy|Parkway|Pkwy|Square|Sq|Trail|Trl|Loop|Court|Crescent|Cres)\b\.?/gi;

interface CategoryPattern {
  category: DisintermediationCategory;
  re: RegExp;
}

/**
 * Detection order is canonical-category order; within `social_handle` and
 * `payment_app` both sub-patterns run. Email runs before the handle patterns so
 * an email never double-reports as a handle.
 */
const PATTERNS: readonly CategoryPattern[] = [
  { category: 'email', re: EMAIL_RE },
  { category: 'phone', re: PHONE_RE },
  { category: 'social_handle', re: HANDLE_AT_RE },
  { category: 'social_handle', re: HANDLE_PLATFORM_RE },
  { category: 'payment_app', re: PAYMENT_NAME_RE },
  { category: 'payment_app', re: CASHTAG_RE },
  { category: 'address', re: ADDRESS_RE },
];

// ──────────────────────────────────────────────────────────────────────────
// Detection
// ──────────────────────────────────────────────────────────────────────────

function collectMatches(text: string): DetectionMatch[] {
  const raw: DetectionMatch[] = [];
  for (const { category, re } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      // matchAll always yields the full match at [0] with a defined index; the
      // `?? ` fallbacks only satisfy noUncheckedIndexedAccess.
      const value = m[0] ?? '';
      const start = m.index ?? 0;
      raw.push({ category, value, start, end: start + value.length });
    }
  }
  // Drop a social-handle match that sits wholly inside an email span (defensive
  // — the lookbehind already excludes an email's own `@`).
  const emails = raw.filter((r) => r.category === 'email');
  const kept = raw.filter(
    (r) =>
      r.category !== 'social_handle' ||
      !emails.some((e) => r.start >= e.start && r.end <= e.end),
  );
  // Source order, stable on ties by category precedence in PATTERNS.
  kept.sort((a, b) => a.start - b.start || a.end - b.end);
  return kept;
}

/** Merge overlapping/touching spans so one redaction marker covers a run. */
function mergeSpans(matches: readonly DetectionMatch[]): Array<{ start: number; end: number }> {
  const spans = matches
    .map((m) => ({ start: m.start, end: m.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) {
      last.end = Math.max(last.end, s.end);
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

function redactSpans(text: string, spans: Array<{ start: number; end: number }>): string {
  if (spans.length === 0) return text;
  let out = '';
  let cursor = 0;
  for (const s of spans) {
    out += text.slice(cursor, s.start) + REDACTION_PLACEHOLDER;
    cursor = s.end;
  }
  out += text.slice(cursor);
  return out;
}

function distinctCategories(
  matches: readonly DetectionMatch[],
): DisintermediationCategory[] {
  const present = new Set(matches.map((m) => m.category));
  return DISINTERMEDIATION_CATEGORIES.filter((c) => present.has(c));
}

/**
 * Redact to a FIXED POINT (the delivery-safety invariant
 * `detect(detect(x).redacted).flagged === false`). A single detection pass can
 * miss the SECOND of two ADJACENT contact tokens: the lookbehind that stops a
 * pattern matching mid-word (e.g. `(?<![\w$])` on a `$cashtag`, `(?<![\w@.])` on
 * an `@handle`) is tripped by the first token's trailing char, so `"$A0$A0"`
 * detects only the first `$A0`. Redacting it then exposes the second to a
 * re-scan. Re-detecting + re-redacting until nothing trips guarantees the
 * delivered text is clean.
 *
 * Convergence: every pass replaces ≥1 real token run with the inert placeholder
 * (which matches nothing) and can only uncover finitely many previously-hidden
 * adjacent tokens, so the loop terminates; `cap` is a defensive backstop for
 * adversarial input (the common case redacts in a single pass).
 */
function redactToFixedPoint(text: string, firstMatches: readonly DetectionMatch[]): string {
  let out = redactSpans(text, mergeSpans(firstMatches));
  if (firstMatches.length === 0) return out;
  const cap = Math.max(1, text.length);
  for (let pass = 1; pass < cap; pass++) {
    const more = collectMatches(out);
    if (more.length === 0) break;
    out = redactSpans(out, mergeSpans(more));
  }
  return out;
}

/**
 * Scan free text for contact-info disclosure. Returns the redacted delivery
 * text plus the unredacted match metadata for the Trust & Safety queue.
 *
 * `matches` are the FIRST-pass detections on the original text (spans index into
 * `text`); `redacted` is iterated to a fixed point so the delivered text is
 * always clean, even when adjacent tokens hid one another (redactToFixedPoint).
 */
export function detect(text: string): DetectionResult {
  const matches = collectMatches(text);
  return {
    flagged: matches.length > 0,
    redacted: redactToFixedPoint(text, matches),
    matches,
    categories: distinctCategories(matches),
  };
}

/** A chat Message body passes through the detector (CONTEXT.md § Message). */
export function scanMessage(body: string): DetectionResult {
  return detect(body);
}

/** An Offer's free-text `scope_note` passes through the detector. */
export function scanScopeNote(scopeNote: string): DetectionResult {
  return detect(scopeNote);
}

/**
 * Scan an Offer. ONLY the free-text `scope_note` is examined; the structured
 * numeric fields bypass the detector entirely (CONTEXT.md § Offer). The
 * parameter shape takes the numerics deliberately to document that they are
 * received and intentionally ignored — they are never passed to `detect`.
 */
export function scanOffer(offer: {
  scopeNote: string;
  // Structured fields — present on the Offer, never scanned. Listed so the
  // bypass is explicit at the call site.
  proposedRate?: number;
  computedTotal?: number;
  scopeQuantity?: number;
}): DetectionResult {
  return detect(offer.scopeNote);
}

export const DISINTERMEDIATION_MODULE_VERSION = '0.2.1-OH-180';
