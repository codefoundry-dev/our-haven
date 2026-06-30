/**
 * PhoneVerify — the provider Verification phone step (OH-184; phone is the hard
 * final activation gate, ADR-0015). A thin wrapper over the reusable `PhoneOtp`
 * component: once the OTP is confirmed (the number lands on `auth.users.phone`),
 * it POSTs /v1/providers/me/verification/phone-confirm to mirror `phone_confirmed_at`
 * into the server-owned verification facts, then hands the updated Verification to
 * the screen.
 *
 * Requires an SMS provider configured on the Supabase project; until then the OTP
 * send surfaces a provider error inside PhoneOtp (the wiring is otherwise complete).
 */
import { ApiError, confirmPhone, type Verification } from '@/api/client';
import { PhoneOtp } from '@/components/PhoneOtp';

export function PhoneVerify({ onVerified }: { onVerified: (v: Verification) => void }) {
  return (
    <PhoneOtp
      helper="We'll text a one-time code. Booking requests are sent here."
      onVerified={async () => {
        try {
          onVerified(await confirmPhone());
        } catch (e) {
          // Surface the backend mirror failure through PhoneOtp's error line.
          throw new Error(
            e instanceof ApiError && e.status === 0
              ? 'Set EXPO_PUBLIC_API_URL to reach the backend.'
              : e instanceof Error
                ? e.message
                : 'That code was not accepted.',
          );
        }
      }}
    />
  );
}
