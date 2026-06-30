import '@/global.css';

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { PreviewProvider } from '@/preview/PreviewProvider';
import { landingTab, type Role } from '@/lib/roles';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <PreviewProvider>
            <StatusBar style="dark" />
            <RootNavigator />
          </PreviewProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { status, role } = useAuth();
  useAuthRedirect(status, role);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="role-claim" />
      <Stack.Screen name="(app)" />
    </Stack>
  );
}

/**
 * Auth gate. Keeps the user in the right top-level group for their state:
 *   anon                  → (auth)      (welcome / role-pick / sign-in / sign-up)
 *   authed, no role yet   → role-claim  (set the permanent role)
 *   authed, role set      → (app)/<role landing tab>, EXCEPT a Caregiver/Provider
 *                           who just claimed their role (entering from role-claim)
 *                           lands on the onboarding hub on web. Sign-ins enter from
 *                           (auth) and so go straight to the dashboard — which is the
 *                           "hub once after signup, dashboard on every later sign-in"
 *                           rule, decided by where the user is leaving from (no extra
 *                           state, no backend call).
 */
function useAuthRedirect(status: ReturnType<typeof useAuth>['status'], role: Role | null) {
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    const root = segments[0];
    const inAuth = root === '(auth)';
    const inRoleClaim = root === 'role-claim';
    const inApp = root === '(app)';

    // The password-recovery link establishes a real (role-less) session, which
    // would otherwise read as "authed, no role" and bounce to role-claim. Keep
    // the user on the reset-password screen until they've set a new password;
    // the screen routes onward (via "/") once that succeeds. (`includes` rather
    // than `segments[1]` so this typechecks against the untyped-routes fallback
    // segments tuple in CI, where the generated route types aren't present.)
    if (inAuth && segments.includes('reset-password')) return;

    if (status === 'anon') {
      if (!inAuth) router.replace('/(auth)/role-pick' as Href);
      return;
    }
    // authed
    if (!role) {
      if (!inRoleClaim) router.replace('/role-claim' as Href);
      return;
    }
    if (!inApp) {
      // The role lands in the token while still on role-claim (SupplyOnboarding's
      // refresh), so root === 'role-claim' here means "just onboarded".
      const justClaimedSupply = inRoleClaim && (role === 'caregiver' || role === 'provider');
      // A just-claimed Parent goes through the ephemeral preview questionnaire
      // (story 111) once before landing on the shell; returning sign-ins enter
      // from (auth), so inRoleClaim is false and they skip straight to Home.
      const justClaimedParent = inRoleClaim && role === 'parent';
      const dest = justClaimedSupply && Platform.OS === 'web'
        ? '/(app)/onboarding'
        : justClaimedParent
          ? '/(app)/preview-questionnaire'
          : `/(app)/${landingTab(role)}`;
      router.replace(dest as Href);
    }
  }, [status, role, segments, router]);
}
