/**
 * CaregiverPayouts (OH-221) — the read-only payouts list the Account tab's
 * "Payouts" row opens. A payout is a captured Booking (OH-211 — "the capture IS
 * the payout"); this screen only reads. Actual withdrawals + bank changes live
 * on the web portal (Account → Bank details & withdrawals), so this screen is
 * deliberately view-only and points there for money movement.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ApiError, getCaregiverPayouts, type CaregiverPayoutItem, type CaregiverPayoutList } from '@/api/client';
import { AppBar } from '@/components/AppBar';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(ymd: string): string {
  // `ymd` is a plain YYYY-MM-DD (no timezone); render it in a friendly form
  // without letting the local tz shift the day.
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const CATEGORY_LABEL: Record<string, string> = { babysitter: 'Babysitting', tutor: 'Tutoring', nanny: 'Nanny' };

export default function CaregiverPayouts() {
  const router = useRouter();
  const [data, setData] = useState<CaregiverPayoutList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await getCaregiverPayouts();
        if (alive) setData(d);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e.message : 'Could not load your payouts.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Screen scroll edges={['top']} contentStyle={styles.content}>
      <AppBar title="Payouts" onBack={() => router.back()} />

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <>
          {/* earnings glance */}
          <View style={styles.glance}>
            <Text style={styles.glanceLabel}>Total earned</Text>
            <Text style={styles.glanceValue}>{usd(data?.totalNetCents ?? 0)}</Text>
            <Text style={styles.glanceSub}>
              {data?.count ?? 0} {data?.count === 1 ? 'payout' : 'payouts'} · after platform fee
            </Text>
          </View>

          {data && data.payouts.length > 0 ? (
            data.payouts.map((p) => <PayoutRow key={p.bookingId} item={p} />)
          ) : (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Icon name="receipt" size={24} color={colors.ink3} />
              </View>
              <Text style={styles.emptyTitle}>No payouts yet</Text>
              <Text style={styles.emptySub}>
                Once you complete a paid booking, your earnings will show up here.
              </Text>
            </View>
          )}

          <Text style={styles.footNote}>
            To update your bank details or withdraw, go to Account → Bank details & withdrawals.
          </Text>
        </>
      )}
    </Screen>
  );
}

function PayoutRow({ item }: { item: CaregiverPayoutItem }) {
  const refunded = item.status === 'refunded';
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowTitle}>{item.category ? CATEGORY_LABEL[item.category] ?? item.category : 'Booking'}</Text>
        <Text style={styles.rowSub}>{formatDate(item.scheduledDate)}</Text>
        <Text style={styles.rowBreakdown}>
          {usd(item.grossCents)} gross · {usd(item.commissionCents)} fee
          {refunded ? ` · ${usd(item.refundedCents)} refunded` : ''}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowNet, refunded ? styles.rowNetMuted : null]}>{usd(item.netCents)}</Text>
        <View style={[styles.pill, refunded ? styles.pillRefunded : styles.pillPaid]}>
          <Text style={[styles.pillText, refunded ? styles.pillTextRefunded : styles.pillTextPaid]}>
            {refunded ? 'Refunded' : 'Paid'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32 },
  centre: { paddingVertical: 48, alignItems: 'center' },
  error: { fontFamily: fonts.regular, fontSize: 14, color: colors.danger, marginTop: 16 },

  glance: { backgroundColor: colors.ink, borderRadius: radii.xl, padding: 22, marginBottom: 8 },
  glanceLabel: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.inkInv,
    opacity: 0.6,
  },
  glanceValue: {
    fontFamily: fonts.bold,
    fontSize: 36,
    lineHeight: 40,
    letterSpacing: -1.2,
    color: colors.inkInv,
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  glanceSub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.inkInv, opacity: 0.65, marginTop: 6 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 16,
    marginTop: 10,
    ...shadow.e1,
  },
  rowLeft: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  rowSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 2 },
  rowBreakdown: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3, marginTop: 4, fontVariant: ['tabular-nums'] },
  rowRight: { alignItems: 'flex-end', gap: 6 },
  rowNet: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink, fontVariant: ['tabular-nums'] },
  rowNetMuted: { color: colors.ink3, textDecorationLine: 'line-through' },

  pill: { height: 22, paddingHorizontal: 10, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  pillPaid: { backgroundColor: 'rgba(47,122,77,0.12)' },
  pillRefunded: { backgroundColor: colors.surfaceAlt },
  pillText: { fontFamily: fonts.semibold, fontSize: 11 },
  pillTextPaid: { color: colors.success },
  pillTextRefunded: { color: colors.ink2 },

  empty: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 16, color: colors.ink },
  emptySub: { fontFamily: fonts.regular, fontSize: 13.5, color: colors.ink2, textAlign: 'center', marginTop: 6, lineHeight: 20 },

  footNote: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3, textAlign: 'center', marginTop: 24, lineHeight: 18 },
});
