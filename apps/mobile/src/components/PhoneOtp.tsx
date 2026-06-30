/**
 * PhoneOtp — reusable phone collection + OTP verification via Supabase Auth.
 *
 * Two phases:
 *   1. enter a phone → `supabase.auth.updateUser({ phone })` sends an SMS OTP
 *   2. enter the code → `verifyOtp({ type: 'phone_change' })` confirms it; the
 *      verified number lands on `auth.users.phone` and the component calls
 *      `onVerified()` (which may be async — e.g. to mirror a server fact, or to
 *      refresh the session).
 *
 * The component itself does NOT call any backend beyond Supabase Auth — callers
 * inject any follow-up via `onVerified`. Requires an SMS provider configured on
 * the Supabase project; until then `updateUser` surfaces a provider error, which
 * is shown here and reported via `onSendFailed` (so the Parent paywall can offer
 * to continue without phone — OH-204).
 *
 * Extracted from the provider Verification flow (OH-184); `components/
 * verification/PhoneVerify.tsx` is now a thin wrapper around this.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { supabase } from '@/auth/supabase';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { TextField } from '@/components/ui/TextField';
import { colors, fonts } from '@/theme/tokens';

/** Best-effort E.164 normalisation; assumes US (+1) for a bare 10/11-digit number. */
export function toE164(raw: string): string | null {
  const cleaned = raw.trim().replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) return cleaned.length >= 8 ? cleaned : null;
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export interface PhoneOtpProps {
  /** Called after the OTP is confirmed. May be async; a throw is surfaced as an error. */
  onVerified: () => void | Promise<void>;
  /** Called when the SMS could not be sent (e.g. no SMS provider on the project). */
  onSendFailed?: (message: string) => void;
  /** Helper text under the phone field. */
  helper?: string;
}

export function PhoneOtp({ onVerified, onSendFailed, helper }: PhoneOtpProps) {
  const [phase, setPhase] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [e164, setE164] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const sendCode = async () => {
    setError(null);
    setInfo(null);
    const normalized = toE164(phone);
    if (!normalized) {
      setError('Enter a valid phone number, including country code.');
      return;
    }
    setBusy(true);
    try {
      const { error: upErr } = await supabase.auth.updateUser({ phone: normalized });
      if (upErr) throw new Error(upErr.message);
      setE164(normalized);
      setPhase('code');
      setInfo(`We texted a code to ${normalized}.`);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not send a code to that number.';
      setError(message);
      onSendFailed?.(message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    if (!/^\d{4,8}$/.test(code.trim())) {
      setError('Enter the code we texted you.');
      return;
    }
    setBusy(true);
    try {
      const { error: vErr } = await supabase.auth.verifyOtp({
        phone: e164,
        token: code.trim(),
        type: 'phone_change',
      });
      if (vErr) throw new Error(vErr.message);
      await onVerified();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code was not accepted.');
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'code') {
    return (
      <View style={styles.wrap}>
        {info ? <Text style={styles.info}>{info}</Text> : null}
        <TextField
          label="Verification code"
          value={code}
          onChangeText={setCode}
          placeholder="123456"
          keyboardType="number-pad"
          textContentType="oneTimeCode"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton onPress={verify} loading={busy} disabled={code.trim().length === 0} style={styles.cta}>
          Verify phone
        </PrimaryButton>
        <Pressable
          onPress={() => {
            setPhase('phone');
            setCode('');
            setError(null);
            setInfo(null);
          }}
          hitSlop={8}
          style={styles.linkRow}
        >
          <Text style={styles.link}>Use a different number</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <TextField
        label="Mobile number"
        value={phone}
        onChangeText={setPhone}
        placeholder="+1 415 555 0123"
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        helper={helper ?? "We'll text a one-time code."}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton onPress={sendCode} loading={busy} disabled={phone.trim().length === 0} style={styles.cta}>
        Send code
      </PrimaryButton>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 0 },
  info: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink2, marginBottom: 10 },
  error: { fontFamily: fonts.medium, fontSize: 12, color: colors.danger, marginTop: 8 },
  cta: { marginTop: 14, height: 48 },
  linkRow: { alignItems: 'center', marginTop: 12 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2, textDecorationLine: 'underline' },
});
