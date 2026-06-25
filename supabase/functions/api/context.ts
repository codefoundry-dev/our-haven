import type { Principal } from './auth/principal.ts';
import type { AppDeps } from './deps.ts';

/**
 * Typed Hono context for the `api` app. `deps` is injected by the root
 * middleware in `buildApp`; `principal` is populated by `requireAuth`. Kept in
 * its own module so middleware/routes can import the types without a cycle
 * through `app.ts`.
 */
export type AppVariables = {
  deps: AppDeps;
  principal: Principal | null;
};

export type AppEnv = { Variables: AppVariables };
