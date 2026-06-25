import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  applyAdminOverride,
  applyFile,
  checkQuota,
  DEFAULT_MONTHLY_APPLICATION_CAP,
  effectiveCap,
  initialCounter,
  maybeReset,
  periodKey,
  type CaregiverApplicationCounter,
} from './index.js';

const JAN_15 = new Date('2026-01-15T10:00:00.000Z');
const FEB_01 = new Date('2026-02-01T00:00:00.000Z');
const FEB_28 = new Date('2026-02-28T23:59:59.000Z');
const MAR_01 = new Date('2026-03-01T00:00:00.000Z');

describe('periodKey', () => {
  it('formats YYYY-MM in UTC', () => {
    expect(periodKey(JAN_15)).toBe('2026-01');
    expect(periodKey(FEB_28)).toBe('2026-02');
    expect(periodKey(MAR_01)).toBe('2026-03');
  });
});

describe('initialCounter', () => {
  it('starts at 0 with the current period and no override', () => {
    const c = initialCounter(JAN_15);
    expect(c).toEqual({ count: 0, periodYearMonth: '2026-01', adminOverrideCap: null });
  });
});

describe('effectiveCap', () => {
  it('defaults to 30 with no override', () => {
    expect(effectiveCap(initialCounter(JAN_15))).toBe(DEFAULT_MONTHLY_APPLICATION_CAP);
    expect(DEFAULT_MONTHLY_APPLICATION_CAP).toBe(30);
  });

  it('returns override when set', () => {
    const c = { ...initialCounter(JAN_15), adminOverrideCap: 50 };
    expect(effectiveCap(c)).toBe(50);
  });
});

describe('checkQuota', () => {
  it('allowed at 0 with full remaining', () => {
    const r = checkQuota(initialCounter(JAN_15), JAN_15);
    expect(r).toEqual({ allowed: true, effectiveCap: 30, remaining: 30 });
  });

  it('allowed at cap-1 with 1 remaining', () => {
    const c: CaregiverApplicationCounter = { ...initialCounter(JAN_15), count: 29 };
    const r = checkQuota(c, JAN_15);
    expect(r).toEqual({ allowed: true, effectiveCap: 30, remaining: 1 });
  });

  it('denied at cap', () => {
    const c: CaregiverApplicationCounter = { ...initialCounter(JAN_15), count: 30 };
    const r = checkQuota(c, JAN_15);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/cap reached/);
  });

  it('allowed at default cap (30) once an override raises it to 50', () => {
    const c: CaregiverApplicationCounter = {
      count: 30,
      periodYearMonth: '2026-01',
      adminOverrideCap: 50,
    };
    const r = checkQuota(c, JAN_15);
    expect(r.allowed).toBe(true);
    if (r.allowed) {
      expect(r.effectiveCap).toBe(50);
      expect(r.remaining).toBe(20);
    }
  });

  it('denied at override-cap; reason names the override', () => {
    const c: CaregiverApplicationCounter = {
      count: 50,
      periodYearMonth: '2026-01',
      adminOverrideCap: 50,
    };
    const r = checkQuota(c, JAN_15);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/admin-overridden/);
  });
});

describe('maybeReset — monthly reset boundary', () => {
  it('no-op when the stored period matches now', () => {
    const c = initialCounter(JAN_15);
    expect(maybeReset(c, JAN_15)).toBe(c);
  });

  it('resets to 0 when crossing the month boundary', () => {
    const c: CaregiverApplicationCounter = {
      count: 30,
      periodYearMonth: '2026-01',
      adminOverrideCap: 50,
    };
    const out = maybeReset(c, FEB_01);
    expect(out).toEqual({ count: 0, periodYearMonth: '2026-02', adminOverrideCap: null });
  });

  it('reset clears the admin override (override is per-period — ADR-0006 §7)', () => {
    const c: CaregiverApplicationCounter = {
      count: 10,
      periodYearMonth: '2026-01',
      adminOverrideCap: 50,
    };
    expect(maybeReset(c, MAR_01).adminOverrideCap).toBeNull();
  });

  it('checkQuota is reset-aware — at-cap last month is allowed on the 1st', () => {
    const c: CaregiverApplicationCounter = {
      count: 30,
      periodYearMonth: '2026-01',
      adminOverrideCap: null,
    };
    expect(checkQuota(c, FEB_01).allowed).toBe(true);
  });
});

describe('applyFile', () => {
  it('increments the count by 1', () => {
    const c = initialCounter(JAN_15);
    const next = applyFile(c, JAN_15);
    expect(next.count).toBe(1);
    expect(next.periodYearMonth).toBe('2026-01');
  });

  it('resets first, then increments — first filing of the new month becomes count=1', () => {
    const c: CaregiverApplicationCounter = {
      count: 30,
      periodYearMonth: '2026-01',
      adminOverrideCap: null,
    };
    const next = applyFile(c, FEB_01);
    expect(next.count).toBe(1);
    expect(next.periodYearMonth).toBe('2026-02');
  });

  it('throws if called past the cap — caller must checkQuota first', () => {
    const c: CaregiverApplicationCounter = {
      count: 30,
      periodYearMonth: '2026-01',
      adminOverrideCap: null,
    };
    expect(() => applyFile(c, JAN_15)).toThrow(/exceed cap/);
  });

  it('respects override — applyFile up to overrideCap works', () => {
    const c: CaregiverApplicationCounter = {
      count: 30,
      periodYearMonth: '2026-01',
      adminOverrideCap: 35,
    };
    const next = applyFile(c, JAN_15);
    expect(next.count).toBe(31);
    expect(next.adminOverrideCap).toBe(35);
  });
});

describe('applyAdminOverride', () => {
  it('sets a positive integer override', () => {
    const c = initialCounter(JAN_15);
    const out = applyAdminOverride(c, JAN_15, 50);
    expect(out.adminOverrideCap).toBe(50);
  });

  it('clears the override when passed null', () => {
    const c: CaregiverApplicationCounter = {
      count: 5,
      periodYearMonth: '2026-01',
      adminOverrideCap: 50,
    };
    expect(applyAdminOverride(c, JAN_15, null).adminOverrideCap).toBeNull();
  });

  it('throws on a non-positive cap', () => {
    const c = initialCounter(JAN_15);
    expect(() => applyAdminOverride(c, JAN_15, 0)).toThrow();
    expect(() => applyAdminOverride(c, JAN_15, -1)).toThrow();
    expect(() => applyAdminOverride(c, JAN_15, 1.5)).toThrow();
  });

  it('throws if the new cap would retroactively put the Caregiver over', () => {
    const c: CaregiverApplicationCounter = {
      count: 20,
      periodYearMonth: '2026-01',
      adminOverrideCap: 30,
    };
    expect(() => applyAdminOverride(c, JAN_15, 10)).toThrow(/below current count/);
  });

  it('resets stale counters before applying — override does not bring back a dead month', () => {
    const c: CaregiverApplicationCounter = {
      count: 30,
      periodYearMonth: '2026-01',
      adminOverrideCap: null,
    };
    const out = applyAdminOverride(c, FEB_01, 40);
    expect(out).toEqual({ count: 0, periodYearMonth: '2026-02', adminOverrideCap: 40 });
  });
});

describe('Concurrent-filing race — pure semantics', () => {
  it('two consecutive applyFile calls increment by 2', () => {
    // The pure module models race resolution at the type level: applyFile
    // returns the post-increment counter. The handler's responsibility is
    // to wrap the read-check-write in a single TX (or row-level lock); the
    // pure module proves the increment is monotonic and deterministic.
    let c: CaregiverApplicationCounter = initialCounter(JAN_15);
    for (let i = 0; i < 2; i++) {
      const check = checkQuota(c, JAN_15);
      expect(check.allowed).toBe(true);
      c = applyFile(c, JAN_15);
    }
    expect(c.count).toBe(2);
  });

  it('applyFile at the cap boundary refuses; the 31st filing of a 30-cap month throws', () => {
    let c: CaregiverApplicationCounter = initialCounter(JAN_15);
    for (let i = 0; i < 30; i++) c = applyFile(c, JAN_15);
    expect(c.count).toBe(30);
    expect(checkQuota(c, JAN_15).allowed).toBe(false);
    expect(() => applyFile(c, JAN_15)).toThrow();
  });
});

describe('Property-based — quota tracker', () => {
  const counterArb: fc.Arbitrary<CaregiverApplicationCounter> = fc.record({
    count: fc.integer({ min: 0, max: 100 }),
    periodYearMonth: fc.constantFrom('2026-01', '2026-02', '2026-03'),
    adminOverrideCap: fc.option(fc.integer({ min: 1, max: 200 }), { nil: null }),
  });
  const dateArb: fc.Arbitrary<Date> = fc.constantFrom(JAN_15, FEB_01, FEB_28, MAR_01);

  it('checkQuota.allowed iff count < effectiveCap (after reset)', () => {
    fc.assert(
      fc.property(counterArb, dateArb, (counter, now) => {
        const reset = maybeReset(counter, now);
        const r = checkQuota(counter, now);
        expect(r.allowed).toBe(reset.count < effectiveCap(reset));
      }),
    );
  });

  it('applyFile only succeeds when checkQuota allows', () => {
    fc.assert(
      fc.property(counterArb, dateArb, (counter, now) => {
        const r = checkQuota(counter, now);
        if (r.allowed) {
          const next = applyFile(counter, now);
          expect(next.count).toBeGreaterThan(0);
        } else {
          expect(() => applyFile(counter, now)).toThrow();
        }
      }),
    );
  });

  it('determinism: same inputs → same outputs', () => {
    fc.assert(
      fc.property(counterArb, dateArb, (counter, now) => {
        expect(maybeReset(counter, now)).toEqual(maybeReset(counter, now));
        expect(checkQuota(counter, now)).toEqual(checkQuota(counter, now));
      }),
    );
  });

  it('crossing a month boundary always resets to count=0 + override=null', () => {
    fc.assert(
      fc.property(counterArb, (counter) => {
        // Pick a `now` whose period differs from the counter's.
        const allPeriods = ['2026-01', '2026-02', '2026-03'];
        const otherPeriod = allPeriods.find((p) => p !== counter.periodYearMonth)!;
        const parts = otherPeriod.split('-').map(Number);
        const y = parts[0] as number;
        const m = parts[1] as number;
        const now = new Date(Date.UTC(y, m - 1, 15));
        const reset = maybeReset(counter, now);
        expect(reset.count).toBe(0);
        expect(reset.adminOverrideCap).toBeNull();
        expect(reset.periodYearMonth).toBe(otherPeriod);
      }),
    );
  });
});
