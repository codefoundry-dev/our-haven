import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnv, resetEnvForTests } from '@/config/env.js';
import { initStorage, UploadValidationError } from '@/supabase/storage.js';

import { applyTestEnv } from '../helpers/test-jwt.js';

const baseEnv = () => {
  resetEnvForTests();
  applyTestEnv();
  return loadEnv();
};

const mockSupabase = (overrides?: {
  createSignedUploadUrl?: (path: string) => Promise<{
    data: { signedUrl: string; path: string; token: string } | null;
    error: { message: string } | null;
  }>;
}): SupabaseClient => {
  const createSignedUploadUrl =
    overrides?.createSignedUploadUrl ??
    (async (path: string) => ({
      data: {
        signedUrl: `https://signed.example/object/${path}?token=fake`,
        path,
        token: 'fake-upload-token',
      },
      error: null,
    }));
  return {
    storage: {
      from: vi.fn(() => ({ createSignedUploadUrl })),
    },
  } as unknown as SupabaseClient;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('initStorage().createSignedUploadUrl', () => {
  it('returns a signed url + token + object path scoped by kind and owner', async () => {
    const env = baseEnv();
    const storage = initStorage(env, mockSupabase());
    const result = await storage.createSignedUploadUrl({
      kind: 'id-doc',
      ownerId: 'user-123',
      contentType: 'image/jpeg',
      contentLengthBytes: 1024,
    });
    expect(result.uploadUrl).toMatch(/^https:\/\/signed\.example/);
    expect(result.uploadToken).toBe('fake-upload-token');
    expect(result.objectPath).toMatch(/^id-doc\/user-123\/[0-9a-f-]+\.jpeg$/);
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects oversize id-doc uploads with UploadValidationError', async () => {
    const env = baseEnv();
    const storage = initStorage(env, mockSupabase());
    await expect(
      storage.createSignedUploadUrl({
        kind: 'id-doc',
        ownerId: 'user-123',
        contentType: 'application/pdf',
        contentLengthBytes: 20 * 1024 * 1024,
      }),
    ).rejects.toBeInstanceOf(UploadValidationError);
  });

  it('rejects oversize avatar uploads (avatar cap is tighter than docs)', async () => {
    const env = baseEnv();
    const storage = initStorage(env, mockSupabase());
    await expect(
      storage.createSignedUploadUrl({
        kind: 'avatar',
        ownerId: 'user-123',
        contentType: 'image/png',
        contentLengthBytes: 6 * 1024 * 1024,
      }),
    ).rejects.toBeInstanceOf(UploadValidationError);
  });

  it('propagates Supabase Storage errors', async () => {
    const env = baseEnv();
    const supabase = mockSupabase({
      createSignedUploadUrl: async () => ({
        data: null,
        error: { message: 'bucket not found' },
      }),
    });
    const storage = initStorage(env, supabase);
    await expect(
      storage.createSignedUploadUrl({
        kind: 'avatar',
        ownerId: 'user-123',
        contentType: 'image/png',
        contentLengthBytes: 1024,
      }),
    ).rejects.toThrow(/bucket not found/);
  });
});
