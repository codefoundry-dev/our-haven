import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { mintAccessToken, stubDeps } from '../_test/jwt.ts';
import type { AppEnv } from '../context.ts';
import type { AppDeps } from '../deps.ts';
import { requireAuth, type RequireAuthOptions } from './middleware.ts';

function buildProbeApp(deps: AppDeps, opts?: RequireAuthOptions) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });
  app.get('/probe', requireAuth(opts), (c) => {
    const p = c.get('principal')!;
    return c.json({ uid: p.uid, role: p.role, kind: p.kind, secondFactor: p.secondFactor });
  });
  return app;
}

describe('requireAuth() — Hono middleware (ported from plugins/auth.ts)', () => {
  it('401 missing_bearer_token when Authorization header is absent', async () => {
    const res = await buildProbeApp(stubDeps()).request('/probe');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'missing_bearer_token' });
  });

  it('401 when the bearer prefix is missing', async () => {
    const res = await buildProbeApp(stubDeps()).request('/probe', {
      headers: { authorization: 'token-without-bearer' },
    });
    expect(res.status).toBe(401);
  });

  it('401 invalid_token on a bad signature', async () => {
    const res = await buildProbeApp(stubDeps()).request('/probe', {
      headers: { authorization: 'Bearer not.a.real.jwt' },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_token' });
  });

  it('populates principal on a valid parent token', async () => {
    const token = await mintAccessToken({
      sub: 'supabase-uid-123',
      email: 'parent@example.com',
      appMetadata: { role: 'parent' },
    });
    const res = await buildProbeApp(stubDeps()).request('/probe', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ uid: 'supabase-uid-123', role: 'parent', kind: null });
  });

  it('403 forbidden_role when the route requires a role the token lacks', async () => {
    const token = await mintAccessToken({ sub: 'supabase-uid-123' });
    const res = await buildProbeApp(stubDeps(), { roles: ['parent'] }).request('/probe', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_role' });
  });

  it('403 when the role mismatches', async () => {
    const token = await mintAccessToken({
      sub: 'supabase-uid-123',
      appMetadata: { role: 'parent' },
    });
    const res = await buildProbeApp(stubDeps(), { roles: ['admin'] }).request('/probe', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it('honors provider kind from app_metadata', async () => {
    const token = await mintAccessToken({
      sub: 'supabase-uid-123',
      appMetadata: { role: 'provider', kind: 'specialist' },
    });
    const res = await buildProbeApp(stubDeps(), { roles: ['provider'] }).request('/probe', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: 'provider', kind: 'specialist' });
  });

  it('strips kind for non-provider roles', async () => {
    const token = await mintAccessToken({
      sub: 'supabase-uid-123',
      appMetadata: { role: 'parent', kind: 'specialist' },
    });
    const res = await buildProbeApp(stubDeps()).request('/probe', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: 'parent', kind: null });
  });

  it('derives secondFactor=totp from aal2 + amr={mfa/totp}', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await mintAccessToken({
      sub: 'supabase-uid-123',
      appMetadata: { role: 'provider', kind: 'caregiver' },
      aal: 'aal2',
      amr: [
        { method: 'password', timestamp: now - 60 },
        { method: 'mfa/totp', timestamp: now - 5 },
      ],
    });
    const res = await buildProbeApp(stubDeps()).request('/probe', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ secondFactor: 'totp' });
  });

  it('leaves secondFactor null on aal1 tokens', async () => {
    const token = await mintAccessToken({
      sub: 'supabase-uid-123',
      appMetadata: { role: 'provider', kind: 'caregiver' },
    });
    const res = await buildProbeApp(stubDeps()).request('/probe', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ secondFactor: null });
  });
});
