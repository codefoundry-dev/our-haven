import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import type { AppEnv } from '../context.ts';
import type { SupabaseHandles } from '../supabase/admin.ts';

/**
 * Signed upload URLs for client-direct Supabase Storage uploads (OH-184).
 *
 * The browser/app never holds the service-role key, so it cannot write to a
 * private bucket directly. Instead it asks this endpoint for a one-time signed
 * upload URL + token (minted by the service-role admin client), PUTs the file
 * straight to Storage (supabase.storage.from(bucket).uploadToSignedUrl(...)),
 * then confirms the resulting objectPath to the owning resource — for a
 * government ID that is POST /v1/providers/me/verification/id-doc.
 *
 * Object paths are server-chosen and namespaced by the authenticated uid +
 * kind (`<kind>/<uid>/<uuid>`), so a client can neither overwrite another
 * member's object nor smuggle an out-of-namespace path past the confirm checks
 * on the owning resource.
 *
 * Kinds (OH-184 / OH-186): `id-doc` (government ID), `license-doc` (Provider
 * professional license certificate), `insurance-doc` (Provider liability COI).
 * All three are sensitive supply-verification PII and share the one private
 * `id-docs` bucket (env.ID_DOC_BUCKET), separated by the kind path prefix; the
 * owning resource validates the prefix on confirm (id-doc →
 * /v1/providers/me/verification/id-doc; license-doc + insurance-doc →
 * /v1/providers/me/credentials/{license,insurance}).
 */

const UPLOAD_KINDS = ['id-doc', 'license-doc', 'insurance-doc'] as const;
type UploadKind = (typeof UPLOAD_KINDS)[number];

const SUPPLY_ROLES = ['caregiver', 'provider'] as const;

const SignedUrlRequest = z
  .object({
    kind: z.enum(UPLOAD_KINDS),
  })
  .openapi('SignedUploadUrlRequest');

const SignedUrlResponse = z
  .object({
    bucket: z.string(),
    /** Server-chosen, uid-namespaced object key the client uploads to and then confirms. */
    objectPath: z.string(),
    /** One-time upload token bound to objectPath (passed to uploadToSignedUrl). */
    token: z.string(),
    /** Fully-qualified signed URL (alternative to the supabase-js token helper). */
    signedUrl: z.string(),
  })
  .openapi('SignedUploadUrl');

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('UploadsError');

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

/** Per-kind bucket + object-key builder. Keeps the uid namespacing in one place. */
function objectKeyFor(kind: UploadKind, uid: string): string {
  // crypto.randomUUID is a Web Platform global available on both Deno and Node 22.
  const unique = crypto.randomUUID();
  switch (kind) {
    case 'id-doc':
      return `id-doc/${uid}/${unique}`;
    case 'license-doc':
      return `license-doc/${uid}/${unique}`;
    case 'insurance-doc':
      return `insurance-doc/${uid}/${unique}`;
  }
}

interface CreateSignedUploadUrlResult {
  data: { signedUrl: string; token: string; path: string } | null;
  error: { message: string } | null;
}

const signedUrlRoute = createRoute({
  method: 'post',
  path: '/uploads/signed-url',
  tags: ['uploads'],
  summary: 'Mint a one-time signed URL for a client-direct private Storage upload',
  description:
    'Returns a signed upload URL + token for a server-chosen, uid-namespaced object key in a private Supabase Storage bucket. The client PUTs the file with supabase.storage.from(bucket).uploadToSignedUrl(objectPath, token, file), then confirms the objectPath to the owning resource (id-doc → POST /v1/providers/me/verification/id-doc; license-doc → POST /v1/providers/me/credentials/license; insurance-doc → POST /v1/providers/me/credentials/insurance). Supply-scoped (caregiver / provider).',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: [...SUPPLY_ROLES] })] as const,
  request: { body: { content: json(SignedUrlRequest), required: true } },
  responses: {
    200: { description: 'Signed upload URL issued', content: json(SignedUrlResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role (parent / admin)', content: json(ErrorResponse) },
    502: { description: 'Storage failed to mint a signed URL', content: json(ErrorResponse) },
  },
});

export function registerUploadRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(signedUrlRoute, async (c) => {
    const { env, supabase } = c.var.deps;
    const principal = c.get('principal')!;
    const { kind } = c.req.valid('json');

    const bucket = env.ID_DOC_BUCKET;
    const objectPath = objectKeyFor(kind, principal.uid);

    const storage = (supabase as SupabaseHandles).admin.storage.from(bucket);
    const { data, error } = (await storage.createSignedUploadUrl(
      objectPath,
    )) as CreateSignedUploadUrlResult;

    if (error || !data) {
      console.error('[uploads] createSignedUploadUrl failed', error);
      return c.json(
        { error: 'signed_url_failed', reason: 'storage could not mint a signed upload URL' },
        502,
      );
    }

    return c.json(
      { bucket, objectPath: data.path, token: data.token, signedUrl: data.signedUrl },
      200,
    );
  });
}
