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
  published_rate_cents: number | null;
  per_child_surcharge_cents: number | null;
  availability_grid: ColumnType<Record<string, Record<string, boolean>>, Record<string, Record<string, boolean>> | undefined, Record<string, Record<string, boolean>>>;
  availability_note: string | null;
  paused: ColumnType<boolean, boolean | undefined, boolean>;
  w10_tax_credit_friendly: ColumnType<boolean, boolean | undefined, boolean>;
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

export interface Database {
  auth_email_otps: AuthEmailOtpsTable;
  auth_step_up_grants: AuthStepUpGrantsTable;
  providers: ProvidersTable;
  provider_verifications: ProviderVerificationsTable;
  provider_profiles: ProviderProfilesTable;
  provider_screenings: ProviderScreeningsTable;
  specialist_credentials: SpecialistCredentialsTable;
  provider_home_childcare_registrations: ProviderHomeChildcareRegistrationsTable;
  provider_connect_accounts: ProviderConnectAccountsTable;
  stripe_tax_calculations: StripeTaxCalculationsTable;
  messages: MessagesTable;
  notification_outbox: NotificationOutboxTable;
}
