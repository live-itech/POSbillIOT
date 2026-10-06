import { createServer, type Server } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginAs, makeApp, openShift, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let cookie: string;
let teh: { id: string };
let tcp: Server | null = null;

beforeEach(async () => {
  await resetDb();
  const users = await seedUsers();
  b = await seedBasics();
  await openShift(users.kasir.id, 100000);
  const cat = await prisma.category.create({ data: { name: 'Minuman' } });
  teh = await prisma.product.create({ data: { name: 'Es Teh', categoryId: cat.id, kind: 'STOCK', price: 8000, stockQty: 10 } });
  t = await makeApp();
  cookie = await loginAs(t.app, 'kasir');
});
afterEach(async () => {
  await t.app.close();
  await new Promise<void>((r) => (tcp ? tcp.close(() => r()) : r()));
  tcp = null;
});

const req = (method: 'GET' | 'POST', url: string, payload?: unknown, c = cookie) => t.app.inject({ method, url, headers: { cookie: c }, payload: payload as object });

async function paidBill(): Promise<string> {
  const bill = (await req('POST', '/api/bills')).json();
  await req('POST', `/api/bills/${bill.id}/items`, { items: [{ productId: teh.id, qty: 1 }] });
  const res = await req('POST', `/api/bills/${bill.id}/checkout`, { idempotencyKey: `key-${bill.id}`, expectedGrandTotal: 8000, payments: [{ method: 'CASH', amount: 8000, received: 10000 }] });
  expect(res.statusCode).toBe(200);
  return bill.id;
}

const jobs = () => prisma.printJob.findMany({ orderBy: { createdAt: 'asc' } });

describe('struk', () => {
  it('simulator: checkout membuat job RECEIPT DONE dengan pratinjau struk', async () => {
    const billId = await paidBill();
    await vi.waitFor(async () => expect((await jobs())[0]?.status).toBe('DONE'));
    const [job] = await jobs();
    expect(job).toMatchObject({ kind: 'RECEIPT', billId });
    expect(job!.previewText).toContain('FP-20261001-0001');
    expect(job!.previewText).toContain('Es Teh');
    expect(job!.previewText).toMatch(/TOTAL\s+8\.000/);
    expect(job!.previewText).toMatch(/Kembalian\s+2\.000/);
  });

  it('LAN: byte ESC/POS sampai ke printer', async () => {
    const received: Buffer[] = [];
    tcp = createServer((sock) => sock.on('data', (d) => received.push(d)));
    await new Promise<void>((r) => tcp!.listen(0, '127.0.0.1', () => r()));
    const port = (tcp.address() as { port: number }).port;
    await prisma.setting.update({ where: { id: 1 }, data: { printerDriver: 'LAN', printerHost: '127.0.0.1', printerPort: port } });
    await paidBill();
    await vi.waitFor(async () => expect((await jobs())[0]?.status).toBe('DONE'));
    await vi.waitFor(() => expect(Buffer.concat(received).includes(Buffer.from('TOTAL'))).toBe(true));
    expect([...Buffer.concat(received).subarray(0, 2)]).toEqual([0x1b, 0x40]);
  });

  it('printer gagal: bill tetap PAID, job FAILED; cetak ulang membuat job baru tanpa pembayaran baru', async () => {
    const dead = createServer();
    await new Promise<void>((r) => dead.listen(0, '127.0.0.1', () => r()));
    const port = (dead.address() as { port: number }).port;
    await new Promise<void>((r) => dead.close(() => r())); // port tertutup → koneksi ditolak
    await prisma.setting.update({ where: { id: 1 }, data: { printerDriver: 'LAN', printerHost: '127.0.0.1', printerPort: port } });
    const billId = await paidBill();
    await vi.waitFor(async () => expect((await jobs())[0]?.status).toBe('FAILED'));
    expect((await jobs())[0]!.error).toMatch(/Printer LAN/);
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: billId } })).status).toBe('PAID');

    await prisma.setting.update({ where: { id: 1 }, data: { printerDriver: 'SIMULATOR' } });
    const re = await req('POST', `/api/bills/${billId}/print`);
    expect(re.statusCode).toBe(200);
    expect(re.json().previewText).toContain('** CETAK ULANG **');
    await vi.waitFor(async () => expect((await jobs()).map((j) => j.status)).toEqual(['FAILED', 'DONE']));
    expect(await prisma.payment.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'bill.reprint' } })).toBe(1);
  });

  it('cetak ulang bill OPEN ditolak; daftar job terbaru dulu', async () => {
    const open = (await req('POST', '/api/bills')).json();
    expect((await req('POST', `/api/bills/${open.id}/print`)).json().error.code).toBe('BILL_NOT_PAID');
    await paidBill();
    await vi.waitFor(async () => expect((await jobs())[0]?.status).toBe('DONE'));
    const list = (await req('GET', '/api/print/jobs?limit=5')).json();
    expect(list[0]).toMatchObject({ kind: 'RECEIPT', status: 'DONE' });
  });
});

describe('rekap shift & tes cetak', () => {
  it('tutup shift mencetak rekap', async () => {
    await req('POST', '/api/shifts/current/close', { countedCash: 100000 });
    await vi.waitFor(async () => expect((await jobs())[0]).toMatchObject({ kind: 'SHIFT_REPORT', status: 'DONE' }));
    expect((await jobs())[0]!.previewText).toContain('REKAP SHIFT');
  });

  it('tes cetak hanya owner', async () => {
    expect((await req('POST', '/api/print/test')).statusCode).toBe(403);
    const owner = await loginAs(t.app, 'owner');
    const res = await req('POST', '/api/print/test', undefined, owner);
    expect(res.json()).toMatchObject({ kind: 'TEST' });
    expect(res.json().previewText).toContain('TES CETAK');
  });
});
