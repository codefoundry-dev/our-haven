import { describe, expect, it } from 'vitest';

import {
  CRON_JOBS,
  WORKER_TICK_SCHEDULE,
  WORKER_TICK_URL_SETTING,
  workerTickJob,
} from '@/jobs/cron.js';

const cronFields = (expr: string) => expr.trim().split(/\s+/);

describe('workerTickJob', () => {
  it('POSTs to the worker-tick function via pg_net every minute', () => {
    const job = workerTickJob();

    expect(job.name).toBe('worker_tick');
    // pg_cron cannot call app code, so the job is a pg_net HTTP POST (schedule +
    // transport — the plpgsql-canary carve-out, ADR-0019 § Decision 4).
    expect(job.command).toContain('net.http_post');
    expect(job.command).toContain(WORKER_TICK_URL_SETTING);
    // No pgmq anywhere — that layer is gone.
    expect(job.command).not.toContain('pgmq');

    // Every minute: all five cron fields are wildcards.
    expect(job.schedule).toBe(WORKER_TICK_SCHEDULE);
    expect(cronFields(job.schedule)).toEqual(['*', '*', '*', '*', '*']);
  });

  it('is a no-op until the function URL is configured (safe to apply anywhere)', () => {
    // The WHERE guard means an unset app.worker_tick_url skips the POST, so the
    // migration applies cleanly in local/CI/staging without a configured URL.
    const job = workerTickJob();
    expect(job.command).toContain(`where current_setting('${WORKER_TICK_URL_SETTING}', true) is not null`);
  });
});

describe('CRON_JOBS catalog', () => {
  it('registers the worker tick', () => {
    expect(CRON_JOBS.map((job) => job.name)).toContain('worker_tick');
  });

  it('uses unique job names (pg_cron keys jobs by name; dupes would clobber)', () => {
    const names = CRON_JOBS.map((job) => job.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
