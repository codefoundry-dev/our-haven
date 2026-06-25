/**
 * The `screening.invite` outbox contract (OH-185) — the handoff from the `api`
 * payments webhook (the writer) to the `worker-tick` screening dispatcher (the
 * reader). Shared so both halves agree on the event type, the payload shape, and
 * the dedupe key without coupling the two function trees to each other.
 *
 * Why the payload carries identity: the slow Checkr call is deferred to the
 * worker-tick, but the worker-tick has no Supabase admin client (it never
 * verifies JWTs). The payments webhook DOES (it runs on the `api` host), so it
 * resolves the applicant's identity once, at enqueue time, and ships it in the
 * payload. The dispatcher then needs only the Checkr adapter + a DB handle.
 */

export const SCREENING_INVITE_EVENT = 'screening.invite' as const;

export interface ScreeningInvitePayload {
  /** `provider_screenings.id` — the correlation id Checkr stores as custom_id. */
  screeningId: string;
  /** `providers.id`. */
  providerId: string;
  email: string;
  firstName: string;
  lastName: string;
  /** 2-letter US resident state (Checkr needs it for jurisdiction). */
  state: string;
}

/**
 * Stable dedupe key for the outbox row. The unique partial index on
 * `notification_outbox.dedupe_key` makes a redelivered `payment_intent.succeeded`
 * a no-op insert (one screening → at most one invite job).
 */
export function screeningInviteDedupeKey(screeningId: string): string {
  return `${SCREENING_INVITE_EVENT}:${screeningId}`;
}
