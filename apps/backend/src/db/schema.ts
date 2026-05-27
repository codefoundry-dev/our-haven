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

export interface Database {
  auth_email_otps: AuthEmailOtpsTable;
  auth_step_up_grants: AuthStepUpGrantsTable;
}
