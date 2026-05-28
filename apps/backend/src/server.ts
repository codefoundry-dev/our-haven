import { buildApp } from '@/app.js';
import { loadEnv } from '@/config/env.js';
import { createDb } from '@/db/kysely.js';
import { initQueue } from '@/jobs/queue.js';
import { initSupabase } from '@/supabase/admin.js';
import { initStorage } from '@/supabase/storage.js';
import { createCheckrAdapter } from '@/vendors/checkr.js';
import { createStripeAdapter } from '@/vendors/stripe.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const db = createDb(env);
  const supabase = initSupabase(env);
  const storage = initStorage(env, supabase.admin);
  const queue = initQueue(db);
  const stripe = createStripeAdapter({
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    connectWebhookSecret: env.STRIPE_CONNECT_WEBHOOK_SECRET,
    tax: {
      subscriptionTaxCode: env.STRIPE_TAX_SUBSCRIPTION_TAX_CODE,
      commissionTaxCode: env.STRIPE_TAX_COMMISSION_TAX_CODE,
      originState: env.STRIPE_TAX_ORIGIN_STATE,
    },
  });
  const backgroundCheck = createCheckrAdapter({
    apiKey: env.CHECKR_API_KEY,
    webhookSecret: env.CHECKR_WEBHOOK_SECRET,
    packageSlug: env.CHECKR_PACKAGE,
    apiBase: env.CHECKR_API_BASE,
  });

  const app = await buildApp({ env, db, supabase, storage, queue, stripe, backgroundCheck });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'received shutdown signal');
    await app.close();
    await db.destroy();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: '0.0.0.0', port: env.PORT });
  app.log.info(
    { supabaseUrl: env.SUPABASE_URL, bucket: env.SUPABASE_STORAGE_BUCKET },
    'our-haven backend ready',
  );
}

main().catch((err) => {
  console.error('fatal: failed to start backend', err);
  process.exit(1);
});
