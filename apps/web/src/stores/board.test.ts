import { DEFAULT_BOOKING_SETTINGS, DEFAULT_TRANSACTION_SETTINGS } from '@funplay/shared';
import type { BoardSnapshot, UnitView } from '@funplay/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { computeOffset, useBoard } from './board';

const unit = (id: string, name: string, sortOrder: number): UnitView => ({
  id, name, sortOrder, unitTypeId: 'reg', unitTypeName: 'Reguler', unitTypeColor: '#7C3AED', area: '', deviceId: null,
  relayChannel: null, state: 'ACTIVE', lightOverride: null, light: null, deviceOnline: null, booking: null, session: null,
});

const snapshot = (units: UnitView[]): BoardSnapshot => ({
  serverTime: '2026-10-01T03:10:00.000Z',
  settings: { outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5, pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS, ...DEFAULT_BOOKING_SETTINGS },
  units, devices: [], tariffs: [],
});

beforeEach(() => useBoard.setState(useBoard.getInitialState()));

describe('computeOffset', () => {
  it('jam PC kasir 10 menit terlambat → offset +10 menit', () => {
    expect(computeOffset('2026-10-01T03:10:00.000Z', Date.parse('2026-10-01T03:00:00.000Z'))).toBe(600_000);
  });
  it('jam PC kasir 10 menit terlalu cepat → offset -10 menit', () => {
    expect(computeOffset('2026-10-01T03:10:00.000Z', Date.parse('2026-10-01T03:20:00.000Z'))).toBe(-600_000);
  });
  it('jam sinkron → offset 0', () => {
    expect(computeOffset('2026-10-01T03:10:00.000Z', Date.parse('2026-10-01T03:10:00.000Z'))).toBe(0);
  });
});

describe('useBoard', () => {
  it('applyBoard mengurutkan meja dan menyimpan offset', () => {
    useBoard.getState().applyBoard(snapshot([unit('b', 'Meja 2', 2), unit('a', 'Meja 1', 1)]), Date.parse('2026-10-01T03:00:00.000Z'));
    const s = useBoard.getState();
    expect(s.order).toEqual(['a', 'b']);
    expect(s.offsetMs).toBe(600_000);
    expect(s.settings?.outletType).toBe('BILLIARD');
  });

  it('applyUnit memperbarui satu meja dan menambah meja baru', () => {
    useBoard.getState().applyBoard(snapshot([unit('a', 'Meja 1', 1)]), Date.now());
    useBoard.getState().applyUnit({ ...unit('a', 'Meja 1', 1), light: true });
    useBoard.getState().applyUnit(unit('c', 'Meja 3', 3));
    expect(useBoard.getState().units.a!.light).toBe(true);
    expect(useBoard.getState().order).toEqual(['a', 'c']);
  });

  it('pilihan meja dibuang bila meja hilang dari snapshot', () => {
    useBoard.getState().applyBoard(snapshot([unit('a', 'Meja 1', 1)]), Date.now());
    useBoard.getState().select('a');
    useBoard.getState().applyBoard(snapshot([unit('b', 'Meja 2', 2)]), Date.now());
    expect(useBoard.getState().selectedUnitId).toBeNull();
  });

  it('applyActionUnit tidak menimpa light dari socket tetapi memperbarui field lain', () => {
    useBoard.getState().applyBoard(snapshot([{ ...unit('a', 'Meja 1', 1), light: false }]), Date.now());
    useBoard.getState().applyActionUnit({ ...unit('a', 'Meja 1', 1), light: true, lightOverride: true, state: 'MAINTENANCE' });
    const u = useBoard.getState().units.a!;
    expect(u.light).toBe(false);
    expect(u.lightOverride).toBe(true);
    expect(u.state).toBe('MAINTENANCE');
  });

  it('applyActionUnit tanpa data sebelumnya memakai light dari respons', () => {
    useBoard.getState().applyActionUnit({ ...unit('z', 'Meja 9', 9), light: true });
    const s = useBoard.getState();
    expect(s.units.z!.light).toBe(true);
    expect(s.order).toEqual(['z']);
  });
});
