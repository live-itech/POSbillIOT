import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/test-env';

export default defineConfig({
  test: {
    globalSetup: ['test/global-setup.ts'],
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      COOKIE_SECRET: 'test-secret-test-secret-test-secret',
      NODE_ENV: 'test',
    },
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 20_000,
  },
});
