export const OUTLET_TYPES = ['BILLIARD', 'PLAYSTATION'] as const;
export type OutletType = (typeof OUTLET_TYPES)[number];

export const ROLES = ['KASIR', 'SUPERVISOR', 'OWNER'] as const;
export type Role = (typeof ROLES)[number];

export const SESSION_MODES = ['OPEN', 'PACKAGE'] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export const SESSION_STATUSES = ['RUNNING', 'PAUSED', 'EXPIRED', 'ENDED'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const UNIT_STATES = ['ACTIVE', 'MAINTENANCE'] as const;
export type UnitState = (typeof UNIT_STATES)[number];

/** Driver yang sudah diimplementasi. M5 menambah tcp-client, http-client, inbound. */
export const DEVICE_DRIVERS = ['simulator'] as const;
export type DeviceDriverName = (typeof DEVICE_DRIVERS)[number];
