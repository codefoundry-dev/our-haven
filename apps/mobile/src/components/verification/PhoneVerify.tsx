/**
 * PhoneVerify — the phone verification action (OH-184; phone is the hard final
 * activation gate, ADR-0015). Two phases:
 *   1. enter a phone → supabase.auth.updateUser({ phone }) sends an SMS OTP
 *   2. enter the code → verifyOtp({ type: 'phone_change' }) confirms it, then
 *      POST /v1/providers/me/verification/phone-confirm mirrors phone_confirmed_at
 *
 * Requires an SMS provider configured on the Supabase project; until then
 * updateUser surfaces a provider error here (the wiring is otherwise complete).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError, confirmPhone, type Verification } from '@/api/client';
import { supabase } from '@/auth/supabase';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { TextField } from '@/components/ui/TextField';
import { colors, fonts } from '@/theme/tokens';

/** Best-effort E.164 normalisation; assumes US (+1) for a bare 10/11-digit number. */
function toE164(raw: string): string | null {
  const cleaned = raw.trim().replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) return cleaned.length >= 8 ? cleaned : null;
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export function PhoneVerify({ onVerified }: { onVerified: (v: Verification) => void }) {
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
      setError(e instanceof Error ? e.message : 'Could not send a code to that number.');
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
      const v = await confirmPhone();
      onVerified(v);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 0
          ? 'Set EXPO_PUBLIC_API_URL to reach the backend.'
          : e instanceof Error
            ? e.message
            : 'That code was not accepted.',
      );
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
        <Pressable onPress={() => { setPhase('phone'); setCode(''); setError(null); setInfo(null); }} hitSlop={8} style={styles.linkRow}>
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
        helper="We'll text a one-time code. Booking requests are sent here."
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
