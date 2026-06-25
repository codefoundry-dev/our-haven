/**
 * SupplyOnboarding — the permanent role-claim step for supply roles (OH-183).
 * A Caregiver selects one or more categories (Babysitter / Tutor / Nanny —
 * ADR-0015); a Provider selects a clinical specialty (ADR-0011). Both capture a
 * resident state. On submit it claims the role via POST /v1/auth/role-claim
 * (which also persists the `providers` row) and refreshes the session so the
 * auth gate routes into the app. Reached after email/password OR Google sign-up.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ApiError, roleClaim } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { RolePill } from '@/components/ui/RolePill';
import { SelectableCard } from '@/components/ui/SelectableCard';
import { StatePicker } from '@/components/ui/StatePicker';
import {
  CATEGORY_OPTIONS,
  SPECIALTY_OPTIONS,
  type Category,
  type Specialty,
  type StateCode,
} from '@/lib/supply';
import { colors, fonts } from '@/theme/tokens';

const COPY = {
  caregiver: {
    title: 'Set up your Caregiver profile.',
    subtitle: 'Pick the services you offer and where you’re based. You can be more than one.',
    sectionTitle: 'What do you offer?',
    sectionHint: 'Select all that apply — at least one.',
  },
  provider: {
    title: 'Set up your Provider profile.',
    subtitle: 'Choose your clinical specialty and where you practice.',
    sectionTitle: 'Your specialty',
    sectionHint: 'Choose one.',
  },
} as const;

export function SupplyOnboarding({ role }: { role: 'caregiver' | 'provider' }) {
  const { refresh } = useAuth();
  const copy = COPY[role];

  const [categories, setCategories] = useState<Category[]>([]);
  const [specialty, setSpecialty] = useState<Specialty | null>(null);
  const [state, setState] = useState<StateCode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subtypeChosen = role === 'caregiver' ? categories.length > 0 : specialty !== null;
  const canSubmit = subtypeChosen && state !== null && !loading;

  const toggleCategory = (value: Category) =>
    setCategories((prev) => (prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]));

  const onSubmit = async () => {
    if (!canSubmit || state === null) return;
    setError(null);
    setLoading(true);
    try {
      if (role === 'caregiver') {
        await roleClaim({ role: 'caregiver', categories, state });
      } else {
        await roleClaim({ role: 'provider', specialty: specialty!, state });
      }
      await refresh(); // auth gate redirects into (app) once the role lands in the token
      // Leave `loading` set — the redirect unmounts this screen.
    } catch (e) {
      setLoading(false);
      setError(
        e instanceof ApiError
          ? e.status === 0
            ? 'Set EXPO_PUBLIC_API_URL in apps/mobile/.env to reach the backend.'
            : e.status === 409
              ? 'Your role is already set — it can’t be changed.'
              : e.message
          : 'Could not set up your account. Please try again.',
      );
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.pill}>
        <RolePill role={role} />
      </View>
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.subtitle}>{copy.subtitle}</Text>

      <Text style={styles.sectionTitle}>{copy.sectionTitle}</Text>
      <Text style={styles.sectionHint}>{copy.sectionHint}</Text>
      <View style={styles.options}>
        {role === 'caregiver'
          ? CATEGORY_OPTIONS.map((opt) => (
              <SelectableCard
                key={opt.value}
                label={opt.label}
                blurb={opt.blurb}
                tone={opt.tone}
                selected={categories.includes(opt.value)}
                onPress={() => toggleCategory(opt.value)}
                selectionMode="checkbox"
              />
            ))
          : SPECIALTY_OPTIONS.map((opt) => (
              <SelectableCard
                key={opt.value}
                label={opt.label}
                blurb={opt.blurb}
                selected={specialty === opt.value}
                onPress={() => setSpecialty(opt.value)}
                selectionMode="radio"
              />
            ))}
      </View>

      <View style={styles.stateBlock}>
        <StatePicker value={state} onChange={setState} />
        <Text style={styles.sectionHint}>Determines which state-specific rules apply to you.</Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <PrimaryButton
        onPress={onSubmit}
        loading={loading}
        disabled={!canSubmit}
        icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />}
        style={styles.cta}
      >
        Continue
      </PrimaryButton>

      <View style={styles.notice}>
        <Notice>This sets your permanent role on Our Haven. You’ll verify your ID next.</Notice>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 8, paddingBottom: 12 },
  pill: { marginBottom: 16 },
  title: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.8, color: colors.ink },
  subtitle: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, marginTop: 8 },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 17, letterSpacing: -0.2, color: colors.ink, marginTop: 26 },
  sectionHint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.ink3, marginTop: 4 },
  options: { gap: 12, marginTop: 14 },
  stateBlock: { marginTop: 26 },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, marginTop: 16 },
  cta: { marginTop: 24 },
  notice: { marginTop: 16 },
});
