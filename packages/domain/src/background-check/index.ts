/**
 * Background-check adapter contract + pure-TS event reducer (OH-106).
 *
 * Per ADR-0007 + ADR-0004:
 *   - v1 runs Checkr's standard package, but the platform talks to the vendor
 *     through this interface, not through Checkr's SDK directly. A second vendor
 *     (Sterling, GoodHire), or a voluntary statutory-clearance upload path, can
 *     slot in by implementing this interface.
 *   - The interface is split into two pieces: the adapter (a handler-layer
 *     collaborator that owns the vendor API and signature verification) and the
 *     pure reducer that folds a normalized event into a `VerificationFacts`
 *     patch — same pattern as the Verification workflow module (OH-105).
 *
 * The deep module never talks to a vendor SDK; it only knows how to interpret
 * normalized events. That keeps the domain layer testable without HTTP stubs.
 */

/**
 * Vendor-agnostic terminal screening outcome. Maps from Checkr `report.status`
 * (`clear` / `consider` / `suspended`) and from whatever a second vendor would
 * call the equivalent — the adapter is responsible for the mapping.
 */
export type BackgroundCheckOutcome = 'clear' | 'consider' | 'suspended';

/**
 * Normalized lifecycle event the adapter produces from a vendor webhook.
 *
 *   - `initiated`  — the report has been created on the vendor side (the
 *                    candidate received the invitation, paid the platform,
 *                    submitted SSN/DOB to the vendor, etc.). Drives
 *                    `screening_initiated_at`.
 *   - `completed`  — the report is final. `outcome` decides whether the
 *                    Provider clears (`clear`) or is rejected
 *                    (`consider`/`suspended`).
 *   - `cancelled`  — the report was cancelled by the vendor or admin before
 *                    completion (rare). Treated like a soft reset for v1 —
 *                    the Provider can re-initiate without a re-charge per
 *                    Stripe refund posture, which lives at the handler.
 */
export type BackgroundCheckEvent =
  | { kind: 'initiated'; vendorReportId: string; occurredAt: Date }
  | {
      kind: 'completed';
      vendorReportId: string;
      occurredAt: Date;
      outcome: BackgroundCheckOutcome;
      /** Vendor-specific human-readable reason, surfaced to admin only. */
      reason?: string | null;
    }
  | { kind: 'cancelled'; vendorReportId: string; occurredAt: Date };

/**
 * Patch applied to `provider_verifications`. Only the fields this event
 * touches are present — the handler merges the patch into the row. Mirrors
 * the verification-workflow facts shape so callers can compose without an
 * extra translation step.
 */
export interface VerificationFactsPatch {
  screening_initiated_at?: Date;
  screening_passed_at?: Date;
  rejected_at?: Date;
  rejection_reason?: string;
}

/**
 * Fold one normalized event into a verification-facts patch.
 *
 * Pure + deterministic — same event always produces the same patch. The
 * `kind=cancelled` case returns an empty patch in v1; a future ADR may decide
 * to clear the `screening_initiated_at` timestamp on cancellation, but doing
 * so today would let a Provider replay the screening without paying again.
 */
export function reduceBackgroundCheckEvent(event: BackgroundCheckEvent): VerificationFactsPatch {
  switch (event.kind) {
    case 'initiated':
      return { screening_initiated_at: event.occurredAt };
    case 'completed': {
      if (event.outcome === 'clear') {
        return { screening_passed_at: event.occurredAt };
      }
      const reason =
        event.outcome === 'suspended'
          ? `suspended${event.reason ? `: ${event.reason}` : ''}`
          : `consider${event.reason ? `: ${event.reason}` : ''}`;
      return { rejected_at: event.occurredAt, rejection_reason: reason };
    }
    case 'cancelled':
      return {};
  }
}

/**
 * Input the adapter needs to start a screening on the vendor side.
 *
 * The platform passes the Provider's identity facts (collected at sign-up +
 * ID-doc upload) to the adapter, which posts them to the vendor and returns
 * a vendor-side report id. No PII other than these fields is sent.
 */
export interface InitiateScreeningInput {
  providerId: string;
  email: string;
  firstName: string;
  lastName: string;
  /** US-resident state code, e.g. 'NY' — the vendor needs it for jurisdiction. */
  state: string;
  /** Stable correlation id stored as vendor metadata for webhook matching. */
  correlationId: string;
}

export interface InitiateScreeningResult {
  /** Vendor's report identifier (Checkr `report.id`). Stored on our side. */
  vendorReportId: string;
  /**
   * URL the candidate may need to visit to finish vendor-side onboarding
   * (Checkr returns a `candidate.invitation_url`). Surfaced to the Provider
   * so the web portal can deep-link.
   */
  candidateActionUrl?: string;
}

/**
 * Vendor-agnostic background-check adapter. Handler-layer collaborator;
 * never imported from the domain module itself.
 *
 *   - `initiateScreening`     — kick off the vendor report.
 *   - `verifySignature`       — HMAC the raw webhook body against the
 *                                vendor's webhook secret. Throws if invalid.
 *   - `normalizeWebhookEvent` — parse the verified body into a
 *                                BackgroundCheckEvent. Returns `null` for
 *                                event types we ignore (e.g. Checkr's
 *                                `report.created` is redundant against the
 *                                handler's own bookkeeping).
 *
 * The vendor name is exposed for audit logging and the future multi-vendor
 * routing layer.
 */
export interface BackgroundCheckAdapter {
  readonly vendor: 'checkr' | 'sterling' | 'goodhire' | 'manual';
  initiateScreening(input: InitiateScreeningInput): Promise<InitiateScreeningResult>;
  verifySignature(rawBody: string, signatureHeader: string | null): boolean;
  normalizeWebhookEvent(rawBody: string): BackgroundCheckEvent | null;
}

export const BACKGROUND_CHECK_MODULE_VERSION = '0.1.0-OH-106';
