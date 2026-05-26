import { describe, expect, it, vi, beforeEach } from 'vitest';

import { resetEnvForTests, loadEnv } from '@/config/env.js';
import { UploadValidationError } from '@/gcp/storage.js';

vi.mock('@google-cloud/storage', () => {
  const getSignedUrl = vi.fn(async () => ['https://signed.example/upload?token=fake']);
  const file = vi.fn(() => ({ getSignedUrl }));
  const bucket = vi.fn(() => ({ file }));
  class Storage {
    bucket = bucket;
  }
  return { Storage };
});

const baseEnv = () => {
  resetEnvForTests();
  process.env.NODE_ENV = 'test';
  process.env.GCP_PROJECT_ID = 'our-haven-test';
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/our_haven_test';
  process.env.GCS_UPLOAD_BUCKET = 'our-haven-test-bucket';
  process.env.GCS_SIGNED_URL_TTL_SECONDS = '300';
  return loadEnv();
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('initStorage().createSignedUploadUrl', () => {
  it('returns a signed url + object path scoped by kind and owner', async () => {
    const env = baseEnv();
    const { initStorage } = await import('@/gcp/storage.js');
    const storage = initStorage(env);
    const result = await storage.createSignedUploadUrl({
      kind: 'id-doc',
      ownerId: 'user-123',
      contentType: 'image/jpeg',
      contentLengthBytes: 1024,
    });
    expect(result.uploadUrl).toMatch(/^https:\/\/signed\.example/);
    expect(result.objectPath).toMatch(/^id-doc\/user-123\/[0-9a-f-]+\.jpeg$/);
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects oversize id-doc uploads with UploadValidationError', async () => {
    const env = baseEnv();
    const { initStorage } = await import('@/gcp/storage.js');
    const storage = initStorage(env);
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
    const { initStorage } = await import('@/gcp/storage.js');
    const storage = initStorage(env);
    await expect(
      storage.createSignedUploadUrl({
        kind: 'avatar',
        ownerId: 'user-123',
        contentType: 'image/png',
        contentLengthBytes: 6 * 1024 * 1024,
      }),
    ).rejects.toBeInstanceOf(UploadValidationError);
  });
});
