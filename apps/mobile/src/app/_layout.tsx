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
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/auth/AuthProvider';
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
          <StatusBar style="dark" />
          <RootNavigator />
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
 *   authed, role set      → (app)/<role landing tab>
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

    if (status === 'anon') {
      if (!inAuth) router.replace('/(auth)/role-pick' as Href);
      return;
    }
    // authed
    if (!role) {
      if (!inRoleClaim) router.replace('/role-claim' as Href);
      return;
    }
    if (!inApp) router.replace(`/(app)/${landingTab(role)}` as Href);
  }, [status, role, segments, router]);
}
