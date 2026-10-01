import { describe, expect, it } from 'vitest';
import { buildBillableIntervals, dropLeadingMs, totalMs } from './intervals';

const t = (hhmm: string) => new Date(`2026-10-01T${hhmm}:00Z`);

describe('buildBillableIntervals', () => {
  it('mengembalikan segmen utuh jika tanpa pause', () => {
    expect(buildBillableIntervals([{ unitTypeId: 'reg', startedAt: t('10:00'), endedAt: null }], [], t('11:00'))).toEqual([
      { unitTypeId: 'reg', start: t('10:00'), end: t('11:00') },
    ]);
  });

  it('memotong pause yang sudah selesai', () => {
    const r = buildBillableIntervals(
      [{ unitTypeId: 'reg', startedAt: t('10:00'), endedAt: null }],
      [{ pausedAt: t('10:20'), resumedAt: t('10:30') }],
      t('11:00'),
    );
    expect(r).toEqual([
      { unitTypeId: 'reg', start: t('10:00'), end: t('10:20') },
      { unitTypeId: 'reg', start: t('10:30'), end: t('11:00') },
    ]);
  });

  it('menganggap pause terbuka berlangsung sampai `until`', () => {
    const r = buildBillableIntervals(
      [{ unitTypeId: 'reg', startedAt: t('10:00'), endedAt: null }],
      [{ pausedAt: t('10:40'), resumedAt: null }],
      t('11:00'),
    );
    expect(r).toEqual([{ unitTypeId: 'reg', start: t('10:00'), end: t('10:40') }]);
  });

  it('memisahkan segmen tipe meja berbeda (pindah meja)', () => {
    const r = buildBillableIntervals(
      [
        { unitTypeId: 'vip', startedAt: t('10:30'), endedAt: null },
        { unitTypeId: 'reg', startedAt: t('10:00'), endedAt: t('10:30') },
      ],
      [],
      t('11:00'),
    );
    expect(r).toEqual([
      { unitTypeId: 'reg', start: t('10:00'), end: t('10:30') },
      { unitTypeId: 'vip', start: t('10:30'), end: t('11:00') },
    ]);
  });

  it('memotong segmen yang melewati `until`', () => {
    const r = buildBillableIntervals([{ unitTypeId: 'reg', startedAt: t('10:00'), endedAt: t('12:00') }], [], t('11:00'));
    expect(r).toEqual([{ unitTypeId: 'reg', start: t('10:00'), end: t('11:00') }]);
  });

  it('tidak menghasilkan interval nol', () => {
    expect(buildBillableIntervals([{ unitTypeId: 'reg', startedAt: t('10:00'), endedAt: null }], [], t('10:00'))).toEqual([]);
  });
});

describe('totalMs / dropLeadingMs', () => {
  const ivs = [
    { unitTypeId: 'reg', start: t('10:00'), end: t('10:30') },
    { unitTypeId: 'reg', start: t('10:40'), end: t('11:10') },
  ];
  it('menjumlah durasi', () => {
    expect(totalMs(ivs)).toBe(60 * 60_000);
  });
  it('membuang ms di awal lintas interval', () => {
    expect(dropLeadingMs(ivs, 45 * 60_000)).toEqual([{ unitTypeId: 'reg', start: t('10:55'), end: t('11:10') }]);
  });
  it('mengembalikan kosong jika semua terbuang', () => {
    expect(dropLeadingMs(ivs, 90 * 60_000)).toEqual([]);
  });
});
