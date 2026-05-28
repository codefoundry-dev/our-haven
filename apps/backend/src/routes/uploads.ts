import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { UploadValidationError } from '@/supabase/storage.js';

const SignedUploadRequest = z.object({
  kind: z.enum(['id-doc', 'license-doc', 'insurance-doc', 'state-childcare-registration', 'avatar']),
  contentType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
  contentLengthBytes: z.number().int().positive().max(20 * 1024 * 1024),
});

const SignedUploadResponse = z.object({
  uploadUrl: z.string().url(),
  uploadToken: z.string(),
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
      preHandler: app.requireAuth(),
      schema: {
        tags: ['uploads'],
        summary: 'Create a short-lived signed PUT URL for client-side Supabase Storage upload',
        description:
          'Returns a short-lived (5 min default) Supabase Storage signed upload URL + token. The client uses `uploadToSignedUrl` (or a fetch PUT with the token) to send the file directly to Supabase Storage. Content-type and per-kind max size are validated on the request; bucket-level size caps in Supabase Storage backstop the limit.',
        security: [{ supabaseAccessToken: [] }],
        body: SignedUploadRequest,
        response: {
          200: SignedUploadResponse,
          400: ErrorResponse,
          401: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const ownerId = req.principal!.uid;

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
