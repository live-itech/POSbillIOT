import { writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import type { PublicSettings } from '@funplay/shared';
import { withTimeout } from '../../lib/timeout';

export interface Printer {
  send(bytes: Uint8Array): Promise<void>;
}

/** Tidak mengirim ke mana pun; pratinjau diambil dari PrintJob.previewText. */
export class SimulatorPrinter implements Printer {
  async send(): Promise<void> {}
}

/** Raw TCP (port 9100). Selesai saat semua byte terkirim ke OS. */
export class LanPrinter implements Printer {
  constructor(private readonly host: string, private readonly port: number, private readonly timeoutMs = 5000) {}

  send(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = connect({ host: this.host, port: this.port });
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error(`Printer LAN ${this.host}:${this.port} tidak merespons`));
      }, this.timeoutMs);
      sock.once('error', (e) => {
        clearTimeout(timer);
        reject(new Error(`Printer LAN ${this.host}:${this.port} gagal: ${e.message}`));
      });
      sock.once('connect', () => {
        sock.end(Buffer.from(bytes), () => {
          clearTimeout(timer);
          resolve();
        });
      });
    });
  }
}

/** Path USB yang write-nya masih menggantung (satu thread libuv macet per path, tidak lebih). */
const usbBusy = new Set<string>();

/** Printer USB di server lewat device file (mis. /dev/usb/lp0). */
export class UsbPrinter implements Printer {
  constructor(private readonly path: string, private readonly timeoutMs = 5000) {}

  async send(bytes: Uint8Array): Promise<void> {
    if (usbBusy.has(this.path)) throw new Error(`Printer USB sibuk / tidak merespons (${this.path})`);
    usbBusy.add(this.path);
    const write = writeFile(this.path, bytes);
    void write.then(() => usbBusy.delete(this.path), () => usbBusy.delete(this.path));
    try {
      await withTimeout(write, this.timeoutMs);
    } catch (e) {
      throw new Error(`Printer USB ${this.path} gagal: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

export type PrinterFactory = (s: PublicSettings) => Printer;

export const defaultPrinterFactory: PrinterFactory = (s) => {
  if (s.printerDriver === 'LAN') return new LanPrinter(s.printerHost, s.printerPort);
  if (s.printerDriver === 'USB') return new UsbPrinter(s.printerDevicePath);
  return new SimulatorPrinter();
};
