import { describe, expect, it } from 'vitest';

import { CRON_JOBS, RETENTION_QUEUE, retentionSweepJob } from '@/jobs/cron.js';

const cronFields = (expr: string) => expr.trim().split(/\s+/);

describe('retentionSweepJob', () => {
  it('schedules a daily sweep that enqueues onto the retention_planner pgmq queue', () => {
    const job = retentionSweepJob();

    // pg_cron is SQL-only and cannot call app code (ADR-0010: no in-process
    // timers), so the periodic job enqueues a pgmq message that the Node
    // retention worker drains.
    expect(RETENTION_QUEUE).toBe('retention_planner');
    expect(job.command).toContain(`pgmq.send('${RETENTION_QUEUE}'`);

    // Runs once per day at a fixed UTC time: numeric minute + hour, wildcard
    // day-of-month / month / day-of-week.
    const fields = cronFields(job.schedule);
    expect(fields).toHaveLength(5);
    const [minute, hour, dom, month, dow] = fields;
    expect(Number.isInteger(Number(minute))).toBe(true);
    expect(Number.isInteger(Number(hour))).toBe(true);
    expect([dom, month, dow]).toEqual(['*', '*', '*']);
  });

  it('targets a caller-supplied queue so non-default deployments wire correctly', () => {
    const job = retentionSweepJob('retention_planner_staging');
    expect(job.command).toContain(`pgmq.send('retention_planner_staging'`);
  });
});

describe('CRON_JOBS catalog', () => {
  it('registers the retention sweep', () => {
    expect(CRON_JOBS.map((job) => job.name)).toContain('retention_planner_daily_sweep');
  });

  it('uses unique job names (pg_cron keys jobs by name; dupes would clobber)', () => {
    const names = CRON_JOBS.map((job) => job.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
