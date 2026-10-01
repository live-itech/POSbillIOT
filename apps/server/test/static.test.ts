import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { FakeClock } from '../src/lib/clock';
import { prisma, resetDb, T0 } from './helpers';

let app: Awaited<ReturnType<typeof buildApp>>['app'];

beforeEach(async () => {
  await resetDb();
  const dir = mkdtempSync(join(tmpdir(), 'fp-web-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>FunPlay</title>');
  ({ app } = await buildApp({ prisma, clock: new FakeClock(T0), config: { ...loadConfig(), WEB_DIST: dir }, startLoops: false }));
  await app.ready();
});
afterEach(() => app.close());

it('menyajikan index.html untuk route SPA', async () => {
  const res = await app.inject({ method: 'GET', url: '/settings' });
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('<title>FunPlay</title>');
});

it('API yang tidak ada tetap 404 JSON', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/tidak-ada' });
  expect(res.statusCode).toBe(404);
  expect(res.json().error.code).toBe('NOT_FOUND');
});
