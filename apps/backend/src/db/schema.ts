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
 * Chat messages for live Direct-Message threads, enabled for Supabase Realtime
 * (OH-174 skeleton). Minimal foundational shape; OH-2.13 extends it. The
 * realtime helper (src/supabase/realtime.ts) subscribes to INSERTs filtered by
 * `thread_id`.
 */
export interface MessagesTable {
  id: Generated<string>;
  thread_id: string;
  sender_uid: string;
  body: string;
  created_at: Generated<Date>;
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

export interface Database {
  auth_email_otps: AuthEmailOtpsTable;
  auth_step_up_grants: AuthStepUpGrantsTable;
  providers: ProvidersTable;
  provider_verifications: ProviderVerificationsTable;
  provider_profiles: ProviderProfilesTable;
  provider_category_rates: ProviderCategoryRatesTable;
  caregiver_credentials: CaregiverCredentialsTable;
  provider_slots: ProviderSlotsTable;
  provider_screenings: ProviderScreeningsTable;
  specialist_credentials: SpecialistCredentialsTable;
  provider_home_childcare_registrations: ProviderHomeChildcareRegistrationsTable;
  provider_connect_accounts: ProviderConnectAccountsTable;
  provider_subscriptions: ProviderSubscriptionsTable;
  parent_subscriptions: ParentSubscriptionsTable;
  provider_contact_intakes: ProviderContactIntakesTable;
  stripe_tax_calculations: StripeTaxCalculationsTable;
  messages: MessagesTable;
  notification_outbox: NotificationOutboxTable;
  notification_push_tokens: NotificationPushTokensTable;
  notification_web_push_subscriptions: NotificationWebPushSubscriptionsTable;
}
