import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CanaryViolation {
  file: string;
  line: number;
  rule: string;
  match: string;
}

/**
 * Registered, bounded exceptions to the plpgsql canary (ADR-0019 § "Action on
 * a trip"). Keyed by a stable id referenced from a migration via a
 * `-- plpgsql-canary-exception: <id>` (or `// …`) comment. EMPTY is the
 * permanently-green default; adding an entry is a deliberate ADR checkpoint,
 * never a routine edit.
 */
export const REGISTERED_EXCEPTIONS: Readonly<Record<string, string>> = {
  // handle_new_user AFTER INSERT trigger on auth.users (migration
  // 20260704000001_profiles): a mechanical, business-logic-free copy of sign-up
  // metadata into public.profiles. Sign-up is a direct supabase.auth.signUp()
  // against GoTrue with no application-server hop, so a TS-orchestrated Kysely
  // write cannot observe the auth.users insert — a DB trigger is the only atomic
  // mirror. Bounded (insert-one-row, ON CONFLICT DO NOTHING); not a write-path
  // domain switch-trigger.
  'profiles-mirror': 'auth.users → public.profiles sign-up mirror (20260704000001_profiles)',
  // is_message_thread_participant(uuid) SECURITY DEFINER STABLE *SQL* helper
  // (migration 20260708000001_messaging): a single EXISTS participant lookup
  // that backs the `messages` SELECT RLS policy authorising Supabase Realtime
  // `postgres_changes` delivery to the two thread participants (ADR-0010). The
  // policy predicate must be evaluable in-DB on every changed row, so there is
  // no TS-orchestrated alternative; SECURITY DEFINER avoids the messages policy
  // recursing through message_threads' own RLS on every Realtime change check.
  // Bounded: pure SQL (no control flow), read-only, no business logic.
  'message-thread-participant':
    'is_message_thread_participant RLS/Realtime helper (20260708000001_messaging)',
};

const RULES: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'language plpgsql', re: /\blanguage\s+'?plpgsql'?/i },
  { name: 'create function', re: /\bcreate\s+(?:or\s+replace\s+)?function\b/i },
  { name: 'create trigger', re: /\bcreate\s+(?:constraint\s+)?trigger\b/i },
  { name: 'create rule', re: /\bcreate\s+(?:or\s+replace\s+)?rule\b/i },
];

const EXCEPTION_RE = /(?:--|\/\/)\s*plpgsql-canary-exception:\s*([A-Za-z0-9_-]+)/g;

/**
 * Pure detector: the forbidden-DDL violations in one file's source. A file
 * carrying a `plpgsql-canary-exception` comment for a *registered* id is exempt
 * (ADR-0019). The carve-outs (CHECK/UNIQUE/FK/NOT NULL, partial indexes,
 * generated columns, RLS policies, pg_cron/pg_net, FOR UPDATE SKIP LOCKED,
 * read-only views) never match these four rules, so they pass untouched.
 */
export function scanSource(
  file: string,
  content: string,
  registry: Readonly<Record<string, string>> = REGISTERED_EXCEPTIONS,
): CanaryViolation[] {
  for (const m of content.matchAll(EXCEPTION_RE)) {
    const id = m[1];
    if (id && Object.prototype.hasOwnProperty.call(registry, id)) {
      return []; // covered by a registered exception
    }
  }

  const violations: CanaryViolation[] = [];
  content.split(/\r?\n/).forEach((text, i) => {
    for (const rule of RULES) {
      const found = rule.re.exec(text);
      if (found) violations.push({ file, line: i + 1, rule: rule.name, match: found[0].trim() });
    }
  });
  return violations;
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

export const DEFAULT_MIGRATION_DIRS: readonly string[] = [
  resolve(repoRoot, 'apps', 'backend', 'src', 'db', 'migrations'),
  resolve(repoRoot, 'supabase', 'migrations'),
];

interface SourceFile {
  path: string;
  content: string;
}

async function readEntries(dir: string) {
  try {
    return await readdir(dir, { recursive: true, withFileTypes: true });
  } catch {
    return []; // dir may not exist yet (e.g. supabase/migrations)
  }
}

async function collectMigrationFiles(dirs: readonly string[]): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  for (const dir of dirs) {
    for (const entry of await readEntries(dir)) {
      if (!entry.isFile()) continue;
      if (!/\.(ts|sql)$/i.test(entry.name) || /\.test\.ts$/i.test(entry.name)) continue;
      const full = resolve(entry.parentPath, entry.name);
      out.push({ path: relative(repoRoot, full), content: await readFile(full, 'utf8') });
    }
  }
  return out;
}

export interface CanaryReport {
  ok: boolean;
  scannedCount: number;
  violations: CanaryViolation[];
}

export async function runCanary(
  dirs: readonly string[] = DEFAULT_MIGRATION_DIRS,
  registry: Readonly<Record<string, string>> = REGISTERED_EXCEPTIONS,
): Promise<CanaryReport> {
  const files = await collectMigrationFiles(dirs);
  const violations = files.flatMap((file) => scanSource(file.path, file.content, registry));
  return { ok: violations.length === 0, scannedCount: files.length, violations };
}
