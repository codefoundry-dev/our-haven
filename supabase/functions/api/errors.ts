/**
 * A required vendor secret / config value is absent at the point a route needs
 * it. The core surface (auth, role-claim, verification, uploads) boots and runs
 * without any payment config — a missing Stripe key or price id must NOT 503 the
 * whole fat function (the brittleness that took down role-claim). Only the route
 * that actually exercises the unset secret throws this, and the app's onError
 * maps it to a clean 503 `not_configured` (the feature is unconfigured, not a
 * server bug) rather than an opaque 500 or a malformed upstream call.
 */
export class NotConfiguredError extends Error {
  constructor(readonly configKey: string) {
    super(`${configKey} is not configured`);
    this.name = 'NotConfiguredError';
  }
}
