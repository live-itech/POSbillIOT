export const RECEIPT_WIDTH = 48;

export interface PrintLine {
  text: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  /** Tinggi ganda (lebar tetap 48 kolom). */
  tall?: boolean;
}

export function formatAmount(n: number): string {
  const sign = n < 0 ? '-' : '';
  return sign + Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

const pad2 = (n: number) => String(n).padStart(2, '0');
export function formatReceiptDate(at: Date, utcOffsetMin: number): string {
  const d = new Date(at.getTime() + utcOffsetMin * 60_000);
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

const cut = (s: string, w = RECEIPT_WIDTH) => (s.length > w ? s.slice(0, w) : s);

/** Teks kiri + angka rata kanan dalam 48 kolom; teks kiri dipotong bila terlalu panjang. */
export function twoCols(left: string, right: string): string {
  const room = RECEIPT_WIDTH - right.length - 1;
  const l = left.length > room ? left.slice(0, room) : left;
  return l + ' '.repeat(RECEIPT_WIDTH - l.length - right.length) + right;
}

const rule = (): PrintLine => ({ text: '-'.repeat(RECEIPT_WIDTH) });
const center = (text: string, extra: Partial<PrintLine> = {}): PrintLine => ({ text: cut(text), align: 'center', ...extra });
const multiline = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

export interface ReceiptModel {
  outletName: string;
  address: string;
  header: string;
  footer: string;
  billNumber: string;
  printedAt: string;
  cashier: string;
  label: string;
  sessions: { unitName: string; start: string; end: string }[];
  lines: { name: string; qty: number; unitPrice: number; amount: number; discount: number; details: string[] }[];
  subtotal: number;
  discountTotal: number;
  serviceTotal: number;
  taxTotal: number;
  grandTotal: number;
  payments: { label: string; amount: number }[];
  change: number;
  copy: 'REPRINT' | 'VOID' | null;
}

export function renderReceipt(m: ReceiptModel): PrintLine[] {
  const out: PrintLine[] = [center(m.outletName, { bold: true, tall: true })];
  if (m.address.trim()) out.push(center(m.address.trim()));
  for (const h of multiline(m.header)) out.push(center(h));
  out.push(rule());
  if (m.copy === 'REPRINT') out.push(center('** CETAK ULANG **', { bold: true }));
  if (m.copy === 'VOID') out.push(center('** VOID **', { bold: true }));
  out.push({ text: cut(`No. ${m.billNumber}`) }, { text: cut(`Tanggal ${m.printedAt}`) }, { text: cut(`Kasir ${m.cashier}`) });
  if (m.label) out.push({ text: cut(m.label) });
  for (const s of m.sessions) out.push({ text: cut(`${s.unitName} ${s.start}-${s.end}`) });
  out.push(rule());

  for (const l of m.lines) {
    if (l.qty === 1) out.push({ text: twoCols(l.name, formatAmount(l.amount)) });
    else out.push({ text: cut(l.name) }, { text: twoCols(`  ${l.qty} x ${formatAmount(l.unitPrice)}`, formatAmount(l.amount)) });
    for (const d of l.details) out.push({ text: cut(`  ${d}`) });
    if (l.discount > 0) out.push({ text: twoCols('  Diskon', `-${formatAmount(l.discount)}`) });
  }
  out.push(rule());
  out.push({ text: twoCols('Subtotal', formatAmount(m.subtotal)) });
  if (m.discountTotal > 0) out.push({ text: twoCols('Total diskon', `-${formatAmount(m.discountTotal)}`) });
  if (m.serviceTotal > 0) out.push({ text: twoCols('Service', formatAmount(m.serviceTotal)) });
  if (m.taxTotal > 0) out.push({ text: twoCols('Pajak', formatAmount(m.taxTotal)) });
  out.push({ text: twoCols('TOTAL', formatAmount(m.grandTotal)), bold: true, tall: true });
  out.push(rule());
  for (const p of m.payments) out.push({ text: twoCols(p.label, formatAmount(p.amount)) });
  if (m.change > 0) out.push({ text: twoCols('Kembalian', formatAmount(m.change)) });
  const footer = multiline(m.footer);
  if (footer.length) {
    out.push(rule());
    for (const f of footer) out.push(center(f));
  }
  return out;
}

export interface ShiftReportModel {
  outletName: string;
  openedAt: string;
  closedAt: string;
  openedBy: string;
  closedBy: string;
  openingCash: number;
  sales: { label: string; amount: number }[];
  voids: { label: string; amount: number }[];
  billCount: number;
  voidCount: number;
  expectedCash: number;
  countedCash: number;
  note: string | null;
}

export function renderShiftReport(m: ShiftReportModel): PrintLine[] {
  const out: PrintLine[] = [center('REKAP SHIFT', { bold: true, tall: true }), center(m.outletName), rule()];
  out.push(
    { text: cut(`Buka  ${m.openedAt} (${m.openedBy})`) },
    { text: cut(`Tutup ${m.closedAt} (${m.closedBy})`) },
    rule(),
    { text: twoCols('Kas awal', formatAmount(m.openingCash)) },
    { text: 'Penjualan', bold: true },
  );
  for (const s of m.sales) out.push({ text: twoCols(`  ${s.label}`, formatAmount(s.amount)) });
  if (m.voids.length) {
    out.push({ text: 'Void', bold: true });
    for (const v of m.voids) out.push({ text: twoCols(`  ${v.label}`, `-${formatAmount(v.amount)}`) });
  }
  out.push(
    { text: twoCols('Jumlah bill', String(m.billCount)) },
    { text: twoCols('Jumlah void', String(m.voidCount)) },
    rule(),
    { text: twoCols('Kas seharusnya', formatAmount(m.expectedCash)) },
    { text: twoCols('Kas dihitung', formatAmount(m.countedCash)) },
    { text: twoCols('Selisih', formatAmount(m.countedCash - m.expectedCash)), bold: true },
  );
  if (m.note?.trim()) out.push(rule(), { text: cut(`Catatan: ${m.note.trim()}`) });
  return out;
}

export function renderTestPage(outletName: string, at: string): PrintLine[] {
  return [center(outletName, { bold: true, tall: true }), center('TES CETAK'), center(at), rule(), { text: twoCols('Kiri', 'Kanan') }, rule()];
}

/** Pratinjau teks: rata tengah/kanan diterapkan dengan spasi, 48 kolom. */
export function toPlainText(lines: PrintLine[]): string {
  return lines
    .map((l) => {
      const t = cut(l.text);
      if (l.align === 'center') return ' '.repeat(Math.floor((RECEIPT_WIDTH - t.length) / 2)) + t;
      if (l.align === 'right') return t.padStart(RECEIPT_WIDTH);
      return t;
    })
    .join('\n');
}
