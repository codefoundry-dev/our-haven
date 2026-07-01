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
import { createStripeAdapter } from '../api/vendors/stripe.ts';
import { createCheckrAdapter } from '../_shared/checkr.ts';
import { createExpoPushAdapter } from '../_shared/expo-push.ts';
import { createResendAdapter } from '../_shared/resend.ts';
import { createTwilioAdapter } from '../_shared/twilio.ts';
import { createWebPushAdapter } from '../_shared/web-push.ts';
import { isAuthorized } from './auth.ts';
import { loadEnv } from './config/env.ts';
import { createDb } from './db/kysely.ts';
import {
  createNotificationsDispatcher,
  makeKyselyRecipientResolver,
} from './dispatchers/notifications.ts';
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
  stripe: ReturnType<typeof createStripeAdapter>;
} | null = null;
let bootError = '';
try {
  const env = loadEnv(Deno.env.toObject());
  const db = createDb(env);
  // Shared Stripe adapter for the booking-payment sweeps (OH-211). Unconfigured
  // (no secret) → those sweeps log + skip; the rest of the tick is unaffected.
  const stripe = createStripeAdapter({ secretKey: env.STRIPE_SECRET_KEY, apiBase: env.STRIPE_API_BASE });
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

  // OH-194 notifications fan-out (the real channels behind the OH-237 seam). Each
  // adapter is built only when its secrets are present; an absent adapter means
  // that channel is skipped (best-effort) — except a missing Twilio makes the four
  // SMS-mandatory event kinds fail loudly rather than silently drop. The VAPID
  // pair is treated as unconfigured while still the deploy-time placeholder.
  const vapidConfigured =
    !!env.VAPID_PUBLIC_KEY &&
    !!env.VAPID_PRIVATE_KEY &&
    !env.VAPID_PUBLIC_KEY.includes('placeholder') &&
    !env.VAPID_PRIVATE_KEY.includes('placeholder');
  const notificationsDispatcher = createNotificationsDispatcher({
    resolver: makeKyselyRecipientResolver(dispatchDb),
    bases: {
      mobile: env.NOTIFICATIONS_DEEP_LINK_BASE_MOBILE,
      web: env.NOTIFICATIONS_DEEP_LINK_BASE_WEB,
    },
    expoPush: createExpoPushAdapter({ accessToken: env.EXPO_ACCESS_TOKEN }),
    resend: env.RESEND_API_KEY
      ? createResendAdapter({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM })
      : undefined,
    twilio:
      env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER
        ? createTwilioAdapter({
            accountSid: env.TWILIO_ACCOUNT_SID,
            authToken: env.TWILIO_AUTH_TOKEN,
            fromNumber: env.TWILIO_FROM_NUMBER,
          })
        : undefined,
    webPush: vapidConfigured
      ? createWebPushAdapter({
          publicKey: env.VAPID_PUBLIC_KEY!,
          privateKey: env.VAPID_PRIVATE_KEY!,
          subject: env.VAPID_SUBJECT,
        })
      : undefined,
  });

  // Dispatch chain: screening.invite → notifications → logging no-op.
  const dispatcher = createScreeningInviteDispatcher({
    db: dispatchDb,
    checkr,
    fallback: notificationsDispatcher,
  });
  boot = { env, db, dispatcher, stripe };
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
    const summary = await runTick(boot.db, {
      dispatcher: boot.dispatcher,
      stripe: boot.stripe,
      commissionBp: boot.env.BOOKING_COMMISSION_BP,
    });
    return json(summary, 200);
  } catch (err) {
    console.error('[worker-tick] tick failed', err);
    return json({ error: 'tick_failed' }, 500);
  }
}

Deno.serve(handler);
