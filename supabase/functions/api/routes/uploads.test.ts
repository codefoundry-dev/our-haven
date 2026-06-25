import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';
import type { SupabaseHandles } from '../supabase/admin.ts';

/**
 * Supabase Storage stub: `admin.storage.from(bucket).createSignedUploadUrl(path)`.
 * `from` is a vi.fn so tests can assert the bucket; the returned object's
 * createSignedUploadUrl is a vi.fn so tests can assert the uid-namespaced path.
 */
function makeStorage(result: {
  data?: { signedUrl: string; token: string; path: string } | null;
  error?: { message: string } | null;
}) {
  const createSignedUploadUrl = vi.fn(async (path: string) => ({
    data: result.data === undefined ? { signedUrl: 'https://storage/sign', token: 'tok', path } : result.data,
    error: result.error ?? null,
  }));
  const from = vi.fn(() => ({ createSignedUploadUrl }));
  const supabase = { admin: { storage: { from } } } as unknown as SupabaseHandles;
  return { supabase, from, createSignedUploadUrl };
}

function makeDeps(opts: { supabase?: SupabaseHandles } = {}): AppDeps {
  const stub = new Proxy({} as never, { get: () => stub });
  return {
    env: buildTestEnv(),
    db: stub,
    supabase: (opts.supabase ?? stub) as AppDeps['supabase'],
    stripe: stub,
  };
}

function caregiverToken(uid = 'uid-1') {
  return mintAccessToken({ sub: uid, email: 'cg@example.com', appMetadata: { role: 'caregiver', categories: ['babysitter'] } });
}

const post = (token: string, body: unknown): RequestInit => ({
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('POST /v1/uploads/signed-url', () => {
  it('401 without a bearer token', async () => {
    const app = buildApp(makeDeps());
    const res = await app.request('/v1/uploads/signed-url', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'id-doc' }) });
    expect(res.status).toBe(401);
  });

  it('403 forbidden_role for a parent token', async () => {
    const { supabase } = makeStorage({});
    const app = buildApp(makeDeps({ supabase }));
    const token = await mintAccessToken({ sub: 'uid-p', appMetadata: { role: 'parent' } });
    const res = await app.request('/v1/uploads/signed-url', post(token, { kind: 'id-doc' }));
    expect(res.status).toBe(403);
  });

  it('400 when kind is missing / invalid', async () => {
    const { supabase } = makeStorage({});
    const app = buildApp(makeDeps({ supabase }));
    const res = await app.request('/v1/uploads/signed-url', post(await caregiverToken(), { kind: 'passport' }));
    expect(res.status).toBe(400);
  });

  it('mints a signed URL for an id-doc against the private bucket, uid-namespaced', async () => {
    const { supabase, from, createSignedUploadUrl } = makeStorage({
      data: { signedUrl: 'https://storage/sign/abc', token: 'upload-token', path: 'id-doc/uid-1/generated' },
    });
    const app = buildApp(makeDeps({ supabase }));
    const res = await app.request('/v1/uploads/signed-url', post(await caregiverToken(), { kind: 'id-doc' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      bucket: 'id-docs',
      objectPath: 'id-doc/uid-1/generated',
      token: 'upload-token',
      signedUrl: 'https://storage/sign/abc',
    });
    expect(from).toHaveBeenCalledWith('id-docs');
    // The object key is server-chosen and namespaced by the authenticated uid.
    const calledPath = createSignedUploadUrl.mock.calls[0]?.[0] as string;
    expect(calledPath.startsWith('id-doc/uid-1/')).toBe(true);
  });

  it('502 when Storage returns an error', async () => {
    const { supabase } = makeStorage({ data: null, error: { message: 'bucket missing' } });
    const app = buildApp(makeDeps({ supabase }));
    const res = await app.request('/v1/uploads/signed-url', post(await caregiverToken(), { kind: 'id-doc' }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'signed_url_failed' });
  });
});
