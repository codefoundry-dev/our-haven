/**
 * ProviderConsultWeb — the clinical Provider's live consultation room on desktop
 * web. Content-only: the route dispatcher wraps this in
 * <WebShell role="provider" active="schedule">.
 *
 * Faithful to the native consult video surface (dark stage · remote participant ·
 * self-view PiP · mic/camera/chat/end controls) reframed as a two-column desktop
 * layout, with the context + log right column borrowed from the Claude Design web
 * project cp-web/cp-session.jsx (CPSessionLive).
 *
 * Consultation-centric per ADR-0011 / CONTEXT.md: clinical discussion and payment
 * happen OFF-PLATFORM. So unlike the caregiver session this has NO billing timer,
 * NO live earnings, NO "propose hours" / Stripe payout — the "LIVE" readout is a
 * plain call-status indicator. RN primitives only (renders via RN-web).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon, type IconName } from '@/components/Icon';
import { Card } from '@/components/ui/Card';
import { WebPageHeader } from '@/components/web/WebShell';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

interface LogEntry {
  t: string;
  label: string;
  dot: string;
}

const LOG: readonly LogEntry[] = [
  { t: '0m', label: 'Consultation joined', dot: colors.success },
  { t: '+6m', label: 'Reviewed sensory-regulation goals', dot: colors.ink2 },
  { t: '+18m', label: 'Modelled calm-down routine · breaks', dot: colors.ink2 },
];

export function ProviderConsultWeb() {
  const router = useRouter();
  const go = (r: string) => router.push(r as never);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  return (
    <View>
      <WebPageHeader greet="Provider · Live consultation" title="Consultation" actions={['message']} />

      <View style={styles.body}>
        <View style={styles.layout}>
          {/* ── left · the video stage ────────────────────────────── */}
          <View style={styles.mainCol}>
            <View style={styles.stage}>
              {/* status overlays */}
              <View style={styles.statusBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.statusText}>LIVE · 04:18</Text>
              </View>
              <View style={styles.modeBadge}>
                <Icon name="video" size={13} color={colors.inkInv} />
                <Text style={styles.modeText}>Video</Text>
              </View>

              {/* remote participant */}
              <View style={styles.remoteAvatar}>
                <Text style={styles.remoteInitial}>P</Text>
              </View>
              <Text style={styles.stageCaption}>OT consultation · Amara (6)</Text>

              {/* remote name tag */}
              <View style={styles.nameTag}>
                <Text style={styles.nameTagText}>Priya N. · Parent</Text>
              </View>

              {/* self-view PiP */}
              <View style={styles.pip}>
                <View style={styles.pipAvatar}>
                  <Icon name={camOn ? 'person' : 'camera-off'} size={22} color="rgba(251,247,239,0.7)" />
                </View>
                <Text style={styles.pipLabel}>You</Text>
              </View>
            </View>

            {/* control bar */}
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
              <ControlButton icon="message" label="Chat" onPress={() => go('/message-thread')} />
              <ControlButton icon="phone-off" label="End" danger onPress={() => router.back()} />
            </View>
          </View>

          {/* ── right · context + session log ─────────────────────── */}
          <View style={styles.sideCol}>
            {/* parent / family block */}
            <Card radius={radii.xl} padding={22} style={styles.sideCard}>
              <View style={styles.parentRow}>
                <View style={styles.parentAvatar}>
                  <Text style={styles.parentInitial}>P</Text>
                </View>
                <View style={styles.flexMin}>
                  <Text style={styles.parentName} numberOfLines={1}>
                    Priya N. · OT consultation
                  </Text>
                  <Text style={styles.parentSub}>For Amara (6) · 45 min · video</Text>
                </View>
                <Pressable onPress={() => go('/message-thread')} style={styles.iconBtn}>
                  <Icon name="message" size={18} color={colors.ink} />
                </Pressable>
              </View>

              <View style={styles.notesBox}>
                <Icon name="shield" size={15} color={colors.info} />
                <View style={styles.flexMin}>
                  <Text style={styles.notesKicker}>Notes from Priya · view-only</Text>
                  <Text style={styles.notesText}>
                    Sensory regulation focus. Amara settles best with short breaks. EpiPen on file — peanut allergy.
                  </Text>
                </View>
              </View>
            </Card>

            {/* session log */}
            <Card radius={radii.xl} padding={22} style={styles.sideCard}>
              <View style={styles.logHead}>
                <Text style={styles.secHead}>Session log</Text>
                <Pressable style={styles.addNote}>
                  <Icon name="plus" size={14} color={colors.ink} />
                  <Text style={styles.addNoteText}>Add note</Text>
                </Pressable>
              </View>
              {LOG.map((m) => (
                <View key={m.t} style={styles.logRow}>
                  <Text style={styles.logTime}>{m.t}</Text>
                  <View style={[styles.logDot, { backgroundColor: m.dot }]} />
                  <Text style={styles.logLabel}>{m.label}</Text>
                </View>
              ))}
              <View style={[styles.logRow, styles.logRowLast]}>
                <Text style={[styles.logTime, styles.logTimeNow]}>now</Text>
                <View style={[styles.logDot, styles.logDotNow]} />
                <Text style={styles.logLabelNow}>Consultation in progress…</Text>
              </View>
            </Card>

            {/* session notes editor */}
            <Pressable style={styles.notesEditor}>
              <Icon name="edit" size={16} color={colors.ink} />
              <Text style={styles.notesEditorText}>Session notes</Text>
              <Icon name="chevron-right" size={18} color={colors.ink3} />
            </Pressable>

            {/* off-platform reassurance */}
            <View style={styles.note}>
              <Icon name="info" size={18} color={colors.brand} />
              <Text style={styles.noteText}>
                Clinical discussion and payment happen off-platform. No session timer and no payout to confirm — the
                consultation auto-completes after the slot.
              </Text>
            </View>
          </View>
        </View>
      </View>
    </View>
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
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  flexMin: { flex: 1, minWidth: 0 },

  layout: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },
  mainCol: { flexGrow: 1.6, flexBasis: 560, minWidth: 360 },
  sideCol: { flexGrow: 1, flexBasis: 320, minWidth: 280, gap: 16 },

  // video stage
  stage: {
    height: 480,
    borderRadius: radii.xl,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  statusBadge: {
    position: 'absolute',
    top: 16,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(22,21,19,0.55)',
  },
  liveDot: { width: 8, height: 8, borderRadius: radii.pill, backgroundColor: colors.danger },
  statusText: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.4, color: colors.inkInv, fontVariant: ['tabular-nums'] },
  modeBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(251,247,239,0.12)',
  },
  modeText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.inkInv },

  remoteAvatar: {
    width: 120,
    height: 120,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(251,247,239,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  remoteInitial: { fontFamily: fonts.bold, fontSize: 44, color: colors.inkInv },
  stageCaption: { fontFamily: fonts.medium, fontSize: 14, color: 'rgba(251,247,239,0.7)', marginTop: 16 },
  nameTag: {
    position: 'absolute',
    left: 16,
    bottom: 16,
    height: 32,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(22,21,19,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameTagText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkInv },
  pip: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 120,
    height: 150,
    borderRadius: radii.md,
    backgroundColor: 'rgba(251,247,239,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(251,247,239,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  pipAvatar: {
    width: 52,
    height: 52,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(251,247,239,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pipLabel: { fontFamily: fonts.semibold, fontSize: 12, color: 'rgba(251,247,239,0.7)' },

  // control bar
  controls: { flexDirection: 'row', justifyContent: 'center', gap: 28, marginTop: 18 },
  control: { alignItems: 'center', gap: 8 },
  controlBtn: {
    width: 64,
    height: 64,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.e1,
  },
  controlLabel: { fontFamily: fonts.medium, fontSize: 12.5, color: colors.ink2 },

  // right column
  sideCard: { ...shadow.e1 },
  parentRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  parentAvatar: { width: 48, height: 48, borderRadius: radii.pill, backgroundColor: colors.catSpec, alignItems: 'center', justifyContent: 'center' },
  parentInitial: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink },
  parentName: { fontFamily: fonts.semibold, fontSize: 15.5, color: colors.ink },
  parentSub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2, marginTop: 2 },
  iconBtn: { width: 42, height: 42, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },

  notesBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 14, padding: 14, borderRadius: radii.sm, backgroundColor: colors.surfaceAlt },
  notesKicker: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.info },
  notesText: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: colors.ink, marginTop: 4 },

  logHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  secHead: { fontFamily: fonts.bold, fontSize: 11.5, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2 },
  addNote: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.surface },
  addNoteText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink },
  logRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  logRowLast: { borderBottomWidth: 0 },
  logTime: { width: 52, fontFamily: fonts.medium, fontSize: 11.5, color: colors.ink3, fontVariant: ['tabular-nums'], paddingTop: 1 },
  logTimeNow: { color: colors.info, fontFamily: fonts.semibold },
  logDot: { width: 9, height: 9, borderRadius: radii.pill, marginTop: 4 },
  logDotNow: { width: 11, height: 11, backgroundColor: colors.info },
  logLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 13.5, color: colors.ink },
  logLabelNow: { flex: 1, fontFamily: fonts.regular, fontSize: 13.5, color: colors.ink2, fontStyle: 'italic' },

  notesEditor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 52,
    paddingHorizontal: 16,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  notesEditorText: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },

  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: radii.md, backgroundColor: colors.brandSoft },
  noteText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2 },
});
