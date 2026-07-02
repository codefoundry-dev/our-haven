/**
 * NotificationPreferences (OH-221) — the Account tab's "Notifications" settings.
 * Per-channel opt-outs the worker-tick dispatcher honours: Push + Email are live
 * toggles; SMS is shown as an always-on informational row because the platform
 * only sends SMS for safety-critical events (CONTEXT § Notifications), which are
 * never suppressed. Web-push is a browser-only channel and isn't surfaced here.
 *
 * Toggles are optimistic: flip the switch, PATCH the one channel, and revert on
 * failure so the UI never drifts from what the server stored.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import {
  ApiError,
  getNotificationPreferences,
  patchNotificationPreferences,
  type NotificationPreferences,
} from '@/api/client';
import { AppBar } from '@/components/AppBar';
import { Icon, type IconName } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Toggle } from '@/components/ui/Toggle';
import { useNotificationPrefs } from '@/lib/notificationPrefs';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

/** The two channels a mobile recipient can opt out of (web-push is browser-only). */
type ToggleChannel = 'push' | 'email';

export default function NotificationPreferencesScreen() {
  const router = useRouter();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Marketing opt-in (OH-223) — a SEPARATE consent from the channel opt-outs
  // above (CONTEXT § Notifications); its own store + route.
  const marketing = useNotificationPrefs();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await getNotificationPreferences();
        if (alive) {
          setError(null);
          setPrefs(p);
        }
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e.message : 'Could not load your preferences.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const toggle = useCallback(
    async (channel: ToggleChannel) => {
      if (!prefs || saving) return;
      const next = !prefs[channel];
      const previous = prefs;
      setPrefs({ ...prefs, [channel]: next }); // optimistic
      setError(null);
      setSaving(true);
      try {
        const saved = await patchNotificationPreferences({ [channel]: next });
        setPrefs(saved);
      } catch (e) {
        setPrefs(previous); // revert
        setError(e instanceof ApiError ? e.message : 'Could not save. Please try again.');
      } finally {
        setSaving(false);
      }
    },
    [prefs, saving],
  );

  return (
    <Screen scroll edges={['top']} contentStyle={styles.content}>
      <AppBar title="Notifications" onBack={() => router.back()} />

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : error && !prefs ? (
        <Text style={styles.error}>{error}</Text>
      ) : prefs ? (
        <>
          <Text style={styles.intro}>Choose how we reach you about bookings, messages, and payouts.</Text>

          <ToggleRow
            icon="bell"
            title="Push notifications"
            sub="Alerts on this device."
            on={prefs.push}
            onPress={() => toggle('push')}
          />
          <ToggleRow
            icon="send"
            title="Email"
            sub="Summaries and receipts to your inbox."
            on={prefs.email}
            onPress={() => toggle('email')}
          />

          {/* SMS is safety-critical and always on — shown as info, not a toggle. */}
          <View style={styles.infoRow}>
            <View style={styles.rowIcon}>
              <Icon name="phone" size={18} color={colors.brand} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Text messages</Text>
              <Text style={styles.rowSub}>Critical safety and time-sensitive alerts are always sent by SMS.</Text>
            </View>
            <View style={styles.alwaysPill}>
              <Text style={styles.alwaysText}>Always on</Text>
            </View>
          </View>

          {/* Marketing is a separate opt-IN, distinct from the transactional
              channels above (OH-223; CONTEXT § Notifications). */}
          <ToggleRow
            icon="sparkle"
            title="Marketing emails"
            sub="News, tips and offers — separate from booking alerts."
            on={marketing.marketingOptIn}
            onPress={() => {
              if (!marketing.loading && !marketing.saving) {
                marketing.setMarketingOptIn(!marketing.marketingOptIn);
              }
            }}
          />
          {marketing.error ? <Text style={styles.error}>{marketing.error}</Text> : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </>
      ) : null}
    </Screen>
  );
}

function ToggleRow({
  icon,
  title,
  sub,
  on,
  onPress,
}: {
  icon: IconName;
  title: string;
  sub: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Icon name={icon} size={18} color={colors.brand} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <Toggle on={on} onPress={onPress} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32 },
  centre: { paddingVertical: 48, alignItems: 'center' },
  error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger, marginTop: 12 },
  intro: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, marginTop: 4, marginBottom: 12, lineHeight: 20 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 16,
    marginTop: 10,
    ...shadow.e1,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 16,
    marginTop: 10,
    ...shadow.e1,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  rowSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 2, lineHeight: 18 },

  alwaysPill: { height: 24, paddingHorizontal: 11, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  alwaysText: { fontFamily: fonts.semibold, fontSize: 11.5, color: colors.ink2 },
});
