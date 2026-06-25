import type { Role } from './roles.ts';

// Ported from apps/backend/src/auth/principal.ts (types only; no runtime).
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
  /** Supply roles — resident state, drives per-state adapter routing (ADR-0009/0015). */
  state: string | null;
  email: string | null;
  phone: string | null;
  secondFactor: SecondFactor | null;
  claims: SupabaseJwtPayload;
}
