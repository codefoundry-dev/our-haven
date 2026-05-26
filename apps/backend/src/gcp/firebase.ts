import { readFileSync } from 'node:fs';

import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

import type { Env } from '@/config/env.js';

export interface FirebaseHandles {
  auth: Auth;
  firestore: Firestore;
}

export function initFirebase(env: Env): FirebaseHandles {
  if (getApps().length === 0) {
    initializeApp({
      credential: env.FIREBASE_SERVICE_ACCOUNT_PATH
        ? cert(JSON.parse(readFileSync(env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8')))
        : applicationDefault(),
      projectId: env.GCP_PROJECT_ID,
    });
  }
  const firestore = getFirestore();
  firestore.settings({ ignoreUndefinedProperties: true });
  return {
    auth: getAuth(),
    firestore,
  };
}
