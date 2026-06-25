import type { Role } from '@/auth/roles.js';

export type SecondFactor = 'totp' | 'phone';

export interface SupabaseJwtPayload {
  sub: string;
  email?: string | null;
  phone?: string | null;
  aud?: string | string[];
  aal?: 'aal1' | 'aal2';
  amr?: Array<{ method: string; timestamp?: number }>;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  iat?: number;
  exp?: number;
  [claim: string]: unknown;
}

export interface Principal {
  uid: string;
  role: Role | null;
  /** role=caregiver — one or more supply categories (ADR-0011). */
  categories: string[] | null;
  /** role=provider — clinical specialty (ADR-0011). */
  specialty: string | null;
  email: string | null;
  phone: string | null;
  secondFactor: SecondFactor | null;
  claims: SupabaseJwtPayload;
}
