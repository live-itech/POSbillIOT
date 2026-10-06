import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let users: Awaited<ReturnType<typeof seedUsers>>;
let spv: string;
let kasir: string;

beforeEach(async () => {
  await resetDb();
  users = await seedUsers();
  await seedBasics();
  t = await makeApp();
  spv = await loginAs(t.app, 'supervisor');
  kasir = await loginAs(t.app, 'kasir');
});
afterEach(() => t.app.close());

const req = (cookie: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie }, payload: payload as object });
const gold = async () => (await req(spv, 'POST', '/api/member-levels', { name: 'Gold', timeDiscountPct: 10, fnbDiscountPct: 5 })).json() as { id: string };
const addMember = (body: Record<string, unknown>, cookie = spv) => req(cookie, 'POST', '/api/members', body);

describe('level member', () => {
  it('hanya supervisor/owner yang mengelola; semua role boleh melihat', async () => {
    expect((await req(kasir, 'POST', '/api/member-levels', { name: 'Gold' })).statusCode).toBe(403);
    const res = await req(spv, 'POST', '/api/member-levels', { name: 'Gold', timeDiscountPct: 10, fnbDiscountPct: 5 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Gold', timeDiscountPct: 10, fnbDiscountPct: 5, sortOrder: 0, active: true });
    expect((await req(kasir, 'GET', '/api/member-levels')).json()).toHaveLength(1);
    const id = res.json().id;
    expect((await req(spv, 'PATCH', `/api/member-levels/${id}`, { fnbDiscountPct: 101 })).statusCode).toBe(400);
    expect((await req(spv, 'PATCH', `/api/member-levels/${id}`, { fnbDiscountPct: 0 })).json().fnbDiscountPct).toBe(0);
  });
});

describe('member', () => {
  it('kode otomatis berurutan; cari kode/nama/HP; kasir hanya mencari', async () => {
    const level = await gold();
    const a = await addMember({ name: 'Sinta', phone: '0811', levelId: level.id });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ code: 'M0001', name: 'Sinta', phone: '0811', levelName: 'Gold', active: true });
    expect((await addMember({ name: 'Budi', phone: '0822', levelId: level.id })).json().code).toBe('M0002');
    const names = async (q: string) => ((await req(kasir, 'GET', `/api/members?q=${q}`)).json() as { name: string }[]).map((m) => m.name);
    expect(await names('m0002')).toEqual(['Budi']);
    expect(await names('sin')).toEqual(['Sinta']);
    expect(await names('0811')).toEqual(['Sinta']);
    expect((await addMember({ name: 'Rina', levelId: level.id }, kasir)).statusCode).toBe(403);
    expect((await addMember({ name: 'Rina', levelId: 'tidak-ada' })).statusCode).toBe(404);
  });

  it('no. HP unik di antara member aktif', async () => {
    const level = await gold();
    const sinta = (await addMember({ name: 'Sinta', phone: '0811', levelId: level.id })).json();
    const dup = await addMember({ name: 'Rina', phone: '0811', levelId: level.id });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('PHONE_TAKEN');
    expect((await req(spv, 'PATCH', `/api/members/${sinta.id}`, { active: false })).statusCode).toBe(200);
    expect((await addMember({ name: 'Rina', phone: '0811', levelId: level.id })).statusCode).toBe(200);
    expect((await req(spv, 'PATCH', `/api/members/${sinta.id}`, { active: true })).json().error.code).toBe('PHONE_TAKEN');
    expect((await addMember({ name: 'Tanpa HP 1', levelId: level.id })).statusCode).toBe(200);
    expect((await addMember({ name: 'Tanpa HP 2', levelId: level.id })).statusCode).toBe(200);
    expect((await req(kasir, 'GET', '/api/members?active=false')).json().map((m: { name: string }) => m.name)).toEqual(['Sinta']);
  });

  it('dua pendaftaran paralel dengan HP sama → tepat satu berhasil', async () => {
    const level = await gold();
    const [x, y] = await Promise.all([
      addMember({ name: 'Sinta', phone: '0811', levelId: level.id }),
      addMember({ name: 'Rina', phone: '0811', levelId: level.id }),
    ]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    expect(await prisma.member.count()).toBe(1);
  });

  it('member yang pernah bertransaksi tidak bisa dihapus; level yang dipakai juga tidak', async () => {
    const level = await gold();
    const m = (await addMember({ name: 'Sinta', phone: '0811', levelId: level.id })).json();
    await prisma.bill.create({ data: { number: 'FP-TEST-0001', createdById: users.kasir.id, memberId: m.id } });
    const del = await req(spv, 'DELETE', `/api/members/${m.id}`);
    expect(del.statusCode).toBe(409);
    expect(del.json().error.code).toBe('MEMBER_IN_USE');
    expect((await req(spv, 'DELETE', `/api/member-levels/${level.id}`)).json().error.code).toBe('IN_USE');
    const fresh = (await addMember({ name: 'Budi', levelId: level.id })).json();
    expect((await req(spv, 'DELETE', `/api/members/${fresh.id}`)).statusCode).toBe(204);
  });

  it('level nonaktif tidak bisa dipilih', async () => {
    const level = await gold();
    await req(spv, 'PATCH', `/api/member-levels/${level.id}`, { active: false });
    expect((await addMember({ name: 'Sinta', levelId: level.id })).json().error.code).toBe('LEVEL_INACTIVE');
  });
});
