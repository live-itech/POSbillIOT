import { EventEmitter } from 'node:events';
import type { AlertEvent, DeviceStatusView, PrintJobView } from '@funplay/shared';

export interface BusEvents {
  'unit.changed': [unitId: string];
  'board.changed': [];
  alert: [AlertEvent];
  'device.changed': [DeviceStatusView];
  'bill.changed': [billId: string];
  'shift.changed': [];
  'booking.changed': [bookingId: string];
  'print.job': [PrintJobView];
}

export class Bus extends EventEmitter<BusEvents> {}
