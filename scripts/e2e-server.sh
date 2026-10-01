#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export DATABASE_URL="${E2E_DATABASE_URL:-postgresql://funplay:funplay@localhost:5432/funplay_e2e}"
export COOKIE_SECRET="e2e-secret-e2e-secret-e2e-secret-e2e"
export NODE_ENV=production PORT=3100 HOST=127.0.0.1 WEB_DIST="$PWD/apps/web/dist"
case "${DATABASE_URL##*/}" in
  *_e2e) ;;
  *) echo "Menolak: DATABASE_URL harus mengarah ke database *_e2e (bukan ${DATABASE_URL##*/})" >&2; exit 1 ;;
esac
pnpm --filter @funplay/web build
cd apps/server
pnpm exec prisma migrate deploy
pnpm exec tsx scripts/e2e-reset.ts
pnpm exec tsx src/seed.ts
exec pnpm exec tsx src/main.ts
