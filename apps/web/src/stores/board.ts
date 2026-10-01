import type { BoardSnapshot, DeviceStatusView, PublicSettings, TariffRule, UnitView } from '@funplay/shared';
import { create } from 'zustand';

/** Selisih jam server terhadap jam lokal browser saat snapshot diterima. */
export function computeOffset(serverTimeIso: string, receivedAtMs: number): number {
  return Date.parse(serverTimeIso) - receivedAtMs;
}

const sortIds = (units: Record<string, UnitView>): string[] =>
  Object.values(units)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'id'))
    .map((u) => u.id);

interface BoardState {
  connected: boolean;
  offsetMs: number;
  settings: PublicSettings | null;
  units: Record<string, UnitView>;
  order: string[];
  devices: Record<string, DeviceStatusView>;
  tariffs: TariffRule[];
  selectedUnitId: string | null;
  applyBoard(b: BoardSnapshot, receivedAtMs: number): void;
  applyUnit(u: UnitView): void;
  /** Respons aksi HTTP: lampu dikirim lewat socket setelah rekonsiliasi, jadi jangan menimpa dengan nilai basi. */
  applyActionUnit(u: UnitView): void;
  applyDevice(d: DeviceStatusView): void;
  select(id: string | null): void;
  setConnected(v: boolean): void;
}

export const useBoard = create<BoardState>((set) => ({
  connected: false,
  offsetMs: 0,
  settings: null,
  units: {},
  order: [],
  devices: {},
  tariffs: [],
  selectedUnitId: null,
  applyBoard: (b, receivedAtMs) =>
    set((s) => {
      const units = Object.fromEntries(b.units.map((u) => [u.id, u]));
      return {
        offsetMs: computeOffset(b.serverTime, receivedAtMs),
        settings: b.settings,
        tariffs: b.tariffs,
        units,
        order: sortIds(units),
        devices: Object.fromEntries(b.devices.map((d) => [d.id, d])),
        selectedUnitId: s.selectedUnitId && units[s.selectedUnitId] ? s.selectedUnitId : null,
      };
    }),
  applyUnit: (u) =>
    set((s) => {
      const units = { ...s.units, [u.id]: u };
      return { units, order: s.units[u.id] ? s.order : sortIds(units) };
    }),
  applyActionUnit: (u) =>
    set((s) => {
      const prev = s.units[u.id];
      const merged = prev ? { ...u, light: prev.light } : u;
      const units = { ...s.units, [u.id]: merged };
      return { units, order: prev ? s.order : sortIds(units) };
    }),
  applyDevice: (d) => set((s) => ({ devices: { ...s.devices, [d.id]: d } })),
  select: (id) => set({ selectedUnitId: id }),
  setConnected: (v) => set({ connected: v }),
}));
