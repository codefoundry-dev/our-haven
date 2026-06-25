import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Env } from '../config/env.ts';

/**
 * Management-plane handles for the `api` Edge Function (port of
 * apps/backend/src/supabase/admin.ts). The service-role admin client performs
 * privileged Auth operations — writing custom role claims to `app_metadata`
 * (role-claim, OH-175), reading users for verification mirroring, etc.
 * Server-only: the service-role key is never exposed to clients.
 *
 * On a deployed Edge Function `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are
 * auto-injected by the platform; tests pass a stub via AppDeps.
 */
export interface SupabaseHandles {
  admin: SupabaseClient;
}

export function initSupabase(env: Env): SupabaseHandles {
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return { admin };
}
