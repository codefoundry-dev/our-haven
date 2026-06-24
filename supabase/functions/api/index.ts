// Deno entrypoint for the `api` fat Edge Function (ADR-0019 § Decision 1).
//
// Thin by design: read env, build the data-plane connection once at MODULE
// scope (a warm isolate reuses it — ADR-0019 § Decision 3), construct the Hono
// app, and serve. All behaviour lives in `app.ts` and below, which run
// unchanged under vitest on Node — this file is the only Deno-coupled module
// and is intentionally excluded from the Node typecheck (it references the
// `Deno` global). Validated by `supabase functions serve` / deploy.
import { buildApp } from './app.ts';
import { loadEnv } from './config/env.ts';
import { createDb } from './db/kysely.ts';

const env = loadEnv(Deno.env.toObject());
const db = createDb(env);
const app = buildApp({ env, db });

Deno.serve(app.fetch);
