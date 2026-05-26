import { buildApp } from '@/app.js';
import { loadEnv } from '@/config/env.js';
import { createDb } from '@/db/kysely.js';
import { initFirebase } from '@/gcp/firebase.js';
import { initStorage } from '@/gcp/storage.js';
import { initTasks } from '@/gcp/tasks.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const db = createDb(env);
  const firebase = initFirebase(env);
  const storage = initStorage(env);
  const tasks = initTasks(env);

  const app = await buildApp({ env, db, firebase, storage, tasks });

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
    { region: env.GCP_REGION, firestoreLocation: env.FIRESTORE_LOCATION },
    'our-haven backend ready',
  );
}

main().catch((err) => {
  console.error('fatal: failed to start backend', err);
  process.exit(1);
});
