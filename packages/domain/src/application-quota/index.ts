/**
 * Application-quota tracker (OH-113).
 *
 * Pure-TS deep module per ADR-0004. Encodes the per-Provider monthly
 * Application cap from CONTEXT.md § Application + ADR-0006 § Decision 7.
 *
 *   v1 default: 30 Applications / Provider / calendar month, reset on the
 *   1st of the month (UTC for storage, displayed to the Provider in their
 *   local timezone by the UI layer — not this module's concern).
 *
 * The tracker is pure logic over a thin counter storage shape; the handler
 * layer owns the actual row in Supabase. The pure module decides:
 *   - whether the Provider may file another Application now,
 *   - what the post-increment counter shape looks like,
 *   - whether a stored counter has aged into a new month and must be reset,
 *   - whether an admin override raises a Provider's effective cap.
 *
 * Pure + deterministic. No I/O.
 */

/**
 * Default cap per Provider per calendar month (ADR-0006 §7). Documented as
 * a v1 starting number; re-tunable based on observed usage.
 */
export const DEFAULT_MONTHLY_APPLICATION_CAP = 30;

/**
 * Per-Provider counter shape. Stored as-is by the handler in the Provider
 * row (or a sidecar table — schema decision is outside this module).
 *
 *   `count`              — Applications filed in the current period.
 *   `periodYearMonth`    — YYYY-MM tag for the period the count applies to.
 *                          When `now` falls outside this period, the count
 *                          is stale and must be reset to 0 with the period
 *                          advanced.
 *   `adminOverrideCap`   — If present, raises the effective cap above the
 *                          default for this Provider this period. Cleared
 *                          on monthly reset. ADR-0006 §7 "admin override
 *                          path".
 */
export interface ProviderApplicationCounter {
  count: number;
  periodYearMonth: string;
  adminOverrideCap: number | null;
}

/**
 * Result of a quota check.
 *
 *   `allowed: true`  — the Provider may file another Application; the
 *                      handler should `applyFile()` the counter and persist
 *                      it.
 *   `allowed: false` — the cap is reached (or the override-cap is reached
 *                      if one is set). The reason names which cap was hit.
 *
 * The check is *not* a side effect — the counter is unchanged until the
 * handler calls `applyFile()` separately. This split lets the handler
 * gate UI display ("you have 4 applications left this month") on the same
 * primitive that gates filing.
 */
export type QuotaCheckResult =
  | { allowed: true; effectiveCap: number; remaining: number }
  | { allowed: false; effectiveCap: number; reason: string };

/**
 * Format a YYYY-MM tag for a given date in UTC. Public so the handler can
 * key storage rows consistently.
 */
export function periodKey(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Build a fresh counter for a brand-new Provider, anchored to `now`'s
 * calendar month.
 */
export function initialCounter(now: Date): ProviderApplicationCounter {
  return { count: 0, periodYearMonth: periodKey(now), adminOverrideCap: null };
}

/**
 * If the stored counter's period is older than `now`'s period, return a
 * fresh counter for `now`'s period (count reset to 0, override cleared).
 * Otherwise return the input unchanged.
 *
 * This is the monthly-reset boundary logic. The handler calls this before
 * `checkQuota()` so a Provider whose count was at-cap last month can file
 * again as soon as the new month begins.
 */
export function maybeReset(
  counter: ProviderApplicationCounter,
  now: Date,
): ProviderApplicationCounter {
  const currentPeriod = periodKey(now);
  if (counter.periodYearMonth === currentPeriod) return counter;
  return initialCounter(now);
}

/**
 * The effective cap for this counter — either the admin override, if set,
 * or the default. Exposed for UI ("you can file X more this month").
 */
export function effectiveCap(counter: ProviderApplicationCounter): number {
  return counter.adminOverrideCap ?? DEFAULT_MONTHLY_APPLICATION_CAP;
}

/**
 * Whether the Provider may file another Application *now*. Reset-aware:
 * if the counter is from a previous period, the answer is computed against
 * the reset-equivalent counter (the handler still needs to persist the
 * reset itself via `maybeReset()`).
 */
export function checkQuota(
  counter: ProviderApplicationCounter,
  now: Date,
): QuotaCheckResult {
  const effective = maybeReset(counter, now);
  const cap = effectiveCap(effective);
  if (effective.count >= cap) {
    return {
      allowed: false,
      effectiveCap: cap,
      reason:
        effective.adminOverrideCap !== null
          ? `monthly application cap reached (${cap} — admin-overridden)`
          : `monthly application cap reached (${cap})`,
    };
  }
  return { allowed: true, effectiveCap: cap, remaining: cap - effective.count };
}

/**
 * Apply a successful Application filing to the counter. Returns the new
 * counter the handler should persist. Reset-aware in the same way
 * `checkQuota()` is: a stale counter is reset before increment.
 *
 * Throws if filing would exceed the cap — the caller is expected to have
 * gated on `checkQuota()` first. The throw is defensive; it surfaces a
 * caller bug (re-filing without re-checking under concurrent contention).
 */
export function applyFile(
  counter: ProviderApplicationCounter,
  now: Date,
): ProviderApplicationCounter {
  const effective = maybeReset(counter, now);
  const cap = effectiveCap(effective);
  if (effective.count >= cap) {
    throw new Error(
      `applyFile would exceed cap (${cap}); caller must checkQuota() first`,
    );
  }
  return { ...effective, count: effective.count + 1 };
}

/**
 * Apply an admin override for the current period. `cap` must be a positive
 * integer ≥ current count (we don't retroactively cap a Provider below
 * what they've already filed — that would create unexplained-state UI).
 *
 * Pass `null` to clear the override and revert to the default cap.
 */
export function applyAdminOverride(
  counter: ProviderApplicationCounter,
  now: Date,
  cap: number | null,
): ProviderApplicationCounter {
  const effective = maybeReset(counter, now);
  if (cap !== null) {
    if (!Number.isInteger(cap) || cap <= 0) {
      throw new Error('admin override cap must be a positive integer');
    }
    if (cap < effective.count) {
      throw new Error(
        `admin override cap (${cap}) is below current count (${effective.count})`,
      );
    }
  }
  return { ...effective, adminOverrideCap: cap };
}

export const APPLICATION_QUOTA_MODULE_VERSION = '0.1.0-OH-113';
