import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, prisma, resetDb, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let users: Awaited<ReturnType<typeof seedUsers>>;

beforeEach(async () => {
  await resetDb();
  users = await seedUsers();
  t = await makeApp();
});
afterEach(() => t.app.close());

const as = async (username: string) => {
  const cookie = await loginAs(t.app, username);
  return (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    t.app.inject({ method, url, headers: { cookie }, payload: payload as object });
};

describe('katalog', () => {
  it('supervisor membuat kategori & produk; semua user bisa membaca', async () => {
    const sup = await as('supervisor');
    const cat = (await sup('POST', '/api/categories', { name: 'Minuman', color: '#06B6D4' })).json();
    expect(cat).toMatchObject({ name: 'Minuman', color: '#06B6D4', sortOrder: 0, active: true });
    const p = await sup('POST', '/api/products', { name: 'Es Teh Manis', categoryId: cat.id, kind: 'STOCK', price: 8000, stockQty: 50 });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({ name: 'Es Teh Manis', kind: 'STOCK', price: 8000, stockQty: 50, active: true });

    const kasir = await as('kasir');
    expect((await kasir('GET', '/api/products')).json()).toHaveLength(1);
    expect((await kasir('GET', '/api/categories')).json()).toHaveLength(1);
  });

  it('kasir tidak boleh menulis katalog', async () => {
    const kasir = await as('kasir');
    expect((await kasir('POST', '/api/categories', { name: 'X' })).statusCode).toBe(403);
  });

  it('validasi: harga negatif, jenis tak dikenal, nama ganda', async () => {
    const own = await as('owner');
    const cat = (await own('POST', '/api/categories', { name: 'Makanan' })).json();
    expect((await own('POST', '/api/products', { name: 'A', categoryId: cat.id, kind: 'STOCK', price: -1 })).statusCode).toBe(400);
    expect((await own('POST', '/api/products', { name: 'A', categoryId: cat.id, kind: 'BARANG', price: 1 })).statusCode).toBe(400);
    await own('POST', '/api/products', { name: 'Mie Goreng', categoryId: cat.id, kind: 'STOCK', price: 15000 });
    const dup = await own('POST', '/api/products', { name: 'Mie Goreng', categoryId: cat.id, kind: 'STOCK', price: 15000 });
    expect(dup.statusCode).toBe(409);
  });

  it('ubah harga; hapus produk yang belum dipakai; yang sudah dipakai → IN_USE', async () => {
    const own = await as('owner');
    const cat = (await own('POST', '/api/categories', { name: 'Layanan' })).json();
    const a = (await own('POST', '/api/products', { name: 'Sewa Stick', categoryId: cat.id, kind: 'SERVICE', price: 10000 })).json();
    const b = (await own('POST', '/api/products', { name: 'Loker', categoryId: cat.id, kind: 'SERVICE', price: 5000 })).json();
    expect((await own('PATCH', `/api/products/${a.id}`, { price: 12000 })).json().price).toBe(12000);
    expect((await own('DELETE', `/api/products/${b.id}`)).statusCode).toBe(204);

    const bill = await prisma.bill.create({ data: { number: 'FP-20261001-0001', createdById: users.owner.id } });
    await prisma.billLine.create({ data: { billId: bill.id, type: 'SERVICE', productId: a.id, nameSnapshot: 'Sewa Stick', unitPrice: 12000, qty: 1, createdById: users.owner.id } });
    const used = await own('DELETE', `/api/products/${a.id}`);
    expect(used.statusCode).toBe(409);
    expect(used.json().error.code).toBe('IN_USE');
    expect((await own('DELETE', `/api/categories/${cat.id}`)).json().error.code).toBe('IN_USE');
  });
});
