/**
 * Role-aware tab shell. The same six route files back all three roles; the
 * custom BottomNav decides which destinations (and order) show per role
 * (ADR-0011). Screens not in a role's nav are simply never surfaced.
 */
import { Tabs } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { BottomNav } from '@/components/BottomNav';

export default function AppLayout() {
  const { role } = useAuth();
  if (!role) return null; // the auth gate will redirect away

  return (
    <Tabs tabBar={(props) => <BottomNav {...props} role={role} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="home" />
      <Tabs.Screen name="opportunities" />
      <Tabs.Screen name="schedule" />
      <Tabs.Screen name="bookings" />
      <Tabs.Screen name="messages" />
      <Tabs.Screen name="account" />
      {/* Reached from Account, not the tab bar (OH-184 / OH-188 / OH-189). */}
      <Tabs.Screen name="verification" options={{ href: null }} />
      <Tabs.Screen name="profile-builder" options={{ href: null }} />
      <Tabs.Screen name="provider-profile" options={{ href: null }} />
      {/* Supply onboarding hub — landed on after role-claim (web), reached from the
          dashboard "Finish your setup" banner; never a tab. */}
      <Tabs.Screen name="onboarding" options={{ href: null }} />
    </Tabs>
  );
}
