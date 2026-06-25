import { defineConfig } from 'vitest/config';

// Vitest for the repo-root-owned Edge tooling (ADR-0019): the Deno `api`
// function tree (which runs unchanged on Node) plus its Node-side scripts
// (OpenAPI emit/drift, the plpgsql canary). Rooted at the repo so the
// explicit-.ts + bare-specifier source resolves deps from the hoisted root
// node_modules. Separate from the apps/backend (Fastify) suite, which keeps its
// own vitest.config.ts.
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'supabase/functions/api/**/*.test.ts',
      'supabase/functions/worker-tick/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    reporters: ['verbose'],
  },
});
