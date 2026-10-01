import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3100', locale: 'id-ID' },
  webServer: {
    command: 'bash scripts/e2e-server.sh',
    url: 'http://127.0.0.1:3100/api/health',
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
