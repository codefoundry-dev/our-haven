/**
 * Migration runner placeholder. Phase 2 ticket 2.1 ships the harness; actual
 * tables land in 2.3 (sign-up), 2.4 (verification), 2.8 (profile), 2.11
 * (booking-lifecycle), 2.12 (jobs+applications), 2.13 (messages), 2.14
 * (retention/erasure). Backed by Kysely's FileMigrationProvider once
 * src/db/migrations/ has files.
 */
import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FileMigrationProvider, Migrator } from 'kysely/migration';

import { loadEnv } from '../src/config/env.js';
import { createDb } from '../src/db/kysely.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'src', 'db', 'migrations');

type Command = 'up' | 'down' | 'make';

async function makeMigration(name: string | undefined): Promise<void> {
  if (!name) {
    console.error('Usage: migrate make <name>');
    process.exit(2);
  }
  await fs.mkdir(MIGRATIONS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const file = resolve(MIGRATIONS_DIR, `${stamp}_${name}.ts`);
  await fs.writeFile(
    file,
    `import type { Kysely } from 'kysely';\n\nexport async function up(db: Kysely<unknown>): Promise<void> {\n  // TODO\n}\n\nexport async function down(db: Kysely<unknown>): Promise<void> {\n  // TODO\n}\n`,
    'utf8',
  );
  console.log(`Created ${file}`);
}

async function runMigrations(direction: 'up' | 'down'): Promise<void> {
  await fs.mkdir(MIGRATIONS_DIR, { recursive: true });
  const env = loadEnv();
  const db = createDb(env);
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path: { join: (...p: string[]) => resolve(...p) },
      migrationFolder: MIGRATIONS_DIR,
    }),
  });
  const { error, results } = direction === 'up' ? await migrator.migrateToLatest() : await migrator.migrateDown();
  for (const r of results ?? []) {
    if (r.status === 'Success') console.log(`✔ ${direction} ${r.migrationName}`);
    else if (r.status === 'Error') console.error(`✗ ${direction} ${r.migrationName}`);
  }
  await db.destroy();
  if (error) {
    console.error(error);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const [, , raw, ...rest] = process.argv;
  const cmd = raw as Command | undefined;
  if (cmd === 'make') return makeMigration(rest[0]);
  if (cmd === 'up' || cmd === 'down') return runMigrations(cmd);
  console.error('Usage: migrate <up|down|make>');
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
