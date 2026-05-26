import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(here, 'src'),
      '@our-haven/domain': resolve(here, '..', '..', 'packages', 'domain', 'src', 'index.ts'),
      '@our-haven/openapi-types': resolve(
        here,
        '..',
        '..',
        'packages',
        'openapi-types',
        'src',
        'index.ts',
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    reporters: ['verbose'],
  },
});
