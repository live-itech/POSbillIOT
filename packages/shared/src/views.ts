import type { BookingSettings, UnitBookingView } from './bookings';
import type { OutletType, Role, SessionMode, SessionStatus, UnitState } from './constants';
import type { TariffRule } from './billing/tariff';
import type { TransactionSettings } from './transactions';

export interface PublicUser { id: string; name: string; username: string; role: Role }
export interface UserDto extends PublicUser { active: boolean; hasPin: boolean }

export interface PublicSettings extends TransactionSettings, BookingSettings {
  outletType: OutletType;
  outletName: string;
  address: string;
  utcOffsetMin: number;
  roundingBlockMin: number;
  minChargeMin: number;
  warnBeforeMin: number;
  pauseKeepsLightOn: boolean;
  autoOffUnexpected: boolean;
}

export interface UnitTypeDto { id: string; name: string; color: string }
export interface UnitDto {
  id: string;
  name: string;
  unitTypeId: string;
  area: string;
  deviceId: string | null;
  relayChannel: number | null;
  state: UnitState;
  sortOrder: number;
  lightOverride: boolean | null;
}
export interface DeviceDto {
  id: string;
  name: string;
  driver: string;
  channels: number;
  host: string | null;
  port: number | null;
  codec: string | null;
  online: boolean;
  lastSeenAt: string | null;
}
export interface TariffDto {
  id: string;
  name: string;
  unitTypeId: string;
  days: number[];
  start: string;
  end: string;
  pricePerHour: number;
  priority: number;
  active: boolean;
}
export interface PackageDto { id: string; name: string; unitTypeId: string; durationMin: number; price: number; active: boolean }

export interface SegmentView { unitId: string; unitTypeId: string; startedAt: string; endedAt: string | null }
export interface PauseView { pausedAt: string; resumedAt: string | null }
export interface SessionView {
  id: string;
  billId: string;
  mode: SessionMode;
  status: SessionStatus;
  startedAt: string;
  plannedEndAt: string | null;
  endedAt: string | null;
  packageName: string | null;
  packageDurationMin: number | null;
  packagePrice: number | null;
  segments: SegmentView[];
  pauses: PauseView[];
}
export interface UnitView extends UnitDto {
  unitTypeName: string;
  unitTypeColor: string;
  /** State relay aktual bila diketahui. */
  light: boolean | null;
  /** null jika meja tidak terhubung device. */
  deviceOnline: boolean | null;
  session: SessionView | null;
  /** Booking BOOKED terawal yang sedang menahan meja (hold), atau null. */
  booking: UnitBookingView | null;
}

export interface DeviceStatusView {
  id: string;
  name: string;
  driver: string;
  channels: number;
  online: boolean;
  relays: boolean[] | null;
  lastSeenAt: string | null;
}

export type AlertType = 'SESSION_WARNING' | 'SESSION_EXPIRED' | 'DEVICE_OFFLINE' | 'DEVICE_ONLINE' | 'DEVICE_CMD_FAILED' | 'UNEXPECTED_ON';
export interface AlertEvent {
  id: string;
  at: string;
  level: 'info' | 'warning' | 'danger';
  type: AlertType;
  unitId: string | null;
  message: string;
}

export interface BoardSnapshot {
  serverTime: string;
  settings: PublicSettings;
  units: UnitView[];
  devices: DeviceStatusView[];
  tariffs: TariffRule[];
}
