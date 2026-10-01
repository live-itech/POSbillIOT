#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export DATABASE_URL="${E2E_DATABASE_URL:-postgresql://funplay:funplay@localhost:5432/funplay_e2e}"
export COOKIE_SECRET="e2e-secret-e2e-secret-e2e-secret-e2e"
export NODE_ENV=production PORT=3100 HOST=127.0.0.1 WEB_DIST="$PWD/apps/web/dist"
pnpm --filter @funplay/web build
cd apps/server
pnpm exec prisma migrate deploy
pnpm exec tsx scripts/e2e-reset.ts
pnpm exec tsx src/seed.ts
exec pnpm exec tsx src/main.ts
