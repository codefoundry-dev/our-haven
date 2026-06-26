/**
 * Caregiver onboarding WEB wizard chrome (Claude Design cp-web `POWebShell`).
 *
 * The supply web flow is a step-by-step wizard, NOT a checklist that links out:
 * a fixed 320px "CAREGIVER SETUP" step rail on the left, a Step N of 9 utility
 * row, the step body, and a sticky Back / [secondary] / Continue footer. Each of
 * the nine onboarding steps renders its own body inside this frame.
 *
 * This is a plain component imported only from `onboarding.web.tsx` (a `.web.tsx`
 * route), so it never reaches the native bundle — same pattern as AuthWebShell.
 * Below the rail breakpoint it collapses to a single column with a slim progress
 * bar so the wizard stays usable on a narrow browser.
 */
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

/** The 9 caregiver KYC steps, mirrored from mobile §5.1.13 (rail + utility row). */
export const CAREGIVER_WIZARD_STEPS = [
  'Category',
  'Profile basics',
  'Published Rate',
  'Government ID',
  'Background check',
  'Credentials',
  'Phone',
  'Agreements',
  'Bank & payouts',
] as const;

export interface WizardShellProps {
  /** 1-based index of the active step. */
  step: number;
  /** Rail labels (defaults to the caregiver slate). */
  steps?: readonly string[];
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Primary action. */
  cta?: string;
  onContinue?: () => void;
  ctaDisabled?: boolean;
  busy?: boolean;
  /** Optional ghost action between Back and Continue (e.g. "Skip for now"). */
  secondary?: string;
  onSecondary?: () => void;
  /** Small print shown inline in the footer. */
  footnote?: string;
  onBack: () => void;
  /** "Saved to draft" / "Saving…" status in the utility row. */
  savedLabel?: string;
  /** ≥ this width shows the left rail; below it collapses to one column. */
  wide: boolean;
}

export function WizardShell({
  step,
  steps = CAREGIVER_WIZARD_STEPS,
  eyebrow,
  title,
  subtitle,
  children,
  cta = 'Continue',
  onContinue,
  ctaDisabled,
  busy,
  secondary,
  onSecondary,
  footnote,
  onBack,
  savedLabel = 'Saved to draft',
  wide,
}: WizardShellProps) {
  const total = steps.length;
  const current = steps[step - 1];

  return (
    <View style={styles.root}>
      {wide ? (
        <View style={styles.rail}>
          <View style={styles.brandRow}>
            <View style={styles.logoMark}>
              <Text style={styles.logoMarkText}>oh</Text>
            </View>
            <Text style={styles.wordmark}>Our Haven</Text>
          </View>

          <Text style={styles.railKicker}>Caregiver setup</Text>

          <View style={styles.railSteps}>
            {steps.map((label, i) => {
              const n = i + 1;
              const done = n < step;
              const active = n === step;
              return (
                <View key={label} style={[styles.railStep, active && styles.railStepActive]}>
                  <View
                    style={[
                      styles.railDot,
                      { backgroundColor: done || active ? colors.brand : colors.surfaceAlt },
                    ]}
                  >
                    {done ? (
                      <Icon name="check" size={13} color={colors.inkInv} />
                    ) : (
                      <Text style={[styles.railDotText, (done || active) && { color: colors.inkInv }]}>{n}</Text>
                    )}
                  </View>
                  <Text
                    style={[
                      styles.railStepLabel,
                      active ? styles.railStepLabelActive : done ? styles.railStepLabelDone : null,
                    ]}
                  >
                    {label}
                  </Text>
                </View>
              );
            })}
          </View>

          <View style={styles.railFootnote}>
            <Text style={styles.railFootnoteText}>
              Heavy verification lives on the web — ID, documents and Checkr work best in a browser.
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.main}>
        {/* utility row */}
        <View style={styles.utilityRow}>
          <Text style={styles.utilityStep}>
            Step {step} of {total} · {current}
          </Text>
          <View style={styles.utilityRight}>
            <Text style={styles.utilitySaved}>{savedLabel}</Text>
            <Text style={styles.utilityHelp}>Help</Text>
          </View>
        </View>

        {!wide ? (
          <View style={styles.miniTrack}>
            <View style={[styles.miniFill, { width: `${Math.round((step / total) * 100)}%` }]} />
          </View>
        ) : null}

        <ScrollView
          style={styles.contentScroll}
          contentContainerStyle={[styles.content, !wide && styles.contentNarrow]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.contentInner}>
            {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            <View style={styles.body}>{children}</View>
          </View>
        </ScrollView>

        {/* sticky footer */}
        <View style={[styles.footer, !wide && styles.footerNarrow]}>
          <Pressable accessibilityRole="button" onPress={onBack} style={styles.backBtn}>
            <Icon name="chevron-left" size={16} color={colors.ink2} />
            <Text style={styles.backBtnText}>Back</Text>
          </Pressable>

          {footnote && wide ? <Text style={styles.footnote}>{footnote}</Text> : <View style={{ flex: 1 }} />}

          {secondary ? (
            <Pressable accessibilityRole="button" onPress={onSecondary} style={styles.secondaryBtn}>
              <Text style={styles.secondaryBtnText}>{secondary}</Text>
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={onContinue}
            disabled={ctaDisabled || busy || !onContinue}
            style={[styles.ctaBtn, (ctaDisabled || busy || !onContinue) && styles.ctaBtnDisabled]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.inkInv} />
            ) : (
              <>
                <Text style={styles.ctaBtnText}>{cta}</Text>
                <Icon name="arrow-right" size={16} color={colors.inkInv} />
              </>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ── Shared step primitives ────────────────────────────────────────────────

/** Uppercase section label. */
export function SecHead({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[styles.secHead, style]}>{children}</Text>;
}

/** Soft info callout (surfaceAlt / brandSoft). */
export function InfoNote({
  children,
  icon = 'info',
  tone = 'alt',
}: {
  children: ReactNode;
  icon?: IconName;
  tone?: 'alt' | 'brand';
}) {
  return (
    <View style={[styles.note, tone === 'brand' && styles.noteBrand]}>
      <Icon name={icon} size={18} color={tone === 'brand' ? colors.brand : colors.ink2} />
      <Text style={styles.noteText}>{children}</Text>
    </View>
  );
}

/** Labelled text input styled like the design's WizField (with a focus ring). */
export function WizField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  mono,
  suffix,
  helper,
  autoCapitalize = 'sentences',
  maxLength,
  editable = true,
}: {
  label?: string;
  value: string;
  onChangeText?: (v: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  mono?: boolean;
  suffix?: string;
  helper?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  maxLength?: number;
  editable?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <View style={[styles.field, focused && styles.fieldFocused, !editable && styles.fieldReadonly]}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.ink3}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          maxLength={maxLength}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[styles.fieldInput, mono && styles.fieldInputMono]}
        />
        {suffix ? <Text style={styles.fieldSuffix}>{suffix}</Text> : null}
      </View>
      {helper ? <Text style={styles.fieldHelper}>{helper}</Text> : null}
    </View>
  );
}

/** Multiline bio/notes input with a character counter. */
export function WizTextArea({
  value,
  onChangeText,
  placeholder,
  maxLength,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  maxLength: number;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[styles.textArea, focused && styles.fieldFocused]}
    >
      <TextInput
        value={value}
        onChangeText={(v) => onChangeText(v.slice(0, maxLength))}
        placeholder={placeholder}
        placeholderTextColor={colors.ink3}
        multiline
        textAlignVertical="top"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={styles.textAreaInput}
      />
    </View>
  );
}

/** Toggle chip. */
export function WizChip({ label, on, onPress }: { label: string; on: boolean; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      disabled={!onPress}
      style={[styles.chip, on ? styles.chipOn : styles.chipOff]}
    >
      {on ? <Icon name="check" size={13} color={colors.inkInv} /> : null}
      <Text style={[styles.chipText, on && { color: colors.inkInv }]}>{label}</Text>
    </Pressable>
  );
}

/** Pill switch matching the profile builder toggle. */
export function WizToggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label?: string }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      onPress={onToggle}
      style={[styles.switch, on ? styles.switchOn : styles.switchOff]}
    >
      <View style={[styles.knob, on ? styles.knobOn : styles.knobOff]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.canvas },

  // ── rail ──
  rail: {
    width: 320,
    flexShrink: 0,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.hairline,
    paddingVertical: 40,
    paddingHorizontal: 34,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 40 },
  logoMark: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  logoMarkText: { fontFamily: fonts.bold, fontSize: 17, color: colors.inkInv, letterSpacing: -0.5 },
  wordmark: { fontFamily: fonts.bold, fontSize: 17, letterSpacing: -0.3, color: colors.ink },
  railKicker: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginBottom: 18 },
  railSteps: { flex: 1, gap: 2 },
  railStep: { flexDirection: 'row', alignItems: 'center', gap: 14, height: 42, paddingHorizontal: 12, borderRadius: 12 },
  railStepActive: { backgroundColor: colors.brandSoft },
  railDot: { width: 26, height: 26, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  railDotText: { fontFamily: fonts.bold, fontSize: 12, color: colors.ink3 },
  railStepLabel: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink3 },
  railStepLabelActive: { fontFamily: fonts.bold, color: colors.brand },
  railStepLabelDone: { fontFamily: fonts.medium, color: colors.ink },
  railFootnote: { marginTop: 24, paddingTop: 20, borderTopWidth: 1, borderTopColor: colors.hairline },
  railFootnoteText: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink2 },

  // ── main column ──
  main: { flex: 1, minWidth: 0 },
  utilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 22,
    paddingHorizontal: 40,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  utilityStep: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2 },
  utilityRight: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  utilitySaved: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },
  utilityHelp: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },

  miniTrack: { height: 4, backgroundColor: colors.surfaceAlt },
  miniFill: { height: 4, backgroundColor: colors.brand },

  contentScroll: { flex: 1 },
  content: { paddingVertical: 40, paddingHorizontal: 56 },
  contentNarrow: { paddingVertical: 28, paddingHorizontal: 20 },
  contentInner: { width: '100%', maxWidth: 640 },
  eyebrow: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink2 },
  title: { fontFamily: fonts.bold, fontSize: 34, lineHeight: 40, letterSpacing: -1, color: colors.ink, marginTop: 10, marginBottom: 8 },
  subtitle: { fontFamily: fonts.regular, fontSize: 15.5, lineHeight: 23, color: colors.ink2, maxWidth: 560 },
  body: { marginTop: 28 },

  // ── footer ──
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    backgroundColor: colors.surface,
    paddingVertical: 16,
    paddingHorizontal: 56,
  },
  footerNarrow: { paddingHorizontal: 20, paddingVertical: 12 },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 50,
    paddingHorizontal: 22,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  backBtnText: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.ink2 },
  footnote: { flex: 1, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 16, color: colors.ink3 },
  secondaryBtn: { height: 50, paddingHorizontal: 20, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.ink2 },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    minWidth: 132,
    paddingHorizontal: 26,
    borderRadius: radii.pill,
    backgroundColor: colors.brand,
  },
  ctaBtnDisabled: { opacity: 0.45 },
  ctaBtnText: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.inkInv },

  // ── primitives ──
  secHead: { fontFamily: fonts.bold, fontSize: 11.5, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2 },

  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: radii.md, backgroundColor: colors.surfaceAlt },
  noteBrand: { backgroundColor: colors.brandSoft },
  noteText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2 },

  fieldLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginBottom: 7 },
  field: {
    height: 52,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },
  fieldFocused: { borderWidth: 2, borderColor: colors.brand, boxShadow: '0 0 0 4px rgba(30,122,134,0.12)' } as object,
  fieldReadonly: { backgroundColor: colors.surfaceAlt },
  fieldInput: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.ink, outlineStyle: 'none' } as object,
  fieldInputMono: { fontFamily: fonts.mono, fontSize: 16, letterSpacing: 1 },
  fieldSuffix: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink2 },
  fieldHelper: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink3, marginTop: 6 },

  textArea: {
    minHeight: 110,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    borderRadius: radii.md,
    padding: 16,
  },
  textAreaInput: { flex: 1, fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 23, color: colors.ink, outlineStyle: 'none' } as object,

  chip: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 38, paddingHorizontal: 16, borderRadius: radii.pill, borderWidth: 1.5 },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipOff: { backgroundColor: colors.surface, borderColor: colors.hairline },
  chipText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink2 },

  switch: { width: 48, height: 28, borderRadius: radii.pill, padding: 2, justifyContent: 'center' },
  switchOn: { backgroundColor: colors.brand },
  switchOff: { backgroundColor: colors.monoGray },
  knob: { width: 24, height: 24, borderRadius: radii.pill, backgroundColor: colors.surface, ...shadow.e1 },
  knobOn: { alignSelf: 'flex-end' },
  knobOff: { alignSelf: 'flex-start' },
});
