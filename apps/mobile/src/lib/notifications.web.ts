/**
 * Push notifications seam (web) — OH-223. The web analogue of `notifications.ts`
 * (native): identical exported shape so callers are platform-blind (the
 * `stripeClient` pattern). Wires VAPID web-push to
 * `PUT/DELETE /v1/notifications/web-push`:
 *
 *   - `registerForPush()` — service-worker + PushManager subscribe. On the
 *     automatic sign-in call it is SILENT: it only subscribes when the browser
 *     permission is already granted (modern browsers block/penalise permission
 *     prompts outside a user gesture). Pass `{ interactive: true }` from a
 *     button press (Account → "Enable browser notifications") to prompt.
 *   - `unregisterForPush()` — unsubscribe + delete the endpoint row.
 *   - `useNotificationObserver()` — no-op on web: a web-push click is handled by
 *     the service worker (public/sw.js), which focuses/opens the app; v1 sends
 *     an empty tickle with no per-event payload to route by.
 *
 * Requires EXPO_PUBLIC_VAPID_PUBLIC_KEY (the pair's private half lives on
 * worker-tick). Absent → every call is a silent no-op, matching the repo's
 * unconfigured-vendor posture.
 */
import { deleteWebPushSubscription, registerWebPushSubscription } from '@/api/client';
import type { Role } from '@/lib/roles';

const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** RFC 7515 base64url VAPID key → the Uint8Array PushManager wants. */
function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function registerForPush(opts: { interactive?: boolean } = {}): Promise<void> {
  if (!pushSupported() || !VAPID_PUBLIC_KEY) return;

  let permission = Notification.permission;
  if (permission === 'default' && opts.interactive) {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') return;

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as BufferSource,
      }));

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;
    await registerWebPushSubscription({
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    });
  } catch (e) {
    // Best-effort channel (CONTEXT: web push is the tickle, email/SMS carry the content).
    console.warn('[notifications] web-push subscribe failed', e);
  }
}

export async function unregisterForPush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration('/sw.js');
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    await deleteWebPushSubscription(subscription.endpoint).catch(() => {});
    await subscription.unsubscribe();
  } catch (e) {
    console.warn('[notifications] web-push unsubscribe failed', e);
  }
}

/** Web tap-routing lives in the service worker (sw.js); nothing to observe here. */
export function useNotificationObserver(_role: Role | null): void {
  // no-op on web
}
