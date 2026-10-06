export function formatRupiah(n: number): string {
  const sign = n < 0 ? '-' : '';
  const digits = Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}Rp ${digits}`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} menit`;
  return m ? `${h} jam ${m} menit` : `${h} jam`;
}

/** Ambil angka dari input uang ("150.000", "Rp 20.000"); kosong → 0. */
export function parseRupiah(s: string): number {
  const digits = s.replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" (hari lokal outlet) → rentang UTC [from, to). */
export function localDayRange(date: string, utcOffsetMin: number): { from: string; to: string } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const from = Date.UTC(y, m - 1, d) - utcOffsetMin * 60_000;
  return { from: new Date(from).toISOString(), to: new Date(from + 86_400_000).toISOString() };
}

/** Tanggal lokal outlet untuk <input type="date">. */
export function localDateInput(now: Date, utcOffsetMin: number): string {
  const l = new Date(now.getTime() + utcOffsetMin * 60_000);
  return `${l.getUTCFullYear()}-${pad2(l.getUTCMonth() + 1)}-${pad2(l.getUTCDate())}`;
}
