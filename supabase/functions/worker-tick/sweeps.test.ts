import { describe, expect, it } from 'vitest';

import { dueScreeningsQuery, screeningDisposalSweep, SWEEPS } from './sweeps.ts';
import { compileOnlyDb } from './_test/env.ts';

describe('SWEEPS registry', () => {
  it('includes the screening-disposal sweep', () => {
    expect(SWEEPS.map((s) => s.name)).toContain('screening_disposal');
    expect(screeningDisposalSweep.name).toBe('screening_disposal');
  });
});

describe('dueScreeningsQuery (SKIP LOCKED claim)', () => {
  it('compiles to a FOR UPDATE SKIP LOCKED select bounded by purge_at', () => {
    const { sql } = dueScreeningsQuery(compileOnlyDb(), new Date('2026-06-26T12:00:00Z'), 100).compile();
    const lower = sql.toLowerCase();

    expect(lower).toContain('for update');
    expect(lower).toContain('skip locked');
    expect(lower).toContain('"purge_at" <=');
    // Only rows still holding raw FCRA-disposable detail.
    expect(lower).toContain('"vendor_report_id" is not null');
    expect(lower).toContain('"candidate_action_url" is not null');
    expect(lower).toContain("'{}'::jsonb");
  });
});
