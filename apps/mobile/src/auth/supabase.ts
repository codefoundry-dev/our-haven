/**
 * Supabase client for the unified app.
 *
 * Platform-aware session storage: AsyncStorage on native, the browser's
 * default (localStorage) on web. `detectSessionInUrl` is web-only (OAuth /
 * magic-link redirects). Native auto-refresh is driven from AppState below.
 *
 * Config comes from EXPO_PUBLIC_* env (inlined at build time by Expo). When it
 * is missing we fall back to a harmless placeholder so the app still boots and
 * renders — `isSupabaseConfigured` is then false and the UI surfaces a notice.
 */
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured && __DEV__) {
  console.warn(
    '[supabase] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are not set. ' +
      'Auth is disabled until you copy apps/mobile/.env.example to .env and fill them in.',
  );
}

const isWeb = Platform.OS === 'web';

export const supabase = createClient(url ?? 'https://placeholder.supabase.co', anonKey ?? 'public-anon-key', {
  auth: {
    storage: isWeb ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: isWeb,
  },
});

// Refresh the session while the app is foregrounded (native only).
if (!isWeb) {
  AppState.addEventListener('change', (next) => {
    if (next === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
