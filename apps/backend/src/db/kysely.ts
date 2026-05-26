import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

import type { Env } from '@/config/env.js';

import type { Database } from './schema.js';

export function createDb(env: Env): Kysely<Database> {
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
    max: 10,
  });
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
    log:
      env.NODE_ENV === 'development'
        ? (event) => {
            if (event.level === 'error') {
              console.error('[kysely]', event.error);
            }
          }
        : undefined,
  });
}

export type Db = Kysely<Database>;
