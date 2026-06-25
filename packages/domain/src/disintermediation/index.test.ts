import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  detect,
  DISINTERMEDIATION_CATEGORIES,
  DISINTERMEDIATION_MODULE_VERSION,
  REDACTION_PLACEHOLDER,
  scanMessage,
  scanOffer,
  scanScopeNote,
  type DisintermediationCategory,
} from './index.js';

function categoriesOf(text: string): readonly DisintermediationCategory[] {
  return detect(text).categories;
}

describe('detect — phone numbers', () => {
  it.each([
    'call me at 555-123-4567',
    'my cell is (555) 123-4567',
    'reach me: 5551234567',
    'text +1 555 123 4567',
    'number 555.123.4567 anytime',
    'ph: +15551234567',
  ])('flags %j as phone', (text) => {
    expect(categoriesOf(text)).toContain('phone');
  });

  it('redacts the phone substring', () => {
    const r = detect('call 555-123-4567 please');
    expect(r.redacted).toBe(`call ${REDACTION_PLACEHOLDER} please`);
    expect(r.matches[0]).toMatchObject({ category: 'phone', value: '555-123-4567' });
  });
});

describe('detect — emails', () => {
  it.each([
    'email jane@example.com',
    'reach j.doe+tag@sub.domain.co.uk',
    'me_at_work@company.io is best',
  ])('flags %j as email', (text) => {
    expect(categoriesOf(text)).toContain('email');
  });

  it('does NOT re-report an email local part / @ as a social handle', () => {
    const cats = categoriesOf('write to jane@example.com');
    expect(cats).toContain('email');
    expect(cats).not.toContain('social_handle');
  });
});

describe('detect — social handles', () => {
  it.each(['my insta @jane_doe', 'follow @johndoe', 'snap: coolnanny22', 'ig = the_sitter'])(
    'flags %j as social_handle',
    (text) => {
      expect(categoriesOf(text)).toContain('social_handle');
    },
  );

  it('does not trip on incidental platform words without a handle separator', () => {
    expect(categoriesOf('snapchat is a fun way to share photos')).not.toContain('social_handle');
  });

  it('requires a letter-first handle (so @2026 is not a handle)', () => {
    expect(categoriesOf('see you @2026 reunion')).not.toContain('social_handle');
  });
});

describe('detect — payment apps', () => {
  it.each([
    'venmo me the deposit',
    'pay via Zelle',
    'I use cash app',
    'send on cashapp',
    'paypal works too',
    'apple pay is fine',
    'my cashtag is $JaneDoe',
  ])('flags %j as payment_app', (text) => {
    expect(categoriesOf(text)).toContain('payment_app');
  });

  it('does NOT treat a dollar amount as a cashtag', () => {
    expect(categoriesOf('I charge $35 an hour')).not.toContain('payment_app');
  });
});

describe('detect — addresses', () => {
  it.each([
    'I live at 123 Main Street',
    'drop off at 1600 Pennsylvania Ave',
    'meet at 45 Oak Rd please',
    'unit at 7 Birchwood Lane',
  ])('flags %j as address', (text) => {
    expect(categoriesOf(text)).toContain('address');
  });
});

describe('false-positive curation — childcare chat must stay clean', () => {
  it.each([
    'I charge $35/hr for 3 kids, Mon–Fri 3–5 PM',
    '2 children aged 3 and 7, very sweet',
    'available from 9 to 5 on weekdays',
    'see you in 2026!',
    'I can do 4 hours on Saturday',
    "the rate is 40 dollars, that's my floor",
    'my 2 year old and 5 year old need a sitter',
  ])('no detections in %j', (text) => {
    const r = detect(text);
    expect(r.flagged).toBe(false);
    expect(r.matches).toHaveLength(0);
    expect(r.redacted).toBe(text);
  });
});

describe('detect — multiple categories + redaction', () => {
  const text = 'text 555-123-4567 or email me@x.com, venmo @cash_jane';
  const r = detect(text);

  it('flags and surfaces every distinct category in canonical order', () => {
    expect(r.flagged).toBe(true);
    // canonical order = DISINTERMEDIATION_CATEGORIES order: phone, email,
    // social_handle, payment_app, address.
    expect(r.categories).toEqual(['phone', 'email', 'social_handle', 'payment_app']);
  });

  it('redacts every detected span and nothing else', () => {
    expect(r.redacted).not.toContain('555-123-4567');
    expect(r.redacted).not.toContain('me@x.com');
    expect(r.redacted).toContain(REDACTION_PLACEHOLDER);
    // The connective prose survives.
    expect(r.redacted).toContain('text ');
    expect(r.redacted).toContain(' or email ');
  });
});

describe('scope_note fixtures (CONTEXT.md § Offer)', () => {
  it('a clean scope_note is delivered verbatim', () => {
    const note = 'Two toddlers, gentle bedtime routine, no screen time after 7.';
    const r = scanScopeNote(note);
    expect(r.flagged).toBe(false);
    expect(r.redacted).toBe(note);
  });

  it('a scope_note leaking contact info is flagged + redacted', () => {
    const r = scanScopeNote('Lovely family — text me at 555-987-6543 to coordinate');
    expect(r.flagged).toBe(true);
    expect(r.categories).toContain('phone');
    expect(r.redacted).not.toContain('555-987-6543');
  });
});

describe('scanOffer — structured numeric fields bypass the detector', () => {
  it('only the scope_note is scanned; numerics never trip detection', () => {
    const r = scanOffer({
      scopeNote: 'Three afternoons a week, homework help',
      proposedRate: 5551234567, // a numeric that LOOKS like a phone — must be ignored
      computedTotal: 16000,
      scopeQuantity: 4,
    });
    expect(r.flagged).toBe(false);
    expect(r.matches).toHaveLength(0);
  });

  it('still flags contact info that appears in the scope_note itself', () => {
    const r = scanOffer({
      scopeNote: 'reach me on telegram: nannyjane',
      proposedRate: 3500,
      computedTotal: 14000,
      scopeQuantity: 4,
    });
    expect(r.flagged).toBe(true);
    expect(r.categories).toContain('social_handle');
  });
});

describe('scanMessage delegates to detect', () => {
  it('matches detect() exactly', () => {
    const body = 'hi, my zelle is jane@bank.com';
    expect(scanMessage(body)).toEqual(detect(body));
  });
});

describe('properties (fast-check)', () => {
  it('match spans are faithful: value === text.slice(start, end)', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        for (const m of detect(text).matches) {
          expect(text.slice(m.start, m.end)).toBe(m.value);
          expect(m.start).toBeGreaterThanOrEqual(0);
          expect(m.end).toBeLessThanOrEqual(text.length);
        }
      }),
    );
  });

  it('re-detecting the redacted output flags nothing new (redaction is sufficient)', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const once = detect(text);
        const twice = detect(once.redacted);
        expect(twice.flagged).toBe(false);
      }),
    );
  });

  it('categories is always a canonical-ordered subset with no duplicates', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const cats = detect(text).categories;
        expect(new Set(cats).size).toBe(cats.length);
        const canonicalIdx = cats.map((c) => DISINTERMEDIATION_CATEGORIES.indexOf(c));
        const sorted = [...canonicalIdx].sort((a, b) => a - b);
        expect(canonicalIdx).toEqual(sorted);
      }),
    );
  });

  it('flagged iff at least one match', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const r = detect(text);
        expect(r.flagged).toBe(r.matches.length > 0);
      }),
    );
  });
});

describe('module version', () => {
  it('is bumped for OH-180', () => {
    expect(DISINTERMEDIATION_MODULE_VERSION).toBe('0.2.0-OH-180');
  });
});
