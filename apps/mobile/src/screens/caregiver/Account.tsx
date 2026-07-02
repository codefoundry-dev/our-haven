/**
 * CaregiverAccount (OH-221) — the Caregiver's Account tab. Fleshes out the thin
 * shared Account body into the three sections the web control panel shows
 * (screens/web/cp/Account.tsx): Listing & profile (mobile-native edits — the
 * same screens as web), Bank & payouts (Stripe-hosted KYC opened in an in-app
 * browser + a read-only payouts list + a "Finish on web →" handoff for the
 * step-up-MFA'd bank/withdrawal management, PRD story 80), and Settings
 * (notification preferences + sign out).
 *
 * The heavy payout actions stay web-of-record: KYC is a Stripe-hosted link
 * (createConnectOnboardingLink) and bank/withdrawal is a signed handoff to the
 * web portal (createWebHandoff) — neither is re-implemented natively.
 */
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  ApiError,
  createConnectOnboardingLink,
  createWebHandoff,
  getConnectSummary,
  type CaregiverConnectSummary,
} from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Icon, type IconName } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { openHostedFlow, openManagementUrl } from '@/lib/linkout';
import { ROLE_CARDS } from '@/lib/roles';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

/** Derive the payout-account status pill + primary action from the Connect summary. */
function connectStatus(summary: CaregiverConnectSummary | null): {
  label: string;
  tone: 'ok' | 'pending' | 'neutral';
  action: string;
  sub: string;
} {
  if (!summary || !summary.hasAccount) {
    return {
      label: 'Not set up',
      tone: 'neutral',
      action: 'Set up payouts',
      sub: 'Onboard with Stripe to get paid for your bookings.',
    };
  }
  if (summary.accountReady) {
    return { label: 'Active', tone: 'ok', action: 'Manage', sub: 'Your payout account is verified and active.' };
  }
  if (summary.disabledReason) {
    return {
      label: 'Action needed',
      tone: 'pending',
      action: 'Continue',
      sub: 'Stripe needs more information to enable payouts.',
    };
  }
  if (summary.detailsSubmitted) {
    return { label: 'In review', tone: 'pending', action: 'Continue', sub: 'Stripe is reviewing your details.' };
  }
  return { label: 'Incomplete', tone: 'pending', action: 'Continue setup', sub: 'Finish onboarding to receive payouts.' };
}

export default function CaregiverAccount() {
  const router = useRouter();
  const { session, role, signOut } = useAuth();

  const meta = (session?.user?.user_metadata ?? {}) as { first_name?: string; last_name?: string };
  const first = meta.first_name ?? '';
  const last = meta.last_name ?? '';
  const email = session?.user?.email ?? '';
  const name = [first, last].filter(Boolean).join(' ') || 'Your account';
  const initials = `${(first[0] ?? email[0] ?? '?').toUpperCase()}${(last[0] ?? '').toUpperCase()}`;

  const [summary, setSummary] = useState<CaregiverConnectSummary | null>(null);
  const [connectBusy, setConnectBusy] = useState(false);
  const [bankBusy, setBankBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await getConnectSummary());
    } catch {
      // A caregiver who hasn't been screened yet has no Connect account — leave
      // the summary null (the "Not set up" state) rather than surfacing an error.
      setSummary(null);
    }
  }, []);

  // Refetch on focus so returning from the Stripe-hosted KYC flow reflects the
  // account's new capabilities (the account.updated webhook mirrors them).
  useFocusEffect(
    useCallback(() => {
      void loadSummary();
    }, [loadSummary]),
  );

  const startKyc = useCallback(async () => {
    setError(null);
    setConnectBusy(true);
    try {
      const { url } = await createConnectOnboardingLink();
      await openHostedFlow(url, 'account');
      await loadSummary();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : 'Could not open Stripe onboarding. Please try again.',
      );
    } finally {
      setConnectBusy(false);
    }
  }, [loadSummary]);

  const openBankOnWeb = useCallback(async () => {
    setError(null);
    setBankBusy(true);
    try {
      const { url } = await createWebHandoff('/account');
      await openManagementUrl(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not open the web portal. Please try again.');
    } finally {
      setBankBusy(false);
    }
  }, []);

  const status = connectStatus(summary);
  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : '';

  return (
    <Screen scroll edges={['top']} contentStyle={styles.content}>
      <View style={styles.appBar}>
        <Text style={styles.heading}>Account</Text>
      </View>

      {/* profile hero */}
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.initials}>{initials}</Text>
        </View>
        <View style={styles.identity}>
          <Text style={styles.name}>{name}</Text>
          {email ? <Text style={styles.email}>{email}</Text> : null}
          {role ? (
            <View style={styles.roleChip}>
              <Icon name={ROLE_CARDS[role].icon} size={13} color={colors.ink} />
              <Text style={styles.roleText}>{roleLabel}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* ── Listing & profile ─────────────────────────────────────── */}
      <Text style={styles.secHead}>Listing & profile</Text>
      <LinkRow
        icon="person"
        title="Public profile"
        sub="Photo, bio, ages & comfort — what Parents see."
        onPress={() => router.push('/profile-builder')}
      />
      <LinkRow
        icon="dollar"
        title="Rates & pricing"
        sub="Per-category hourly rate, surcharge & negotiation."
        onPress={() => router.push('/profile-builder')}
      />
      <LinkRow
        icon="pin"
        title="Availability"
        sub="The days and times you can take work."
        onPress={() => router.push('/availability')}
      />
      <LinkRow
        icon="shield"
        title="Verification"
        sub="ID, background check & credentials."
        onPress={() => router.push('/verification')}
      />

      {/* ── Bank & payouts ────────────────────────────────────────── */}
      <Text style={styles.secHead}>Bank & payouts</Text>
      <LinkRow
        icon="briefcase"
        title="Payout account"
        sub={status.sub}
        statusText={status.label}
        statusTone={status.tone}
        actionLabel={status.action}
        busy={connectBusy}
        onPress={startKyc}
      />
      <LinkRow
        icon="receipt"
        title="Payouts"
        sub="Your captured earnings and payout history."
        onPress={() => router.push('/payouts' as Href)}
      />
      <LinkRow
        icon="lock"
        title="Bank details & withdrawals"
        sub="Update your bank or withdraw — finish on web →"
        busy={bankBusy}
        onPress={openBankOnWeb}
      />

      {/* ── Settings ──────────────────────────────────────────────── */}
      <Text style={styles.secHead}>Settings</Text>
      <LinkRow
        icon="bell"
        title="Notifications"
        sub="Choose how we reach you about bookings and messages."
        onPress={() => router.push('/notification-preferences' as Href)}
      />

      <View style={styles.signOut}>
        <PrimaryButton onPress={signOut}>Sign out</PrimaryButton>
      </View>
    </Screen>
  );
}

/** A tappable settings row (its own card), optionally with a status pill / busy spinner. */
function LinkRow({
  icon,
  title,
  sub,
  onPress,
  statusText,
  statusTone = 'neutral',
  actionLabel,
  busy = false,
}: {
  icon: IconName;
  title: string;
  sub: string;
  onPress: () => void;
  statusText?: string;
  statusTone?: 'ok' | 'pending' | 'neutral';
  actionLabel?: string;
  busy?: boolean;
}) {
  const toneStyle =
    statusTone === 'ok' ? styles.pillOk : statusTone === 'pending' ? styles.pillPending : styles.pillNeutral;
  const toneText =
    statusTone === 'ok' ? styles.pillTextOk : statusTone === 'pending' ? styles.pillTextPending : styles.pillTextNeutral;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      style={({ pressed }) => [styles.linkCard, { opacity: pressed || busy ? 0.85 : 1 }]}
    >
      <View style={styles.linkIcon}>
        <Icon name={icon} size={18} color={colors.brand} />
      </View>
      <View style={styles.linkText}>
        <Text style={styles.linkTitle}>{title}</Text>
        <Text style={styles.linkSub}>{sub}</Text>
        {actionLabel ? <Text style={styles.actionLabel}>{actionLabel}</Text> : null}
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={colors.brand} />
      ) : statusText ? (
        <View style={[styles.pill, toneStyle]}>
          <Text style={[styles.pillText, toneText]}>{statusText}</Text>
        </View>
      ) : (
        <Icon name="chevron-right" size={20} color={colors.ink3} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32 },
  appBar: { paddingTop: 8, paddingBottom: 16 },
  heading: { fontFamily: fonts.bold, fontSize: 26, letterSpacing: -0.6, color: colors.ink },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 16,
    ...shadow.e1,
  },
  avatar: { width: 56, height: 56, borderRadius: radii.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: fonts.bold, fontSize: 20, color: colors.inkInv },
  identity: { flex: 1, minWidth: 0 },
  name: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.3, color: colors.ink },
  email: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 2 },
  roleChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
  },
  roleText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink },

  error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger, marginTop: 12 },

  secHead: {
    fontFamily: fonts.bold,
    fontSize: 11.5,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.ink2,
    marginTop: 24,
    marginBottom: 4,
  },

  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 16,
    marginTop: 10,
    ...shadow.e1,
  },
  linkIcon: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: { flex: 1, minWidth: 0 },
  linkTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  linkSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 2 },
  actionLabel: { fontFamily: fonts.semibold, fontSize: 13, color: colors.brand, marginTop: 6 },

  pill: { height: 24, paddingHorizontal: 11, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  pillOk: { backgroundColor: 'rgba(47,122,77,0.12)' },
  pillPending: { backgroundColor: 'rgba(180,120,20,0.14)' },
  pillNeutral: { backgroundColor: colors.surfaceAlt },
  pillText: { fontFamily: fonts.semibold, fontSize: 11.5 },
  pillTextOk: { color: colors.success },
  pillTextPending: { color: '#8A5A00' },
  pillTextNeutral: { color: colors.ink2 },

  signOut: { marginTop: 28 },
});
