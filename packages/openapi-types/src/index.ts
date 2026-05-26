/**
 * Public surface of @our-haven/openapi-types.
 *
 * `src/generated/schema.ts` is produced by `npm run generate` (which runs
 * `openapi-typescript` against apps/backend/openapi/openapi.yaml). The
 * generated file is committed as machine-generated source — CI runs
 * `npm run openapi:check --workspace=@our-haven/backend` + this package's
 * generate step and fails on diff.
 *
 * Bootstrap order on a fresh clone:
 *   1. npm install
 *   2. npm run openapi:emit --workspace=@our-haven/backend
 *   3. npm run openapi:generate
 */
export type { components, paths, operations } from './generated/schema.js';
