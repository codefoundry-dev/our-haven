import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { UploadValidationError } from '@/gcp/storage.js';

const SignedUploadRequest = z.object({
  kind: z.enum(['id-doc', 'license-doc', 'insurance-doc', 'state-childcare-registration', 'avatar']),
  contentType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
  contentLengthBytes: z.number().int().positive().max(20 * 1024 * 1024),
});

const SignedUploadResponse = z.object({
  uploadUrl: z.string().url(),
  objectPath: z.string(),
  expiresAt: z.string().datetime(),
});

const ErrorResponse = z.object({
  error: z.string(),
  field: z.string().optional(),
});

export const uploadRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/uploads/signed-url',
    {
      schema: {
        tags: ['uploads'],
        summary: 'Create a v4 signed PUT URL for client-side GCS upload',
        description:
          'Returns a short-lived (5 min default) v4 signed URL the client uses to PUT a file directly to GCS. Content-type and max size are enforced via x-goog-content-length-range on the signed request.',
        security: [{ firebaseIdToken: [] }],
        body: SignedUploadRequest,
        response: {
          200: SignedUploadResponse,
          400: ErrorResponse,
          401: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      // TODO(2.2): replace placeholder ownerId with verified Firebase Auth subject
      // once @fastify/auth + firebase-admin token verification middleware lands.
      const ownerId = 'anonymous';

      try {
        const result = await app.deps.storage.createSignedUploadUrl({
          kind: req.body.kind,
          ownerId,
          contentType: req.body.contentType,
          contentLengthBytes: req.body.contentLengthBytes,
        });
        return result;
      } catch (err) {
        if (err instanceof UploadValidationError) {
          reply.code(400);
          return { error: err.message, field: err.field };
        }
        throw err;
      }
    },
  );
};
