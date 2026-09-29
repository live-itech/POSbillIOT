import type { EventEmitter } from 'node:events';
import { SimulatorDriver } from './simulator.driver';

export interface DriverEvents {
  online: [];
  offline: [];
  state: [relays: boolean[]];
}

/** Channel bernomor 1..channels. */
export interface DeviceDriver extends EventEmitter<DriverEvents> {
  readonly channels: number;
  start(): Promise<void>;
  stop(): Promise<void>;
  isOnline(): boolean;
  /** Resolve setelah device mengonfirmasi (ACK). */
  setRelay(channel: number, on: boolean): Promise<void>;
  readAll?(): Promise<boolean[]>;
}

export interface DeviceConfigRow {
  id: string;
  name: string;
  driver: string;
  channels: number;
  host: string | null;
  port: number | null;
  codec: string | null;
  config: unknown;
}

export type DriverFactory = (row: DeviceConfigRow) => DeviceDriver;

export function createDefaultDriverFactory(): DriverFactory {
  return (row) => {
    switch (row.driver) {
      case 'simulator':
        return new SimulatorDriver(row.channels);
      default:
        throw new Error(`Driver "${row.driver}" belum tersedia`);
    }
  };
}
