/**
 * The plpgsql canary (ADR-0019 § "The plpgsql canary") — sibling to
 * apps/backend's check-openapi-drift.ts. CI fails if a migration introduces
 * `language plpgsql` / `create function|trigger|rule` without a registered
 * exception, because that is the pre-agreed switch-trigger: the moment
 * correctness forces write-path domain logic into the database, a
 * TS-orchestrated Kysely transaction can no longer express the operation and
 * the Edge-Functions pivot stops being a cheap host swap.
 *
 * The permanently-green default is the whole point. Run: npm run check:no-plpgsql
 */
import { runCanary } from './_plpgsql-canary.ts';

async function main(): Promise<void> {
  const report = await runCanary();

  if (!report.ok) {
    console.error('plpgsql canary TRIPPED (ADR-0019) — forbidden DDL in a migration:\n');
    for (const v of report.violations) {
      console.error(`  ${v.file}:${v.line} — ${v.rule}: ${v.match}`);
    }
    console.error(
      '\nAtomicity belongs in a TS-orchestrated Kysely db.transaction(), not in the database.\n' +
        'If this is genuinely a bounded, business-logic-free op, make it an ADR checkpoint:\n' +
        'register the exception in scripts/_plpgsql-canary.ts (REGISTERED_EXCEPTIONS) and\n' +
        'annotate the migration with `-- plpgsql-canary-exception: <id>`.',
    );
    process.exit(1);
  }

  console.log(
    `plpgsql canary green — scanned ${report.scannedCount} migration file(s), no forbidden DDL.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
