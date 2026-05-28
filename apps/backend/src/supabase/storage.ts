import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Env } from '@/config/env.js';

export interface SignedUploadRequest {
  kind: 'id-doc' | 'license-doc' | 'insurance-doc' | 'state-childcare-registration' | 'avatar';
  ownerId: string;
  contentType: 'image/jpeg' | 'image/png' | 'application/pdf';
  contentLengthBytes: number;
}

export interface SignedUploadResult {
  uploadUrl: string;
  uploadToken: string;
  objectPath: string;
  expiresAt: string;
}

const MAX_BYTES_BY_KIND: Record<SignedUploadRequest['kind'], number> = {
  'id-doc': 15 * 1024 * 1024,
  'license-doc': 15 * 1024 * 1024,
  'insurance-doc': 15 * 1024 * 1024,
  'state-childcare-registration': 15 * 1024 * 1024,
  avatar: 5 * 1024 * 1024,
};

export class UploadValidationError extends Error {
  constructor(
    message: string,
    public readonly field: keyof SignedUploadRequest,
  ) {
    super(message);
    this.name = 'UploadValidationError';
  }
}

export interface StorageHandles {
  bucket: string;
  createSignedUploadUrl(req: SignedUploadRequest): Promise<SignedUploadResult>;
}

export function initStorage(env: Env, supabase: SupabaseClient): StorageHandles {
  const bucket = env.SUPABASE_STORAGE_BUCKET;

  return {
    bucket,
    async createSignedUploadUrl(req) {
      const maxBytes = MAX_BYTES_BY_KIND[req.kind];
      if (req.contentLengthBytes > maxBytes) {
        throw new UploadValidationError(
          `contentLengthBytes ${req.contentLengthBytes} exceeds max ${maxBytes} for kind ${req.kind}`,
          'contentLengthBytes',
        );
      }
      const extension = req.contentType === 'application/pdf' ? 'pdf' : req.contentType.split('/')[1];
      const objectPath = `${req.kind}/${req.ownerId}/${randomUUID()}.${extension}`;
      const expiresAtMs = Date.now() + env.SUPABASE_SIGNED_URL_TTL_SECONDS * 1000;

      const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(objectPath);
      if (error || !data) {
        throw new Error(`Supabase Storage createSignedUploadUrl failed: ${error?.message ?? 'no data'}`);
      }

      return {
        uploadUrl: data.signedUrl,
        uploadToken: data.token,
        objectPath: data.path,
        expiresAt: new Date(expiresAtMs).toISOString(),
      };
    },
  };
}
