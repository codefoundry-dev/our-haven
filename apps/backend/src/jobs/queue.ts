import { sql } from 'kysely';

import type { Db } from '@/db/kysely.js';

export interface EnqueueJobInput {
  queue: string;
  payload: unknown;
  scheduleAt?: Date;
}

export interface QueueHandles {
  enqueue(input: EnqueueJobInput): Promise<string>;
}

export function initQueue(db: Db): QueueHandles {
  return {
    async enqueue({ queue, payload, scheduleAt }) {
      const delaySec = scheduleAt
        ? Math.max(0, Math.floor((scheduleAt.getTime() - Date.now()) / 1000))
        : 0;
      const payloadJson = JSON.stringify(payload);
      const result = await sql<{ msg_id: string }>`
        SELECT pgmq.send(${queue}::text, ${payloadJson}::jsonb, ${delaySec}::integer)::text AS msg_id
      `.execute(db);
      const row = result.rows[0];
      if (!row?.msg_id) {
        throw new Error(`pgmq.send returned no msg_id for queue ${queue}`);
      }
      return row.msg_id;
    },
  };
}
