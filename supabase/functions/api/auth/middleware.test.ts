import { Hono } from 'hono';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';

import { buildTestEnv, mintAccessToken, stubDeps } from '../_test/jwt.ts';
import type { AppEnv } from '../context.ts';
import type { AppDeps } from '../deps.ts';
import { requireAuth, type RequireAuthOptions } from './middleware.ts';

// The middleware verifies asymmetric (ES256) tokens against the project's remote
// JWKS. Redirect createRemoteJWKSet to jose's no-network createLocalJWKSet over
// an in-test key set, so the real jwtVerify still runs genuine ES256 crypto but
// nothing leaves the box. Only createRemoteJWKSet is replaced; everything else
// (decodeProtectedHeader, jwtVerify, SignJWT, …) is the real jose.
const testJwks = vi.hoisted(() => ({ current: { keys: [] as Record<string, unknown>[] } }));
vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>();
  return {
    ...actual,
    createRemoteJWKSet: () => actual.createLocalJWKSet(testJwks.current as never),
  };
});

function buildProbeApp(deps: AppDeps, opts?: RequireAuthOptions) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });
  app.get('/probe', requireAuth(opts), (c) => {
    const p = c.get('principal')!;
    return c.json({
      uid: p.uid,
      role: p.role,
      categories: p.categories,
      specialty: p.specialty,
      secondFactor: p.secondFactor,
    });
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
    expect(await res.json()).toMatchObject({
      uid: 'supabase-uid-123',
      role: 'parent',
      categories: null,
      specialty: null,
    });
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
    const res = await buildProbeApp(stubDeps(), { roles: ['caregiver'] }).request('/probe', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it('honors provider specialty from app_metadata', async () => {
    const token = await mintAccessToken({
      sub: 'supabase-uid-123',
      appMetadata: { role: 'provider', specialty: 'slp' },
    });
    const res = await buildProbeApp(stubDeps(), { roles: ['provider'] }).request('/probe', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: 'provider', specialty: 'slp', categories: null });
  });

  it('honors caregiver categories from app_metadata', async () => {
    const token = await mintAccessToken({
      sub: 'supabase-uid-123',
      appMetadata: { role: 'caregiver', categories: ['babysitter', 'nanny'] },
    });
    const res = await buildProbeApp(stubDeps(), { roles: ['caregiver'] }).request('/probe', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      role: 'caregiver',
      categories: ['babysitter', 'nanny'],
      specialty: null,
    });
  });

  it('strips categories/specialty for roles that do not carry them', async () => {
    const token = await mintAccessToken({
      sub: 'supabase-uid-123',
      appMetadata: { role: 'parent', categories: ['babysitter'], specialty: 'slp' },
    });
    const res = await buildProbeApp(stubDeps()).request('/probe', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: 'parent', categories: null, specialty: null });
  });

  it('derives secondFactor=totp from aal2 + amr={mfa/totp}', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await mintAccessToken({
      sub: 'supabase-uid-123',
      appMetadata: { role: 'caregiver', categories: ['babysitter'] },
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
      appMetadata: { role: 'caregiver', categories: ['babysitter'] },
    });
    const res = await buildProbeApp(stubDeps()).request('/probe', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ secondFactor: null });
  });

  // Admin TOTP is mandatory server-side on every request (OH-175 — CONTEXT § MFA
  // posture; PRD § Admin), not just at sign-in.
  describe('admin TOTP enforcement', () => {
    it('403 admin_totp_required when an admin token is aal1 (no TOTP)', async () => {
      const token = await mintAccessToken({ sub: 'admin-uid-1', appMetadata: { role: 'admin' } });
      const res = await buildProbeApp(stubDeps()).request('/probe', {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'admin_totp_required' });
    });

    it('403 admin_totp_required when an admin token is aal2 but the factor is phone (not TOTP)', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await mintAccessToken({
        sub: 'admin-uid-1',
        appMetadata: { role: 'admin' },
        aal: 'aal2',
        amr: [{ method: 'phone', timestamp: now }],
      });
      const res = await buildProbeApp(stubDeps(), { roles: ['admin'] }).request('/probe', {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'admin_totp_required' });
    });

    it('passes an admin token with aal2 + TOTP', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await mintAccessToken({
        sub: 'admin-uid-1',
        appMetadata: { role: 'admin' },
        aal: 'aal2',
        amr: [
          { method: 'password', timestamp: now - 60 },
          { method: 'mfa/totp', timestamp: now - 5 },
        ],
      });
      const res = await buildProbeApp(stubDeps(), { roles: ['admin'] }).request('/probe', {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ role: 'admin', secondFactor: 'totp' });
    });
  });

  // Supabase projects now sign access tokens with ASYMMETRIC JWT signing keys
  // (ES256, published at /auth/v1/.well-known/jwks.json) by default. The
  // previous HS256-only verification rejected every real token with
  // `invalid_token` — this guards the dual-mode (JWKS) verification path.
  describe('asymmetric (ES256) verification via the project JWKS', () => {
    it('accepts an ES256 token signed with a key from the project JWKS', async () => {
      // Distinct host so the module-level JWKS cache cannot collide with the
      // reject case below (each URL builds its own resolver once).
      const supabaseUrl = 'https://asym-project.supabase.co';
      const kid = 'es256-test-key-1';
      const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
      testJwks.current = { keys: [{ ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' }] };

      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({
        aud: 'authenticated',
        role: 'authenticated',
        email: 'caregiver@example.com',
        app_metadata: { role: 'caregiver', categories: ['babysitter'] },
        user_metadata: {},
        aal: 'aal1',
        amr: [{ method: 'password', timestamp: now }],
      })
        .setProtectedHeader({ alg: 'ES256', kid, typ: 'JWT' })
        .setSubject('asym-uid-1')
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .sign(privateKey);

      const deps = stubDeps();
      deps.env = buildTestEnv({ SUPABASE_URL: supabaseUrl });
      const res = await buildProbeApp(deps).request('/probe', {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        uid: 'asym-uid-1',
        role: 'caregiver',
        categories: ['babysitter'],
      });
    });

    it('rejects an ES256 token signed by a key NOT in the JWKS', async () => {
      const supabaseUrl = 'https://asym-reject.supabase.co';
      const kid = 'es256-reject-key';
      const trusted = await generateKeyPair('ES256', { extractable: true });
      const attacker = await generateKeyPair('ES256', { extractable: true });
      testJwks.current = {
        keys: [{ ...(await exportJWK(trusted.publicKey)), kid, alg: 'ES256', use: 'sig' }],
      };

      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({
        aud: 'authenticated',
        app_metadata: { role: 'caregiver' },
      })
        .setProtectedHeader({ alg: 'ES256', kid, typ: 'JWT' })
        .setSubject('forged-uid')
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .sign(attacker.privateKey);

      const deps = stubDeps();
      deps.env = buildTestEnv({ SUPABASE_URL: supabaseUrl });
      const res = await buildProbeApp(deps).request('/probe', {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'invalid_token' });
    });
  });
});
