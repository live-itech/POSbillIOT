import { EventEmitter } from 'node:events';
import type { AlertEvent, DeviceStatusView } from '@funplay/shared';

export interface BusEvents {
  'unit.changed': [unitId: string];
  'board.changed': [];
  alert: [AlertEvent];
  'device.changed': [DeviceStatusView];
}

export class Bus extends EventEmitter<BusEvents> {}
