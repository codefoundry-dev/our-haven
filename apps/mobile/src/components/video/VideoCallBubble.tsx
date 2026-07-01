/**
 * VideoCallBubble (OH-216) — the inline "Join video call" affordance a
 * `kind: 'video_call'` message renders as, in place of a chat bubble. Either
 * party sees a Join button (the initiator can re-join their own call); tapping it
 * mints a fresh token and opens the embedded room. Shared across native + web
 * (RN primitives → RN-web). Presentational only — the thread owns the join call.
 *
 * The ~30-minute validity is server-authoritative: a join past the window returns
 * 410 and the thread surfaces "this call is no longer available", so the bubble
 * stays simple (no client-side clock) and always offers Join.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

export interface VideoCallBubbleProps {
  /** The viewer started this call. */
  mine: boolean;
  joining?: boolean;
  onJoin: () => void;
}

export function VideoCallBubble({ mine, joining, onJoin }: VideoCallBubbleProps) {
  return (
    <View style={[styles.wrap, mine ? styles.wrapMe : styles.wrapThem]}>
      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <Icon name="video" size={18} color={colors.brand} />
        </View>
        <View style={styles.body}>
          <Text style={styles.title}>{mine ? 'You started a video call' : 'Video call'}</Text>
          <Text style={styles.sub}>Tap to join — valid ~30 min</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Join video call"
          disabled={joining}
          onPress={onJoin}
          style={({ pressed }) => [styles.joinBtn, (pressed || joining) && styles.joinPressed]}
        >
          <Icon name="video" size={14} color={colors.inkInv} />
          <Text style={styles.joinText}>{joining ? 'Joining…' : 'Join'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { maxWidth: '82%' },
  wrapMe: { alignSelf: 'flex-end' },
  wrapThem: { alignSelf: 'flex-start' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    ...shadow.e1,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flexShrink: 1, minWidth: 0 },
  title: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  sub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 1 },
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.brand,
  },
  joinPressed: { opacity: 0.7 },
  joinText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkInv },
});
