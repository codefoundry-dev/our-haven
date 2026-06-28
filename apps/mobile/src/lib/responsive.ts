/**
 * Web responsive breakpoint — the single source of truth for when the web build
 * shows its desktop chrome versus the native mobile experience.
 *
 * At and above WEB_WIDE_BREAKPOINT the `.web.tsx` route dispatchers render the
 * desktop side-rail shells (WebShell / ParentWebShell) and the floating BottomNav
 * hides. Below it — i.e. a phone-width browser — the web build falls back to the
 * exact same native mobile screens + floating BottomNav, so the mobile web views
 * match the native mobile designs (no desktop layout squeezed into a narrow column).
 *
 * Consumed by WebShell, ParentWebShell, BottomNav and every role-aware
 * `.web.tsx` tab/flow route. Keep these in sync by importing from here.
 */
import { Platform, useWindowDimensions } from 'react-native';

export const WEB_WIDE_BREAKPOINT = 900;

/**
 * True when the desktop web chrome should show: web platform AND a viewport at
 * least WEB_WIDE_BREAKPOINT wide. Native always returns false (it has no desktop
 * chrome), so callers render the native mobile screen on native and narrow web.
 */
export function useWebWide(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= WEB_WIDE_BREAKPOINT;
}
