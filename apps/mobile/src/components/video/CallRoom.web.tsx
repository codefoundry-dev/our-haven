/**
 * CallRoom (web, OH-216) — the embedded Daily.co room on React Native Web. The
 * native SDK (CallRoom.tsx) can't run in a browser, so web uses Daily's
 * browser SDK: a full-screen prebuilt call frame (mic/camera/leave controls
 * included) attached to the container's DOM node. Same private-room + per-user
 * meeting token contract as native.
 *
 * On RN-web a `View`'s ref is the underlying DOM element, which is exactly the
 * `HTMLElement` Daily's `createFrame` needs.
 */
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import DailyIframe, { type DailyCall } from '@daily-co/daily-js';

export interface CallRoomProps {
  roomUrl: string;
  token: string;
  onLeave: () => void;
}

export function CallRoom({ roomUrl, token, onLeave }: CallRoomProps) {
  const containerRef = useRef<View>(null);
  const frameRef = useRef<DailyCall | null>(null);

  useEffect(() => {
    const el = containerRef.current as unknown as HTMLElement | null;
    if (!el) return;

    // Daily permits only one call instance per page — tear down any stragglers.
    const existing = DailyIframe.getCallInstance();
    if (existing) existing.destroy();

    const frame = DailyIframe.createFrame(el, {
      showLeaveButton: true,
      iframeStyle: { width: '100%', height: '100%', border: '0' },
    });
    frameRef.current = frame;
    frame.on('left-meeting', onLeave);
    frame.join({ url: roomUrl, token }).catch(() => onLeave());

    return () => {
      frame.destroy();
      frameRef.current = null;
    };
    // onLeave is stable (the screen memoises the close handler).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomUrl, token]);

  return <View ref={containerRef} style={styles.fill} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1, width: '100%', height: '100%' },
});
