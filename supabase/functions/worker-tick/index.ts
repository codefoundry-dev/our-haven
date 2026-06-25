// Deno entrypoint for the `worker-tick` Edge Function (ADR-0019 § Decision 4).
//
// Thin by design: read env, build the data-plane connection once at MODULE
// scope (a warm isolate reuses it), then on each request authenticate the
// pg_cron caller and run one tick. All behaviour lives in `tick.ts` and below,
// which run unchanged under vitest on Node — this file is the only Deno-coupled
// module and is intentionally excluded from the Node typecheck (it references
// the `Deno` global). Validated by `supabase functions serve` / deploy.
//
// Deployed `--no-verify-jwt`: the caller is pg_cron + pg_net, not an end user,
// so the function gates itself on the WORKER_TICK_SECRET shared secret instead
// of a Supabase JWT.
import { createCheckrAdapter } from '../_shared/checkr.ts';
import { isAuthorized } from './auth.ts';
import { loadEnv } from './config/env.ts';
import { createDb } from './db/kysely.ts';
import { createScreeningInviteDispatcher } from './dispatchers/screening.ts';
import { runTick } from './tick.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Build env + db once at module scope (warm-isolate reuse). A boot failure is
// almost always a missing/invalid secret; surface it as a readable 503 rather
// than an opaque WORKER_ERROR. The detail is config-validation text only.
let boot: {
  env: ReturnType<typeof loadEnv>;
  db: ReturnType<typeof createDb>;
  dispatcher: ReturnType<typeof createScreeningInviteDispatcher>;
} | null = null;
let bootError = '';
try {
  const env = loadEnv(Deno.env.toObject());
  const db = createDb(env);
  // A SECOND db handle, dedicated to dispatcher write-backs. The outbox drain
  // holds `db`'s single pooled connection inside a transaction for the duration
  // of each dispatch (the SKIP-LOCKED guarantee), so the screening dispatcher
  // must persist its result through its own connection or it would deadlock
  // against `max:1` (see dispatchers/screening.ts).
  const dispatchDb = createDb(env);
  const checkr = createCheckrAdapter({
    apiKey: env.CHECKR_API_KEY,
    packageSlug: env.CHECKR_PACKAGE,
    apiBase: env.CHECKR_API_BASE,
  });
  const dispatcher = createScreeningInviteDispatcher({ db: dispatchDb, checkr });
  boot = { env, db, dispatcher };
} catch (err) {
  bootError = err instanceof Error ? err.message : String(err);
  console.error('[worker-tick] boot failed:', bootError);
}

async function handler(req: Request): Promise<Response> {
  if (!boot) return json({ error: 'boot_failed', detail: bootError }, 503);

  // pg_cron fires a POST; anything else is a misroute or a probe.
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  if (!isAuthorized(req.headers.get('authorization'), boot.env.WORKER_TICK_SECRET)) {
    return json({ error: 'unauthorized' }, 401);
  }

  try {
    const summary = await runTick(boot.db, { dispatcher: boot.dispatcher });
    return json(summary, 200);
  } catch (err) {
    console.error('[worker-tick] tick failed', err);
    return json({ error: 'tick_failed' }, 500);
  }
}

Deno.serve(handler);
