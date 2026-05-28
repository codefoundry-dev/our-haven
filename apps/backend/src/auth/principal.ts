import type { ProviderKind, Role } from '@/auth/roles.js';

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
  kind: ProviderKind | null;
  email: string | null;
  phone: string | null;
  secondFactor: SecondFactor | null;
  claims: SupabaseJwtPayload;
}
