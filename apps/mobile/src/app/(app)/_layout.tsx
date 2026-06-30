/**
 * Role-aware tab shell. The same six tab route files back all three roles; the
 * custom BottomNav decides which destinations (and order) show per role
 * (ADR-0011). Screens not in a role's nav are simply never surfaced.
 *
 * Flow screens reached from a tab (Provider detail, Booking compose, Message
 * thread, …) are registered with `href: null` so they're real navigable routes
 * without ever appearing in the tab bar.
 *
 * Foreign-tab guard: a role can still reach a tab it doesn't own by typing the
 * URL (e.g. a Caregiver opening /bookings, which only Parents/Providers have, or
 * a Provider opening /home). Those tabs have no layout for that role and would
 * fall back to another role's native screen — a stretched mobile view on desktop.
 * We redirect any such visit to the role's own landing tab so it never renders.
 */
import { Redirect, Tabs, useSegments, type Href } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { BottomNav } from '@/components/BottomNav';
import { ParentSubscriptionProvider } from '@/lib/ParentSubscriptionProvider';
import { ROLE_TABS, landingTab } from '@/lib/roles';

/** Every tab id any role owns — used to tell tab routes apart from flow routes. */
const ALL_TAB_IDS = new Set<string>(
  Object.values(ROLE_TABS).flatMap((tabs) => tabs.map((t) => t.id)),
);

export default function AppLayout() {
  const { role } = useAuth();
  // Cast to a plain string[]: expo-router types useSegments() as a route-derived
  // tuple whose generated shape varies (CI regenerates .expo/types), which made
  // segments[1] read as out-of-bounds in CI. We only need positional access.
  const segments = useSegments() as string[];
  if (!role) return null; // the auth gate will redirect away

  // Redirect a role away from a tab destination it doesn't own (manual URL /
  // deep link). Flow routes (href: null) aren't tab ids, so they pass through.
  const current = segments[1];
  if (current && ALL_TAB_IDS.has(current) && !ROLE_TABS[role].some((t) => t.id === current)) {
    return <Redirect href={`/(app)/${landingTab(role)}` as Href} />;
  }

  return (
    <ParentSubscriptionProvider>
    <Tabs tabBar={(props) => <BottomNav {...props} role={role} />} screenOptions={{ headerShown: false }}>
      {/* ── tab destinations (role-aware dispatchers) ─────────────── */}
      <Tabs.Screen name="home" />
      <Tabs.Screen name="opportunities" />
      <Tabs.Screen name="schedule" />
      <Tabs.Screen name="bookings" />
      <Tabs.Screen name="messages" />
      <Tabs.Screen name="account" />

      {/* ── account-reached editors (OH-184 / OH-188 / OH-189) ────── */}
      <Tabs.Screen name="verification" options={{ href: null }} />
      <Tabs.Screen name="profile-builder" options={{ href: null }} />
      <Tabs.Screen name="provider-profile" options={{ href: null }} />

      {/* Supply onboarding hub — landed on after role-claim (web), reached from
          the dashboard "Finish your setup" banner; never a tab. */}
      <Tabs.Screen name="onboarding" options={{ href: null }} />

      {/* ── demand-side flow routes (parent) ──────────────────────── */}
      {/* Ephemeral preview questionnaire — landed on once after Parent
          role-claim (and re-openable from Home "Adjust"); never a tab. */}
      <Tabs.Screen name="preview-questionnaire" options={{ href: null }} />
      <Tabs.Screen name="search" options={{ href: null }} />
      <Tabs.Screen name="provider-detail" options={{ href: null }} />
      <Tabs.Screen name="booking-compose" options={{ href: null }} />
      <Tabs.Screen name="booking-detail" options={{ href: null }} />
      <Tabs.Screen name="post-job" options={{ href: null }} />
      <Tabs.Screen name="job-applicants" options={{ href: null }} />
      <Tabs.Screen name="children" options={{ href: null }} />
      <Tabs.Screen name="parent-profile" options={{ href: null }} />
      <Tabs.Screen name="paywall" options={{ href: null }} />
      <Tabs.Screen name="consent" options={{ href: null }} />

      {/* ── messaging (shared) ────────────────────────────────────── */}
      <Tabs.Screen name="message-thread" options={{ href: null }} />

      {/* ── supply-side flow routes (caregiver / provider) ────────── */}
      <Tabs.Screen name="job-detail" options={{ href: null }} />
      <Tabs.Screen name="job-apply" options={{ href: null }} />
      <Tabs.Screen name="consult" options={{ href: null }} />
      <Tabs.Screen name="availability" options={{ href: null }} />
    </Tabs>
    </ParentSubscriptionProvider>
  );
}
