export const MS_PER_MIN = 60_000;
export const MINUTES_PER_DAY = 1440;
const MS_PER_DAY = 86_400_000;

export function addMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * MS_PER_MIN);
}

/** Hari (0=Minggu..6=Sabtu) dan menit-dalam-hari (boleh pecahan) di zona outlet (offset tetap, tanpa DST). */
export function localParts(at: Date, utcOffsetMin: number): { dow: number; minuteOfDay: number } {
  const local = at.getTime() + utcOffsetMin * MS_PER_MIN;
  const msOfDay = ((local % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
  const dayIndex = Math.floor(local / MS_PER_DAY);
  const dow = (((dayIndex + 4) % 7) + 7) % 7; // 1970-01-01 adalah Kamis
  return { dow, minuteOfDay: msOfDay / MS_PER_MIN };
}

export function localDayStart(at: Date, utcOffsetMin: number): Date {
  const offMs = utcOffsetMin * MS_PER_MIN;
  const local = at.getTime() + offMs;
  return new Date(Math.floor(local / MS_PER_DAY) * MS_PER_DAY - offMs);
}

export function localDateKey(at: Date, utcOffsetMin: number): string {
  const d = new Date(at.getTime() + utcOffsetMin * MS_PER_MIN);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}${mm}${dd}`;
}

export function localHHMM(at: Date, utcOffsetMin: number): string {
  return formatHHMM(Math.floor(localParts(at, utcOffsetMin).minuteOfDay));
}

export function parseHHMM(s: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`Format jam tidak valid: ${s}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min > 0)) throw new Error(`Format jam tidak valid: ${s}`);
  return h * 60 + min;
}

export function formatHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
