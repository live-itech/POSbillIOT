import { EventEmitter } from 'node:events';
import type { DeviceDriver, DriverEvents } from './driver';

/** Device virtual untuk development, demo, dan test. */
export class SimulatorDriver extends EventEmitter<DriverEvents> implements DeviceDriver {
  private relays: boolean[];
  private onlineFlag = false;
  /** Jumlah perintah berikutnya yang akan gagal (untuk test). */
  failNext = 0;

  constructor(readonly channels: number) {
    super();
    this.relays = Array.from({ length: channels }, () => false);
  }

  async start(): Promise<void> {
    this.setOnline(true);
  }

  async stop(): Promise<void> {
    this.setOnline(false);
  }

  isOnline(): boolean {
    return this.onlineFlag;
  }

  setOnline(v: boolean): void {
    if (this.onlineFlag === v) return;
    this.onlineFlag = v;
    this.emit(v ? 'online' : 'offline');
  }

  async setRelay(channel: number, on: boolean): Promise<void> {
    if (!this.onlineFlag) throw new Error('Device offline');
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('Simulated failure');
    }
    this.check(channel);
    this.relays[channel - 1] = on;
    this.emit('state', this.snapshot());
  }

  async readAll(): Promise<boolean[]> {
    if (!this.onlineFlag) throw new Error('Device offline');
    return this.snapshot();
  }

  /** Simulasi relay dinyalakan/dimatikan langsung di lokasi (tanpa POS). */
  physicalSet(channel: number, on: boolean): void {
    this.check(channel);
    this.relays[channel - 1] = on;
    this.emit('state', this.snapshot());
  }

  /** Simulasi Arduino mati listrik: semua relay OFF lalu offline. */
  powerCycle(): void {
    this.relays.fill(false);
    this.setOnline(false);
  }

  snapshot(): boolean[] {
    return [...this.relays];
  }

  private check(channel: number): void {
    if (!Number.isInteger(channel) || channel < 1 || channel > this.channels) {
      throw new Error(`Channel ${channel} di luar jangkauan`);
    }
  }
}
