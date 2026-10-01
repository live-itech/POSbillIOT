import { randomUUID } from 'node:crypto';
import type { AlertEvent } from '@funplay/shared';
import type { Bus } from './bus';
import type { Clock } from './clock';

export function emitAlert(bus: Bus, clock: Clock, a: Omit<AlertEvent, 'id' | 'at'>): AlertEvent {
  const ev: AlertEvent = { id: randomUUID(), at: clock.now().toISOString(), ...a };
  bus.emit('alert', ev);
  return ev;
}
