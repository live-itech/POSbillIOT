import { afterEach, beforeEach, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors';
import { makeApp, resetDb } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;

beforeEach(async () => {
  await resetDb();
  t = await makeApp({
    configure: (app) => {
      app.get('/api/_test/app-error', async () => {
        throw new AppError(409, 'X_CONFLICT', 'Bentrok');
      });
    },
  });
});
afterEach(() => t.app.close());

it('GET /api/health mengembalikan waktu server dari clock', async () => {
  const res = await t.app.inject({ method: 'GET', url: '/api/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true, serverTime: '2026-10-01T03:00:00.000Z' });
});

it('AppError diubah menjadi bentuk error standar', async () => {
  const res = await t.app.inject({ method: 'GET', url: '/api/_test/app-error' });
  expect(res.statusCode).toBe(409);
  expect(res.json()).toEqual({ error: { code: 'X_CONFLICT', message: 'Bentrok' } });
});
