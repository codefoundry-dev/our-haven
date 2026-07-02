/**
 * Push notifications seam (native) — OH-223. The native half of the platform
 * split (web analogue: `notifications.web.ts`, same exported shape — the
 * `stripeClient` pattern), wiring expo-notifications to the OH-194 endpoint
 * tables via `PUT/DELETE /v1/notifications/push-tokens`:
 *
 *   - `registerForPush()`   — permission prompt → Expo push token → upsert. Runs
 *     on sign-in (root layout). Skips gracefully on a simulator, when the EAS
 *     projectId is absent (push not configured on this build), or when the user
 *     declines — the app never blocks on it.
 *   - `unregisterForPush()` — delete this device's token. Called BEFORE
 *     `supabase.auth.signOut()` (the API call needs the still-live session).
 *   - `useNotificationObserver(role)` — notification-tap → deep-link routing.
 *     Push `data.route` carries the domain mobile link (`ourhaven://thread/{id}`,
 *     `schedule/booking/{id}`, `booking/{id}`, `job/{id}` — see
 *     docs/notifications-deep-link-format.md); the app's actual routes are FLAT
 *     with query params, so `mapNotificationRoute` translates, role-aware (a
 *     Parent's booking surface is /booking-detail; supply's is the Schedule tab).
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { deletePushToken, registerPushToken } from '@/api/client';
import type { Role } from '@/lib/roles';

// Foreground presentation: show the banner (the tap deep-links); no sound/badge
// noise in v1 (matches CONTEXT's quiet-by-default posture outside SMS urgency).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** The token this app session registered — lets sign-out delete the right row. */
let registeredToken: string | null = null;

function easProjectId(): string | null {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  return fromConfig ?? Constants.easConfig?.projectId ?? null;
}

/** Android 13+ requires a channel to exist before the permission prompt/token. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Our Haven',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

async function ensurePermission(): Promise<boolean> {
  const settings = await Notifications.getPermissionsAsync();
  const granted = (s: Notifications.NotificationPermissionsStatus) =>
    s.granted ||
    s.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    s.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED;
  if (granted(settings)) return true;
  if (!settings.canAskAgain) return false;
  return granted(await Notifications.requestPermissionsAsync());
}

/**
 * Register this device for push (all roles — the one unified app). Safe to call
 * on every sign-in: the endpoint upserts on the token and re-points a shared
 * device to the current account. Every skip path is silent-by-design.
 * `opts.interactive` exists for signature parity with the web seam (where a
 * user gesture is required to prompt); native prompts via the OS dialog either way.
 */
export async function registerForPush(_opts: { interactive?: boolean } = {}): Promise<void> {
  if (!Device.isDevice) return; // simulator/emulator — Expo push unavailable
  const projectId = easProjectId();
  if (!projectId) {
    console.warn('[notifications] no EAS projectId in app config — push registration skipped');
    return;
  }
  await ensureAndroidChannel();
  if (!(await ensurePermission())) return;

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await registerPushToken({
    expoPushToken: token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  registeredToken = token;
}

/**
 * Drop this device's token (sign-out). Falls back to re-deriving the token when
 * the module state is cold (sign-out in a later app session) — possible without
 * a prompt because permission was already granted at registration time.
 */
export async function unregisterForPush(): Promise<void> {
  try {
    let token = registeredToken;
    registeredToken = null;
    if (!token) {
      if (!Device.isDevice) return;
      const projectId = easProjectId();
      if (!projectId) return;
      const settings = await Notifications.getPermissionsAsync();
      if (!settings.granted && settings.ios?.status !== Notifications.IosAuthorizationStatus.AUTHORIZED) return;
      token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    }
    await deletePushToken(token);
  } catch (e) {
    // Best-effort: a dead token is also pruned server-side on DeviceNotRegistered.
    console.warn('[notifications] push unregister failed', e);
  }
}

/**
 * Domain deep-link path → app route. The domain link's path (post-scheme) is one
 * of the CHANNEL_MATRIX route templates; the app's routes are flat + query-param
 * (see (app)/_layout.tsx). Role decides the booking/job surface. Null = no-op
 * (unknown path or a role we can't place — never a crash from a stale push).
 */
export function mapNotificationRoute(
  route: string,
  role: Role | null,
): { pathname: string; params?: Record<string, string> } | null {
  const path = route.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\/+/, '');
  const segments = path.split('/').filter((s) => s.length > 0);
  const [head] = segments;
  const id = decodeURIComponent(segments[segments.length - 1] ?? '');
  if (!head || !id) return null;

  if (head === 'thread') return { pathname: '/message-thread', params: { threadId: id } };
  if (head === 'booking' || (head === 'schedule' && segments[1] === 'booking')) {
    // Parent: the shared booking detail. Supply: their Schedule tab (the
    // parent-scoped /booking-detail API would 404 for them).
    return role === 'parent'
      ? { pathname: '/booking-detail', params: { bookingId: id } }
      : { pathname: '/schedule' };
  }
  if (head === 'job') {
    return role === 'parent'
      ? { pathname: '/job-applicants', params: { jobId: id } }
      : { pathname: '/job-detail', params: { jobId: id } };
  }
  return null;
}

/**
 * Notification-tap → route. Covers both the cold start (the tap that launched
 * the app, via `useLastNotificationResponse`) and warm taps (the response
 * listener); the handled-identifier ref dedupes the overlap. Waits for `role`
 * so a cold-start tap routes correctly once the session resolves.
 */
export function useNotificationObserver(role: Role | null): void {
  const handled = useRef<string | null>(null);
  const lastResponse = Notifications.useLastNotificationResponse();

  useEffect(() => {
    function redirect(notification: Notifications.Notification): void {
      const route = (notification.request.content.data as { route?: unknown } | null)?.route;
      if (typeof route !== 'string') return;
      const dest = mapNotificationRoute(route, role);
      if (!dest) return;
      // Cast: pathname is runtime-derived, so it can't narrow to the generated
      // typed-routes union (and CI typechecks without the generated route types).
      router.push({ pathname: dest.pathname, params: dest.params } as Href);
    }

    if (role && lastResponse?.notification) {
      const id = lastResponse.notification.request.identifier;
      if (handled.current !== id) {
        handled.current = id;
        redirect(lastResponse.notification);
      }
    }

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const id = response.notification.request.identifier;
      if (handled.current === id) return;
      handled.current = id;
      redirect(response.notification);
    });
    return () => sub.remove();
  }, [role, lastResponse]);
}
