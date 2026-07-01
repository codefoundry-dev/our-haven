import type { ColumnType, Generated } from 'kysely';

export interface AuthEmailOtpsTable {
  id: Generated<string>;
  uid: string;
  email: string;
  code_hash: string;
  salt: string;
  expires_at: ColumnType<Date, Date | string, Date | string>;
  attempts: Generated<number>;
  consumed_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  created_at: Generated<Date>;
}

export interface AuthStepUpGrantsTable {
  id: Generated<string>;
  uid: string;
  second_factor: string;
  granted_at: Generated<Date>;
  expires_at: ColumnType<Date, Date | string, Date | string>;
}

/**
 * public.profiles — the queryable user directory (uid → role) the app and admin
 * tools read. ADR-0011 keeps `app_metadata.role` authoritative for the JWT/RLS;
 * this table is its queryable projection (auth.users / app_metadata live in the
 * protected `auth` schema and cannot be joined from the public API).
 *
 * Every auth user gets exactly one row, created synchronously by the
 * `handle_new_user` AFTER INSERT trigger on auth.users (migration
 * 20260704000001_profiles). There is NO FK to auth.users — it lives in the
 * protected auth schema (matches `providers.uid` / `parent_subscriptions.uid`).
 *
 *   intended_role — the sign-up choice (provisional), copied from user_metadata.
 *   role          — the permanent claimed role; null until POST /auth/role-claim
 *                   sets it (alongside app_metadata.role). Read it as
 *                   coalesce(role, intended_role) for "what flow to show".
 *   state         — resident state (supply roles); set at role-claim, null parent.
 */
export interface ProfilesTable {
  id: string; // the Supabase auth user uuid (auth.users.id)
  email: ColumnType<string | null, string | null | undefined, string | null>;
  first_name: ColumnType<string | null, string | null | undefined, string | null>;
  last_name: ColumnType<string | null, string | null | undefined, string | null>;
  intended_role: ColumnType<string | null, string | null | undefined, string | null>;
  role: ColumnType<
    'parent' | 'caregiver' | 'provider' | 'admin' | null,
    'parent' | 'caregiver' | 'provider' | 'admin' | null | undefined,
    'parent' | 'caregiver' | 'provider' | 'admin' | null
  >;
  state: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface ProvidersTable {
  id: Generated<string>;
  uid: string;
  // Flat supply role (ADR-0011). The account-level role also lives in Supabase
  // `app_metadata`; this column is the physical store of the supply sub-type.
  role: 'caregiver' | 'provider';
  categories: string[] | null; // role=caregiver — one or more (babysitter|tutor|nanny)
  specialty: string | null; // role=provider
  state: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ProviderVerificationsTable {
  provider_id: string;
  email_confirmed_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  phone_confirmed_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  id_doc_object_path: string | null;
  id_doc_uploaded_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  screening_initiated_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  screening_passed_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  license_verified_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  // Provider-only — proof of liability insurance verified by admin (OH-186).
  // Stamped alongside license_verified_at by the provider-credentials admin
  // decision; drives the domain `insurance-pending` gate.
  insurance_verified_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  rejected_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  rejection_reason: string | null;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface ProviderProfilesTable {
  provider_id: string;
  display_name: string | null;
  headline: string | null;
  bio: string | null;
  // Caregiver public-profile fields (OH-188 follow-up): 5-digit ZIP + whole years
  // of experience. Both API-layer-validated, with DB-check backstops.
  zip: string | null;
  years_experience: number | null;
  languages: ColumnType<string[], string[] | undefined, string[]>;
  specialty_tags: ColumnType<string[], string[] | undefined, string[]>;
  photo_object_path: string | null;
  // Provider display-only per-session Rate. Caregiver per-category rates live in
  // `provider_category_rates` (OH-188); these single columns serve the Provider.
  published_rate_cents: number | null;
  per_child_surcharge_cents: number | null;
  availability_grid: ColumnType<Record<string, Record<string, boolean>>, Record<string, Record<string, boolean>> | undefined, Record<string, Record<string, boolean>>>;
  availability_note: string | null;
  paused: ColumnType<boolean, boolean | undefined, boolean>;
  w10_tax_credit_friendly: ColumnType<boolean, boolean | undefined, boolean>;
  // Caregiver profile builder (OH-188 / ADR-0015,0017). `negotiable` default ON.
  // `ages_served` / `behaviour_comfort` are taxonomy keys from @our-haven/shared,
  // enforced at the API layer (no DB check).
  negotiable: ColumnType<boolean, boolean | undefined, boolean>;
  ages_served: ColumnType<string[], string[] | undefined, string[]>;
  behaviour_comfort: ColumnType<string[], string[] | undefined, string[]>;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

/**
 * Per-category Published Rate for a Caregiver (OH-188 / CONTEXT.md § Rate). One
 * row per (provider, category). `per_child_surcharge_cents` is Babysitter /
 * Nanny only (DB-checked + API-guarded); null for Tutor and for an unset
 * surcharge. Drives Offer pre-fill, the search Rate-ceiling filter, and the
 * "from $X" lowest-rate teaser.
 */
export interface ProviderCategoryRatesTable {
  provider_id: string;
  category: 'babysitter' | 'tutor' | 'nanny';
  published_rate_cents: number;
  per_child_surcharge_cents: number | null;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

/**
 * Caregiver Credentials umbrella (OH-188 / CONTEXT.md § Credentials). Distinct
 * from `specialist_credentials` (Provider license + insurance). Each Credential
 * is born `pending`, hidden from the public profile until an admin approves it
 * (the Caregiver sees "Pending review"). Never an activation gate.
 */
export interface CaregiverCredentialsTable {
  id: Generated<string>;
  provider_id: string;
  type: 'title' | 'certification' | 'training';
  label: string;
  review_state: ColumnType<
    'pending' | 'approved' | 'rejected',
    'pending' | 'approved' | 'rejected' | undefined,
    'pending' | 'approved' | 'rejected'
  >;
  rejection_reason: string | null;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

/**
 * Provider consultation slots (OH-189 / CONTEXT.md § Booking — slot-pick). One
 * row per dated window a Provider publishes. `state` follows the
 * `provider-slot-scheduler` lifecycle (open → held → released); `start_min` /
 * `end_min` are minutes-since-midnight (0..1440). `held_by_booking_id` names the
 * holding Booking while `held` (no FK yet — Booking is pure-domain).
 */
export interface ProviderSlotsTable {
  id: Generated<string>;
  provider_id: string;
  slot_date: ColumnType<string, string, string>;
  start_min: number;
  end_min: number;
  state: ColumnType<'open' | 'held' | 'released', 'open' | 'held' | 'released' | undefined, 'open' | 'held' | 'released'>;
  held_by_booking_id: string | null;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

/**
 * Bookings (OH-203) — the persisted Booking the OH-177 `booking-lifecycle` deep
 * module backs, scoped to the **Provider consultation** slice in v1. A Parent
 * books an open `provider_slots` window: the act holds the slot and writes one
 * row here born `accepted` (`kind = 'provider'`), NULL payment (off-platform,
 * ADR-0011 — no Job/Offer/payment-intent). It auto-completes when the minute
 * tick sweeps `auto_complete_at <= now()` (state `accepted → completed`) and is
 * visible on both schedules: the Parent's (`parent_uid`) and the Provider's
 * (`provider_id`).
 *
 * Shaped for the full caregiver|provider model (the `kind` fork + the nine
 * lifecycle states). The provider consultation path writes the slot columns; a
 * **caregiver** Booking (OH-207, materialised at Direct-Message Book-request
 * accept) writes the Job-chain columns instead (`origin` + `job_id` /
 * `application_id` / `offer_id` / `series_id`, the Agreed-Rate + computed-total
 * snapshot, the reveal-at-accept service address, ad-hoc child detail). All the
 * caregiver columns are NULLable so the provider path is untouched. `parent_uid`
 * is the auth user uuid (no `parents` table — matches `parent_subscriptions.uid`);
 * `provider_id → providers.id` is the supply member (a Caregiver is a providers
 * row — ADR-0011). `rate_cents` is the provider display-only per-session snapshot;
 * `auto_complete_at` interprets the slot's wall-clock end as UTC.
 */
export interface BookingsTable {
  id: Generated<string>;
  kind: 'caregiver' | 'provider';
  state:
    | 'requested'
    | 'accepted'
    | 'declined'
    | 'expired'
    | 'in-progress'
    | 'awaiting-confirmation'
    | 'completed'
    | 'disputed'
    | 'cancelled';
  parent_uid: string;
  provider_id: string;
  slot_id: string | null;
  scheduled_date: ColumnType<string, string, string>;
  start_min: number;
  end_min: number;
  rate_cents: number | null;
  auto_complete_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  // ── caregiver Job-chain columns (OH-207; NULL on a provider consultation) ────
  origin: 'posted-job' | 'direct-message' | null;
  job_id: string | null;
  application_id: string | null;
  offer_id: string | null;
  series_id: string | null;
  agreed_rate_cents: number | null;
  computed_total_cents: number | null;
  category: 'babysitter' | 'tutor' | 'nanny' | null;
  child_count: number | null;
  child_ages: number[] | null;
  service_address_line1: string | null;
  service_address_line2: string | null;
  service_city: string | null;
  service_state: string | null;
  service_postal_code: string | null;
  accepted_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  // ── payment lifecycle (OH-211; NULL on a provider consultation) ──────────────
  payment_intent_id: string | null;
  payment_status:
    | 'scheduled'
    | 'requires_action'
    | 'authorized'
    | 'captured'
    | 'canceled'
    | 'refunded'
    | 'failed'
    | null;
  authorized_amount_cents: number | null;
  captured_amount_cents: number | null;
  refunded_amount_cents: number | null;
  commission_bp: number | null;
  commission_cents: number | null;
  // `proposed_hours` is Postgres numeric → surfaced as a string by the driver.
  proposed_hours: ColumnType<string | null, string | number | null, string | number | null>;
  proposed_amount_cents: number | null;
  authorize_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  request_expires_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  confirm_deadline_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  confirmed_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  disputed_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  cancelled_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  cancellation_tier: 'free' | 'half' | 'full' | null;
  dispute_reason: string | null;
  dispute_details: string | null;
  payment_error: string | null;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface ProviderScreeningsTable {
  id: Generated<string>;
  provider_id: string;
  vendor: 'checkr' | 'sterling' | 'goodhire' | 'manual';
  package: string;
  vendor_report_id: string | null;
  status:
    | 'payment_pending'
    | 'payment_succeeded'
    | 'in_progress'
    | 'clear'
    | 'consider'
    | 'suspended'
    | 'cancelled';
  stripe_payment_intent_id: string | null;
  charge_amount_cents: number;
  paid_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  initiated_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  completed_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  candidate_action_url: string | null;
  raw_payload: ColumnType<Record<string, unknown>, Record<string, unknown> | undefined, Record<string, unknown>>;
  purge_at: ColumnType<Date, Date | string | undefined, Date | string>;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface SpecialistCredentialsTable {
  provider_id: string;
  license_board_state: string | null;
  license_number: string | null;
  license_doc_object_path: string | null;
  license_uploaded_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  insurance_doc_object_path: string | null;
  insurance_uploaded_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  decision: 'verified' | 'rejected' | null;
  decision_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  decision_by_admin_uid: string | null;
  decision_notes: string | null;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface ProviderHomeChildcareRegistrationsTable {
  provider_id: string;
  state_at_upload: string | null;
  certificate_doc_object_path: string | null;
  certificate_uploaded_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  decision: 'verified' | 'rejected' | null;
  decision_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  decision_by_admin_uid: string | null;
  decision_notes: string | null;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface ProviderConnectAccountsTable {
  provider_id: string;
  stripe_account_id: string | null;
  charges_enabled: ColumnType<boolean, boolean | undefined, boolean>;
  payouts_enabled: ColumnType<boolean, boolean | undefined, boolean>;
  details_submitted: ColumnType<boolean, boolean | undefined, boolean>;
  disabled_reason: string | null;
  requirements: ColumnType<Record<string, unknown>, Record<string, unknown> | undefined, Record<string, unknown>>;
  account_ready_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  last_webhook_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

/**
 * Provider Subscription — the clinical tier's Stripe Billing relationship
 * (OH-191; ADR-0011 / CONTEXT.md § Subscription). The Provider is a Stripe
 * *Customer* (NOT a Connect account — Providers receive no Payouts). One row per
 * Provider; created at checkout-start so `stripe_customer_id` is stored before
 * the first webhook (the join key). `status` is mirrored from Stripe billing
 * webhooks and is the live source for the listing gate (via the domain
 * `provider-subscription` module). `listed_at` is a first-listed marker.
 */
export interface ProviderSubscriptionsTable {
  provider_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status:
    | 'incomplete'
    | 'incomplete_expired'
    | 'trialing'
    | 'active'
    | 'past_due'
    | 'canceled'
    | 'unpaid'
    | 'paused'
    | null;
  price_id: string | null;
  current_period_end: ColumnType<Date | null, Date | string | null, Date | string | null>;
  cancel_at_period_end: ColumnType<boolean, boolean | undefined, boolean>;
  listed_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  last_webhook_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

/**
 * Parent Subscription — the demand-side Stripe Billing relationship (OH-193;
 * ADR-0011 / CONTEXT.md § Subscription). The Parent is a Stripe *Customer*; the
 * subscription is sold on web (Stripe-hosted checkout) and unlocks full search,
 * messaging, Book-requests, Job posting, and Provider-consultation booking. Unlike
 * `provider_subscriptions` there is no `parents` table — a Parent is just the
 * Supabase auth user — so the row is keyed by `uid` (the auth user uuid), no FK.
 * Created at checkout-start so `stripe_customer_id` precedes the first webhook (the
 * join key). `status` is mirrored from Stripe billing webhooks and is the live
 * source for the paywall gate (via the domain `parent-subscription` module).
 * `entitled_at` is a first-unlocked marker.
 */
export interface ParentSubscriptionsTable {
  uid: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status:
    | 'incomplete'
    | 'incomplete_expired'
    | 'trialing'
    | 'active'
    | 'past_due'
    | 'canceled'
    | 'unpaid'
    | 'paused'
    | null;
  price_id: string | null;
  current_period_end: ColumnType<Date | null, Date | string | null, Date | string | null>;
  cancel_at_period_end: ColumnType<boolean, boolean | undefined, boolean>;
  entitled_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  last_webhook_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

/**
 * Parent profile (OH-200; ADR-0012 / ADR-0016). The family-level record that
 * replaces the removed Child entity: a free-text `bio`, a `preferences[]`
 * checklist (desired Caregiver traits — not safety-critical, no consent gate),
 * the fixed sensitive `safety_behaviors[]` checklist, and the optional default
 * service address that pre-fills a transaction's `service_address`. Like
 * `parent_subscriptions` there is no `parents` table — keyed by the auth `uid`,
 * no FK.
 *
 * `safety_behaviors` may be non-empty only when `safety_behaviors_consent_at` is
 * set (the consent-to-store gate, PRD story 3 — enforced at the API layer and
 * backstopped by a DB CHECK). Withdrawal clears both. `preferences` /
 * `safety_behaviors` hold taxonomy keys from `@our-haven/shared`, API-validated
 * (no DB check). There is no persisted neurodivergence/diagnosis field anywhere.
 */
export interface ParentProfilesTable {
  uid: string;
  bio: string | null;
  preferences: ColumnType<string[], string[] | undefined, string[]>;
  safety_behaviors: ColumnType<string[], string[] | undefined, string[]>;
  safety_behaviors_consent_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  default_address_line1: string | null;
  default_address_line2: string | null;
  default_city: string | null;
  default_state: string | null;
  default_postal_code: string | null;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

/**
 * Corporate "Contact Us" intake (OH-191; ADR-0011). v1 captures a sales lead for
 * the large-corporation custom-contract path — no self-serve org onboarding /
 * multi-seat model. Not keyed to a `providers` row (leads are pre-account); a
 * captured row is what the intake "routes" a notification-outbox handoff against.
 */
export interface ProviderContactIntakesTable {
  id: Generated<string>;
  organization_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  estimated_seats: number | null;
  state: string | null;
  message: string | null;
  status: ColumnType<'new' | 'routed' | 'closed', 'new' | 'routed' | 'closed' | undefined, 'new' | 'routed' | 'closed'>;
  routed_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  created_at: Generated<Date>;
}

export interface StripeTaxCalculationsTable {
  id: Generated<string>;
  stripe_calculation_id: string;
  purpose: 'subscription' | 'commission';
  reference: string;
  subject_uid: string | null;
  customer_state: string;
  customer_postal_code: string | null;
  amount_cents: number;
  tax_amount_cents: ColumnType<number, number | undefined, number>;
  amount_total_cents: number;
  tax_behavior: ColumnType<'inclusive' | 'exclusive', 'inclusive' | 'exclusive' | undefined, 'inclusive' | 'exclusive'>;
  tax_code: string;
  tax_breakdown: ColumnType<unknown[], unknown[] | undefined, unknown[]>;
  raw_payload: ColumnType<Record<string, unknown>, Record<string, unknown> | undefined, Record<string, unknown>>;
  stripe_expires_at: ColumnType<Date, Date | string, Date | string>;
  created_at: Generated<Date>;
}

/**
 * A Direct-Message thread (OH-205) — a 1:1 conversation between a Parent and a
 * supply member. v1 only creates pre-acceptance Parent↔Caregiver threads
 * (ADR-0011); `job_id` is NULL until OH-179 materialisation rebinds the thread.
 * `body`/preview values are always the redacted, delivery-safe text.
 */
export interface MessageThreadsTable {
  id: Generated<string>;
  parent_uid: string;
  supply_uid: string;
  provider_id: string;
  supply_role: string;
  job_id: string | null;
  created_at: Generated<Date>;
  last_message_at: ColumnType<Date, Date | string | undefined, Date | string>;
  last_message_preview: ColumnType<string | null, string | null | undefined, string | null>;
  last_message_redacted: ColumnType<boolean, boolean | undefined, boolean>;
}

/**
 * Chat messages for live Direct-Message threads, enabled for Supabase Realtime
 * (OH-174 skeleton; OH-205 data model). `body` holds the REDACTED, delivery-safe
 * text (redaction happens at write time because Realtime broadcasts the row);
 * `redacted` is true when contact info was stripped. The unredacted original
 * lives in `message_flags`. The realtime helper subscribes to INSERTs filtered
 * by `thread_id`.
 */
export interface MessagesTable {
  id: Generated<string>;
  thread_id: string;
  sender_uid: string;
  body: string;
  redacted: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Generated<Date>;
}

/**
 * Trust & Safety flagged-thread queue (OH-205; CONTEXT § Trust & Safety). One
 * row per message that tripped the disintermediation detector — the UNREDACTED
 * original + match metadata, for T&S review. Service-role-only (RLS enabled, no
 * policy); never published to Realtime.
 */
export interface MessageFlagsTable {
  id: Generated<string>;
  // Exactly one of message_id / offer_id is set (DB-checked). offer_id covers a
  // flagged Offer `scope_note` (OH-206; PRD story 109) in the same T&S queue.
  message_id: string | null;
  offer_id: ColumnType<string | null, string | null | undefined, string | null>;
  thread_id: string;
  sender_uid: string;
  categories: ColumnType<string[], string[], string[]>;
  original_body: string;
  matches: ColumnType<unknown[], unknown[], unknown[]>;
  created_at: Generated<Date>;
  reviewed_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  reviewed_by: string | null;
}

/** One concrete session slot on an Offer's schedule (jsonb; mirrors the domain
 *  `BookingSlot`). `date` is an ISO `YYYY-MM-DD`; times are minutes-from-midnight. */
export interface OfferSlotRow {
  date: string;
  startMin: number;
  endMin: number;
}

/** Anchored weekly recurrence rule on an Offer (jsonb; mirrors the domain
 *  `RecurrenceRule`). `weekdays` are 0=Sun..6=Sat. */
export interface OfferRecurrenceRow {
  startDate: string;
  endDate: string;
  weekdays: number[];
  startMin: number;
  endMin: number;
}

export type OfferStatus =
  | 'pending'
  | 'accepted'
  | 'countered'
  | 'declined'
  | 'expired'
  | 'withdrawn';

/**
 * A structured Offer / Book-request (OH-206; CONTEXT § Offer) anchored to a
 * Direct-Message thread and rendered inline as an Offer bubble. Carries a MUTABLE
 * `status`. SERVICE-ROLE-ONLY (RLS enabled, no SELECT policy; NOT Realtime-
 * published): an Offer row holds the exact service address, which must stay hidden
 * from the Caregiver until accept (story 124), so all reads go through the Edge
 * GET which projects the address per viewer + status. The pricing-snapshot +
 * child-detail + address fields are compose-time copies that never re-derive from
 * the Caregiver/Parent profile. `slots`/`recurrence` are jsonb (raw JS write). The
 * accept→materialisation (Job/Application/Booking + thread rebind via `job_id`)
 * is OH-207, so `job_id` is NULL throughout OH-206.
 */
export interface OffersTable {
  id: Generated<string>;
  thread_id: string;
  sender_uid: string;
  sender: 'parent' | 'caregiver';
  status: ColumnType<OfferStatus, OfferStatus | undefined, OfferStatus>;
  category: 'babysitter' | 'tutor' | 'nanny';
  proposed_rate_cents: number;
  scope_minutes: number;
  per_child_surcharge_cents: ColumnType<number, number | undefined, number>;
  computed_total_cents: number;
  scope_note: ColumnType<string, string | undefined, string>;
  scope_note_redacted: ColumnType<boolean, boolean | undefined, boolean>;
  negotiable: boolean;
  valid_until: ColumnType<Date, Date | string, Date | string>;
  child_count: number;
  child_ages: ColumnType<number[], number[] | undefined, number[]>;
  safety_behaviors: ColumnType<string[], string[] | undefined, string[]>;
  service_address_line1: string | null;
  service_address_line2: string | null;
  service_city: string | null;
  service_state: string | null;
  service_postal_code: string | null;
  schedule_kind: 'one-off' | 'multi-day' | 'recurring';
  // jsonb — read as the parsed shape (postgres.js parses jsonb on read) and
  // written as a raw JS value (the same pattern as stripe_tax tax_breakdown).
  slots: ColumnType<OfferSlotRow[], OfferSlotRow[] | undefined, OfferSlotRow[]>;
  recurrence: ColumnType<OfferRecurrenceRow | null, OfferRecurrenceRow | null | undefined, OfferRecurrenceRow | null>;
  supersedes_offer_id: string | null;
  job_id: string | null;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

/**
 * Transactional notification outbox (ADR-0019 § Decision 4; OH-237). A row is
 * written in the same transaction as the domain change that triggers a
 * notification (see jobs/outbox.ts `enqueueNotification`) and drained by the
 * worker-tick Edge Function. OH-194 supplies the concrete channel dispatcher.
 */
export interface NotificationOutboxTable {
  id: Generated<string>;
  recipient_uid: string;
  event_type: string;
  payload: ColumnType<Record<string, unknown>, Record<string, unknown> | undefined, Record<string, unknown>>;
  dedupe_key: string | null;
  attempts: ColumnType<number, number | undefined, number>;
  max_attempts: ColumnType<number, number | undefined, number>;
  next_attempt_at: ColumnType<Date, Date | string | undefined, Date | string>;
  sent_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  failed_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  last_error: string | null;
  created_at: Generated<Date>;
}

/**
 * Expo Push tokens (OH-194) — a recipient's mobile push destinations. One row per
 * device token; the worker-tick notifications dispatcher reads every token for a
 * `uid` and prunes a row when Expo reports `DeviceNotRegistered`. The write
 * (registration) path lands with the apps/mobile push-setup ticket.
 */
export interface NotificationPushTokensTable {
  id: Generated<string>;
  uid: string;
  expo_push_token: string;
  platform: 'ios' | 'android' | 'web';
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

/**
 * VAPID web-push subscriptions (OH-194) — a recipient's web push destinations.
 * v1 sends an empty "tickle" (no RFC 8291 encryption), so only `endpoint` is used
 * to send; `p256dh` + `auth` are stored for future payload encryption. The
 * dispatcher prunes on a 404/410 from the push service.
 */
export interface NotificationWebPushSubscriptionsTable {
  id: Generated<string>;
  uid: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

/**
 * Jobs (OH-207; CONTEXT § Job) — the canonical anchor for every Caregiver
 * Booking (ADR-0006, narrowed by ADR-0011). A **Direct-Message** Job is
 * materialised at Book-request accept, born `awarded` (skips draft/open); a
 * **posted** Job (OH-209) starts `draft` and is published to `open`.
 * `provider_id → providers.id` is the awarded Caregiver (NULL until award for a
 * posted Job); `parent_uid` is the owning Parent (auth uid, no FK).
 * Service-role-only (read through the Edge).
 *
 * The compose columns (OH-209; `schedule_kind` … `budget_hint_cents`) are the
 * bundle a **posted** Job carries directly (schedule + child detail + disclosed
 * Safety-Behaviors subset + service address + timestamped disclosure consent;
 * ADR-0014/0016). They are all NULLable/defaulted — a Direct-Message Job leaves
 * them unset (its schedule + child detail live on the Offer + Bookings). A
 * posted Job's schedule is `one-off` (single-slot `slots`) or `recurring`
 * (`recurrence` rule) — a multi-day one-off is fanned out into one Job per date.
 */
export interface JobsTable {
  id: Generated<string>;
  origin: 'posted' | 'direct-message';
  state: 'draft' | 'open' | 'awarded' | 'expired' | 'cancelled' | 'closed';
  parent_uid: string;
  provider_id: string | null;
  category: 'babysitter' | 'tutor' | 'nanny';
  description: string;
  awarded_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  // ── posted-Job compose bundle (OH-209; NULL for Direct-Message Jobs) ────────
  schedule_kind: 'one-off' | 'recurring' | null;
  slots: ColumnType<OfferSlotRow[], OfferSlotRow[] | undefined, OfferSlotRow[]>;
  recurrence: ColumnType<OfferRecurrenceRow | null, OfferRecurrenceRow | null | undefined, OfferRecurrenceRow | null>;
  child_count: number | null;
  child_ages: number[] | null;
  safety_behaviors: ColumnType<string[], string[] | undefined, string[]>;
  disclosure_consent_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  service_address_line1: string | null;
  service_address_line2: string | null;
  service_city: string | null;
  service_state: string | null;
  service_postal_code: string | null;
  budget_hint_cents: number | null;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

/**
 * Applications (OH-207; CONTEXT § Application) — a Caregiver's response to a Job.
 * A Direct-Message Job materialises exactly one Application, born `awarded`, with
 * `accepted_offer_id` set to the accepted Book-request. One Application per
 * Caregiver per Job (unique `job_id`+`provider_id`). Service-role-only.
 */
export interface ApplicationsTable {
  id: Generated<string>;
  job_id: string;
  provider_id: string;
  origin: 'posted' | 'direct-message';
  state: 'submitted' | 'countered' | 'awarded' | 'declined' | 'withdrawn' | 'expired';
  accepted_offer_id: string | null;
  proposal: string | null;
  awarded_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

/**
 * Booking Series (OH-207; CONTEXT § Booking Series, ADR-0014 §5) — a stateless
 * grouping row for a **recurring** Caregiver arrangement. Holds NO lifecycle
 * state; each occurrence Booking (`bookings.series_id`) runs the graph on its
 * own. `rule` is the booking-lifecycle `RecurrenceRule` shape; `offer_id`
 * back-links the Book-request that materialised the Series (withdraw-cascade).
 */
export interface BookingSeriesTable {
  id: Generated<string>;
  job_id: string;
  parent_uid: string;
  provider_id: string;
  category: 'babysitter' | 'tutor' | 'nanny';
  rule: ColumnType<OfferRecurrenceRow, OfferRecurrenceRow, OfferRecurrenceRow>;
  agreed_rate_cents: number;
  offer_id: string | null;
  created_at: Generated<Date>;
}

export interface Database {
  auth_email_otps: AuthEmailOtpsTable;
  auth_step_up_grants: AuthStepUpGrantsTable;
  profiles: ProfilesTable;
  providers: ProvidersTable;
  provider_verifications: ProviderVerificationsTable;
  provider_profiles: ProviderProfilesTable;
  provider_category_rates: ProviderCategoryRatesTable;
  caregiver_credentials: CaregiverCredentialsTable;
  provider_slots: ProviderSlotsTable;
  bookings: BookingsTable;
  provider_screenings: ProviderScreeningsTable;
  specialist_credentials: SpecialistCredentialsTable;
  provider_home_childcare_registrations: ProviderHomeChildcareRegistrationsTable;
  provider_connect_accounts: ProviderConnectAccountsTable;
  provider_subscriptions: ProviderSubscriptionsTable;
  parent_subscriptions: ParentSubscriptionsTable;
  parent_profiles: ParentProfilesTable;
  provider_contact_intakes: ProviderContactIntakesTable;
  stripe_tax_calculations: StripeTaxCalculationsTable;
  message_threads: MessageThreadsTable;
  messages: MessagesTable;
  message_flags: MessageFlagsTable;
  offers: OffersTable;
  jobs: JobsTable;
  applications: ApplicationsTable;
  booking_series: BookingSeriesTable;
  notification_outbox: NotificationOutboxTable;
  notification_push_tokens: NotificationPushTokensTable;
  notification_web_push_subscriptions: NotificationWebPushSubscriptionsTable;
}
