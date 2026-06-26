import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import type { AppEnv } from '../context.ts';

/**
 * Corporate "Contact Us" intake (OH-191) — PRD-0001 v1.7 story 49a; ADR-0011.
 *
 * The clinical tier has two monetization paths: individual / small-business
 * Providers self-serve a Provider Subscription (routes/provider-subscription.ts),
 * while **large corporations submit a sales-led "Contact Us" intake** for a
 * custom contract. v1 ships the intake form ONLY — no self-serve organization
 * onboarding, no multi-seat org model; contract terms are a sales/legal matter
 * handled manually.
 *
 *   POST /v1/providers/contact-us   (public)
 *
 * PUBLIC by design: corporate leads are pre-account (they have no Provider login
 * yet), so this route carries no `requireAuth`. The lead is **captured** in
 * `provider_contact_intakes` and, when a sales recipient is configured
 * (CONTACT_INTAKE_NOTIFY_UID), **routed** via a notification-outbox handoff in
 * the same transaction (OH-237 substrate; the channel fan-out is OH-194). With
 * no recipient configured the lead is still captured for ops to read; it is just
 * not enqueued.
 */

/** The outbox event a captured corporate intake routes to sales (OH-194 reads it). */
const CONTACT_INTAKE_EVENT = 'provider_contact_intake.received';

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('ContactUsError');

const ContactUsRequest = z
  .object({
    organizationName: z.string().min(1).max(160),
    contactName: z.string().min(1).max(120),
    contactEmail: z.string().email().max(254),
    contactPhone: z.string().max(40).optional(),
    /** Rough headcount the corporation expects to list (sizes the sales follow-up). */
    estimatedSeats: z.number().int().min(0).max(100_000).optional(),
    /** 2-letter US state, optional — a multi-state corporation may leave it blank. */
    state: z
      .string()
      .length(2)
      .regex(/^[A-Za-z]{2}$/)
      .optional(),
    message: z.string().max(4000).optional(),
  })
  .openapi('ContactUsRequest');

const ContactUsResponse = z
  .object({ id: z.string(), status: z.enum(['new', 'routed']) })
  .openapi('ContactUsResponse');

const contactUsRoute = createRoute({
  method: 'post',
  path: '/providers/contact-us',
  tags: ['subscription'],
  summary: 'Submit a corporate Provider "Contact Us" intake (public)',
  description:
    'Captures a sales-led custom-contract lead for the large-corporation Provider path (v1 intake only — no self-serve org onboarding / multi-seat model). Public route — corporate leads are pre-account. The lead is persisted and, when a sales recipient is configured, routed via a notification-outbox handoff in the same transaction.',
  request: { body: { content: json(ContactUsRequest), required: true } },
  responses: {
    201: { description: 'Intake captured (+ routed when a sales recipient is configured)', content: json(ContactUsResponse) },
    400: { description: 'Invalid intake payload', content: json(ErrorResponse) },
  },
});

export function registerContactUsRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(contactUsRoute, async (c) => {
    const { db, env } = c.var.deps;
    const input = c.req.valid('json');

    const notifyUid = env.CONTACT_INTAKE_NOTIFY_UID;
    const now = new Date();

    const values = {
      organization_name: input.organizationName,
      contact_name: input.contactName,
      contact_email: input.contactEmail,
      contact_phone: input.contactPhone ?? null,
      estimated_seats: input.estimatedSeats ?? null,
      state: input.state ? input.state.toUpperCase() : null,
      message: input.message ?? null,
      status: (notifyUid ? 'routed' : 'new') as 'routed' | 'new',
      routed_at: notifyUid ? now : null,
    };

    // Capture + route in ONE transaction: a corporate lead is never enqueued
    // without being persisted (and vice versa). The dedupe key is belt-and-braces
    // — the intake id is freshly generated, so the row is unique anyway.
    const intake = await db.transaction().execute(async (trx) => {
      const inserted = (await trx
        .insertInto('provider_contact_intakes')
        .values(values)
        .returning(['id', 'status'])
        .executeTakeFirstOrThrow()) as { id: string; status: 'new' | 'routed' };

      if (notifyUid) {
        await trx
          .insertInto('notification_outbox')
          .values({
            recipient_uid: notifyUid,
            event_type: CONTACT_INTAKE_EVENT,
            payload: {
              intakeId: inserted.id,
              organizationName: input.organizationName,
              contactName: input.contactName,
              contactEmail: input.contactEmail,
              estimatedSeats: input.estimatedSeats ?? null,
              state: values.state,
            },
            dedupe_key: `${CONTACT_INTAKE_EVENT}:${inserted.id}`,
          })
          .onConflict((oc) => oc.column('dedupe_key').doNothing())
          .execute();
      }

      return inserted;
    });

    return c.json({ id: intake.id, status: intake.status }, 201);
  });
}
