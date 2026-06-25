import { describe, expect, it } from 'vitest';

import { scanSource } from './_plpgsql-canary.ts';

describe('plpgsql canary — scanSource (ADR-0019)', () => {
  it('passes clean schema DDL — the carve-outs never trip it', () => {
    const sql = `
      create table foo (id uuid primary key, n int not null check (n >= 0), unique (n));
      create index foo_n_idx on foo (n) where n > 0;
      alter table foo add column total int generated always as (n * 2) stored;
      alter table foo enable row level security;
      create policy foo_read on foo for select using (true);
      create extension if not exists pg_cron;
      select cron.schedule('sweep', '* * * * *', $$ select 1 $$);
      select * from foo for update skip locked;
      create or replace view foo_v as select id from foo;
    `;
    expect(scanSource('20260101_clean.ts', sql)).toEqual([]);
  });

  it('trips on a plpgsql function (both the create + the language rule)', () => {
    const sql = `create or replace function bump() returns trigger language plpgsql as $$ begin end $$;`;
    const rules = scanSource('m.ts', sql).map((v) => v.rule);
    expect(rules).toContain('create function');
    expect(rules).toContain('language plpgsql');
  });

  it('trips on create trigger', () => {
    const sql = 'create trigger set_ts before insert on foo for each row execute function bump();';
    expect(scanSource('m.ts', sql).map((v) => v.rule)).toContain('create trigger');
  });

  it('trips on create rule', () => {
    const sql = 'create rule r as on delete to foo do instead nothing;';
    expect(scanSource('m.ts', sql).map((v) => v.rule)).toContain('create rule');
  });

  it('reports the file + 1-based line of each violation', () => {
    const v = scanSource('apps/backend/src/db/migrations/x.ts', 'line1\ncreate trigger t on foo\nline3');
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({
      file: 'apps/backend/src/db/migrations/x.ts',
      line: 2,
      rule: 'create trigger',
    });
  });

  it('is exempt when the comment references a REGISTERED exception id', () => {
    const sql = `-- plpgsql-canary-exception: OH-999\ncreate trigger set_ts before insert on foo ...;`;
    expect(scanSource('m.ts', sql, { 'OH-999': 'mechanical updated_at touch' })).toEqual([]);
  });

  it('still trips when the referenced exception id is NOT registered', () => {
    const sql = `-- plpgsql-canary-exception: OH-404\ncreate trigger set_ts before insert on foo ...;`;
    expect(scanSource('m.ts', sql, { 'OH-999': 'a different, real exception' }).map((v) => v.rule)).toContain(
      'create trigger',
    );
  });

  it('accepts the // comment style (TS migrations), not just --', () => {
    const sql = `// plpgsql-canary-exception: OH-1\ncreate function f() returns int language sql as $$ select 1 $$;`;
    expect(scanSource('m.ts', sql, { 'OH-1': 'bounded op' })).toEqual([]);
  });
});
