import { execSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './test-env';

export default function setup(): void {
  // Deviation from brief: use non-destructive `migrate deploy` instead of `migrate
  // reset --force`. `migrate reset` is refused by Prisma's AI-agent safety guard
  // (detects CLAUDECODE env var) and requires real-time human consent we cannot
  // fabricate. `migrate deploy` only applies pending migrations (no data loss); it
  // is safe here because per-test isolation already comes from resetDb() (TRUNCATE)
  // in test/helpers.ts, and funplay_test has no data of its own to lose.
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
