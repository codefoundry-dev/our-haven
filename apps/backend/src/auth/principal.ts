import type { DecodedIdToken } from 'firebase-admin/auth';

import type { ProviderKind, Role } from '@/auth/roles.js';

export type SecondFactor = 'totp' | 'phone';

export interface Principal {
  uid: string;
  role: Role | null;
  kind: ProviderKind | null;
  email: string | null;
  phone: string | null;
  secondFactor: SecondFactor | null;
  claims: DecodedIdToken;
}
