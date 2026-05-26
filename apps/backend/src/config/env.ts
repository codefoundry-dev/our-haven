import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  GCP_PROJECT_ID: z.string().min(1),
  GCP_REGION: z
    .enum(['us-east1', 'us-east4'])
    .default('us-east1')
    .describe('Pinned to US per ADR-0004 + ADR-0009. us-east1 default, us-east4 fallback.'),
  FIRESTORE_LOCATION: z
    .literal('nam5')
    .default('nam5')
    .describe('Firestore US multi-region per ADR-0004 § 5.'),

  DATABASE_URL: z
    .string()
    .url()
    .describe('Postgres connection string. Cloud SQL in prod, local Postgres in dev.'),
  DATABASE_SSL: z.coerce.boolean().default(false),

  GCS_UPLOAD_BUCKET: z
    .string()
    .min(1)
    .describe('US-region GCS bucket for signed-URL uploads (ID docs, license docs, etc.).'),
  GCS_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(300),

  CLOUD_TASKS_QUEUE_BOOKING: z
    .string()
    .min(1)
    .default('booking-lifecycle')
    .describe('Cloud Tasks queue for booking 24h expiry + session 24h auto-confirm.'),
  CLOUD_TASKS_QUEUE_RETENTION: z
    .string()
    .min(1)
    .default('retention-planner')
    .describe('Cloud Tasks queue for retention/erasure jobs.'),

  FIREBASE_SERVICE_ACCOUNT_PATH: z
    .string()
    .optional()
    .describe(
      'Path to Firebase Admin service-account JSON. Omit in Cloud Run (uses workload identity / ADC).',
    ),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvForTests(): void {
  cached = null;
}
