import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Env } from '@/config/env.js';

export interface SupabaseHandles {
  admin: SupabaseClient;
}

export function initSupabase(env: Env): SupabaseHandles {
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return { admin };
}
