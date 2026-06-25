import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

import type { Database } from '@/db/schema.js';
import { enqueueInsertQuery } from '@/jobs/outbox.js';

// Compile-only Kysely: building + `.compile()` never opens a connection, so no
// database is needed to assert the generated SQL.
function compileDb(): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool: new pg.Pool({ max: 1 }) }) });
}

describe('enqueueInsertQuery', () => {
  it('targets the partial dedupe index via ON CONFLICT … WHERE … DO NOTHING', () => {
    const { sql } = enqueueInsertQuery(compileDb(), {
      recipientUid: '00000000-0000-0000-0000-000000000001',
      eventType: 'booking.requested',
      dedupeKey: 'booking.requested:42',
    }).compile();
    const lower = sql.toLowerCase();

    expect(lower).toContain('insert into "notification_outbox"');
    expect(lower).toContain('returning "id"');
    // The predicate must mirror the partial index `WHERE dedupe_key IS NOT NULL`,
    // or Postgres rejects the ON CONFLICT as matching no unique constraint.
    expect(lower).toContain('on conflict ("dedupe_key")');
    expect(lower).toContain('where "dedupe_key" is not null');
    expect(lower).toContain('do nothing');
  });

  it('builds without a dedupe key or max_attempts override', () => {
    const { sql } = enqueueInsertQuery(compileDb(), {
      recipientUid: '00000000-0000-0000-0000-000000000002',
      eventType: 'screening.completed',
    }).compile();

    expect(sql.toLowerCase()).toContain('insert into "notification_outbox"');
  });
});
