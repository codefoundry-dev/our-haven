/**
 * Consultation session (live) — the Provider's in-call surface (ADR-0011).
 * A dark video stage with participant labels, a self-view PiP, a session-notes
 * affordance and a control bar of circular buttons (mic, camera, end-call in
 * danger, chat). Reached from the Schedule "Join" action. UI-only scaffold.
 *
 * Design reference: Claude design project — screens/provider-session.jsx /
 * screens/video-call.jsx (ScreenVideoCallRoom), adapted to RN primitives.
 *
 * This is the native (and narrow-web) body; the desktop layout lives in
 * `@/screens/web/cp/Consult` and is chosen by `consult.web.tsx`.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Icon, type IconName } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

export default function ConsultScreen() {
  const router = useRouter();
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  return (
    <Screen edges={['top']} contentStyle={styles.content}>
      <AppBar
        onBack={() => router.back()}
        title="Consultation"
        actions={[{ icon: 'dots', label: 'More' }]}
      />

      {/* Live status */}
      <View style={styles.statusRow}>
        <View style={styles.liveDot} />
        <Text style={styles.statusText}>LIVE · 04:18</Text>
        <View style={styles.modeBadge}>
          <Icon name="video" size={12} color={colors.ink2} />
          <Text style={styles.modeText}>Video</Text>
        </View>
      </View>

      {/* Video stage — dark surface, remote participant centered */}
      <View style={styles.stage}>
        <View style={styles.remoteAvatar}>
          <Text style={styles.remoteInitial}>P</Text>
        </View>
        <Text style={styles.stageCaption}>OT consultation · Amara (6)</Text>

        {/* Remote name label */}
        <View style={[styles.nameTag, styles.nameTagRemote]}>
          <Text style={styles.nameTagText}>Priya N. · Parent</Text>
        </View>

        {/* Self-view PiP */}
        <View style={styles.pip}>
          <View style={styles.pipAvatar}>
            <Icon name={camOn ? 'person' : 'camera-off'} size={20} color="rgba(251,247,239,0.7)" />
          </View>
          <Text style={styles.pipLabel}>You</Text>
        </View>
      </View>

      {/* Session notes affordance */}
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.notesBtn, { opacity: pressed ? 0.85 : 1 }]}
      >
        <Icon name="edit" size={16} color={colors.ink} />
        <Text style={styles.notesText}>Session notes</Text>
        <Icon name="chevron-right" size={18} color={colors.ink3} />
      </Pressable>

      {/* Control bar */}
      <View style={styles.controls}>
        <ControlButton
          icon={micOn ? 'mic' : 'mic-off'}
          label={micOn ? 'Mute' : 'Unmute'}
          off={!micOn}
          onPress={() => setMicOn((v) => !v)}
        />
        <ControlButton
          icon={camOn ? 'video' : 'camera-off'}
          label={camOn ? 'Camera' : 'Camera off'}
          off={!camOn}
          onPress={() => setCamOn((v) => !v)}
        />
        <ControlButton icon="message" label="Chat" onPress={() => router.push('/message-thread')} />
        <ControlButton icon="phone-off" label="End" danger onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

function ControlButton({
  icon,
  label,
  danger,
  off,
  onPress,
}: {
  icon: IconName;
  label: string;
  danger?: boolean;
  off?: boolean;
  onPress?: () => void;
}) {
  const filled = danger || off;
  const bg = danger ? colors.danger : off ? colors.ink : colors.surface;
  const fg = filled ? colors.inkInv : colors.ink;
  return (
    <View style={styles.control}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.controlBtn, { backgroundColor: bg, opacity: pressed ? 0.85 : 1 }]}
      >
        <Icon name={icon} size={24} color={fg} />
      </Pressable>
      <Text style={styles.controlLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingBottom: 16 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  liveDot: { width: 8, height: 8, borderRadius: radii.pill, backgroundColor: colors.danger },
  statusText: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.4, color: colors.ink2, fontVariant: ['tabular-nums'] },
  modeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginLeft: 'auto',
    height: 24,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
  },
  modeText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink2 },

  stage: {
    flex: 1,
    marginTop: 14,
    borderRadius: radii.xl,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  remoteAvatar: {
    width: 96,
    height: 96,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(251,247,239,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  remoteInitial: { fontFamily: fonts.bold, fontSize: 36, color: colors.inkInv },
  stageCaption: { fontFamily: fonts.medium, fontSize: 13, color: 'rgba(251,247,239,0.7)', marginTop: 14 },
  nameTag: {
    position: 'absolute',
    height: 30,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(22,21,19,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameTagRemote: { left: 14, bottom: 14 },
  nameTagText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.inkInv },
  pip: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    width: 92,
    height: 120,
    borderRadius: radii.md,
    backgroundColor: 'rgba(251,247,239,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(251,247,239,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pipAvatar: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(251,247,239,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pipLabel: { fontFamily: fonts.semibold, fontSize: 11, color: 'rgba(251,247,239,0.7)' },

  notesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 52,
    paddingHorizontal: 16,
    marginTop: 14,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  notesText: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },

  controls: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18, paddingHorizontal: 8 },
  control: { alignItems: 'center', gap: 8 },
  controlBtn: {
    width: 60,
    height: 60,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.e1,
  },
  controlLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink2 },
});
