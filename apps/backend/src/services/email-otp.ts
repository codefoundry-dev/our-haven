import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

import type { Db } from '@/db/kysely.js';

const CODE_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1_000;
const MAX_ATTEMPTS = 5;
const SCRYPT_KEYLEN = 32;
const SALT_BYTES = 16;

export interface EmailOtpNotifier {
  sendEmailOtp(input: { email: string; code: string; expiresAt: Date }): Promise<void>;
}

export interface EmailOtpIssueResult {
  id: string;
  expiresAt: Date;
}

export type EmailOtpVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'no_active_code' | 'wrong_code' | 'expired' | 'too_many_attempts' };

export class EmailOtpService {
  constructor(
    private readonly db: Db,
    private readonly notifier: EmailOtpNotifier,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async issue(input: { uid: string; email: string }): Promise<EmailOtpIssueResult> {
    const now = this.clock();
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
    const code = generateCode();
    const salt = randomBytes(SALT_BYTES).toString('hex');
    const codeHash = hashCode(code, salt);

    const id = await this.db.transaction().execute(async (tx) => {
      await tx
        .updateTable('auth_email_otps')
        .set({ consumed_at: now })
        .where('uid', '=', input.uid)
        .where('consumed_at', 'is', null)
        .where('expires_at', '>', now)
        .execute();

      const inserted = await tx
        .insertInto('auth_email_otps')
        .values({
          uid: input.uid,
          email: input.email,
          code_hash: codeHash,
          salt,
          expires_at: expiresAt,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      return inserted.id;
    });

    await this.notifier.sendEmailOtp({ email: input.email, code, expiresAt });
    return { id, expiresAt };
  }

  async verify(input: { uid: string; code: string }): Promise<EmailOtpVerifyResult> {
    const now = this.clock();

    return this.db.transaction().execute(async (tx) => {
      const row = await tx
        .selectFrom('auth_email_otps')
        .selectAll()
        .where('uid', '=', input.uid)
        .where('consumed_at', 'is', null)
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst();

      if (!row) return { ok: false, reason: 'no_active_code' } as const;

      const expiresAt = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
      if (expiresAt.getTime() <= now.getTime()) {
        return { ok: false, reason: 'expired' } as const;
      }
      if (row.attempts >= MAX_ATTEMPTS) {
        return { ok: false, reason: 'too_many_attempts' } as const;
      }

      const expected = Buffer.from(row.code_hash, 'hex');
      const actual = scryptSync(input.code, row.salt, SCRYPT_KEYLEN);
      const match = expected.length === actual.length && timingSafeEqual(expected, actual);

      if (!match) {
        await tx
          .updateTable('auth_email_otps')
          .set({ attempts: row.attempts + 1 })
          .where('id', '=', row.id)
          .execute();
        const remaining = MAX_ATTEMPTS - (row.attempts + 1);
        return remaining <= 0
          ? ({ ok: false, reason: 'too_many_attempts' } as const)
          : ({ ok: false, reason: 'wrong_code' } as const);
      }

      await tx
        .updateTable('auth_email_otps')
        .set({ consumed_at: now })
        .where('id', '=', row.id)
        .execute();
      return { ok: true } as const;
    });
  }
}

function generateCode(): string {
  return randomInt(0, 10 ** CODE_LENGTH)
    .toString()
    .padStart(CODE_LENGTH, '0');
}

function hashCode(code: string, salt: string): string {
  return scryptSync(code, salt, SCRYPT_KEYLEN).toString('hex');
}

export class LoggingEmailOtpNotifier implements EmailOtpNotifier {
  constructor(private readonly log: { info: (msg: object, label?: string) => void }) {}
  async sendEmailOtp(input: { email: string; code: string; expiresAt: Date }): Promise<void> {
    this.log.info(
      { email: redact(input.email), code: input.code, expiresAt: input.expiresAt.toISOString() },
      'email-otp issued (dev notifier — real SendGrid wiring lands in OH-115)',
    );
  }
}

function redact(email: string): string {
  const at = email.indexOf('@');
  if (at <= 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
