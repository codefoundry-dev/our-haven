/**
 * Caller authentication for the tick (OH-237). The function is deployed
 * `--no-verify-jwt` (it is invoked by pg_cron + pg_net, not by an end user with
 * a Supabase JWT), so it gates itself on a shared secret presented as
 * `Authorization: Bearer <secret>`. Compared in constant time so a timing
 * side-channel cannot leak the secret.
 */

/** Constant-time string equality. Always compares the full length of the longer
 *  input so the running time does not reveal where a mismatch occurred. */
export function secretsMatch(presented: string, expected: string): boolean {
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(expected);
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/** Extract the bearer token from an Authorization header value (`''` if none). */
export function bearerToken(authHeader: string | null | undefined): string {
  if (!authHeader) return '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match?.[1] ?? '';
}

/** True when the request carries the correct shared secret. */
export function isAuthorized(authHeader: string | null | undefined, expectedSecret: string): boolean {
  return secretsMatch(bearerToken(authHeader), expectedSecret);
}
