# FunPlay M1 — Fondasi & Meja: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun fondasi FunPlay (monorepo, login & peran, pengaturan, master meja/tarif/paket, lapisan device + simulator, sesi main, penjadwal, dashboard realtime) sehingga kasir bisa menjalankan meja dan lampu virtual menyala/mati secara realtime.

**Architecture:** Monorepo pnpm: `packages/shared` berisi kalkulator tarif murni + tipe bersama yang dipakai server dan web; `apps/server` (Fastify + Prisma + PostgreSQL + Socket.IO) memegang jam otoritatif, sesi, dan `DeviceManager` yang merekonsiliasi *desired state* relay lewat driver yang bisa ditukar (M1: `simulator`); `apps/web` (React + Vite + Tailwind) menampilkan grid meja + panel detail tetap dan menerima pembaruan lewat Socket.IO.

**Tech Stack:** Node.js 22, pnpm 10, TypeScript 5, Fastify 5, Prisma 6, PostgreSQL, Socket.IO 4, zod 3, argon2, Vitest 3, React 19, Vite 7, Tailwind CSS 4, TanStack Query 5, zustand 5, Radix Dialog, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-funplay-pos-design.md` (M1 = §14 baris M1; juga §4, §5, §6.1, §6.7, §6.8, §7, §8, §11, §12)

## Global Constraints

- Uang = integer Rupiah (`Int`), tidak ada float untuk nilai uang.
- Jam otoritatif di server; klien menghitung timer dari `startedAt` + offset jam server.
- Kalkulator tarif tunggal di `packages/shared` — dipakai untuk preview UI dan tagihan final.
- Bahasa UI dan pesan error: Indonesia. Mata uang: Rupiah.
- Perintah device **tidak memblokir** transaksi; kegagalan → retry (rekonsiliasi) + peringatan.
- Aksi sensitif (pause, override lampu) oleh KASIR wajib PIN supervisor; persetujuan dicatat di `AuditLog.approvedById`.
- Salah PIN 5 kali → kunci sementara (5 menit).
- Default pengaturan: pembulatan 15 menit, minimum main 60 menit, peringatan 5 menit, lampu tetap ON saat pause, zona waktu WIB (`utcOffsetMin = 420`).
- Rekonsiliasi device setiap 10 detik dan setiap device tersambung kembali.
- Gaya visual Playful Violet: primer `#7C3AED`, aksen `#F59E0B`, latar `#FAF8FF`, teks `#1E1B4B`; hampir habis `#FBBF24`; habis `#F43F5E`.
- Layout kasir: grid kiri + panel detail tetap kanan; di layar sempit panel pindah ke bawah.
- Label "Meja"/🎱 untuk BILLIARD, "Unit"/🎮 untuk PLAYSTATION.
- Channel relay bernomor **1..N** di API/DB; array state internal berindeks `channel - 1`.
- Jangan pakai `crypto.randomUUID()` di browser (LAN http bukan secure context) — pakai `newId()` dari `apps/web/src/lib/id.ts`.

## Review Focus

1. **Dua kasir / double-click "Mulai" pada meja yang sama** → tepat satu sesi dibuat, yang lain 409 `UNIT_BUSY` (Task 11, test "concurrent start").
2. **Server mati saat paket berjalan lalu hidup setelah waktu paket lewat** → sesi jadi `EXPIRED` dengan `endedAt = plannedEndAt` (downtime tidak ditagih), lampu direkonsiliasi (Task 13, test "restart recovery").
3. **Sesi melewati tengah malam dengan tarif lintas-hari & tarif weekend berprioritas** → dipecah benar per tarif (Task 3, test "Friday night into Saturday").
4. **Arduino offline saat sesi dimulai** → sesi tetap tercatat dan argo jalan; lampu menyala otomatis ketika device kembali online (Task 11, test "device offline at start").
5. **Jam PC kasir salah** → timer/preview memakai offset jam server (Task 17, test `computeOffset`).

---

## Persiapan Lingkungan (sekali, manual oleh developer)

PostgreSQL lokal sudah berjalan di port 5432. Buat role & database (butuh sudo):

```bash
sudo -u postgres psql -c "CREATE ROLE funplay LOGIN PASSWORD 'funplay' CREATEDB;"
sudo -u postgres createdb -O funplay funplay
sudo -u postgres createdb -O funplay funplay_test
sudo -u postgres createdb -O funplay funplay_e2e
corepack enable
```

Verifikasi: `PGPASSWORD=funplay psql -h localhost -U funplay -d funplay_test -c 'select 1'` → mencetak `1`.

## Struktur File (dikunci oleh plan ini)

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, playwright.config.ts, scripts/e2e-server.sh, e2e/*.spec.ts
packages/shared/src/
  index.ts            ekspor publik
  constants.ts        enum string (role, mode, status, driver)
  time.ts             util waktu lokal outlet (offset tetap)
  billing/intervals.ts  segmen − pause → interval tertagih
  billing/tariff.ts     aturan tarif, pencarian tarif, batas tarif
  billing/charge.ts     pembulatan + pemecahan per tarif + paket
  billing/session-charge.ts  adaptor sesi → charge; durasi berjalan
  status.ts           status kartu meja + sisa waktu
  labels.ts           label per jenis outlet
  views.ts            DTO & view bersama server/web
apps/server/
  prisma/schema.prisma
  src/config.ts, db.ts, app.ts, context.ts, main.ts, seed.ts, seed-data.ts
  src/lib/{errors,clock,bus,alerts,timeout}.ts
  src/modules/auth/{password,auth.service,guard,auth.routes}.ts
  src/modules/audit/audit.ts
  src/modules/settings/{settings.service,settings.routes}.ts
  src/modules/users/users.routes.ts
  src/modules/catalog/{unit-types.routes,units.routes,tariffs.service,tariffs.routes,packages.routes}.ts
  src/modules/devices/{driver,simulator.driver,desired,device-manager,devices.routes}.ts
  src/modules/board/board.ts
  src/modules/sessions/{sessions.service,sessions.routes}.ts
  src/modules/scheduler/scheduler.ts
  src/modules/realtime/realtime.ts
  test/{test-env,global-setup,helpers}.ts + *.test.ts
apps/web/src/
  main.tsx, App.tsx, styles.css, test-setup.ts
  lib/{api,cn,format,id,beep,theme,socket}.ts
  stores/{board,toast,pin}.ts
  hooks/useNow.ts
  components/ui/{button,input,modal}.tsx, components/{Toaster,PinPrompt}.tsx
  features/auth/{auth.tsx,LoginPage.tsx}
  features/layout/AppShell.tsx
  features/board/{BoardPage,UnitCard,status,useChargePreview,ChargeLines,UnitPanel,StartSession,ActiveSession,ExtendDialog,MoveDialog,StopDialog,actions,LightControl,SimulatorPanel}.tsx|ts
  features/settings/{SettingsPage,CrudResource,resources,GeneralSettings}.tsx|ts
```

---

### Task 1: Monorepo & util waktu di `shared`

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc`
- Modify: `.gitignore`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/constants.ts`, `packages/shared/src/time.ts`
- Test: `packages/shared/src/time.test.ts`

**Interfaces:**
- Produces: `MS_PER_MIN`, `MINUTES_PER_DAY`, `addMinutes(at: Date, minutes: number): Date`, `localParts(at: Date, utcOffsetMin: number): { dow: number; minuteOfDay: number }`, `localDayStart(at, off): Date`, `localDateKey(at, off): string` (`YYYYMMDD`), `localHHMM(at, off): string`, `parseHHMM(s): number`, `formatHHMM(min): string`; konstanta `OUTLET_TYPES/OutletType`, `ROLES/Role`, `SESSION_MODES/SessionMode`, `SESSION_STATUSES/SessionStatus`, `UNIT_STATES/UnitState`, `DEVICE_DRIVERS/DeviceDriverName`.

- [ ] **Step 1: Buat file root**

`package.json`:
```json
{
  "name": "funplay",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "pnpm -r --parallel --filter \"./apps/*\" dev",
    "build": "pnpm --filter @funplay/web build && pnpm --filter @funplay/server build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "e2e": "playwright test"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
  - packages/*
onlyBuiltDependencies:
  - argon2
  - prisma
  - '@prisma/client'
  - '@prisma/engines'
  - esbuild
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`.nvmrc`: `22`

`.gitignore` (ganti seluruh isi):
```
.superpowers/
node_modules/
dist/
.env
.env.*
!.env.example
playwright-report/
test-results/
```

Lalu jalankan: `corepack use pnpm@10` (menambahkan field `packageManager` ke `package.json`).

- [ ] **Step 2: Buat paket `shared`**

`packages/shared/package.json`:
```json
{
  "name": "@funplay/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" }
}
```

`packages/shared/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true, "types": [] }, "include": ["src"] }
```

Jalankan: `pnpm --filter @funplay/shared add -D typescript@^5.9 vitest@^3.2`

`packages/shared/src/constants.ts`:
```ts
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
```

`packages/shared/src/index.ts`:
```ts
export * from './constants';
export * from './time';
```

- [ ] **Step 3: Tulis test yang gagal**

`packages/shared/src/time.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { addMinutes, formatHHMM, localDateKey, localDayStart, localHHMM, localParts, parseHHMM } from './time';

const WIB = 420;

describe('localParts', () => {
  it('mengubah instan UTC ke hari & menit lokal WIB', () => {
    // 2026-10-02 11:30 UTC = Jumat 18:30 WIB
    expect(localParts(new Date('2026-10-02T11:30:00Z'), WIB)).toEqual({ dow: 5, minuteOfDay: 1110 });
  });
  it('berpindah ke hari lokal berikutnya setelah tengah malam WIB', () => {
    // 2026-10-02 17:15 UTC = Sabtu 00:15 WIB
    expect(localParts(new Date('2026-10-02T17:15:00Z'), WIB)).toEqual({ dow: 6, minuteOfDay: 15 });
  });
  it('menyimpan pecahan menit', () => {
    expect(localParts(new Date('2026-10-02T11:30:30Z'), WIB).minuteOfDay).toBe(1110.5);
  });
});

describe('localDayStart / localDateKey / localHHMM', () => {
  it('memberi awal hari lokal', () => {
    expect(localDayStart(new Date('2026-10-02T17:15:00Z'), WIB).toISOString()).toBe('2026-10-02T17:00:00.000Z');
  });
  it('memberi kunci tanggal lokal', () => {
    expect(localDateKey(new Date('2026-10-02T17:15:00Z'), WIB)).toBe('20261003');
  });
  it('memberi jam lokal HH:MM', () => {
    expect(localHHMM(new Date('2026-10-02T11:30:59Z'), WIB)).toBe('18:30');
  });
});

describe('parseHHMM / formatHHMM / addMinutes', () => {
  it('parse & format bolak-balik', () => {
    expect(parseHHMM('18:00')).toBe(1080);
    expect(parseHHMM('24:00')).toBe(1440);
    expect(formatHHMM(1080)).toBe('18:00');
    expect(formatHHMM(1440)).toBe('24:00');
    expect(formatHHMM(65)).toBe('01:05');
  });
  it('menolak format salah', () => {
    expect(() => parseHHMM('7:05')).toThrow();
    expect(() => parseHHMM('24:30')).toThrow();
    expect(() => parseHHMM('12:60')).toThrow();
  });
  it('menambah menit', () => {
    expect(addMinutes(new Date('2026-10-01T03:00:00Z'), 90).toISOString()).toBe('2026-10-01T04:30:00.000Z');
  });
});
```

- [ ] **Step 4: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/shared test`
Expected: FAIL — `Failed to resolve import "./time"`.

- [ ] **Step 5: Implementasi**

`packages/shared/src/time.ts`:
```ts
export const MS_PER_MIN = 60_000;
export const MINUTES_PER_DAY = 1440;
const MS_PER_DAY = 86_400_000;

export function addMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * MS_PER_MIN);
}

/** Hari (0=Minggu..6=Sabtu) dan menit-dalam-hari (boleh pecahan) di zona outlet (offset tetap, tanpa DST). */
export function localParts(at: Date, utcOffsetMin: number): { dow: number; minuteOfDay: number } {
  const local = at.getTime() + utcOffsetMin * MS_PER_MIN;
  const msOfDay = ((local % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
  const dayIndex = Math.floor(local / MS_PER_DAY);
  const dow = (((dayIndex + 4) % 7) + 7) % 7; // 1970-01-01 adalah Kamis
  return { dow, minuteOfDay: msOfDay / MS_PER_MIN };
}

export function localDayStart(at: Date, utcOffsetMin: number): Date {
  const offMs = utcOffsetMin * MS_PER_MIN;
  const local = at.getTime() + offMs;
  return new Date(Math.floor(local / MS_PER_DAY) * MS_PER_DAY - offMs);
}

export function localDateKey(at: Date, utcOffsetMin: number): string {
  const d = new Date(at.getTime() + utcOffsetMin * MS_PER_MIN);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}${mm}${dd}`;
}

export function localHHMM(at: Date, utcOffsetMin: number): string {
  return formatHHMM(Math.floor(localParts(at, utcOffsetMin).minuteOfDay));
}

export function parseHHMM(s: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`Format jam tidak valid: ${s}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min > 0)) throw new Error(`Format jam tidak valid: ${s}`);
  return h * 60 + min;
}

export function formatHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
```

- [ ] **Step 6: Jalankan test, pastikan lulus**

Run: `pnpm --filter @funplay/shared test && pnpm --filter @funplay/shared typecheck`
Expected: PASS semua test, typecheck tanpa error.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .nvmrc .gitignore packages/shared
git commit -m "chore: monorepo scaffold and shared time utilities"
```

---

### Task 2: Interval tertagih (segmen − pause)

**Files:**
- Create: `packages/shared/src/billing/intervals.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/billing/intervals.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `interface SegmentInput { unitTypeId: string; startedAt: Date; endedAt: Date | null }`
  - `interface PauseInput { pausedAt: Date; resumedAt: Date | null }`
  - `interface BillableInterval { unitTypeId: string; start: Date; end: Date }`
  - `buildBillableIntervals(segments: SegmentInput[], pauses: PauseInput[], until: Date): BillableInterval[]`
  - `totalMs(intervals: BillableInterval[]): number`
  - `dropLeadingMs(intervals: BillableInterval[], ms: number): BillableInterval[]`

- [ ] **Step 1: Tulis test yang gagal**

`packages/shared/src/billing/intervals.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildBillableIntervals, dropLeadingMs, totalMs } from './intervals';

const t = (hhmm: string) => new Date(`2026-10-01T${hhmm}:00Z`);

describe('buildBillableIntervals', () => {
  it('mengembalikan segmen utuh jika tanpa pause', () => {
    expect(buildBillableIntervals([{ unitTypeId: 'reg', startedAt: t('10:00'), endedAt: null }], [], t('11:00'))).toEqual([
      { unitTypeId: 'reg', start: t('10:00'), end: t('11:00') },
    ]);
  });

  it('memotong pause yang sudah selesai', () => {
    const r = buildBillableIntervals(
      [{ unitTypeId: 'reg', startedAt: t('10:00'), endedAt: null }],
      [{ pausedAt: t('10:20'), resumedAt: t('10:30') }],
      t('11:00'),
    );
    expect(r).toEqual([
      { unitTypeId: 'reg', start: t('10:00'), end: t('10:20') },
      { unitTypeId: 'reg', start: t('10:30'), end: t('11:00') },
    ]);
  });

  it('menganggap pause terbuka berlangsung sampai `until`', () => {
    const r = buildBillableIntervals(
      [{ unitTypeId: 'reg', startedAt: t('10:00'), endedAt: null }],
      [{ pausedAt: t('10:40'), resumedAt: null }],
      t('11:00'),
    );
    expect(r).toEqual([{ unitTypeId: 'reg', start: t('10:00'), end: t('10:40') }]);
  });

  it('memisahkan segmen tipe meja berbeda (pindah meja)', () => {
    const r = buildBillableIntervals(
      [
        { unitTypeId: 'vip', startedAt: t('10:30'), endedAt: null },
        { unitTypeId: 'reg', startedAt: t('10:00'), endedAt: t('10:30') },
      ],
      [],
      t('11:00'),
    );
    expect(r).toEqual([
      { unitTypeId: 'reg', start: t('10:00'), end: t('10:30') },
      { unitTypeId: 'vip', start: t('10:30'), end: t('11:00') },
    ]);
  });

  it('memotong segmen yang melewati `until`', () => {
    const r = buildBillableIntervals([{ unitTypeId: 'reg', startedAt: t('10:00'), endedAt: t('12:00') }], [], t('11:00'));
    expect(r).toEqual([{ unitTypeId: 'reg', start: t('10:00'), end: t('11:00') }]);
  });

  it('tidak menghasilkan interval nol', () => {
    expect(buildBillableIntervals([{ unitTypeId: 'reg', startedAt: t('10:00'), endedAt: null }], [], t('10:00'))).toEqual([]);
  });
});

describe('totalMs / dropLeadingMs', () => {
  const ivs = [
    { unitTypeId: 'reg', start: t('10:00'), end: t('10:30') },
    { unitTypeId: 'reg', start: t('10:40'), end: t('11:10') },
  ];
  it('menjumlah durasi', () => {
    expect(totalMs(ivs)).toBe(60 * 60_000);
  });
  it('membuang ms di awal lintas interval', () => {
    expect(dropLeadingMs(ivs, 45 * 60_000)).toEqual([{ unitTypeId: 'reg', start: t('10:55'), end: t('11:10') }]);
  });
  it('mengembalikan kosong jika semua terbuang', () => {
    expect(dropLeadingMs(ivs, 90 * 60_000)).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/shared test`
Expected: FAIL — `Failed to resolve import "./intervals"`.

- [ ] **Step 3: Implementasi**

`packages/shared/src/billing/intervals.ts`:
```ts
export interface SegmentInput {
  unitTypeId: string;
  startedAt: Date;
  endedAt: Date | null;
}

export interface PauseInput {
  pausedAt: Date;
  resumedAt: Date | null;
}

export interface BillableInterval {
  unitTypeId: string;
  start: Date;
  end: Date;
}

/** Waktu main yang ditagih: tiap segmen meja dikurangi rentang pause, dipotong di `until`. */
export function buildBillableIntervals(segments: SegmentInput[], pauses: PauseInput[], until: Date): BillableInterval[] {
  const untilMs = until.getTime();
  const pauseRanges = pauses
    .map((p) => [p.pausedAt.getTime(), (p.resumedAt ?? until).getTime()] as const)
    .sort((a, b) => a[0] - b[0]);
  const sorted = [...segments].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const out: BillableInterval[] = [];

  for (const seg of sorted) {
    const segEnd = Math.min((seg.endedAt ?? until).getTime(), untilMs);
    let cursor = seg.startedAt.getTime();
    for (const [ps, pe] of pauseRanges) {
      if (pe <= cursor || ps >= segEnd) continue;
      if (ps > cursor) out.push({ unitTypeId: seg.unitTypeId, start: new Date(cursor), end: new Date(ps) });
      cursor = Math.max(cursor, pe);
    }
    if (segEnd > cursor) out.push({ unitTypeId: seg.unitTypeId, start: new Date(cursor), end: new Date(segEnd) });
  }
  return out;
}

export function totalMs(intervals: BillableInterval[]): number {
  return intervals.reduce((sum, iv) => sum + (iv.end.getTime() - iv.start.getTime()), 0);
}

/** Membuang `ms` pertama dari waktu tertagih (dipakai untuk memotong durasi paket). */
export function dropLeadingMs(intervals: BillableInterval[], ms: number): BillableInterval[] {
  let left = ms;
  const out: BillableInterval[] = [];
  for (const iv of intervals) {
    const len = iv.end.getTime() - iv.start.getTime();
    if (left >= len) {
      left -= len;
      continue;
    }
    out.push(left > 0 ? { ...iv, start: new Date(iv.start.getTime() + left) } : iv);
    left = 0;
  }
  return out;
}
```

Tambahkan ke `packages/shared/src/index.ts`:
```ts
export * from './billing/intervals';
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter @funplay/shared test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): billable intervals from segments and pauses"
```

### Task 3: Aturan tarif & kalkulator biaya waktu

**Files:**
- Create: `packages/shared/src/billing/tariff.ts`, `packages/shared/src/billing/charge.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/billing/tariff.test.ts`, `packages/shared/src/billing/charge.test.ts`

**Interfaces:**
- Consumes: `localParts`, `localDayStart`, `MINUTES_PER_DAY`, `MS_PER_MIN` (Task 1); `BillableInterval`, `totalMs`, `dropLeadingMs` (Task 2).
- Produces:
  - `interface TariffRule { id: string; unitTypeId: string; name: string; daysMask: number; startMin: number; endMin: number; pricePerHour: number; priority: number }` — `startMin` 0..1439, `endMin` 1..1440; `endMin <= startMin` berarti melewati tengah malam dan `daysMask` merujuk hari **mulainya** rentang. Bit hari: `1 << dow` (0=Minggu).
  - `ALL_DAYS = 127`, `dayBit(dow)`, `daysToMask(days: number[])`, `maskToDays(mask): number[]`
  - `class NoTariffError extends Error { unitTypeId: string; at: Date }`
  - `ruleCovers(rule, dow, minuteOfDay): boolean`, `findTariff(rules, unitTypeId, at, utcOffsetMin): TariffRule` (prioritas tertinggi menang; seri → urutan pertama), `nextBoundary(rules, unitTypeId, at, utcOffsetMin): Date`
  - `interface RoundingRule { blockMin: number; minChargeMin: number }`, `interface PackageInfo { name: string; durationMin: number; price: number }`
  - `interface ChargeLine { kind: 'PACKAGE' | 'TARIFF'; label: string; tariffId: string | null; unitTypeId: string | null; pricePerHour: number | null; minutes: number; amount: number }`
  - `interface TimeCharge { billableMinutes: number; chargedMinutes: number; total: number; lines: ChargeLine[] }`
  - `interface ComputeTimeChargeInput { intervals: BillableInterval[]; anchor: { unitTypeId: string; at: Date }; tariffs: TariffRule[]; rounding: RoundingRule; utcOffsetMin: number; pkg?: PackageInfo | null }`
  - `roundUpMinutes(rawMs, rule, applyMinimum): number`, `computeTimeCharge(input): TimeCharge`

**Aturan perhitungan (dari spec §6.1):** waktu dihitung per menit (dibulatkan ke atas), lalu dibulatkan ke atas per blok; minimum main berlaku untuk open billing. Pembulatan & minimum diterapkan pada **total** durasi; kelebihan menit dibebankan pada potongan tarif **terakhir**. Mode paket: `durationMin` pertama waktu tertagih = harga paket (walau berhenti lebih awal); sisanya (hasil tambah waktu) dihitung tarif normal dengan pembulatan blok **tanpa** minimum.

- [ ] **Step 1: Tulis test tarif yang gagal**

`packages/shared/src/billing/tariff.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ALL_DAYS, dayBit, daysToMask, findTariff, maskToDays, nextBoundary, NoTariffError, ruleCovers, type TariffRule } from './tariff';

const WIB = 420;
const wib = (date: string, hhmm: string) => new Date(new Date(`${date}T${hhmm}:00Z`).getTime() - WIB * 60_000);

const day: TariffRule = { id: 'reg-day', unitTypeId: 'reg', name: 'Reguler Siang', daysMask: ALL_DAYS, startMin: 480, endMin: 1080, pricePerHour: 40000, priority: 0 };
const night: TariffRule = { id: 'reg-night', unitTypeId: 'reg', name: 'Reguler Malam', daysMask: ALL_DAYS, startMin: 1080, endMin: 480, pricePerHour: 50000, priority: 0 };
const weekend: TariffRule = { id: 'reg-weekend', unitTypeId: 'reg', name: 'Reguler Weekend', daysMask: dayBit(0) | dayBit(6), startMin: 0, endMin: 1440, pricePerHour: 60000, priority: 10 };

describe('mask hari', () => {
  it('bolak-balik', () => {
    expect(daysToMask([0, 6])).toBe(65);
    expect(maskToDays(65)).toEqual([0, 6]);
    expect(maskToDays(ALL_DAYS)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('ruleCovers', () => {
  const fridayNight: TariffRule = { ...night, id: 'fri', daysMask: dayBit(5), endMin: 120 };
  it('rentang lintas tengah malam berlaku di pagi hari berikutnya', () => {
    expect(ruleCovers(fridayNight, 6, 60)).toBe(true); // Sabtu 01:00 → masih rentang Jumat
  });
  it('tidak berlaku di pagi hari yang hari sebelumnya bukan hari rentang', () => {
    expect(ruleCovers(fridayNight, 4, 60)).toBe(false); // Kamis 01:00
    expect(ruleCovers(fridayNight, 5, 60)).toBe(false); // Jumat 01:00 (rentang Kamis tidak ada)
  });
});

describe('findTariff', () => {
  const rules = [day, night, weekend];
  it('memilih tarif siang & malam', () => {
    expect(findTariff(rules, 'reg', wib('2026-10-01', '10:00'), WIB).id).toBe('reg-day');
    expect(findTariff(rules, 'reg', wib('2026-10-01', '20:00'), WIB).id).toBe('reg-night');
    expect(findTariff(rules, 'reg', wib('2026-10-02', '03:00'), WIB).id).toBe('reg-night');
  });
  it('prioritas lebih tinggi menang', () => {
    expect(findTariff(rules, 'reg', wib('2026-10-03', '10:00'), WIB).id).toBe('reg-weekend');
  });
  it('melempar NoTariffError jika tidak ada tarif', () => {
    expect(() => findTariff(rules, 'vip', wib('2026-10-01', '10:00'), WIB)).toThrow(NoTariffError);
  });
});

describe('nextBoundary', () => {
  it('berhenti di batas tarif berikutnya', () => {
    expect(nextBoundary([day, night], 'reg', wib('2026-10-01', '17:30'), WIB)).toEqual(wib('2026-10-01', '18:00'));
  });
  it('berhenti di tengah malam lokal', () => {
    expect(nextBoundary([day, night], 'reg', wib('2026-10-01', '20:00'), WIB)).toEqual(wib('2026-10-02', '00:00'));
  });
});
```

- [ ] **Step 2: Tulis test charge yang gagal**

`packages/shared/src/billing/charge.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { computeTimeCharge, roundUpMinutes, type ComputeTimeChargeInput } from './charge';
import { ALL_DAYS, dayBit, NoTariffError, type TariffRule } from './tariff';

const WIB = 420;
const wib = (date: string, hhmm: string) => new Date(new Date(`${date}T${hhmm}:00Z`).getTime() - WIB * 60_000);
const day: TariffRule = { id: 'reg-day', unitTypeId: 'reg', name: 'Reguler Siang', daysMask: ALL_DAYS, startMin: 480, endMin: 1080, pricePerHour: 40000, priority: 0 };
const night: TariffRule = { id: 'reg-night', unitTypeId: 'reg', name: 'Reguler Malam', daysMask: ALL_DAYS, startMin: 1080, endMin: 480, pricePerHour: 50000, priority: 0 };
const weekend: TariffRule = { id: 'reg-weekend', unitTypeId: 'reg', name: 'Reguler Weekend', daysMask: dayBit(0) | dayBit(6), startMin: 0, endMin: 1440, pricePerHour: 60000, priority: 10 };
const rounding = { blockMin: 15, minChargeMin: 60 };

function charge(start: Date, end: Date, extra: Partial<ComputeTimeChargeInput> = {}) {
  return computeTimeCharge({
    intervals: [{ unitTypeId: 'reg', start, end }],
    anchor: { unitTypeId: 'reg', at: start },
    tariffs: [day, night],
    rounding,
    utcOffsetMin: WIB,
    ...extra,
  });
}

describe('roundUpMinutes', () => {
  it('membulatkan ke atas per menit lalu per blok', () => {
    expect(roundUpMinutes(61 * 60_000, { blockMin: 15, minChargeMin: 0 }, true)).toBe(75);
    expect(roundUpMinutes(60 * 60_000, { blockMin: 15, minChargeMin: 0 }, true)).toBe(60);
    expect(roundUpMinutes(1, { blockMin: 1, minChargeMin: 0 }, true)).toBe(1);
  });
  it('menerapkan minimum hanya jika diminta', () => {
    expect(roundUpMinutes(0, rounding, true)).toBe(60);
    expect(roundUpMinutes(0, rounding, false)).toBe(0);
  });
});

describe('computeTimeCharge — open billing', () => {
  it('menerapkan minimum main', () => {
    const c = charge(wib('2026-10-01', '10:00'), wib('2026-10-01', '10:17'));
    expect(c).toEqual({
      billableMinutes: 17,
      chargedMinutes: 60,
      total: 40000,
      lines: [{ kind: 'TARIFF', label: 'Reguler Siang', tariffId: 'reg-day', unitTypeId: 'reg', pricePerHour: 40000, minutes: 60, amount: 40000 }],
    });
  });

  it('membulatkan ke blok 15 menit', () => {
    const c = charge(wib('2026-10-01', '10:00'), wib('2026-10-01', '11:40'));
    expect(c.chargedMinutes).toBe(105);
    expect(c.total).toBe(70000);
  });

  it('memecah sesi yang melewati pergantian tarif', () => {
    const c = charge(wib('2026-10-01', '17:30'), wib('2026-10-01', '18:45'));
    expect(c.lines.map((l) => [l.label, l.minutes, l.amount])).toEqual([
      ['Reguler Siang', 30, 20000],
      ['Reguler Malam', 45, 37500],
    ]);
    expect(c.total).toBe(57500);
  });

  it('membebankan kelebihan pembulatan ke potongan terakhir', () => {
    const c = charge(wib('2026-10-01', '17:30'), wib('2026-10-01', '18:31'));
    expect(c.billableMinutes).toBe(61);
    expect(c.chargedMinutes).toBe(75);
    expect(c.lines.map((l) => [l.label, l.minutes, l.amount])).toEqual([
      ['Reguler Siang', 30, 20000],
      ['Reguler Malam', 45, 37500],
    ]);
  });

  it('menggabungkan potongan tarif sama yang terbelah tengah malam', () => {
    const c = charge(wib('2026-10-01', '23:00'), wib('2026-10-02', '01:00'));
    expect(c.lines.map((l) => [l.label, l.minutes, l.amount])).toEqual([['Reguler Malam', 120, 100000]]);
  });

  it('Friday night into Saturday: tarif weekend berprioritas mengambil alih setelah tengah malam', () => {
    const c = charge(wib('2026-10-02', '23:00'), wib('2026-10-03', '01:00'), { tariffs: [day, night, weekend] });
    expect(c.lines.map((l) => [l.label, l.minutes, l.amount])).toEqual([
      ['Reguler Malam', 60, 50000],
      ['Reguler Weekend', 60, 60000],
    ]);
    expect(c.total).toBe(110000);
  });

  it('menagih minimum saat belum ada waktu berjalan (pakai tarif di anchor)', () => {
    const c = computeTimeCharge({ intervals: [], anchor: { unitTypeId: 'reg', at: wib('2026-10-01', '10:00') }, tariffs: [day, night], rounding, utcOffsetMin: WIB });
    expect(c.total).toBe(40000);
    expect(c.chargedMinutes).toBe(60);
  });

  it('melempar NoTariffError jika tarif tidak ada', () => {
    expect(() => charge(wib('2026-10-01', '10:00'), wib('2026-10-01', '11:00'), { tariffs: [] })).toThrow(NoTariffError);
  });
});

describe('computeTimeCharge — paket', () => {
  const pkg = { name: 'Paket 2 Jam', durationMin: 120, price: 90000 };
  it('menagih harga paket penuh walau berhenti lebih awal', () => {
    const c = charge(wib('2026-10-01', '10:00'), wib('2026-10-01', '10:50'), { pkg });
    expect(c).toEqual({
      billableMinutes: 50,
      chargedMinutes: 120,
      total: 90000,
      lines: [{ kind: 'PACKAGE', label: 'Paket 2 Jam', tariffId: null, unitTypeId: null, pricePerHour: null, minutes: 120, amount: 90000 }],
    });
  });
  it('menagih tambahan waktu dengan tarif normal tanpa minimum', () => {
    const c = charge(wib('2026-10-01', '10:00'), wib('2026-10-01', '12:20'), { pkg });
    expect(c.lines.map((l) => [l.kind, l.minutes, l.amount])).toEqual([
      ['PACKAGE', 120, 90000],
      ['TARIFF', 30, 20000],
    ]);
    expect(c.total).toBe(110000);
    expect(c.chargedMinutes).toBe(150);
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/shared test`
Expected: FAIL — `Failed to resolve import "./tariff"` dan `"./charge"`.

- [ ] **Step 4: Implementasi tarif**

`packages/shared/src/billing/tariff.ts`:
```ts
import { localDayStart, localParts, MINUTES_PER_DAY, MS_PER_MIN } from '../time';

export interface TariffRule {
  id: string;
  unitTypeId: string;
  name: string;
  daysMask: number;
  startMin: number;
  endMin: number;
  pricePerHour: number;
  priority: number;
}

export const ALL_DAYS = 0b1111111;

export function dayBit(dow: number): number {
  return 1 << dow;
}

export function daysToMask(days: number[]): number {
  return days.reduce((mask, d) => mask | dayBit(d), 0);
}

export function maskToDays(mask: number): number[] {
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => (mask & dayBit(d)) !== 0);
}

export class NoTariffError extends Error {
  constructor(
    public readonly unitTypeId: string,
    public readonly at: Date,
  ) {
    super(`Tidak ada tarif untuk tipe ${unitTypeId} pada ${at.toISOString()}`);
    this.name = 'NoTariffError';
  }
}

export function ruleCovers(rule: TariffRule, dow: number, minuteOfDay: number): boolean {
  const has = (d: number) => (rule.daysMask & dayBit(d)) !== 0;
  if (rule.endMin > rule.startMin) {
    return has(dow) && minuteOfDay >= rule.startMin && minuteOfDay < rule.endMin;
  }
  if (has(dow) && minuteOfDay >= rule.startMin) return true;
  return has((dow + 6) % 7) && minuteOfDay < rule.endMin;
}

export function findTariff(rules: TariffRule[], unitTypeId: string, at: Date, utcOffsetMin: number): TariffRule {
  const { dow, minuteOfDay } = localParts(at, utcOffsetMin);
  let best: TariffRule | undefined;
  for (const r of rules) {
    if (r.unitTypeId !== unitTypeId || !ruleCovers(r, dow, minuteOfDay)) continue;
    if (!best || r.priority > best.priority) best = r;
  }
  if (!best) throw new NoTariffError(unitTypeId, at);
  return best;
}

/** Instan berikutnya setelah `at` di mana tarif yang berlaku bisa berubah (batas aturan atau tengah malam lokal). */
export function nextBoundary(rules: TariffRule[], unitTypeId: string, at: Date, utcOffsetMin: number): Date {
  const { minuteOfDay } = localParts(at, utcOffsetMin);
  const points = new Set<number>([MINUTES_PER_DAY]);
  for (const r of rules) {
    if (r.unitTypeId !== unitTypeId) continue;
    points.add(r.startMin);
    points.add(r.endMin % MINUTES_PER_DAY || MINUTES_PER_DAY);
  }
  let next = MINUTES_PER_DAY;
  for (const p of points) if (p > minuteOfDay && p < next) next = p;
  return new Date(localDayStart(at, utcOffsetMin).getTime() + next * MS_PER_MIN);
}
```

- [ ] **Step 5: Implementasi charge**

`packages/shared/src/billing/charge.ts`:
```ts
import { MS_PER_MIN } from '../time';
import { dropLeadingMs, totalMs, type BillableInterval } from './intervals';
import { findTariff, nextBoundary, type TariffRule } from './tariff';

export interface RoundingRule {
  blockMin: number;
  minChargeMin: number;
}

export interface PackageInfo {
  name: string;
  durationMin: number;
  price: number;
}

export interface ChargeLine {
  kind: 'PACKAGE' | 'TARIFF';
  label: string;
  tariffId: string | null;
  unitTypeId: string | null;
  pricePerHour: number | null;
  minutes: number;
  amount: number;
}

export interface TimeCharge {
  billableMinutes: number;
  chargedMinutes: number;
  total: number;
  lines: ChargeLine[];
}

export interface ComputeTimeChargeInput {
  intervals: BillableInterval[];
  anchor: { unitTypeId: string; at: Date };
  tariffs: TariffRule[];
  rounding: RoundingRule;
  utcOffsetMin: number;
  pkg?: PackageInfo | null;
}

const EPS = 1e-9;

function ceilMinutes(ms: number): number {
  return Math.max(0, Math.ceil(ms / MS_PER_MIN - EPS));
}

export function roundUpMinutes(rawMs: number, rule: RoundingRule, applyMinimum: boolean): number {
  const block = Math.max(1, rule.blockMin);
  let rounded = Math.ceil(ceilMinutes(rawMs) / block) * block;
  if (applyMinimum) rounded = Math.max(rounded, rule.minChargeMin);
  return rounded;
}

interface Piece {
  rule: TariffRule;
  ms: number;
}

function splitByTariff(intervals: BillableInterval[], tariffs: TariffRule[], utcOffsetMin: number): Piece[] {
  const pieces: Piece[] = [];
  for (const iv of intervals) {
    let cursor = iv.start;
    while (cursor.getTime() < iv.end.getTime()) {
      const rule = findTariff(tariffs, iv.unitTypeId, cursor, utcOffsetMin);
      const boundary = nextBoundary(tariffs, iv.unitTypeId, cursor, utcOffsetMin);
      const end = boundary.getTime() < iv.end.getTime() ? boundary : iv.end;
      const ms = end.getTime() - cursor.getTime();
      const last = pieces[pieces.length - 1];
      if (last && last.rule.id === rule.id) last.ms += ms;
      else pieces.push({ rule, ms });
      cursor = end;
    }
  }
  return pieces;
}

export function computeTimeCharge(input: ComputeTimeChargeInput): TimeCharge {
  const { intervals, anchor, tariffs, rounding, utcOffsetMin, pkg } = input;
  const lines: ChargeLine[] = [];
  let chargedMinutes = 0;
  let tariffIntervals = intervals;

  if (pkg) {
    lines.push({ kind: 'PACKAGE', label: pkg.name, tariffId: null, unitTypeId: null, pricePerHour: null, minutes: pkg.durationMin, amount: pkg.price });
    chargedMinutes += pkg.durationMin;
    tariffIntervals = dropLeadingMs(intervals, pkg.durationMin * MS_PER_MIN);
  }

  const restMs = totalMs(tariffIntervals);
  const restCharged = pkg && restMs === 0 ? 0 : roundUpMinutes(restMs, rounding, !pkg);

  if (restCharged > 0) {
    const pieces = splitByTariff(tariffIntervals, tariffs, utcOffsetMin);
    if (pieces.length === 0) pieces.push({ rule: findTariff(tariffs, anchor.unitTypeId, anchor.at, utcOffsetMin), ms: 0 });
    pieces[pieces.length - 1]!.ms += restCharged * MS_PER_MIN - restMs;

    let cum = 0;
    let prevRounded = 0;
    for (const p of pieces) {
      cum += p.ms;
      const rounded = Math.round(cum / MS_PER_MIN);
      const minutes = rounded - prevRounded;
      prevRounded = rounded;
      if (minutes <= 0) continue;
      lines.push({
        kind: 'TARIFF',
        label: p.rule.name,
        tariffId: p.rule.id,
        unitTypeId: p.rule.unitTypeId,
        pricePerHour: p.rule.pricePerHour,
        minutes,
        amount: Math.round((p.rule.pricePerHour * minutes) / 60),
      });
    }
    chargedMinutes += restCharged;
  }

  return {
    billableMinutes: ceilMinutes(totalMs(intervals)),
    chargedMinutes,
    total: lines.reduce((s, l) => s + l.amount, 0),
    lines,
  };
}
```

Tambahkan ke `packages/shared/src/index.ts`:
```ts
export * from './billing/tariff';
export * from './billing/charge';
```

- [ ] **Step 6: Jalankan test, pastikan lulus**

Run: `pnpm --filter @funplay/shared test && pnpm --filter @funplay/shared typecheck`
Expected: PASS semua.

- [ ] **Step 7: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): tariff rules and time charge calculator"
```

---

### Task 4: Status meja, label outlet, DTO bersama, adaptor charge sesi

**Files:**
- Create: `packages/shared/src/billing/session-charge.ts`, `packages/shared/src/status.ts`, `packages/shared/src/labels.ts`, `packages/shared/src/views.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/billing/session-charge.test.ts`, `packages/shared/src/status.test.ts`, `packages/shared/src/labels.test.ts`

**Interfaces:**
- Consumes: Task 1–3.
- Produces:
  - `type Instant = Date | string`
  - `interface SessionLike { mode: SessionMode; startedAt: Instant; endedAt: Instant | null; packageName: string | null; packageDurationMin: number | null; packagePrice: number | null; segments: { unitTypeId: string; startedAt: Instant; endedAt: Instant | null }[]; pauses: { pausedAt: Instant; resumedAt: Instant | null }[] }`
  - `interface ChargeSettings { utcOffsetMin: number; roundingBlockMin: number; minChargeMin: number }`
  - `computeSessionCharge(s: SessionLike, tariffs: TariffRule[], settings: ChargeSettings, now: Date): TimeCharge`
  - `sessionElapsedMs(s: SessionLike, now: Date): number`
  - `type UnitStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'WARNING' | 'EXPIRED' | 'MAINTENANCE'`
  - `interface StatusSessionLike { status: SessionStatus; plannedEndAt: Instant | null; pauses?: { pausedAt: Instant; resumedAt: Instant | null }[] }`
  - `remainingMs(s: StatusSessionLike, now: Date): number | null`, `deriveUnitStatus(input: { maintenance: boolean; session: StatusSessionLike | null; now: Date; warnBeforeMin: number }): UnitStatus`
  - `outletLabels(t: OutletType): { unit: string; icon: string }`
  - DTO/view: `PublicUser`, `UserDto`, `PublicSettings`, `UnitTypeDto`, `UnitDto`, `DeviceDto`, `TariffDto`, `PackageDto`, `SegmentView`, `PauseView`, `SessionView`, `UnitView`, `DeviceStatusView`, `AlertType`, `AlertEvent`, `BoardSnapshot` (lihat kode Step 4).

- [ ] **Step 1: Tulis test yang gagal**

`packages/shared/src/billing/session-charge.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { computeSessionCharge, sessionElapsedMs, type SessionLike } from './session-charge';
import { ALL_DAYS, type TariffRule } from './tariff';

const day: TariffRule = { id: 'reg-day', unitTypeId: 'reg', name: 'Reguler Siang', daysMask: ALL_DAYS, startMin: 480, endMin: 1080, pricePerHour: 40000, priority: 0 };
const settings = { utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60 };

// 03:00Z = 10:00 WIB. String ISO dipakai seperti SessionView dari server.
const session: SessionLike = {
  mode: 'PACKAGE',
  startedAt: '2026-10-01T03:00:00.000Z',
  endedAt: null,
  packageName: 'Paket 1 Jam',
  packageDurationMin: 60,
  packagePrice: 45000,
  segments: [{ unitTypeId: 'reg', startedAt: '2026-10-01T03:00:00.000Z', endedAt: null }],
  pauses: [{ pausedAt: '2026-10-01T03:20:00.000Z', resumedAt: '2026-10-01T03:30:00.000Z' }],
};
const now = new Date('2026-10-01T04:15:00.000Z'); // 11:15 WIB

describe('computeSessionCharge', () => {
  it('menghitung paket + sisa tanpa waktu pause', () => {
    const c = computeSessionCharge(session, [day], settings, now);
    expect(c.billableMinutes).toBe(65);
    expect(c.lines.map((l) => [l.kind, l.minutes, l.amount])).toEqual([
      ['PACKAGE', 60, 45000],
      ['TARIFF', 15, 10000],
    ]);
    expect(c.total).toBe(55000);
  });
  it('memakai endedAt bila ada, bukan now', () => {
    const c = computeSessionCharge({ ...session, endedAt: '2026-10-01T04:00:00.000Z' }, [day], settings, now);
    expect(c.total).toBe(45000);
  });
});

describe('sessionElapsedMs', () => {
  it('mengabaikan pause', () => {
    expect(sessionElapsedMs(session, now)).toBe(65 * 60_000);
  });
});
```

`packages/shared/src/status.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { deriveUnitStatus, remainingMs } from './status';

const now = new Date('2026-10-01T03:00:00.000Z');
const inMin = (m: number) => new Date(now.getTime() + m * 60_000).toISOString();
const base = { maintenance: false, now, warnBeforeMin: 5 };

describe('deriveUnitStatus', () => {
  it('IDLE / MAINTENANCE tanpa sesi', () => {
    expect(deriveUnitStatus({ ...base, session: null })).toBe('IDLE');
    expect(deriveUnitStatus({ ...base, maintenance: true, session: null })).toBe('MAINTENANCE');
  });
  it('RUNNING untuk open billing', () => {
    expect(deriveUnitStatus({ ...base, session: { status: 'RUNNING', plannedEndAt: null } })).toBe('RUNNING');
  });
  it('WARNING saat sisa ≤ menit peringatan', () => {
    expect(deriveUnitStatus({ ...base, session: { status: 'RUNNING', plannedEndAt: inMin(10) } })).toBe('RUNNING');
    expect(deriveUnitStatus({ ...base, session: { status: 'RUNNING', plannedEndAt: inMin(4) } })).toBe('WARNING');
  });
  it('EXPIRED saat lewat plannedEndAt walau scheduler belum jalan', () => {
    expect(deriveUnitStatus({ ...base, session: { status: 'RUNNING', plannedEndAt: inMin(-1) } })).toBe('EXPIRED');
    expect(deriveUnitStatus({ ...base, session: { status: 'EXPIRED', plannedEndAt: inMin(-1) } })).toBe('EXPIRED');
  });
  it('PAUSED apa adanya', () => {
    expect(deriveUnitStatus({ ...base, session: { status: 'PAUSED', plannedEndAt: inMin(2) } })).toBe('PAUSED');
  });
});

describe('remainingMs', () => {
  it('membekukan sisa waktu saat pause', () => {
    const s = { status: 'PAUSED' as const, plannedEndAt: inMin(30), pauses: [{ pausedAt: inMin(-10), resumedAt: null }] };
    expect(remainingMs(s, now)).toBe(40 * 60_000);
  });
  it('null untuk open billing', () => {
    expect(remainingMs({ status: 'RUNNING', plannedEndAt: null }, now)).toBeNull();
  });
});
```

`packages/shared/src/labels.test.ts`:
```ts
import { expect, it } from 'vitest';
import { outletLabels } from './labels';

it('label mengikuti jenis outlet', () => {
  expect(outletLabels('BILLIARD')).toEqual({ unit: 'Meja', icon: '🎱' });
  expect(outletLabels('PLAYSTATION')).toEqual({ unit: 'Unit', icon: '🎮' });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/shared test`
Expected: FAIL — modul `./session-charge`, `./status`, `./labels` tidak ditemukan.

- [ ] **Step 3: Implementasi**

`packages/shared/src/billing/session-charge.ts`:
```ts
import type { SessionMode } from '../constants';
import { computeTimeCharge, type TimeCharge } from './charge';
import { buildBillableIntervals, totalMs, type BillableInterval } from './intervals';
import type { TariffRule } from './tariff';

export type Instant = Date | string;

export interface SessionLike {
  mode: SessionMode;
  startedAt: Instant;
  endedAt: Instant | null;
  packageName: string | null;
  packageDurationMin: number | null;
  packagePrice: number | null;
  segments: { unitTypeId: string; startedAt: Instant; endedAt: Instant | null }[];
  pauses: { pausedAt: Instant; resumedAt: Instant | null }[];
}

export interface ChargeSettings {
  utcOffsetMin: number;
  roundingBlockMin: number;
  minChargeMin: number;
}

const toDate = (v: Instant): Date => (v instanceof Date ? v : new Date(v));

function intervalsOf(s: SessionLike, now: Date): BillableInterval[] {
  const until = s.endedAt ? toDate(s.endedAt) : now;
  return buildBillableIntervals(
    s.segments.map((g) => ({ unitTypeId: g.unitTypeId, startedAt: toDate(g.startedAt), endedAt: g.endedAt ? toDate(g.endedAt) : null })),
    s.pauses.map((p) => ({ pausedAt: toDate(p.pausedAt), resumedAt: p.resumedAt ? toDate(p.resumedAt) : null })),
    until,
  );
}

export function sessionElapsedMs(s: SessionLike, now: Date): number {
  return totalMs(intervalsOf(s, now));
}

export function computeSessionCharge(s: SessionLike, tariffs: TariffRule[], settings: ChargeSettings, now: Date): TimeCharge {
  const first = s.segments[0];
  if (!first) throw new Error('Sesi tanpa segmen');
  const pkg =
    s.mode === 'PACKAGE' && s.packageDurationMin != null && s.packagePrice != null
      ? { name: s.packageName ?? 'Paket', durationMin: s.packageDurationMin, price: s.packagePrice }
      : null;
  return computeTimeCharge({
    intervals: intervalsOf(s, now),
    anchor: { unitTypeId: first.unitTypeId, at: toDate(s.startedAt) },
    tariffs,
    rounding: { blockMin: settings.roundingBlockMin, minChargeMin: settings.minChargeMin },
    utcOffsetMin: settings.utcOffsetMin,
    pkg,
  });
}
```

`packages/shared/src/status.ts`:
```ts
import type { SessionStatus } from './constants';
import type { Instant } from './billing/session-charge';
import { MS_PER_MIN } from './time';

export type UnitStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'WARNING' | 'EXPIRED' | 'MAINTENANCE';

export interface StatusSessionLike {
  status: SessionStatus;
  plannedEndAt: Instant | null;
  pauses?: { pausedAt: Instant; resumedAt: Instant | null }[];
}

/** Sisa waktu paket; dibekukan pada awal pause yang sedang berjalan. null untuk open billing. */
export function remainingMs(s: StatusSessionLike, now: Date): number | null {
  if (!s.plannedEndAt) return null;
  const end = new Date(s.plannedEndAt).getTime();
  const openPause = s.status === 'PAUSED' ? s.pauses?.find((p) => p.resumedAt === null) : undefined;
  const ref = openPause ? new Date(openPause.pausedAt).getTime() : now.getTime();
  return Math.max(0, end - ref);
}

export function deriveUnitStatus(input: { maintenance: boolean; session: StatusSessionLike | null; now: Date; warnBeforeMin: number }): UnitStatus {
  const { maintenance, session, now, warnBeforeMin } = input;
  if (!session || session.status === 'ENDED') return maintenance ? 'MAINTENANCE' : 'IDLE';
  if (session.status === 'EXPIRED') return 'EXPIRED';
  if (session.status === 'PAUSED') return 'PAUSED';
  const left = remainingMs(session, now);
  if (left === null) return 'RUNNING';
  if (left <= 0) return 'EXPIRED';
  if (left <= warnBeforeMin * MS_PER_MIN) return 'WARNING';
  return 'RUNNING';
}
```

`packages/shared/src/labels.ts`:
```ts
import type { OutletType } from './constants';

export function outletLabels(t: OutletType): { unit: string; icon: string } {
  return t === 'PLAYSTATION' ? { unit: 'Unit', icon: '🎮' } : { unit: 'Meja', icon: '🎱' };
}
```

`packages/shared/src/views.ts`:
```ts
import type { OutletType, Role, SessionMode, SessionStatus, UnitState } from './constants';
import type { TariffRule } from './billing/tariff';

export interface PublicUser { id: string; name: string; username: string; role: Role }
export interface UserDto extends PublicUser { active: boolean; hasPin: boolean }

export interface PublicSettings {
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
```

`packages/shared/src/index.ts` (isi lengkap):
```ts
export * from './constants';
export * from './time';
export * from './billing/intervals';
export * from './billing/tariff';
export * from './billing/charge';
export * from './billing/session-charge';
export * from './status';
export * from './labels';
export * from './views';
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter @funplay/shared test && pnpm --filter @funplay/shared typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): unit status, outlet labels, shared views, session charge adapter"
```

---

### Task 5: Scaffold server, skema Prisma, harness test, `/api/health`

**Files:**
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/vitest.config.ts`, `apps/server/.env.example`, `apps/server/.env`
- Create: `apps/server/prisma/schema.prisma` (+ migrasi `init` yang digenerate)
- Create: `apps/server/src/config.ts`, `src/db.ts`, `src/context.ts`, `src/app.ts`, `src/lib/errors.ts`, `src/lib/clock.ts`, `src/lib/bus.ts`
- Create: `apps/server/test/test-env.ts`, `test/global-setup.ts`, `test/helpers.ts`
- Test: `apps/server/test/health.test.ts`

**Interfaces:**
- Consumes: `NoTariffError`, `AlertEvent`, `DeviceStatusView` dari `@funplay/shared`.
- Produces:
  - `loadConfig(env?): Config` dengan `DATABASE_URL, PORT (3000), HOST ('0.0.0.0'), COOKIE_SECRET (≥32), NODE_ENV, WEB_DIST?`
  - `type Db = PrismaClient | Prisma.TransactionClient`
  - `interface Clock { now(): Date }`, `systemClock`, `class FakeClock { constructor(t: Date); now(); set(t: Date); advanceMinutes(m: number) }`
  - `class Bus extends EventEmitter<BusEvents>` dengan event `'unit.changed': [unitId]`, `'board.changed': []`, `'alert': [AlertEvent]`, `'device.changed': [DeviceStatusView]`
  - `class AppError(status, code, message)`, helper `notFound(what)`, `conflict(code,msg)`, `badRequest(code,msg)`, `forbidden(msg?)`, `unauthorized()`, `registerErrorHandler(app)` — bentuk error `{ error: { code, message } }`; Prisma P2002→409 `DUPLICATE`, P2003→409 `IN_USE`, P2025→404 `NOT_FOUND`; `ZodError`→400 `VALIDATION`; `NoTariffError`→422 `NO_TARIFF`.
  - `interface AppContext { prisma; clock; config; bus }` (diperluas di Task 10, 11, 13)
  - `buildApp(deps: BuildAppDeps): Promise<{ app: FastifyInstance; ctx: AppContext }>`
  - test helpers: `prisma`, `resetDb()`, `T0` (= `2026-10-01T03:00:00Z`, Kamis 10:00 WIB), `makeApp(opts?)`

- [ ] **Step 1: Paket & konfigurasi**

`apps/server/package.json`:
```json
{
  "name": "@funplay/server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file=.env src/main.ts",
    "build": "tsup src/main.ts src/seed.ts --format esm --target node22 --clean --no-splitting --noExternal @funplay/shared",
    "start": "node --env-file=.env dist/main.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "db:migrate": "prisma migrate dev",
    "db:seed": "tsx --env-file=.env src/seed.ts"
  }
}
```

Jalankan:
```bash
pnpm --filter @funplay/server add fastify@^5 @fastify/cookie@^11 @fastify/static@^8 socket.io@^4.8 @prisma/client@^6 argon2 zod@^3.25 "@funplay/shared@workspace:*"
pnpm --filter @funplay/server add -D prisma@^6 tsx tsup typescript@^5.9 vitest@^3.2 @types/node@^22 socket.io-client@^4.8
```

`apps/server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": ["node"] },
  "include": ["src", "test", "vitest.config.ts"]
}
```

`apps/server/.env.example` (salin juga menjadi `.env`):
```
DATABASE_URL=postgresql://funplay:funplay@localhost:5432/funplay
COOKIE_SECRET=ganti-dengan-string-acak-minimal-32-karakter
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
```

`apps/server/test/test-env.ts`:
```ts
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://funplay:funplay@localhost:5432/funplay_test';
```

`apps/server/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/test-env';

export default defineConfig({
  test: {
    globalSetup: ['test/global-setup.ts'],
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      COOKIE_SECRET: 'test-secret-test-secret-test-secret',
      NODE_ENV: 'test',
    },
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 20_000,
  },
});
```

`apps/server/test/global-setup.ts`:
```ts
import { execSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './test-env';

export default function setup(): void {
  execSync('pnpm exec prisma migrate reset --force --skip-seed --skip-generate', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
```

- [ ] **Step 2: Skema Prisma**

`apps/server/prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum OutletType {
  BILLIARD
  PLAYSTATION
}

enum Role {
  KASIR
  SUPERVISOR
  OWNER
}

enum UnitState {
  ACTIVE
  MAINTENANCE
}

enum SessionMode {
  OPEN
  PACKAGE
}

enum SessionStatus {
  RUNNING
  PAUSED
  EXPIRED
  ENDED
}

enum BillStatus {
  OPEN
  PAID
  VOID
}

enum DeviceEventType {
  CMD_ON
  CMD_OFF
  ACK
  FAIL
  ONLINE
  OFFLINE
  UNEXPECTED_ON
}

model Setting {
  id                Int        @id @default(1)
  outletType        OutletType @default(BILLIARD)
  outletName        String     @default("FunPlay")
  address           String     @default("")
  utcOffsetMin      Int        @default(420)
  roundingBlockMin  Int        @default(15)
  minChargeMin      Int        @default(60)
  warnBeforeMin     Int        @default(5)
  pauseKeepsLightOn Boolean    @default(true)
  autoOffUnexpected Boolean    @default(false)
  updatedAt         DateTime   @updatedAt
}

model User {
  id             String         @id @default(cuid())
  name           String
  username       String         @unique
  passwordHash   String
  pinHash        String?
  role           Role
  active         Boolean        @default(true)
  failedPinCount Int            @default(0)
  lockedUntil    DateTime?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
  loginSessions  LoginSession[]
}

model LoginSession {
  id        String   @id @default(cuid())
  tokenHash String   @unique
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  createdAt DateTime @default(now())
}

model UnitType {
  id        String    @id @default(cuid())
  name      String    @unique
  color     String    @default("#7C3AED")
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  units     Unit[]
  tariffs   Tariff[]
  packages  Package[]
}

model Device {
  id         String        @id @default(cuid())
  name       String        @unique
  driver     String
  codec      String?
  host       String?
  port       Int?
  channels   Int           @default(8)
  config     Json          @default("{}")
  online     Boolean       @default(false)
  lastSeenAt DateTime?
  createdAt  DateTime      @default(now())
  updatedAt  DateTime      @updatedAt
  units      Unit[]
  events     DeviceEvent[]
}

model Unit {
  id            String           @id @default(cuid())
  name          String           @unique
  unitTypeId    String
  unitType      UnitType         @relation(fields: [unitTypeId], references: [id], onDelete: Restrict)
  area          String           @default("")
  deviceId      String?
  device        Device?          @relation(fields: [deviceId], references: [id], onDelete: Restrict)
  relayChannel  Int?
  state         UnitState        @default(ACTIVE)
  lightOverride Boolean?
  sortOrder     Int              @default(0)
  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt
  sessions      Session[]        @relation("UnitSessions")
  activeSession Session?         @relation("ActiveSession")
  segments      SessionSegment[]

  @@unique([deviceId, relayChannel])
}

model Tariff {
  id           String   @id @default(cuid())
  name         String
  unitTypeId   String
  unitType     UnitType @relation(fields: [unitTypeId], references: [id], onDelete: Restrict)
  daysMask     Int      @default(127)
  startMin     Int
  endMin       Int
  pricePerHour Int
  priority     Int      @default(0)
  active       Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model Package {
  id          String    @id @default(cuid())
  name        String
  unitTypeId  String
  unitType    UnitType  @relation(fields: [unitTypeId], references: [id], onDelete: Restrict)
  durationMin Int
  price       Int
  active      Boolean   @default(true)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  sessions    Session[]
}

model BillCounter {
  date String @id
  last Int
}

/// M1 hanya membuat Bill OPEN per sesi; checkout, baris & pembayaran ditambah di M2.
model Bill {
  id          String     @id @default(cuid())
  number      String     @unique
  status      BillStatus @default(OPEN)
  createdById String
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  sessions    Session[]
}

model Session {
  id                 String             @id @default(cuid())
  billId             String
  bill               Bill               @relation(fields: [billId], references: [id])
  unitId             String
  unit               Unit               @relation("UnitSessions", fields: [unitId], references: [id])
  /// Terisi = unitId selama sesi aktif (RUNNING/PAUSED/EXPIRED); null saat ENDED. Unik → satu sesi aktif per meja.
  activeUnitId       String?            @unique
  activeUnit         Unit?              @relation("ActiveSession", fields: [activeUnitId], references: [id])
  mode               SessionMode
  packageId          String?
  package            Package?           @relation(fields: [packageId], references: [id])
  packageName        String?
  packageDurationMin Int?
  packagePrice       Int?
  status             SessionStatus      @default(RUNNING)
  startedAt          DateTime
  plannedEndAt       DateTime?
  endedAt            DateTime?
  warnedAt           DateTime?
  chargeTotal        Int?
  chargeDetail       Json?
  startedById        String
  endedById          String?
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt
  segments           SessionSegment[]
  pauses             SessionPause[]
  extensions         SessionExtension[]

  @@index([status])
}

model SessionSegment {
  id         String    @id @default(cuid())
  sessionId  String
  session    Session   @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  unitId     String
  unit       Unit      @relation(fields: [unitId], references: [id])
  unitTypeId String
  startedAt  DateTime
  endedAt    DateTime?
}

model SessionPause {
  id           String    @id @default(cuid())
  sessionId    String
  session      Session   @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  pausedAt     DateTime
  resumedAt    DateTime?
  approvedById String
}

model SessionExtension {
  id          String   @id @default(cuid())
  sessionId   String
  session     Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  minutes     Int
  requestId   String   @unique
  createdById String
  createdAt   DateTime @default(now())
}

model AuditLog {
  id           String   @id @default(cuid())
  at           DateTime @default(now())
  userId       String?
  action       String
  entity       String
  entityId     String?
  data         Json     @default("{}")
  approvedById String?

  @@index([at])
}

model DeviceEvent {
  id       String          @id @default(cuid())
  at       DateTime        @default(now())
  deviceId String
  device   Device          @relation(fields: [deviceId], references: [id], onDelete: Cascade)
  channel  Int?
  type     DeviceEventType
  detail   Json            @default("{}")

  @@index([deviceId, at])
}
```

Run: `cd apps/server && pnpm exec prisma migrate dev --name init`
Expected: migrasi `prisma/migrations/<timestamp>_init/migration.sql` dibuat & diterapkan ke DB `funplay`; Prisma Client tergenerate.

- [ ] **Step 3: Tulis test yang gagal**

`apps/server/test/helpers.ts`:
```ts
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { FakeClock } from '../src/lib/clock';

export const prisma = new PrismaClient();

/** Kamis 1 Okt 2026 10:00 WIB. */
export const T0 = new Date('2026-10-01T03:00:00Z');

export async function resetDb(): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export async function makeApp(opts: { now?: Date; configure?: (app: FastifyInstance) => void } = {}) {
  const clock = new FakeClock(opts.now ?? T0);
  const { app, ctx } = await buildApp({ prisma, clock, config: loadConfig(), startLoops: false });
  opts.configure?.(app);
  await app.ready();
  return { app, ctx, clock };
}
```

`apps/server/test/health.test.ts`:
```ts
import { afterEach, beforeEach, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors';
import { makeApp, resetDb } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;

beforeEach(async () => {
  await resetDb();
  t = await makeApp({
    configure: (app) => {
      app.get('/api/_test/app-error', async () => {
        throw new AppError(409, 'X_CONFLICT', 'Bentrok');
      });
    },
  });
});
afterEach(() => t.app.close());

it('GET /api/health mengembalikan waktu server dari clock', async () => {
  const res = await t.app.inject({ method: 'GET', url: '/api/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true, serverTime: '2026-10-01T03:00:00.000Z' });
});

it('AppError diubah menjadi bentuk error standar', async () => {
  const res = await t.app.inject({ method: 'GET', url: '/api/_test/app-error' });
  expect(res.statusCode).toBe(409);
  expect(res.json()).toEqual({ error: { code: 'X_CONFLICT', message: 'Bentrok' } });
});
```

- [ ] **Step 4: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test`
Expected: FAIL — `Failed to resolve import "../src/app"`.

- [ ] **Step 5: Implementasi**

`apps/server/src/config.ts`:
```ts
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  COOKIE_SECRET: z.string().min(32),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WEB_DIST: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
```

`apps/server/src/db.ts`:
```ts
import type { Prisma, PrismaClient } from '@prisma/client';

export type Db = PrismaClient | Prisma.TransactionClient;
```

`apps/server/src/lib/clock.ts`:
```ts
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export class FakeClock implements Clock {
  private t: number;
  constructor(t: Date) {
    this.t = t.getTime();
  }
  now(): Date {
    return new Date(this.t);
  }
  set(t: Date): void {
    this.t = t.getTime();
  }
  advanceMinutes(m: number): void {
    this.t += m * 60_000;
  }
}
```

`apps/server/src/lib/bus.ts`:
```ts
import { EventEmitter } from 'node:events';
import type { AlertEvent, DeviceStatusView } from '@funplay/shared';

export interface BusEvents {
  'unit.changed': [unitId: string];
  'board.changed': [];
  alert: [AlertEvent];
  'device.changed': [DeviceStatusView];
}

export class Bus extends EventEmitter<BusEvents> {}
```

`apps/server/src/lib/errors.ts`:
```ts
import { Prisma } from '@prisma/client';
import { NoTariffError } from '@funplay/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} tidak ditemukan`);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const badRequest = (code: string, message: string) => new AppError(400, code, message);
export const forbidden = (message = 'Anda tidak memiliki akses') => new AppError(403, 'FORBIDDEN', message);
export const unauthorized = () => new AppError(401, 'UNAUTHORIZED', 'Silakan login terlebih dahulu');

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: err.issues[0]?.message ?? 'Data tidak valid', issues: err.issues } });
    }
    if (err instanceof NoTariffError) {
      return reply.status(422).send({ error: { code: 'NO_TARIFF', message: 'Tarif untuk tipe ini belum diatur pada jam sekarang' } });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') return reply.status(409).send({ error: { code: 'DUPLICATE', message: 'Data sudah ada' } });
      if (err.code === 'P2003') return reply.status(409).send({ error: { code: 'IN_USE', message: 'Data masih dipakai oleh data lain' } });
      if (err.code === 'P2025') return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Data tidak ditemukan' } });
    }
    const status = (err as FastifyError).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: { code: 'BAD_REQUEST', message: err.message } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Terjadi kesalahan pada server' } });
  });
}
```

`apps/server/src/context.ts`:
```ts
import type { PrismaClient } from '@prisma/client';
import type { Config } from './config';
import type { Bus } from './lib/bus';
import type { Clock } from './lib/clock';

export interface AppContext {
  prisma: PrismaClient;
  clock: Clock;
  config: Config;
  bus: Bus;
}
```

`apps/server/src/app.ts`:
```ts
import cookie from '@fastify/cookie';
import type { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import type { Config } from './config';
import type { AppContext } from './context';
import { Bus } from './lib/bus';
import type { Clock } from './lib/clock';
import { registerErrorHandler } from './lib/errors';

export interface BuildAppDeps {
  prisma: PrismaClient;
  clock: Clock;
  config: Config;
  /** false di test: loop rekonsiliasi & scheduler tidak dijalankan otomatis. */
  startLoops?: boolean;
}

export async function buildApp(deps: BuildAppDeps) {
  const app = Fastify({ logger: deps.config.NODE_ENV === 'test' ? false : { level: 'info' } });
  const ctx: AppContext = { prisma: deps.prisma, clock: deps.clock, config: deps.config, bus: new Bus() };

  registerErrorHandler(app);
  await app.register(cookie, { secret: deps.config.COOKIE_SECRET });

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ ok: true, serverTime: ctx.clock.now().toISOString() }));
    },
    { prefix: '/api' },
  );

  return { app, ctx };
}
```

- [ ] **Step 6: Jalankan test, pastikan lulus**

Run: `pnpm --filter @funplay/server test && pnpm --filter @funplay/server typecheck`
Expected: PASS (global setup mereset DB `funplay_test` lalu 2 test lulus).

- [ ] **Step 7: Commit**

```bash
git add apps/server pnpm-lock.yaml
git commit -m "feat(server): fastify scaffold, prisma schema, test harness"
```

---

### Task 6: Login, peran, persetujuan PIN supervisor, audit

**Files:**
- Create: `apps/server/src/modules/auth/password.ts`, `auth.service.ts`, `guard.ts`, `auth.routes.ts`
- Create: `apps/server/src/modules/audit/audit.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/test/helpers.ts`
- Test: `apps/server/test/auth.test.ts`

**Interfaces:**
- Consumes: `AppContext`, `AppError`, `Db` (Task 5); `PublicUser`, `Role` (shared).
- Produces:
  - `hashSecret(plain): Promise<string>`, `verifySecret(hash, plain): Promise<boolean>`
  - `SESSION_COOKIE = 'fp_session'`, `SESSION_TTL_MS = 12 jam`
  - `login(prisma, clock, username, password): Promise<{ token: string; user: PublicUser }>`, `userFromToken(prisma, clock, token): Promise<PublicUser | null>`, `logout(prisma, token)`, `toPublicUser(u: User): PublicUser`
  - `approveWithPin(prisma, clock, requester: PublicUser, pin?: string): Promise<string>` — mengembalikan id penyetuju; SUPERVISOR/OWNER menyetujui diri sendiri; KASIR wajib PIN (403 `APPROVAL_REQUIRED`, 403 `PIN_INVALID`, 423 `PIN_LOCKED` setelah 5 salah, kunci 5 menit).
  - `installAuth(app, ctx)` (mengisi `req.user` untuk URL `/api/*`), `requireAuth`, `requireRole(...roles)`
  - `authRoutes(ctx): FastifyPluginAsync` — `POST /api/auth/login`, `POST /api/auth/logout` (204), `GET /api/auth/me` → `{ user }`
  - `audit(db: Db, e: AuditEntry)` dengan `AuditEntry { userId: string | null; action: string; entity: string; entityId?: string | null; data?: Prisma.InputJsonValue; approvedById?: string | null }`
  - test helpers: `createUser(role, username?, opts?: { password?: string; pin?: string })`, `seedUsers()` → `{ kasir, supervisor (PIN 1111), owner (PIN 1234) }` (password semua `secret123`), `loginAs(app, username): Promise<string>` (header cookie)

- [ ] **Step 1: Tambah helper test**

Tambahkan ke `apps/server/test/helpers.ts`:
```ts
import type { Role } from '@prisma/client';
import { hashSecret } from '../src/modules/auth/password';

export async function createUser(role: Role, username = role.toLowerCase(), opts: { password?: string; pin?: string } = {}) {
  return prisma.user.create({
    data: {
      name: username,
      username,
      role,
      passwordHash: await hashSecret(opts.password ?? 'secret123'),
      pinHash: opts.pin ? await hashSecret(opts.pin) : null,
    },
  });
}

export async function seedUsers() {
  const kasir = await createUser('KASIR');
  const supervisor = await createUser('SUPERVISOR', 'supervisor', { pin: '1111' });
  const owner = await createUser('OWNER', 'owner', { pin: '1234' });
  return { kasir, supervisor, owner };
}

export async function loginAs(app: FastifyInstance, username: string, password = 'secret123'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
  if (res.statusCode !== 200) throw new Error(`login ${username} gagal: ${res.body}`);
  const c = res.cookies.find((x) => x.name === 'fp_session');
  if (!c) throw new Error('cookie tidak ada');
  return `fp_session=${c.value}`;
}
```

- [ ] **Step 2: Tulis test yang gagal**

`apps/server/test/auth.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { approveWithPin } from '../src/modules/auth/auth.service';
import { requireRole } from '../src/modules/auth/guard';
import { loginAs, makeApp, prisma, resetDb, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let users: Awaited<ReturnType<typeof seedUsers>>;

beforeEach(async () => {
  await resetDb();
  users = await seedUsers();
  t = await makeApp({
    configure: (app) => {
      app.get('/api/_test/owner-only', { preHandler: requireRole('OWNER') }, async () => ({ ok: true }));
    },
  });
});
afterEach(() => t.app.close());

describe('login', () => {
  it('login benar mengeset cookie dan /me mengembalikan user', async () => {
    const cookie = await loginAs(t.app, 'kasir');
    const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ user: { id: users.kasir.id, name: 'kasir', username: 'kasir', role: 'KASIR' } });
    expect(await prisma.auditLog.count({ where: { action: 'auth.login' } })).toBe(1);
  });

  it('password salah → 401 INVALID_LOGIN', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'kasir', password: 'salah' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_LOGIN');
  });

  it('/me tanpa cookie → 401', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('logout mematikan sesi login', async () => {
    const cookie = await loginAs(t.app, 'kasir');
    const out = await t.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(204);
    const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it('user nonaktif tidak bisa memakai sesi lama', async () => {
    const cookie = await loginAs(t.app, 'kasir');
    await prisma.user.update({ where: { id: users.kasir.id }, data: { active: false } });
    const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });
});

describe('requireRole', () => {
  it('kasir ditolak di rute owner', async () => {
    const cookie = await loginAs(t.app, 'kasir');
    const res = await t.app.inject({ method: 'GET', url: '/api/_test/owner-only', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });
  it('owner diterima', async () => {
    const cookie = await loginAs(t.app, 'owner');
    const res = await t.app.inject({ method: 'GET', url: '/api/_test/owner-only', headers: { cookie } });
    expect(res.statusCode).toBe(200);
  });
});

describe('approveWithPin', () => {
  const pub = (u: { id: string; name: string; username: string; role: 'KASIR' | 'SUPERVISOR' | 'OWNER' }) => ({ id: u.id, name: u.name, username: u.username, role: u.role });

  it('supervisor menyetujui dirinya sendiri tanpa PIN', async () => {
    expect(await approveWithPin(prisma, t.clock, pub(users.supervisor))).toBe(users.supervisor.id);
  });
  it('kasir tanpa PIN → APPROVAL_REQUIRED', async () => {
    await expect(approveWithPin(prisma, t.clock, pub(users.kasir))).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  });
  it('kasir dengan PIN supervisor → id supervisor', async () => {
    expect(await approveWithPin(prisma, t.clock, pub(users.kasir), '1111')).toBe(users.supervisor.id);
  });
  it('5 kali PIN salah mengunci kasir 5 menit', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(approveWithPin(prisma, t.clock, pub(users.kasir), '9999')).rejects.toMatchObject({ code: 'PIN_INVALID' });
    }
    await expect(approveWithPin(prisma, t.clock, pub(users.kasir), '1111')).rejects.toMatchObject({ code: 'PIN_LOCKED', status: 423 });
    t.clock.advanceMinutes(6);
    expect(await approveWithPin(prisma, t.clock, pub(users.kasir), '1111')).toBe(users.supervisor.id);
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- auth`
Expected: FAIL — modul `../src/modules/auth/...` tidak ditemukan.

- [ ] **Step 4: Implementasi**

`apps/server/src/modules/auth/password.ts`:
```ts
import argon2 from 'argon2';

export function hashSecret(plain: string): Promise<string> {
  return argon2.hash(plain);
}

export function verifySecret(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain).catch(() => false);
}
```

`apps/server/src/modules/audit/audit.ts`:
```ts
import type { Prisma } from '@prisma/client';
import type { Db } from '../../db';

export interface AuditEntry {
  userId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  data?: Prisma.InputJsonValue;
  approvedById?: string | null;
}

export function audit(db: Db, e: AuditEntry) {
  return db.auditLog.create({
    data: {
      userId: e.userId,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      data: e.data ?? {},
      approvedById: e.approvedById ?? null,
    },
  });
}
```

`apps/server/src/modules/auth/auth.service.ts`:
```ts
import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient, User } from '@prisma/client';
import type { PublicUser } from '@funplay/shared';
import { AppError } from '../../lib/errors';
import type { Clock } from '../../lib/clock';
import { audit } from '../audit/audit';
import { verifySecret } from './password';

export const SESSION_COOKIE = 'fp_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PIN_MAX_FAILS = 5;
const PIN_LOCK_MS = 5 * 60 * 1000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function toPublicUser(u: User): PublicUser {
  return { id: u.id, name: u.name, username: u.username, role: u.role };
}

export async function login(prisma: PrismaClient, clock: Clock, username: string, password: string) {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.active || !(await verifySecret(user.passwordHash, password))) {
    throw new AppError(401, 'INVALID_LOGIN', 'Username atau password salah');
  }
  const token = randomBytes(32).toString('base64url');
  await prisma.loginSession.create({
    data: { tokenHash: sha256(token), userId: user.id, expiresAt: new Date(clock.now().getTime() + SESSION_TTL_MS) },
  });
  await audit(prisma, { userId: user.id, action: 'auth.login', entity: 'User', entityId: user.id });
  return { token, user: toPublicUser(user) };
}

export async function userFromToken(prisma: PrismaClient, clock: Clock, token: string): Promise<PublicUser | null> {
  const s = await prisma.loginSession.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!s || s.expiresAt <= clock.now() || !s.user.active) return null;
  return toPublicUser(s.user);
}

export async function logout(prisma: PrismaClient, token: string): Promise<void> {
  await prisma.loginSession.deleteMany({ where: { tokenHash: sha256(token) } });
}

/** Mengembalikan id user yang menyetujui aksi sensitif. */
export async function approveWithPin(prisma: PrismaClient, clock: Clock, requester: PublicUser, pin?: string): Promise<string> {
  if (requester.role !== 'KASIR') return requester.id;
  if (!pin) throw new AppError(403, 'APPROVAL_REQUIRED', 'Aksi ini butuh PIN supervisor');

  const me = await prisma.user.findUniqueOrThrow({ where: { id: requester.id } });
  if (me.lockedUntil && me.lockedUntil > clock.now()) {
    throw new AppError(423, 'PIN_LOCKED', 'Terlalu banyak PIN salah. Coba lagi beberapa menit lagi.');
  }

  const approvers = await prisma.user.findMany({
    where: { active: true, role: { in: ['SUPERVISOR', 'OWNER'] }, pinHash: { not: null } },
  });
  for (const a of approvers) {
    if (a.pinHash && (await verifySecret(a.pinHash, pin))) {
      await prisma.user.update({ where: { id: me.id }, data: { failedPinCount: 0, lockedUntil: null } });
      return a.id;
    }
  }

  const failed = me.failedPinCount + 1;
  await prisma.user.update({
    where: { id: me.id },
    data: failed >= PIN_MAX_FAILS ? { failedPinCount: 0, lockedUntil: new Date(clock.now().getTime() + PIN_LOCK_MS) } : { failedPinCount: failed },
  });
  throw new AppError(403, 'PIN_INVALID', 'PIN supervisor salah');
}
```

`apps/server/src/modules/auth/guard.ts`:
```ts
import type { PublicUser, Role } from '@funplay/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../../context';
import { forbidden, unauthorized } from '../../lib/errors';
import { SESSION_COOKIE, userFromToken } from './auth.service';

declare module 'fastify' {
  interface FastifyRequest {
    user: PublicUser | null;
  }
}

export function installAuth(app: FastifyInstance, ctx: Pick<AppContext, 'prisma' | 'clock'>): void {
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    req.user = null;
    if (!req.url.startsWith('/api')) return;
    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) return;
    const un = req.unsignCookie(raw);
    if (!un.valid || !un.value) return;
    req.user = await userFromToken(ctx.prisma, ctx.clock, un.value);
  });
}

export async function requireAuth(req: FastifyRequest): Promise<void> {
  if (!req.user) throw unauthorized();
}

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest): Promise<void> => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
  };
}
```

`apps/server/src/modules/auth/auth.routes.ts`:
```ts
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { login, logout, SESSION_COOKIE, SESSION_TTL_MS } from './auth.service';
import { requireAuth } from './guard';

const loginSchema = z.object({ username: z.string().trim().min(1), password: z.string().min(1) });

export function authRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.post('/auth/login', async (req, reply) => {
      const body = loginSchema.parse(req.body);
      const { token, user } = await login(ctx.prisma, ctx.clock, body.username, body.password);
      reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', signed: true, maxAge: SESSION_TTL_MS / 1000 });
      return { user };
    });

    app.post('/auth/logout', async (req, reply) => {
      const raw = req.cookies[SESSION_COOKIE];
      if (raw) {
        const un = req.unsignCookie(raw);
        if (un.valid && un.value) await logout(ctx.prisma, un.value);
      }
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.status(204).send();
    });

    app.get('/auth/me', { preHandler: requireAuth }, async (req) => ({ user: req.user }));
  };
}
```

Ubah `apps/server/src/app.ts` — setelah `await app.register(cookie, ...)` tambahkan `installAuth(app, ctx);`, dan di dalam plugin `/api` daftarkan rute auth:
```ts
import { authRoutes } from './modules/auth/auth.routes';
import { installAuth } from './modules/auth/guard';
// ...
  registerErrorHandler(app);
  await app.register(cookie, { secret: deps.config.COOKIE_SECRET });
  installAuth(app, ctx);

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ ok: true, serverTime: ctx.clock.now().toISOString() }));
      await api.register(authRoutes(ctx));
    },
    { prefix: '/api' },
  );
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `pnpm --filter @funplay/server test && pnpm --filter @funplay/server typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): login sessions, roles, supervisor PIN approval, audit log"
```

---

### Task 7: API pengaturan & user

**Files:**
- Create: `apps/server/src/modules/settings/settings.service.ts`, `settings.routes.ts`
- Create: `apps/server/src/modules/users/users.routes.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/settings-users.test.ts`

**Interfaces:**
- Consumes: Task 5–6.
- Produces:
  - `getSettings(db: Db): Promise<PublicSettings>` (membuat baris default id=1 bila belum ada — **panggil di luar transaksi**), `toPublicSettings(row)`
  - `GET /api/settings` (login), `PUT /api/settings` (OWNER, partial; emit `board.changed`)
  - `GET /api/users`, `POST /api/users`, `PATCH /api/users/:id` (OWNER) → `UserDto`; 400 `SELF_LOCKOUT` bila owner menonaktifkan/menurunkan peran dirinya.

- [ ] **Step 1: Tulis test yang gagal**

`apps/server/test/settings-users.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, resetDb, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let users: Awaited<ReturnType<typeof seedUsers>>;

beforeEach(async () => {
  await resetDb();
  users = await seedUsers();
  t = await makeApp();
});
afterEach(() => t.app.close());

describe('settings', () => {
  it('GET mengembalikan default', async () => {
    const cookie = await loginAs(t.app, 'kasir');
    const res = await t.app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } });
    expect(res.json()).toEqual({
      outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15,
      minChargeMin: 60, warnBeforeMin: 5, pauseKeepsLightOn: true, autoOffUnexpected: false,
    });
  });
  it('kasir tidak boleh mengubah', async () => {
    const cookie = await loginAs(t.app, 'kasir');
    const res = await t.app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie }, payload: { outletName: 'X' } });
    expect(res.statusCode).toBe(403);
  });
  it('owner mengubah sebagian & memicu board.changed', async () => {
    const cookie = await loginAs(t.app, 'owner');
    let fired = 0;
    t.ctx.bus.on('board.changed', () => fired++);
    const res = await t.app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie }, payload: { outletType: 'PLAYSTATION', roundingBlockMin: 30 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outletType: 'PLAYSTATION', roundingBlockMin: 30, minChargeMin: 60 });
    expect(fired).toBe(1);
  });
  it('validasi menolak blok pembulatan 0', async () => {
    const cookie = await loginAs(t.app, 'owner');
    const res = await t.app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie }, payload: { roundingBlockMin: 0 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });
});

describe('users', () => {
  it('owner membuat & melihat user', async () => {
    const cookie = await loginAs(t.app, 'owner');
    const res = await t.app.inject({
      method: 'POST', url: '/api/users', headers: { cookie },
      payload: { name: 'Budi', username: 'budi', password: 'rahasia1', role: 'KASIR' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Budi', username: 'budi', role: 'KASIR', active: true, hasPin: false });
    const list = await t.app.inject({ method: 'GET', url: '/api/users', headers: { cookie } });
    expect(list.json()).toHaveLength(4);
    await loginAs(t.app, 'budi', 'rahasia1');
  });
  it('username duplikat → 409', async () => {
    const cookie = await loginAs(t.app, 'owner');
    const res = await t.app.inject({ method: 'POST', url: '/api/users', headers: { cookie }, payload: { name: 'K', username: 'kasir', password: 'rahasia1', role: 'KASIR' } });
    expect(res.statusCode).toBe(409);
  });
  it('owner tidak bisa menonaktifkan diri sendiri', async () => {
    const cookie = await loginAs(t.app, 'owner');
    const res = await t.app.inject({ method: 'PATCH', url: `/api/users/${users.owner.id}`, headers: { cookie }, payload: { active: false } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('SELF_LOCKOUT');
  });
  it('PATCH mengganti PIN', async () => {
    const cookie = await loginAs(t.app, 'owner');
    const res = await t.app.inject({ method: 'PATCH', url: `/api/users/${users.kasir.id}`, headers: { cookie }, payload: { pin: '4321' } });
    expect(res.json().hasPin).toBe(true);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- settings-users`
Expected: FAIL — 404 pada `/api/settings`.

- [ ] **Step 3: Implementasi**

`apps/server/src/modules/settings/settings.service.ts`:
```ts
import type { Setting } from '@prisma/client';
import { OUTLET_TYPES, type PublicSettings } from '@funplay/shared';
import { z } from 'zod';
import type { Db } from '../../db';

export function toPublicSettings(s: Setting): PublicSettings {
  return {
    outletType: s.outletType,
    outletName: s.outletName,
    address: s.address,
    utcOffsetMin: s.utcOffsetMin,
    roundingBlockMin: s.roundingBlockMin,
    minChargeMin: s.minChargeMin,
    warnBeforeMin: s.warnBeforeMin,
    pauseKeepsLightOn: s.pauseKeepsLightOn,
    autoOffUnexpected: s.autoOffUnexpected,
  };
}

/** Jangan dipanggil di dalam transaksi: create yang bentrok akan membatalkan transaksi Postgres. */
export async function getSettings(db: Db): Promise<PublicSettings> {
  const found = await db.setting.findUnique({ where: { id: 1 } });
  if (found) return toPublicSettings(found);
  try {
    return toPublicSettings(await db.setting.create({ data: { id: 1 } }));
  } catch {
    return toPublicSettings(await db.setting.findUniqueOrThrow({ where: { id: 1 } }));
  }
}

export const settingsUpdateSchema = z
  .object({
    outletType: z.enum(OUTLET_TYPES),
    outletName: z.string().trim().min(1).max(80),
    address: z.string().trim().max(200),
    utcOffsetMin: z.number().int().min(-720).max(840),
    roundingBlockMin: z.number().int().min(1, 'Blok pembulatan minimal 1 menit').max(60),
    minChargeMin: z.number().int().min(0).max(600),
    warnBeforeMin: z.number().int().min(0).max(60),
    pauseKeepsLightOn: z.boolean(),
    autoOffUnexpected: z.boolean(),
  })
  .partial();
```

`apps/server/src/modules/settings/settings.routes.ts`:
```ts
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../../context';
import { audit } from '../audit/audit';
import { requireAuth, requireRole } from '../auth/guard';
import { getSettings, settingsUpdateSchema } from './settings.service';

export function settingsRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.get('/settings', { preHandler: requireAuth }, async () => getSettings(ctx.prisma));

    app.put('/settings', { preHandler: requireRole('OWNER') }, async (req) => {
      const data = settingsUpdateSchema.parse(req.body);
      await getSettings(ctx.prisma);
      await ctx.prisma.setting.update({ where: { id: 1 }, data });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'settings.update', entity: 'Setting', entityId: '1', data });
      ctx.bus.emit('board.changed');
      return getSettings(ctx.prisma);
    });
  };
}
```

`apps/server/src/modules/users/users.routes.ts`:
```ts
import type { User } from '@prisma/client';
import { ROLES, type UserDto } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { badRequest } from '../../lib/errors';
import { audit } from '../audit/audit';
import { requireRole } from '../auth/guard';
import { hashSecret } from '../auth/password';

const fields = {
  name: z.string().trim().min(1).max(60),
  username: z.string().regex(/^[a-z0-9_.]{3,30}$/, 'Username 3–30 karakter: huruf kecil, angka, titik, garis bawah'),
  password: z.string().min(6, 'Password minimal 6 karakter'),
  pin: z.string().regex(/^\d{4,6}$/, 'PIN 4–6 digit angka'),
  role: z.enum(ROLES),
  active: z.boolean(),
};
const createSchema = z.object({ ...fields, pin: fields.pin.optional(), active: fields.active.default(true) });
const updateSchema = z.object(fields).partial();
const idParam = z.object({ id: z.string().min(1) });

function toDto(u: User): UserDto {
  return { id: u.id, name: u.name, username: u.username, role: u.role, active: u.active, hasPin: u.pinHash !== null };
}

export function usersRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const owner = { preHandler: requireRole('OWNER') };

    app.get('/users', owner, async () => (await ctx.prisma.user.findMany({ orderBy: { name: 'asc' } })).map(toDto));

    app.post('/users', owner, async (req) => {
      const b = createSchema.parse(req.body);
      const u = await ctx.prisma.user.create({
        data: {
          name: b.name, username: b.username, role: b.role, active: b.active,
          passwordHash: await hashSecret(b.password),
          pinHash: b.pin ? await hashSecret(b.pin) : null,
        },
      });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'user.create', entity: 'User', entityId: u.id, data: { username: u.username, role: u.role } });
      return toDto(u);
    });

    app.patch('/users/:id', owner, async (req) => {
      const { id } = idParam.parse(req.params);
      const b = updateSchema.parse(req.body);
      if (id === req.user!.id && (b.active === false || (b.role !== undefined && b.role !== 'OWNER'))) {
        throw badRequest('SELF_LOCKOUT', 'Tidak bisa menonaktifkan atau menurunkan peran akun sendiri');
      }
      const u = await ctx.prisma.user.update({
        where: { id },
        data: {
          name: b.name, username: b.username, role: b.role, active: b.active,
          passwordHash: b.password ? await hashSecret(b.password) : undefined,
          pinHash: b.pin ? await hashSecret(b.pin) : undefined,
        },
      });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'user.update', entity: 'User', entityId: id, data: { fields: Object.keys(b) } });
      return toDto(u);
    });
  };
}
```

Ubah `apps/server/src/app.ts` — di plugin `/api` tambahkan setelah `authRoutes`:
```ts
import { settingsRoutes } from './modules/settings/settings.routes';
import { usersRoutes } from './modules/users/users.routes';
// ...
      await api.register(settingsRoutes(ctx));
      await api.register(usersRoutes(ctx));
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter @funplay/server test && pnpm --filter @funplay/server typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): settings and user management API"
```

---

### Task 8: Master data — tipe meja, meja, tarif, paket

**Files:**
- Create: `apps/server/src/modules/catalog/unit-types.routes.ts`, `units.routes.ts`, `tariffs.service.ts`, `tariffs.routes.ts`, `packages.routes.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/catalog.test.ts`

**Interfaces:**
- Consumes: Task 5–7; `parseHHMM`, `formatHHMM`, `daysToMask`, `maskToDays`, `MINUTES_PER_DAY`, DTO shared.
- Produces:
  - `toTariffRule(t: Tariff): TariffRule`, `loadTariffRules(db: Db): Promise<TariffRule[]>` (hanya `active`), `toTariffDto(t): TariffDto`
  - `toUnitDto(u: Unit): UnitDto`
  - REST (GET: login; tulis: OWNER; semua perubahan emit `board.changed`; DELETE → 204):
    - `/api/unit-types` GET/POST, `/api/unit-types/:id` PATCH/DELETE — body `{ name, color? }`
    - `/api/units` GET/POST, `/api/units/:id` PATCH/DELETE — body `{ name, unitTypeId, area?, deviceId?, relayChannel?, state?, sortOrder? }`; 400 `MAPPING_INCOMPLETE`, 400 `CHANNEL_OUT_OF_RANGE`, 409 `UNIT_BUSY` (maintenance saat ada sesi aktif)
    - `/api/tariffs` GET/POST, `/api/tariffs/:id` PATCH/DELETE — body `{ name, unitTypeId, days: number[], start: 'HH:MM', end: 'HH:MM', pricePerHour, priority?, active? }`; `end = '00:00'` dianggap `24:00`; 400 `INVALID_TIME`
    - `/api/packages` GET/POST, `/api/packages/:id` PATCH/DELETE — body `{ name, unitTypeId, durationMin, price, active? }`

- [ ] **Step 1: Tulis test yang gagal**

`apps/server/test/catalog.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, prisma, resetDb, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  await seedUsers();
  t = await makeApp();
  cookie = await loginAs(t.app, 'owner');
});
afterEach(() => t.app.close());

const post = (url: string, payload: unknown) => t.app.inject({ method: 'POST', url, headers: { cookie }, payload });

describe('unit types & units', () => {
  it('membuat tipe lalu meja', async () => {
    const type = (await post('/api/unit-types', { name: 'Reguler' })).json();
    expect(type).toMatchObject({ name: 'Reguler', color: '#7C3AED' });
    const unit = await post('/api/units', { name: 'Meja 1', unitTypeId: type.id });
    expect(unit.statusCode).toBe(200);
    expect(unit.json()).toMatchObject({ name: 'Meja 1', area: '', deviceId: null, relayChannel: null, state: 'ACTIVE', lightOverride: null });
  });

  it('kasir tidak boleh membuat meja', async () => {
    const kasir = await loginAs(t.app, 'kasir');
    const res = await t.app.inject({ method: 'POST', url: '/api/unit-types', headers: { cookie: kasir }, payload: { name: 'X' } });
    expect(res.statusCode).toBe(403);
  });

  it('menolak device tanpa channel dan channel di luar jangkauan', async () => {
    const type = (await post('/api/unit-types', { name: 'Reguler' })).json();
    const device = await prisma.device.create({ data: { name: 'Sim', driver: 'simulator', channels: 4 } });
    const a = await post('/api/units', { name: 'M1', unitTypeId: type.id, deviceId: device.id });
    expect(a.json().error.code).toBe('MAPPING_INCOMPLETE');
    const b = await post('/api/units', { name: 'M1', unitTypeId: type.id, deviceId: device.id, relayChannel: 5 });
    expect(b.json().error.code).toBe('CHANNEL_OUT_OF_RANGE');
  });

  it('channel relay yang sama tidak bisa dipakai dua meja', async () => {
    const type = (await post('/api/unit-types', { name: 'Reguler' })).json();
    const device = await prisma.device.create({ data: { name: 'Sim', driver: 'simulator', channels: 4 } });
    await post('/api/units', { name: 'M1', unitTypeId: type.id, deviceId: device.id, relayChannel: 1 });
    const dup = await post('/api/units', { name: 'M2', unitTypeId: type.id, deviceId: device.id, relayChannel: 1 });
    expect(dup.statusCode).toBe(409);
  });

  it('tipe yang masih dipakai tidak bisa dihapus', async () => {
    const type = (await post('/api/unit-types', { name: 'Reguler' })).json();
    await post('/api/units', { name: 'M1', unitTypeId: type.id });
    const res = await t.app.inject({ method: 'DELETE', url: `/api/unit-types/${type.id}`, headers: { cookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('IN_USE');
  });
});

describe('tariffs & packages', () => {
  it('menyimpan tarif lintas tengah malam dan mengembalikannya dalam HH:MM', async () => {
    const type = (await post('/api/unit-types', { name: 'Reguler' })).json();
    const res = await post('/api/tariffs', { name: 'Malam', unitTypeId: type.id, days: [5, 6], start: '18:00', end: '02:00', pricePerHour: 50000 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Malam', days: [5, 6], start: '18:00', end: '02:00', pricePerHour: 50000, priority: 0, active: true });
    const row = await prisma.tariff.findFirstOrThrow();
    expect(row).toMatchObject({ daysMask: 96, startMin: 1080, endMin: 120 });
  });

  it('end 00:00 disimpan sebagai 24:00', async () => {
    const type = (await post('/api/unit-types', { name: 'Reguler' })).json();
    const res = await post('/api/tariffs', { name: 'Full', unitTypeId: type.id, days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '00:00', pricePerHour: 1 });
    expect(res.json().end).toBe('24:00');
  });

  it('menolak jam mulai = jam selesai dan format salah', async () => {
    const type = (await post('/api/unit-types', { name: 'Reguler' })).json();
    const a = await post('/api/tariffs', { name: 'X', unitTypeId: type.id, days: [1], start: '08:00', end: '08:00', pricePerHour: 1 });
    expect(a.json().error.code).toBe('INVALID_TIME');
    const b = await post('/api/tariffs', { name: 'X', unitTypeId: type.id, days: [1], start: '8:00', end: '09:00', pricePerHour: 1 });
    expect(b.statusCode).toBe(400);
  });

  it('PATCH tarif hanya jam mulai tetap memakai jam selesai lama', async () => {
    const type = (await post('/api/unit-types', { name: 'Reguler' })).json();
    const tr = (await post('/api/tariffs', { name: 'Siang', unitTypeId: type.id, days: [1], start: '08:00', end: '18:00', pricePerHour: 1 })).json();
    const res = await t.app.inject({ method: 'PATCH', url: `/api/tariffs/${tr.id}`, headers: { cookie }, payload: { start: '09:00' } });
    expect(res.json()).toMatchObject({ start: '09:00', end: '18:00' });
  });

  it('CRUD paket', async () => {
    const type = (await post('/api/unit-types', { name: 'Reguler' })).json();
    const p = (await post('/api/packages', { name: 'Paket 2 Jam', unitTypeId: type.id, durationMin: 120, price: 90000 })).json();
    expect(p).toMatchObject({ name: 'Paket 2 Jam', durationMin: 120, price: 90000, active: true });
    const del = await t.app.inject({ method: 'DELETE', url: `/api/packages/${p.id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- catalog`
Expected: FAIL — 404 pada `/api/unit-types`.

- [ ] **Step 3: Implementasi**

`apps/server/src/modules/catalog/unit-types.routes.ts`:
```ts
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { audit } from '../audit/audit';
import { requireAuth, requireRole } from '../auth/guard';

const schema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Warna harus format #RRGGBB').default('#7C3AED'),
});
const idParam = z.object({ id: z.string().min(1) });

export function unitTypesRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const owner = { preHandler: requireRole('OWNER') };
    const toDto = (t: { id: string; name: string; color: string }) => ({ id: t.id, name: t.name, color: t.color });

    app.get('/unit-types', { preHandler: requireAuth }, async () =>
      (await ctx.prisma.unitType.findMany({ orderBy: { name: 'asc' } })).map(toDto),
    );

    app.post('/unit-types', owner, async (req) => {
      const t = await ctx.prisma.unitType.create({ data: schema.parse(req.body) });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'unitType.create', entity: 'UnitType', entityId: t.id });
      ctx.bus.emit('board.changed');
      return toDto(t);
    });

    app.patch('/unit-types/:id', owner, async (req) => {
      const { id } = idParam.parse(req.params);
      const t = await ctx.prisma.unitType.update({ where: { id }, data: schema.partial().parse(req.body) });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'unitType.update', entity: 'UnitType', entityId: id });
      ctx.bus.emit('board.changed');
      return toDto(t);
    });

    app.delete('/unit-types/:id', owner, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await ctx.prisma.unitType.delete({ where: { id } });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'unitType.delete', entity: 'UnitType', entityId: id });
      ctx.bus.emit('board.changed');
      return reply.status(204).send();
    });
  };
}
```

`apps/server/src/modules/catalog/units.routes.ts`:
```ts
import type { Unit } from '@prisma/client';
import { UNIT_STATES, type UnitDto } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import type { Db } from '../../db';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { audit } from '../audit/audit';
import { requireAuth, requireRole } from '../auth/guard';

const fields = {
  name: z.string().trim().min(1).max(40),
  unitTypeId: z.string().min(1),
  area: z.string().trim().max(40),
  deviceId: z.string().min(1).nullable(),
  relayChannel: z.number().int().nullable(),
  state: z.enum(UNIT_STATES),
  sortOrder: z.number().int(),
};
const createSchema = z.object({
  ...fields,
  area: fields.area.default(''),
  deviceId: fields.deviceId.default(null),
  relayChannel: fields.relayChannel.default(null),
  state: fields.state.default('ACTIVE'),
  sortOrder: fields.sortOrder.default(0),
});
const patchSchema = z.object(fields).partial();
const idParam = z.object({ id: z.string().min(1) });

export function toUnitDto(u: Unit): UnitDto {
  return {
    id: u.id, name: u.name, unitTypeId: u.unitTypeId, area: u.area, deviceId: u.deviceId,
    relayChannel: u.relayChannel, state: u.state, sortOrder: u.sortOrder, lightOverride: u.lightOverride,
  };
}

async function validateMapping(db: Db, deviceId: string | null, relayChannel: number | null): Promise<void> {
  if ((deviceId === null) !== (relayChannel === null)) {
    throw badRequest('MAPPING_INCOMPLETE', 'Device dan channel relay harus diisi bersamaan');
  }
  if (deviceId === null || relayChannel === null) return;
  const device = await db.device.findUnique({ where: { id: deviceId } });
  if (!device) throw notFound('Device');
  if (relayChannel < 1 || relayChannel > device.channels) {
    throw badRequest('CHANNEL_OUT_OF_RANGE', `Channel relay harus 1–${device.channels}`);
  }
}

export function unitsRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const owner = { preHandler: requireRole('OWNER') };

    app.get('/units', { preHandler: requireAuth }, async () =>
      (await ctx.prisma.unit.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })).map(toUnitDto),
    );

    app.post('/units', owner, async (req) => {
      const b = createSchema.parse(req.body);
      await validateMapping(ctx.prisma, b.deviceId, b.relayChannel);
      const u = await ctx.prisma.unit.create({ data: b });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'unit.create', entity: 'Unit', entityId: u.id });
      ctx.bus.emit('board.changed');
      return toUnitDto(u);
    });

    app.patch('/units/:id', owner, async (req) => {
      const { id } = idParam.parse(req.params);
      const b = patchSchema.parse(req.body);
      const current = await ctx.prisma.unit.findUnique({ where: { id }, include: { activeSession: true } });
      if (!current) throw notFound('Meja');
      if (b.state === 'MAINTENANCE' && current.activeSession) {
        throw conflict('UNIT_BUSY', `${current.name} sedang dipakai, hentikan sesi dulu`);
      }
      await validateMapping(
        ctx.prisma,
        b.deviceId !== undefined ? b.deviceId : current.deviceId,
        b.relayChannel !== undefined ? b.relayChannel : current.relayChannel,
      );
      const u = await ctx.prisma.unit.update({ where: { id }, data: b });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'unit.update', entity: 'Unit', entityId: id, data: b });
      ctx.bus.emit('board.changed');
      return toUnitDto(u);
    });

    app.delete('/units/:id', owner, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await ctx.prisma.unit.delete({ where: { id } });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'unit.delete', entity: 'Unit', entityId: id });
      ctx.bus.emit('board.changed');
      return reply.status(204).send();
    });
  };
}
```

`apps/server/src/modules/catalog/tariffs.service.ts`:
```ts
import type { Tariff } from '@prisma/client';
import { formatHHMM, maskToDays, type TariffDto, type TariffRule } from '@funplay/shared';
import type { Db } from '../../db';

export function toTariffRule(t: Tariff): TariffRule {
  return {
    id: t.id, unitTypeId: t.unitTypeId, name: t.name, daysMask: t.daysMask,
    startMin: t.startMin, endMin: t.endMin, pricePerHour: t.pricePerHour, priority: t.priority,
  };
}

export function toTariffDto(t: Tariff): TariffDto {
  return {
    id: t.id, name: t.name, unitTypeId: t.unitTypeId, days: maskToDays(t.daysMask),
    start: formatHHMM(t.startMin), end: formatHHMM(t.endMin),
    pricePerHour: t.pricePerHour, priority: t.priority, active: t.active,
  };
}

export async function loadTariffRules(db: Db): Promise<TariffRule[]> {
  return (await db.tariff.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' } })).map(toTariffRule);
}
```

`apps/server/src/modules/catalog/tariffs.routes.ts`:
```ts
import { daysToMask, formatHHMM, MINUTES_PER_DAY, parseHHMM } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { badRequest, notFound } from '../../lib/errors';
import { audit } from '../audit/audit';
import { requireAuth, requireRole } from '../auth/guard';
import { toTariffDto } from './tariffs.service';

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Format jam harus HH:MM');
const fields = {
  name: z.string().trim().min(1).max(40),
  unitTypeId: z.string().min(1),
  days: z.array(z.number().int().min(0).max(6)).min(1, 'Pilih minimal satu hari'),
  start: hhmm,
  end: hhmm,
  pricePerHour: z.number().int().min(0),
  priority: z.number().int(),
  active: z.boolean(),
};
const createSchema = z.object({ ...fields, priority: fields.priority.default(0), active: fields.active.default(true) });
const patchSchema = z.object(fields).partial();
const idParam = z.object({ id: z.string().min(1) });

function parseTimes(start: string, end: string): { startMin: number; endMin: number } {
  let s: number;
  let e: number;
  try {
    s = parseHHMM(start);
    e = parseHHMM(end);
  } catch {
    throw badRequest('INVALID_TIME', 'Format jam harus HH:MM');
  }
  if (s >= MINUTES_PER_DAY) throw badRequest('INVALID_TIME', 'Jam mulai maksimal 23:59');
  if (e === 0) e = MINUTES_PER_DAY;
  if (s === e) throw badRequest('INVALID_TIME', 'Jam mulai dan selesai tidak boleh sama (pakai 00:00–24:00 untuk sepanjang hari)');
  return { startMin: s, endMin: e };
}

export function tariffsRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const owner = { preHandler: requireRole('OWNER') };

    app.get('/tariffs', { preHandler: requireAuth }, async () =>
      (await ctx.prisma.tariff.findMany({ orderBy: [{ unitTypeId: 'asc' }, { startMin: 'asc' }] })).map(toTariffDto),
    );

    app.post('/tariffs', owner, async (req) => {
      const b = createSchema.parse(req.body);
      const t = await ctx.prisma.tariff.create({
        data: {
          name: b.name, unitTypeId: b.unitTypeId, daysMask: daysToMask(b.days), ...parseTimes(b.start, b.end),
          pricePerHour: b.pricePerHour, priority: b.priority, active: b.active,
        },
      });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'tariff.create', entity: 'Tariff', entityId: t.id });
      ctx.bus.emit('board.changed');
      return toTariffDto(t);
    });

    app.patch('/tariffs/:id', owner, async (req) => {
      const { id } = idParam.parse(req.params);
      const b = patchSchema.parse(req.body);
      const cur = await ctx.prisma.tariff.findUnique({ where: { id } });
      if (!cur) throw notFound('Tarif');
      const times = b.start !== undefined || b.end !== undefined ? parseTimes(b.start ?? formatHHMM(cur.startMin), b.end ?? formatHHMM(cur.endMin)) : {};
      const t = await ctx.prisma.tariff.update({
        where: { id },
        data: {
          name: b.name, unitTypeId: b.unitTypeId, pricePerHour: b.pricePerHour, priority: b.priority, active: b.active,
          daysMask: b.days ? daysToMask(b.days) : undefined,
          ...times,
        },
      });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'tariff.update', entity: 'Tariff', entityId: id, data: b });
      ctx.bus.emit('board.changed');
      return toTariffDto(t);
    });

    app.delete('/tariffs/:id', owner, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await ctx.prisma.tariff.delete({ where: { id } });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'tariff.delete', entity: 'Tariff', entityId: id });
      ctx.bus.emit('board.changed');
      return reply.status(204).send();
    });
  };
}
```

`apps/server/src/modules/catalog/packages.routes.ts`:
```ts
import type { Package } from '@prisma/client';
import type { PackageDto } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { audit } from '../audit/audit';
import { requireAuth, requireRole } from '../auth/guard';

const fields = {
  name: z.string().trim().min(1).max(40),
  unitTypeId: z.string().min(1),
  durationMin: z.number().int().min(1).max(1440),
  price: z.number().int().min(0),
  active: z.boolean(),
};
const createSchema = z.object({ ...fields, active: fields.active.default(true) });
const patchSchema = z.object(fields).partial();
const idParam = z.object({ id: z.string().min(1) });

const toDto = (p: Package): PackageDto => ({ id: p.id, name: p.name, unitTypeId: p.unitTypeId, durationMin: p.durationMin, price: p.price, active: p.active });

export function packagesRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const owner = { preHandler: requireRole('OWNER') };

    app.get('/packages', { preHandler: requireAuth }, async () =>
      (await ctx.prisma.package.findMany({ orderBy: [{ unitTypeId: 'asc' }, { durationMin: 'asc' }] })).map(toDto),
    );

    app.post('/packages', owner, async (req) => {
      const p = await ctx.prisma.package.create({ data: createSchema.parse(req.body) });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'package.create', entity: 'Package', entityId: p.id });
      ctx.bus.emit('board.changed');
      return toDto(p);
    });

    app.patch('/packages/:id', owner, async (req) => {
      const { id } = idParam.parse(req.params);
      const p = await ctx.prisma.package.update({ where: { id }, data: patchSchema.parse(req.body) });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'package.update', entity: 'Package', entityId: id });
      ctx.bus.emit('board.changed');
      return toDto(p);
    });

    app.delete('/packages/:id', owner, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await ctx.prisma.package.delete({ where: { id } });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'package.delete', entity: 'Package', entityId: id });
      ctx.bus.emit('board.changed');
      return reply.status(204).send();
    });
  };
}
```

Ubah `apps/server/src/app.ts` — di plugin `/api` tambahkan:
```ts
import { packagesRoutes } from './modules/catalog/packages.routes';
import { tariffsRoutes } from './modules/catalog/tariffs.routes';
import { unitTypesRoutes } from './modules/catalog/unit-types.routes';
import { unitsRoutes } from './modules/catalog/units.routes';
// ...
      await api.register(unitTypesRoutes(ctx));
      await api.register(unitsRoutes(ctx));
      await api.register(tariffsRoutes(ctx));
      await api.register(packagesRoutes(ctx));
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter @funplay/server test && pnpm --filter @funplay/server typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): unit types, units, tariffs and packages API"
```

---

### Task 9: Lapisan device — driver, simulator, `DeviceManager`

**Files:**
- Create: `apps/server/src/modules/devices/driver.ts`, `simulator.driver.ts`, `desired.ts`, `device-manager.ts`
- Create: `apps/server/src/lib/alerts.ts`, `apps/server/src/lib/timeout.ts`
- Modify: `apps/server/test/helpers.ts`
- Test: `apps/server/test/device-manager.test.ts`

**Interfaces:**
- Consumes: `Bus`, `Clock`, `getSettings` (Task 5, 7); `AlertEvent`, `DeviceStatusView`, `SessionStatus` (shared).
- Produces:
  - `interface DriverEvents { online: []; offline: []; state: [relays: boolean[]] }`
  - `interface DeviceDriver extends EventEmitter<DriverEvents> { readonly channels: number; start(): Promise<void>; stop(): Promise<void>; isOnline(): boolean; setRelay(channel: number, on: boolean): Promise<void>; readAll?(): Promise<boolean[]> }`
  - `interface DeviceConfigRow { id; name; driver; channels; host: string|null; port: number|null; codec: string|null; config: unknown }`, `type DriverFactory = (row: DeviceConfigRow) => DeviceDriver`, `createDefaultDriverFactory(): DriverFactory`
  - `class SimulatorDriver implements DeviceDriver` + `setOnline(v)`, `physicalSet(channel, on)`, `powerCycle()`, `snapshot(): boolean[]`, `failNext: number`
  - `desiredLight(override: boolean | null, sessionStatus: SessionStatus | null, pauseKeepsLightOn: boolean): boolean`
  - `emitAlert(bus, clock, a: Omit<AlertEvent, 'id' | 'at'>): AlertEvent`, `withTimeout(p, ms)`
  - `class DeviceManager` — `constructor(deps: { prisma; clock; bus; driverFactory; log })`; `start({ loop }): Promise<void>`; `stop()`; `reload(deviceId)`; `getDriver(deviceId)`; `status(): DeviceStatusView[]`; `light(deviceId, channel): boolean | null`; `online(deviceId): boolean | null`; `applyUnit(unitId): Promise<void>`; `reconcile(deviceId): Promise<void>`; `reconcileAll(): Promise<void>`. Otomatis `reconcileAll()` saat bus `board.changed`.
  - `RECONCILE_INTERVAL_MS = 10_000`, `COMMAND_TIMEOUT_MS = 3_000`
  - test helper `seedBasics()` → `{ reg, vip, device (Sim A, 4 ch), m1 (Meja 1, reg, ch1), m2 (Meja 2, reg, ch2), v1 (VIP 1, vip, ch3), pkg1 (Paket 1 Jam, 60 mnt, 45.000), pkg2 (Paket 2 Jam, 120 mnt, 90.000) }` + tarif Reguler Siang 08–18 40.000, Reguler Malam 18–08 50.000, VIP 00–24 80.000.

**Aturan rekonsiliasi (spec §5.3–5.4):** tiap channel 1..N punya *desired state* (dari `desiredLight`; channel tanpa meja = OFF). Perintah dikirim hanya bila state aktual ≠ desired (atau state aktual tak diketahui dan belum pernah di-ACK dengan nilai itu). **Menyala tanpa sesi** = aktual ON, desired OFF, dan perintah terakhir yang berhasil untuk channel itu adalah OFF → `DeviceEvent UNEXPECTED_ON` + alert sekali; hanya dimatikan bila `autoOffUnexpected`. Perintah gagal → `FAIL` + alert `DEVICE_CMD_FAILED`; dicoba lagi oleh rekonsiliasi berikutnya. Rekonsiliasi per device diserialkan (antrian promise).

- [ ] **Step 1: Tambah helper `seedBasics`**

Tambahkan ke `apps/server/test/helpers.ts`:
```ts
export async function seedBasics() {
  await prisma.setting.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  const reg = await prisma.unitType.create({ data: { name: 'Reguler' } });
  const vip = await prisma.unitType.create({ data: { name: 'VIP' } });
  const device = await prisma.device.create({ data: { name: 'Sim A', driver: 'simulator', channels: 4 } });
  const m1 = await prisma.unit.create({ data: { name: 'Meja 1', unitTypeId: reg.id, deviceId: device.id, relayChannel: 1, sortOrder: 1 } });
  const m2 = await prisma.unit.create({ data: { name: 'Meja 2', unitTypeId: reg.id, deviceId: device.id, relayChannel: 2, sortOrder: 2 } });
  const v1 = await prisma.unit.create({ data: { name: 'VIP 1', unitTypeId: vip.id, deviceId: device.id, relayChannel: 3, sortOrder: 3 } });
  await prisma.tariff.createMany({
    data: [
      { name: 'Reguler Siang', unitTypeId: reg.id, startMin: 480, endMin: 1080, pricePerHour: 40000 },
      { name: 'Reguler Malam', unitTypeId: reg.id, startMin: 1080, endMin: 480, pricePerHour: 50000 },
      { name: 'VIP', unitTypeId: vip.id, startMin: 0, endMin: 1440, pricePerHour: 80000 },
    ],
  });
  const pkg1 = await prisma.package.create({ data: { name: 'Paket 1 Jam', unitTypeId: reg.id, durationMin: 60, price: 45000 } });
  const pkg2 = await prisma.package.create({ data: { name: 'Paket 2 Jam', unitTypeId: reg.id, durationMin: 120, price: 90000 } });
  return { reg, vip, device, m1, m2, v1, pkg1, pkg2 };
}
```

- [ ] **Step 2: Tulis test yang gagal**

`apps/server/test/device-manager.test.ts`:
```ts
import type { AlertEvent } from '@funplay/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bus } from '../src/lib/bus';
import { FakeClock } from '../src/lib/clock';
import { desiredLight } from '../src/modules/devices/desired';
import { DeviceManager } from '../src/modules/devices/device-manager';
import { SimulatorDriver } from '../src/modules/devices/simulator.driver';
import { prisma, resetDb, seedBasics, T0 } from './helpers';

describe('desiredLight', () => {
  it('override menang atas sesi', () => {
    expect(desiredLight(true, null, true)).toBe(true);
    expect(desiredLight(false, 'RUNNING', true)).toBe(false);
  });
  it('mengikuti status sesi', () => {
    expect(desiredLight(null, 'RUNNING', true)).toBe(true);
    expect(desiredLight(null, 'PAUSED', true)).toBe(true);
    expect(desiredLight(null, 'PAUSED', false)).toBe(false);
    expect(desiredLight(null, 'EXPIRED', true)).toBe(false);
    expect(desiredLight(null, null, true)).toBe(false);
  });
});

describe('DeviceManager', () => {
  let bus: Bus;
  let manager: DeviceManager;
  let sim: SimulatorDriver;
  let alerts: AlertEvent[];
  let basics: Awaited<ReturnType<typeof seedBasics>>;

  beforeEach(async () => {
    await resetDb();
    basics = await seedBasics();
    bus = new Bus();
    alerts = [];
    bus.on('alert', (a) => alerts.push(a));
    manager = new DeviceManager({
      prisma,
      clock: new FakeClock(T0),
      bus,
      driverFactory: (row) => (sim = new SimulatorDriver(row.channels)),
      log: { warn: () => {} },
    });
    await manager.start({ loop: false });
    await manager.reconcileAll();
  });
  afterEach(() => manager.stop());

  it('menandai device online di DB saat start', async () => {
    await vi.waitFor(async () => {
      expect((await prisma.device.findUniqueOrThrow({ where: { id: basics.device.id } })).online).toBe(true);
      expect(await prisma.deviceEvent.count({ where: { type: 'ONLINE' } })).toBe(1);
    });
    expect(manager.status()[0]).toMatchObject({ id: basics.device.id, online: true, relays: [false, false, false, false] });
  });

  it('applyUnit menyalakan relay sesuai override dan mencatat CMD_ON + ACK', async () => {
    await prisma.unit.update({ where: { id: basics.m1.id }, data: { lightOverride: true } });
    await manager.applyUnit(basics.m1.id);
    expect(sim.snapshot()).toEqual([true, false, false, false]);
    expect(manager.light(basics.device.id, 1)).toBe(true);
    const types = (await prisma.deviceEvent.findMany({ where: { channel: 1 } })).map((e) => e.type).sort();
    expect(types).toEqual(['ACK', 'CMD_ON']);
  });

  it('device offline → alert DEVICE_OFFLINE dan DB online=false', async () => {
    sim.setOnline(false);
    await vi.waitFor(() => expect(alerts.map((a) => a.type)).toContain('DEVICE_OFFLINE'));
    await vi.waitFor(async () => expect((await prisma.device.findUniqueOrThrow({ where: { id: basics.device.id } })).online).toBe(false));
  });

  it('saat tersambung kembali, state yang benar dikirim ulang', async () => {
    sim.powerCycle();
    await prisma.unit.update({ where: { id: basics.m1.id }, data: { lightOverride: true } });
    await manager.applyUnit(basics.m1.id);
    expect(sim.snapshot()[0]).toBe(false);
    sim.setOnline(true);
    await vi.waitFor(() => expect(sim.snapshot()[0]).toBe(true));
    expect(alerts.map((a) => a.type)).toContain('DEVICE_ONLINE');
  });

  it('relay dinyalakan manual tanpa sesi → UNEXPECTED_ON, tidak dimatikan bila autoOff=false', async () => {
    sim.physicalSet(2, true);
    await vi.waitFor(() => expect(alerts.map((a) => a.type)).toContain('UNEXPECTED_ON'));
    expect(alerts.find((a) => a.type === 'UNEXPECTED_ON')).toMatchObject({ unitId: basics.m2.id, level: 'danger' });
    expect(sim.snapshot()[1]).toBe(true);
    expect(await prisma.deviceEvent.count({ where: { type: 'UNEXPECTED_ON' } })).toBe(1);

    await prisma.setting.update({ where: { id: 1 }, data: { autoOffUnexpected: true } });
    await manager.reconcileAll();
    expect(sim.snapshot()[1]).toBe(false);
  });

  it('perintah gagal → FAIL + alert, lalu berhasil di rekonsiliasi berikutnya', async () => {
    sim.failNext = 1;
    await prisma.unit.update({ where: { id: basics.m1.id }, data: { lightOverride: true } });
    await manager.applyUnit(basics.m1.id);
    expect(sim.snapshot()[0]).toBe(false);
    expect(alerts.map((a) => a.type)).toContain('DEVICE_CMD_FAILED');
    expect(await prisma.deviceEvent.count({ where: { type: 'FAIL' } })).toBe(1);
    await manager.reconcileAll();
    expect(sim.snapshot()[0]).toBe(true);
  });

  it('board.changed memicu rekonsiliasi', async () => {
    await prisma.unit.update({ where: { id: basics.v1.id }, data: { lightOverride: true } });
    bus.emit('board.changed');
    await vi.waitFor(() => expect(sim.snapshot()[2]).toBe(true));
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- device-manager`
Expected: FAIL — modul `../src/modules/devices/...` tidak ditemukan.

- [ ] **Step 4: Implementasi util**

`apps/server/src/lib/timeout.ts`:
```ts
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
```

`apps/server/src/lib/alerts.ts`:
```ts
import { randomUUID } from 'node:crypto';
import type { AlertEvent } from '@funplay/shared';
import type { Bus } from './bus';
import type { Clock } from './clock';

export function emitAlert(bus: Bus, clock: Clock, a: Omit<AlertEvent, 'id' | 'at'>): AlertEvent {
  const ev: AlertEvent = { id: randomUUID(), at: clock.now().toISOString(), ...a };
  bus.emit('alert', ev);
  return ev;
}
```

- [ ] **Step 5: Implementasi driver & simulator**

`apps/server/src/modules/devices/driver.ts`:
```ts
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
```

`apps/server/src/modules/devices/simulator.driver.ts`:
```ts
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
```

`apps/server/src/modules/devices/desired.ts`:
```ts
import type { SessionStatus } from '@funplay/shared';

export function desiredLight(override: boolean | null, sessionStatus: SessionStatus | null, pauseKeepsLightOn: boolean): boolean {
  if (override !== null) return override;
  switch (sessionStatus) {
    case 'RUNNING':
      return true;
    case 'PAUSED':
      return pauseKeepsLightOn;
    default:
      return false;
  }
}
```

- [ ] **Step 6: Implementasi `DeviceManager`**

`apps/server/src/modules/devices/device-manager.ts`:
```ts
import type { Device, PrismaClient } from '@prisma/client';
import type { DeviceStatusView } from '@funplay/shared';
import { emitAlert } from '../../lib/alerts';
import type { Bus } from '../../lib/bus';
import type { Clock } from '../../lib/clock';
import { withTimeout } from '../../lib/timeout';
import { getSettings } from '../settings/settings.service';
import { desiredLight } from './desired';
import type { DeviceConfigRow, DeviceDriver, DriverFactory } from './driver';

export const RECONCILE_INTERVAL_MS = 10_000;
export const COMMAND_TIMEOUT_MS = 3_000;

export interface DeviceManagerDeps {
  prisma: PrismaClient;
  clock: Clock;
  bus: Bus;
  driverFactory: DriverFactory;
  log: { warn: (obj: unknown, msg?: string) => void };
}

interface Entry {
  row: DeviceConfigRow;
  driver: DeviceDriver;
  actual: boolean[] | null;
  /** Nilai terakhir yang berhasil di-ACK / dikonfirmasi per channel. */
  acked: Map<number, boolean>;
  alertedUnexpected: Set<number>;
  wasOnline: boolean;
  queue: Promise<void>;
}

interface ChannelPlan {
  channel: number;
  on: boolean;
  unitId: string | null;
  unitName: string | null;
}

const toRow = (d: Device): DeviceConfigRow => ({
  id: d.id, name: d.name, driver: d.driver, channels: d.channels, host: d.host, port: d.port, codec: d.codec, config: d.config,
});

export class DeviceManager {
  private entries = new Map<string, Entry>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: DeviceManagerDeps) {
    deps.bus.on('board.changed', () => void this.reconcileAll());
  }

  async start(opts: { loop: boolean }): Promise<void> {
    const rows = await this.deps.prisma.device.findMany();
    for (const row of rows) await this.attach(toRow(row));
    if (opts.loop) this.timer = setInterval(() => void this.reconcileAll(), RECONCILE_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const id of [...this.entries.keys()]) await this.detach(id);
  }

  async reload(deviceId: string): Promise<void> {
    await this.detach(deviceId);
    const row = await this.deps.prisma.device.findUnique({ where: { id: deviceId } });
    if (row) await this.attach(toRow(row));
    this.deps.bus.emit('board.changed');
  }

  getDriver(deviceId: string): DeviceDriver | undefined {
    return this.entries.get(deviceId)?.driver;
  }

  status(): DeviceStatusView[] {
    return [...this.entries.values()].map((e) => this.view(e));
  }

  light(deviceId: string | null, channel: number | null): boolean | null {
    if (!deviceId || channel === null) return null;
    const e = this.entries.get(deviceId);
    if (!e || !e.driver.isOnline()) return null;
    return e.actual?.[channel - 1] ?? e.acked.get(channel) ?? null;
  }

  online(deviceId: string | null): boolean | null {
    if (!deviceId) return null;
    return this.entries.get(deviceId)?.driver.isOnline() ?? false;
  }

  async applyUnit(unitId: string): Promise<void> {
    const unit = await this.deps.prisma.unit.findUnique({ where: { id: unitId }, select: { deviceId: true } });
    if (unit?.deviceId) await this.reconcile(unit.deviceId);
  }

  async reconcileAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.reconcile(id)));
  }

  reconcile(deviceId: string): Promise<void> {
    const e = this.entries.get(deviceId);
    if (!e) return Promise.resolve();
    e.queue = e.queue.then(() => this.doReconcile(e)).catch((err: unknown) => this.deps.log.warn({ err }, 'rekonsiliasi device gagal'));
    return e.queue;
  }

  // ---------- internal ----------

  private async attach(row: DeviceConfigRow): Promise<void> {
    let driver: DeviceDriver;
    try {
      driver = this.deps.driverFactory(row);
    } catch (err) {
      this.deps.log.warn({ err, device: row.name }, 'driver device tidak bisa dibuat');
      return;
    }
    const entry: Entry = { row, driver, actual: null, acked: new Map(), alertedUnexpected: new Set(), wasOnline: false, queue: Promise.resolve() };
    this.entries.set(row.id, entry);
    await this.deps.prisma.device.update({ where: { id: row.id }, data: { online: false } });
    // Handler async dipanggil tanpa await; tangkap error agar tidak jadi unhandled rejection.
    const safe = (p: Promise<void>) => p.catch((err: unknown) => this.deps.log.warn({ err, device: row.name }, 'event device gagal diproses'));
    driver.on('online', () => void safe(this.onOnline(entry)));
    driver.on('offline', () => void safe(this.onOffline(entry)));
    driver.on('state', (relays) => void safe(this.onState(entry, relays)));
    try {
      await driver.start();
    } catch (err) {
      this.deps.log.warn({ err, device: row.name }, 'device gagal start');
    }
  }

  private async detach(deviceId: string): Promise<void> {
    const e = this.entries.get(deviceId);
    if (!e) return;
    this.entries.delete(deviceId);
    e.driver.removeAllListeners();
    await e.driver.stop().catch(() => undefined);
  }

  private view(e: Entry): DeviceStatusView {
    return {
      id: e.row.id, name: e.row.name, driver: e.row.driver, channels: e.row.channels,
      online: e.driver.isOnline(), relays: e.actual ? [...e.actual] : null, lastSeenAt: null,
    };
  }

  private async changed(e: Entry): Promise<void> {
    this.deps.bus.emit('device.changed', this.view(e));
    const units = await this.deps.prisma.unit.findMany({ where: { deviceId: e.row.id }, select: { id: true } });
    for (const u of units) this.deps.bus.emit('unit.changed', u.id);
  }

  private async onOnline(e: Entry): Promise<void> {
    e.acked.clear();
    const { prisma, bus, clock } = this.deps;
    await prisma.device.update({ where: { id: e.row.id }, data: { online: true, lastSeenAt: clock.now() } });
    await prisma.deviceEvent.create({ data: { deviceId: e.row.id, type: 'ONLINE' } });
    if (e.wasOnline) emitAlert(bus, clock, { level: 'info', type: 'DEVICE_ONLINE', unitId: null, message: `Device ${e.row.name} tersambung kembali` });
    e.wasOnline = true;
    await this.reconcile(e.row.id);
    await this.changed(e);
  }

  private async onOffline(e: Entry): Promise<void> {
    e.actual = null;
    const { prisma, bus, clock } = this.deps;
    await prisma.device.update({ where: { id: e.row.id }, data: { online: false } });
    await prisma.deviceEvent.create({ data: { deviceId: e.row.id, type: 'OFFLINE' } });
    emitAlert(bus, clock, { level: 'danger', type: 'DEVICE_OFFLINE', unitId: null, message: `Device ${e.row.name} terputus` });
    await this.changed(e);
  }

  private async onState(e: Entry, relays: boolean[]): Promise<void> {
    e.actual = relays;
    await this.deps.prisma.device.update({ where: { id: e.row.id }, data: { lastSeenAt: this.deps.clock.now() } });
    await this.reconcile(e.row.id);
    await this.changed(e);
  }

  private async plan(deviceId: string, channels: number, pauseKeepsLightOn: boolean): Promise<ChannelPlan[]> {
    const units = await this.deps.prisma.unit.findMany({
      where: { deviceId },
      select: { id: true, name: true, relayChannel: true, lightOverride: true, activeSession: { select: { status: true } } },
    });
    const plans: ChannelPlan[] = [];
    for (let ch = 1; ch <= channels; ch++) {
      const u = units.find((x) => x.relayChannel === ch);
      plans.push({
        channel: ch,
        unitId: u?.id ?? null,
        unitName: u?.name ?? null,
        on: u ? desiredLight(u.lightOverride, u.activeSession?.status ?? null, pauseKeepsLightOn) : false,
      });
    }
    return plans;
  }

  private async doReconcile(e: Entry): Promise<void> {
    if (!e.driver.isOnline()) return;
    if (e.driver.readAll) {
      try {
        e.actual = await withTimeout(e.driver.readAll(), COMMAND_TIMEOUT_MS);
      } catch {
        // pakai state terakhir yang diketahui
      }
    }
    const settings = await getSettings(this.deps.prisma);
    const plans = await this.plan(e.row.id, e.row.channels, settings.pauseKeepsLightOn);
    for (const p of plans) {
      const cur = e.actual ? (e.actual[p.channel - 1] ?? null) : null;
      if (cur === p.on) {
        e.acked.set(p.channel, cur);
        e.alertedUnexpected.delete(p.channel);
        continue;
      }
      if (cur === null && e.acked.get(p.channel) === p.on) continue;
      if (cur === true && !p.on && e.acked.get(p.channel) === false) {
        await this.flagUnexpected(e, p);
        if (!settings.autoOffUnexpected) continue;
      }
      await this.send(e, p);
    }
  }

  private async flagUnexpected(e: Entry, p: ChannelPlan): Promise<void> {
    if (e.alertedUnexpected.has(p.channel)) return;
    e.alertedUnexpected.add(p.channel);
    await this.deps.prisma.deviceEvent.create({ data: { deviceId: e.row.id, channel: p.channel, type: 'UNEXPECTED_ON' } });
    emitAlert(this.deps.bus, this.deps.clock, {
      level: 'danger',
      type: 'UNEXPECTED_ON',
      unitId: p.unitId,
      message: `${p.unitName ?? `Channel ${p.channel}`}: lampu menyala tanpa sesi`,
    });
  }

  private async send(e: Entry, p: ChannelPlan): Promise<void> {
    const { prisma, bus, clock } = this.deps;
    await prisma.deviceEvent.create({ data: { deviceId: e.row.id, channel: p.channel, type: p.on ? 'CMD_ON' : 'CMD_OFF' } });
    try {
      await withTimeout(e.driver.setRelay(p.channel, p.on), COMMAND_TIMEOUT_MS);
      e.acked.set(p.channel, p.on);
      if (e.actual) e.actual[p.channel - 1] = p.on;
      await prisma.deviceEvent.create({ data: { deviceId: e.row.id, channel: p.channel, type: 'ACK' } });
    } catch (err) {
      await prisma.deviceEvent.create({ data: { deviceId: e.row.id, channel: p.channel, type: 'FAIL', detail: { on: p.on, error: String(err) } } });
      emitAlert(bus, clock, {
        level: 'warning',
        type: 'DEVICE_CMD_FAILED',
        unitId: p.unitId,
        message: `Lampu ${p.unitName ?? `channel ${p.channel}`} belum merespons`,
      });
    }
  }
}
```

- [ ] **Step 7: Jalankan test, pastikan lulus**

Run: `pnpm --filter @funplay/server test && pnpm --filter @funplay/server typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/server
git commit -m "feat(server): device driver interface, simulator and reconciling DeviceManager"
```

---

### Task 10: API device, override lampu, snapshot board, wiring `DeviceManager`

**Files:**
- Create: `apps/server/src/modules/devices/devices.routes.ts`, `apps/server/src/modules/board/board.ts`
- Modify: `apps/server/src/context.ts`, `apps/server/src/app.ts`, `apps/server/test/helpers.ts`
- Test: `apps/server/test/devices.test.ts`

**Interfaces:**
- Consumes: Task 6–9.
- Produces:
  - `AppContext.devices: DeviceManager`; `BuildAppDeps.driverFactory?: DriverFactory`
  - `unitInclude` (Prisma include untuk meja + sesi aktif + segmen + pause), `toSessionView(s): SessionView`, `toUnitView(u, devices): UnitView`, `buildUnitView(ctx, unitId): Promise<UnitView | null>`, `buildBoard(ctx): Promise<BoardSnapshot>`
  - `GET /api/board` (login) → `BoardSnapshot`
  - `GET /api/devices` (login) → `DeviceDto[]`; `POST /api/devices`, `PATCH /api/devices/:id`, `DELETE /api/devices/:id` (OWNER) — body `{ name, driver: 'simulator', channels (1..32, default 8), host?, port?, codec? }`
  - `POST /api/units/:id/light` (login) — body `{ mode: 'ON' | 'OFF' | 'AUTO', reason (≥3 karakter), approvalPin? }` → `{ unit: UnitView }`; 400 `NO_DEVICE`
  - `POST /api/devices/:id/simulate` (SUPERVISOR/OWNER) — body `{ action: 'set', channel, on } | { action: 'online', online }` → 204; 400 `NOT_SIMULATOR`
  - test helper `makeApp()` kini mengembalikan juga `sims: Map<deviceId, SimulatorDriver>`

- [ ] **Step 1: Perbarui `makeApp`**

Ganti fungsi `makeApp` di `apps/server/test/helpers.ts` (tambahkan import yang dibutuhkan di atas file):
```ts
import type { DriverFactory } from '../src/modules/devices/driver';
import { SimulatorDriver } from '../src/modules/devices/simulator.driver';

export async function makeApp(opts: { now?: Date; configure?: (app: FastifyInstance) => void } = {}) {
  const clock = new FakeClock(opts.now ?? T0);
  const sims = new Map<string, SimulatorDriver>();
  const driverFactory: DriverFactory = (row) => {
    const s = new SimulatorDriver(row.channels);
    sims.set(row.id, s);
    return s;
  };
  const { app, ctx } = await buildApp({ prisma, clock, config: loadConfig(), driverFactory, startLoops: false });
  opts.configure?.(app);
  await app.ready();
  await ctx.devices.reconcileAll();
  return { app, ctx, clock, sims };
}
```

- [ ] **Step 2: Tulis test yang gagal**

`apps/server/test/devices.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginAs, makeApp, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let users: Awaited<ReturnType<typeof seedUsers>>;

beforeEach(async () => {
  await resetDb();
  users = await seedUsers();
  b = await seedBasics();
  t = await makeApp();
});
afterEach(() => t.app.close());

const sim = () => t.sims.get(b.device.id)!;

describe('devices API', () => {
  it('owner membuat device simulator yang langsung online', async () => {
    const cookie = await loginAs(t.app, 'owner');
    const res = await t.app.inject({ method: 'POST', url: '/api/devices', headers: { cookie }, payload: { name: 'Sim B', driver: 'simulator', channels: 8 } });
    expect(res.statusCode).toBe(200);
    const id = res.json().id as string;
    await vi.waitFor(async () => {
      const list = (await t.app.inject({ method: 'GET', url: '/api/devices', headers: { cookie } })).json();
      expect(list.find((d: { id: string }) => d.id === id)).toMatchObject({ name: 'Sim B', channels: 8, online: true });
    });
  });

  it('device yang masih dipetakan ke meja tidak bisa dihapus', async () => {
    const cookie = await loginAs(t.app, 'owner');
    const res = await t.app.inject({ method: 'DELETE', url: `/api/devices/${b.device.id}`, headers: { cookie } });
    expect(res.statusCode).toBe(409);
  });

  it('channel tidak bisa dikurangi di bawah channel yang dipakai', async () => {
    const cookie = await loginAs(t.app, 'owner');
    const res = await t.app.inject({ method: 'PATCH', url: `/api/devices/${b.device.id}`, headers: { cookie }, payload: { channels: 2 } });
    expect(res.json().error.code).toBe('CHANNEL_OUT_OF_RANGE');
  });
});

describe('override lampu', () => {
  it('kasir tanpa PIN ditolak', async () => {
    const cookie = await loginAs(t.app, 'kasir');
    const res = await t.app.inject({ method: 'POST', url: `/api/units/${b.m1.id}/light`, headers: { cookie }, payload: { mode: 'ON', reason: 'bersih-bersih' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('APPROVAL_REQUIRED');
  });

  it('kasir dengan PIN supervisor menyalakan lampu dan tercatat di audit', async () => {
    const cookie = await loginAs(t.app, 'kasir');
    const res = await t.app.inject({
      method: 'POST', url: `/api/units/${b.m1.id}/light`, headers: { cookie },
      payload: { mode: 'ON', reason: 'bersih-bersih', approvalPin: '1111' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().unit).toMatchObject({ id: b.m1.id, lightOverride: true });
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(true));
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'device.override' } });
    expect(log).toMatchObject({ userId: users.kasir.id, approvedById: users.supervisor.id, entityId: b.m1.id });

    const auto = await t.app.inject({
      method: 'POST', url: `/api/units/${b.m1.id}/light`, headers: { cookie },
      payload: { mode: 'AUTO', reason: 'selesai', approvalPin: '1111' },
    });
    expect(auto.json().unit.lightOverride).toBeNull();
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(false));
  });
});

describe('simulate', () => {
  it('supervisor bisa memencet relay virtual, kasir tidak', async () => {
    const sup = await loginAs(t.app, 'supervisor');
    const ok = await t.app.inject({ method: 'POST', url: `/api/devices/${b.device.id}/simulate`, headers: { cookie: sup }, payload: { action: 'set', channel: 4, on: true } });
    expect(ok.statusCode).toBe(204);
    expect(sim().snapshot()[3]).toBe(true);
    const kasir = await loginAs(t.app, 'kasir');
    const no = await t.app.inject({ method: 'POST', url: `/api/devices/${b.device.id}/simulate`, headers: { cookie: kasir }, payload: { action: 'online', online: false } });
    expect(no.statusCode).toBe(403);
  });
});

describe('GET /api/board', () => {
  it('mengembalikan snapshot lengkap', async () => {
    const cookie = await loginAs(t.app, 'kasir');
    const res = await t.app.inject({ method: 'GET', url: '/api/board', headers: { cookie } });
    const board = res.json();
    expect(board.serverTime).toBe('2026-10-01T03:00:00.000Z');
    expect(board.settings.outletType).toBe('BILLIARD');
    expect(board.tariffs).toHaveLength(3);
    expect(board.units.map((u: { name: string }) => u.name)).toEqual(['Meja 1', 'Meja 2', 'VIP 1']);
    expect(board.units[0]).toMatchObject({ unitTypeName: 'Reguler', light: false, deviceOnline: true, session: null });
    expect(board.devices[0]).toMatchObject({ id: b.device.id, online: true, relays: [false, false, false, false] });
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- devices`
Expected: FAIL — `buildApp` belum menerima `driverFactory` / `ctx.devices` undefined.

- [ ] **Step 4: Implementasi board**

`apps/server/src/modules/board/board.ts`:
```ts
import { Prisma } from '@prisma/client';
import type { BoardSnapshot, SessionView, UnitView } from '@funplay/shared';
import type { AppContext } from '../../context';
import { loadTariffRules } from '../catalog/tariffs.service';
import type { DeviceManager } from '../devices/device-manager';
import { getSettings } from '../settings/settings.service';

export const unitInclude = Prisma.validator<Prisma.UnitInclude>()({
  unitType: true,
  activeSession: {
    include: {
      segments: { orderBy: { startedAt: 'asc' } },
      pauses: { orderBy: { pausedAt: 'asc' } },
    },
  },
});

type UnitRow = Prisma.UnitGetPayload<{ include: typeof unitInclude }>;
type SessionRow = NonNullable<UnitRow['activeSession']>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toSessionView(s: SessionRow): SessionView {
  return {
    id: s.id,
    billId: s.billId,
    mode: s.mode,
    status: s.status,
    startedAt: s.startedAt.toISOString(),
    plannedEndAt: iso(s.plannedEndAt),
    endedAt: iso(s.endedAt),
    packageName: s.packageName,
    packageDurationMin: s.packageDurationMin,
    packagePrice: s.packagePrice,
    segments: s.segments.map((g) => ({ unitId: g.unitId, unitTypeId: g.unitTypeId, startedAt: g.startedAt.toISOString(), endedAt: iso(g.endedAt) })),
    pauses: s.pauses.map((p) => ({ pausedAt: p.pausedAt.toISOString(), resumedAt: iso(p.resumedAt) })),
  };
}

export function toUnitView(u: UnitRow, devices: DeviceManager): UnitView {
  return {
    id: u.id,
    name: u.name,
    unitTypeId: u.unitTypeId,
    unitTypeName: u.unitType.name,
    unitTypeColor: u.unitType.color,
    area: u.area,
    deviceId: u.deviceId,
    relayChannel: u.relayChannel,
    state: u.state,
    sortOrder: u.sortOrder,
    lightOverride: u.lightOverride,
    light: devices.light(u.deviceId, u.relayChannel),
    deviceOnline: devices.online(u.deviceId),
    session: u.activeSession ? toSessionView(u.activeSession) : null,
  };
}

export async function buildUnitView(ctx: AppContext, unitId: string): Promise<UnitView | null> {
  const u = await ctx.prisma.unit.findUnique({ where: { id: unitId }, include: unitInclude });
  return u ? toUnitView(u, ctx.devices) : null;
}

export async function buildBoard(ctx: AppContext): Promise<BoardSnapshot> {
  const [settings, units, tariffs] = await Promise.all([
    getSettings(ctx.prisma),
    ctx.prisma.unit.findMany({ include: unitInclude, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    loadTariffRules(ctx.prisma),
  ]);
  return {
    serverTime: ctx.clock.now().toISOString(),
    settings,
    units: units.map((u) => toUnitView(u, ctx.devices)),
    devices: ctx.devices.status(),
    tariffs,
  };
}
```

- [ ] **Step 5: Implementasi rute device**

`apps/server/src/modules/devices/devices.routes.ts`:
```ts
import type { Device } from '@prisma/client';
import { DEVICE_DRIVERS, type DeviceDto } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { badRequest, notFound } from '../../lib/errors';
import { audit } from '../audit/audit';
import { approveWithPin } from '../auth/auth.service';
import { requireAuth, requireRole } from '../auth/guard';
import { buildBoard, buildUnitView } from '../board/board';
import { SimulatorDriver } from './simulator.driver';

const fields = {
  name: z.string().trim().min(1).max(40),
  driver: z.enum(DEVICE_DRIVERS),
  channels: z.number().int().min(1).max(32),
  host: z.string().trim().min(1).nullable(),
  port: z.number().int().min(1).max(65535).nullable(),
  codec: z.string().trim().min(1).nullable(),
};
const createSchema = z.object({
  ...fields,
  channels: fields.channels.default(8),
  host: fields.host.default(null),
  port: fields.port.default(null),
  codec: fields.codec.default(null),
});
const patchSchema = z.object(fields).partial();
const idParam = z.object({ id: z.string().min(1) });
const lightSchema = z.object({
  mode: z.enum(['ON', 'OFF', 'AUTO']),
  reason: z.string().trim().min(3, 'Alasan minimal 3 karakter').max(200),
  approvalPin: z.string().optional(),
});
const simulateSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set'), channel: z.number().int().min(1), on: z.boolean() }),
  z.object({ action: z.literal('online'), online: z.boolean() }),
]);

export function devicesRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const owner = { preHandler: requireRole('OWNER') };
    const toDto = (d: Device): DeviceDto => ({
      id: d.id, name: d.name, driver: d.driver, channels: d.channels, host: d.host, port: d.port, codec: d.codec,
      online: ctx.devices.online(d.id) ?? false, lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
    });

    app.get('/board', { preHandler: requireAuth }, async () => buildBoard(ctx));

    app.get('/devices', { preHandler: requireAuth }, async () =>
      (await ctx.prisma.device.findMany({ orderBy: { name: 'asc' } })).map(toDto),
    );

    app.post('/devices', owner, async (req) => {
      const d = await ctx.prisma.device.create({ data: createSchema.parse(req.body) });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'device.create', entity: 'Device', entityId: d.id });
      await ctx.devices.reload(d.id);
      return toDto(d);
    });

    app.patch('/devices/:id', owner, async (req) => {
      const { id } = idParam.parse(req.params);
      const b = patchSchema.parse(req.body);
      if (b.channels !== undefined) {
        const maxUsed = await ctx.prisma.unit.aggregate({ where: { deviceId: id }, _max: { relayChannel: true } });
        if ((maxUsed._max.relayChannel ?? 0) > b.channels) {
          throw badRequest('CHANNEL_OUT_OF_RANGE', `Channel ${maxUsed._max.relayChannel} masih dipakai meja`);
        }
      }
      const d = await ctx.prisma.device.update({ where: { id }, data: b });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'device.update', entity: 'Device', entityId: id, data: b });
      await ctx.devices.reload(id);
      return toDto(d);
    });

    app.delete('/devices/:id', owner, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await ctx.prisma.device.delete({ where: { id } });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'device.delete', entity: 'Device', entityId: id });
      await ctx.devices.reload(id);
      return reply.status(204).send();
    });

    app.post('/units/:id/light', { preHandler: requireAuth }, async (req) => {
      const { id } = idParam.parse(req.params);
      const b = lightSchema.parse(req.body);
      const approvedById = await approveWithPin(ctx.prisma, ctx.clock, req.user!, b.approvalPin);
      const unit = await ctx.prisma.unit.findUnique({ where: { id } });
      if (!unit) throw notFound('Meja');
      if (!unit.deviceId) throw badRequest('NO_DEVICE', `${unit.name} tidak terhubung ke device`);
      const lightOverride = b.mode === 'AUTO' ? null : b.mode === 'ON';
      await ctx.prisma.unit.update({ where: { id }, data: { lightOverride } });
      await audit(ctx.prisma, {
        userId: req.user!.id, action: 'device.override', entity: 'Unit', entityId: id,
        data: { mode: b.mode, reason: b.reason }, approvedById,
      });
      void ctx.devices.applyUnit(id);
      ctx.bus.emit('unit.changed', id);
      return { unit: await buildUnitView(ctx, id) };
    });

    app.post('/devices/:id/simulate', { preHandler: requireRole('SUPERVISOR', 'OWNER') }, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const b = simulateSchema.parse(req.body);
      const driver = ctx.devices.getDriver(id);
      if (!(driver instanceof SimulatorDriver)) throw badRequest('NOT_SIMULATOR', 'Device ini bukan simulator');
      if (b.action === 'set') driver.physicalSet(b.channel, b.on);
      else driver.setOnline(b.online);
      return reply.status(204).send();
    });
  };
}
```

- [ ] **Step 6: Wiring context & app**

`apps/server/src/context.ts` — tambahkan field:
```ts
import type { DeviceManager } from './modules/devices/device-manager';
// ...
export interface AppContext {
  prisma: PrismaClient;
  clock: Clock;
  config: Config;
  bus: Bus;
  devices: DeviceManager;
}
```

`apps/server/src/app.ts` (isi lengkap):
```ts
import cookie from '@fastify/cookie';
import type { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import type { Config } from './config';
import type { AppContext } from './context';
import { Bus } from './lib/bus';
import type { Clock } from './lib/clock';
import { registerErrorHandler } from './lib/errors';
import { authRoutes } from './modules/auth/auth.routes';
import { installAuth } from './modules/auth/guard';
import { packagesRoutes } from './modules/catalog/packages.routes';
import { tariffsRoutes } from './modules/catalog/tariffs.routes';
import { unitTypesRoutes } from './modules/catalog/unit-types.routes';
import { unitsRoutes } from './modules/catalog/units.routes';
import { DeviceManager } from './modules/devices/device-manager';
import { devicesRoutes } from './modules/devices/devices.routes';
import { createDefaultDriverFactory, type DriverFactory } from './modules/devices/driver';
import { settingsRoutes } from './modules/settings/settings.routes';
import { usersRoutes } from './modules/users/users.routes';

export interface BuildAppDeps {
  prisma: PrismaClient;
  clock: Clock;
  config: Config;
  driverFactory?: DriverFactory;
  /** false di test: loop rekonsiliasi & scheduler tidak dijalankan otomatis. */
  startLoops?: boolean;
}

export async function buildApp(deps: BuildAppDeps) {
  const startLoops = deps.startLoops ?? true;
  const app = Fastify({ logger: deps.config.NODE_ENV === 'test' ? false : { level: 'info' } });
  const bus = new Bus();
  const devices = new DeviceManager({
    prisma: deps.prisma,
    clock: deps.clock,
    bus,
    driverFactory: deps.driverFactory ?? createDefaultDriverFactory(),
    log: app.log,
  });
  const ctx: AppContext = { prisma: deps.prisma, clock: deps.clock, config: deps.config, bus, devices };

  registerErrorHandler(app);
  await app.register(cookie, { secret: deps.config.COOKIE_SECRET });
  installAuth(app, ctx);

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ ok: true, serverTime: ctx.clock.now().toISOString() }));
      await api.register(authRoutes(ctx));
      await api.register(settingsRoutes(ctx));
      await api.register(usersRoutes(ctx));
      await api.register(unitTypesRoutes(ctx));
      await api.register(unitsRoutes(ctx));
      await api.register(tariffsRoutes(ctx));
      await api.register(packagesRoutes(ctx));
      await api.register(devicesRoutes(ctx));
    },
    { prefix: '/api' },
  );

  await devices.start({ loop: startLoops });
  app.addHook('onClose', async () => {
    await devices.stop();
  });

  return { app, ctx };
}
```

- [ ] **Step 7: Jalankan test, pastikan lulus**

Run: `pnpm --filter @funplay/server test && pnpm --filter @funplay/server typecheck`
Expected: PASS (termasuk test Task 5–9).

- [ ] **Step 8: Commit**

```bash
git add apps/server
git commit -m "feat(server): devices API, light override, board snapshot, DeviceManager wiring"
```

---

### Task 11: Sesi — mulai & stop

**Files:**
- Create: `apps/server/src/modules/sessions/sessions.service.ts`, `apps/server/src/modules/sessions/sessions.routes.ts`
- Modify: `apps/server/src/context.ts`, `apps/server/src/app.ts`
- Test: `apps/server/test/sessions.test.ts`

**Interfaces:**
- Consumes: `computeSessionCharge`, `findTariff`, `addMinutes`, `localDateKey` (shared); `loadTariffRules`, `getSettings`, `audit`, `buildUnitView`, `DeviceManager.applyUnit`.
- Produces:
  - `class SessionService` — `constructor(ctx: AppContext)`; `start(user: PublicUser, input: { unitId: string; mode: SessionMode; packageId?: string }): Promise<Session>`; `stop(user: PublicUser, sessionId: string): Promise<{ session: Session; charge: TimeCharge }>` (Task 12 menambah `extend`, `move`, `pause`, `resume`)
  - `AppContext.sessions: SessionService`
  - `nextBillNumber(tx, now, utcOffsetMin): Promise<string>` → `FP-YYYYMMDD-NNNN` (tanggal lokal outlet)
  - `POST /api/sessions` `{ unitId, mode, packageId? }` → `{ unit: UnitView }`
  - `POST /api/sessions/:id/stop` → `{ unit: UnitView, charge: TimeCharge }`
  - Error: 404 `NOT_FOUND`, 409 `UNIT_BUSY`, 409 `UNIT_MAINTENANCE`, 400 `PACKAGE_REQUIRED`, 400 `PACKAGE_MISMATCH`, 422 `NO_TARIFF`, 409 `SESSION_ENDED`

**Catatan M1:** `stop` menutup sesi, menyimpan `chargeTotal` + `chargeDetail`, mematikan lampu, dan meja kembali kosong; `Bill` tetap `OPEN`. Di M2, aksi ini menjadi bagian dari checkout "Stop & Bayar".

- [ ] **Step 1: Tulis test yang gagal**

`apps/server/test/sessions.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginAs, makeApp, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  await seedUsers();
  b = await seedBasics();
  t = await makeApp();
  cookie = await loginAs(t.app, 'kasir');
});
afterEach(() => t.app.close());

const sim = () => t.sims.get(b.device.id)!;
const start = (payload: Record<string, unknown>) => t.app.inject({ method: 'POST', url: '/api/sessions', headers: { cookie }, payload });
const stop = (id: string) => t.app.inject({ method: 'POST', url: `/api/sessions/${id}/stop`, headers: { cookie }, payload: {} });

describe('mulai sesi', () => {
  it('open billing: sesi RUNNING, bill bernomor, lampu menyala', async () => {
    const res = await start({ unitId: b.m1.id, mode: 'OPEN' });
    expect(res.statusCode).toBe(200);
    const unit = res.json().unit;
    expect(unit.session).toMatchObject({ mode: 'OPEN', status: 'RUNNING', startedAt: '2026-10-01T03:00:00.000Z', plannedEndAt: null });
    expect(unit.session.segments).toHaveLength(1);
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: unit.session.billId } });
    expect(bill.number).toBe('FP-20261001-0001');
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(true));

    const second = await start({ unitId: b.m2.id, mode: 'OPEN' });
    const bill2 = await prisma.bill.findUniqueOrThrow({ where: { id: second.json().unit.session.billId } });
    expect(bill2.number).toBe('FP-20261001-0002');
  });

  it('paket: plannedEndAt = mulai + durasi, snapshot harga paket', async () => {
    const res = await start({ unitId: b.m1.id, mode: 'PACKAGE', packageId: b.pkg2.id });
    expect(res.json().unit.session).toMatchObject({
      mode: 'PACKAGE', plannedEndAt: '2026-10-01T05:00:00.000Z', packageName: 'Paket 2 Jam', packageDurationMin: 120, packagePrice: 90000,
    });
  });

  it('meja sedang dipakai → 409 UNIT_BUSY', async () => {
    await start({ unitId: b.m1.id, mode: 'OPEN' });
    const res = await start({ unitId: b.m1.id, mode: 'OPEN' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('UNIT_BUSY');
  });

  it('concurrent start: dua klik bersamaan hanya membuat satu sesi', async () => {
    const [a, c] = await Promise.all([start({ unitId: b.m1.id, mode: 'OPEN' }), start({ unitId: b.m1.id, mode: 'OPEN' })]);
    expect([a.statusCode, c.statusCode].sort()).toEqual([200, 409]);
    expect(await prisma.session.count()).toBe(1);
  });

  it('meja maintenance → 409', async () => {
    await prisma.unit.update({ where: { id: b.m1.id }, data: { state: 'MAINTENANCE' } });
    const res = await start({ unitId: b.m1.id, mode: 'OPEN' });
    expect(res.json().error.code).toBe('UNIT_MAINTENANCE');
  });

  it('paket untuk tipe lain ditolak, paket wajib diisi', async () => {
    expect((await start({ unitId: b.v1.id, mode: 'PACKAGE', packageId: b.pkg1.id })).json().error.code).toBe('PACKAGE_MISMATCH');
    expect((await start({ unitId: b.m1.id, mode: 'PACKAGE' })).json().error.code).toBe('PACKAGE_REQUIRED');
  });

  it('tanpa tarif pada jam sekarang → 422 NO_TARIFF', async () => {
    await prisma.tariff.deleteMany({ where: { unitTypeId: b.reg.id } });
    const res = await start({ unitId: b.m1.id, mode: 'OPEN' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('NO_TARIFF');
  });

  it('device offline at start: sesi tetap tercatat, lampu menyala saat device kembali', async () => {
    sim().setOnline(false);
    const res = await start({ unitId: b.m1.id, mode: 'OPEN' });
    expect(res.statusCode).toBe(200);
    expect(res.json().unit.session.status).toBe('RUNNING');
    expect(sim().snapshot()[0]).toBe(false);
    sim().setOnline(true);
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(true));
  });

  it('memulai sesi menghapus override lampu manual', async () => {
    await prisma.unit.update({ where: { id: b.m1.id }, data: { lightOverride: false } });
    const res = await start({ unitId: b.m1.id, mode: 'OPEN' });
    expect(res.json().unit.lightOverride).toBeNull();
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(true));
  });
});

describe('stop sesi', () => {
  it('menghitung tagihan, mematikan lampu, meja kosong', async () => {
    const s = (await start({ unitId: b.m1.id, mode: 'OPEN' })).json().unit.session;
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(true));
    t.clock.advanceMinutes(100);
    const res = await stop(s.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().charge).toMatchObject({ billableMinutes: 100, chargedMinutes: 105, total: 70000 });
    expect(res.json().unit.session).toBeNull();
    const row = await prisma.session.findUniqueOrThrow({ where: { id: s.id } });
    expect(row).toMatchObject({ status: 'ENDED', activeUnitId: null, chargeTotal: 70000 });
    expect(row.endedAt?.toISOString()).toBe('2026-10-01T04:40:00.000Z');
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(false));
  });

  it('stop dua kali → 409 SESSION_ENDED', async () => {
    const s = (await start({ unitId: b.m1.id, mode: 'OPEN' })).json().unit.session;
    await stop(s.id);
    const res = await stop(s.id);
    expect(res.json().error.code).toBe('SESSION_ENDED');
  });

  it('meja bisa dipakai lagi setelah stop', async () => {
    const s = (await start({ unitId: b.m1.id, mode: 'OPEN' })).json().unit.session;
    await stop(s.id);
    expect((await start({ unitId: b.m1.id, mode: 'OPEN' })).statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- sessions`
Expected: FAIL — 404 pada `/api/sessions`.

- [ ] **Step 3: Implementasi service**

`apps/server/src/modules/sessions/sessions.service.ts`:
```ts
import { Prisma, type Session } from '@prisma/client';
import {
  addMinutes, computeSessionCharge, findTariff, localDateKey,
  type PublicUser, type SessionMode, type TimeCharge,
} from '@funplay/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { audit } from '../audit/audit';
import { loadTariffRules } from '../catalog/tariffs.service';
import { getSettings } from '../settings/settings.service';

export async function nextBillNumber(tx: Db, now: Date, utcOffsetMin: number): Promise<string> {
  const date = localDateKey(now, utcOffsetMin);
  const c = await tx.billCounter.upsert({ where: { date }, create: { date, last: 1 }, update: { last: { increment: 1 } } });
  return `FP-${date}-${String(c.last).padStart(4, '0')}`;
}

/** Ubah pelanggaran unik `activeUnitId` (race dua kasir) menjadi 409 UNIT_BUSY. */
export function rethrowBusy(err: unknown, unitName: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && String(err.meta?.target ?? '').includes('activeUnitId')) {
    throw conflict('UNIT_BUSY', `${unitName} sedang dipakai`);
  }
  throw err;
}

export const sessionParts = { segments: { orderBy: { startedAt: 'asc' } }, pauses: { orderBy: { pausedAt: 'asc' } } } satisfies Prisma.SessionInclude;

export class SessionService {
  constructor(protected readonly ctx: AppContext) {}

  /** Setelah commit: rekonsiliasi lampu (tanpa menunggu) dan beri tahu klien. */
  protected touch(...unitIds: string[]): void {
    for (const id of unitIds) {
      void this.ctx.devices.applyUnit(id);
      this.ctx.bus.emit('unit.changed', id);
    }
  }

  async start(user: PublicUser, input: { unitId: string; mode: SessionMode; packageId?: string }): Promise<Session> {
    const { prisma, clock } = this.ctx;
    const now = clock.now();
    const settings = await getSettings(prisma);
    const unitName = (await prisma.unit.findUnique({ where: { id: input.unitId }, select: { name: true } }))?.name ?? 'Meja';

    let session: Session;
    try {
      session = await prisma.$transaction(async (tx) => {
        const unit = await tx.unit.findUnique({ where: { id: input.unitId }, include: { activeSession: true } });
        if (!unit) throw notFound('Meja');
        if (unit.state === 'MAINTENANCE') throw conflict('UNIT_MAINTENANCE', `${unit.name} sedang maintenance`);
        if (unit.activeSession) throw conflict('UNIT_BUSY', `${unit.name} sedang dipakai`);

        let pkg: { id: string; name: string; durationMin: number; price: number } | null = null;
        if (input.mode === 'PACKAGE') {
          if (!input.packageId) throw badRequest('PACKAGE_REQUIRED', 'Pilih paket terlebih dahulu');
          const p = await tx.package.findUnique({ where: { id: input.packageId } });
          if (!p || !p.active) throw notFound('Paket');
          if (p.unitTypeId !== unit.unitTypeId) throw badRequest('PACKAGE_MISMATCH', 'Paket ini tidak berlaku untuk tipe meja tersebut');
          pkg = p;
        } else {
          findTariff(await loadTariffRules(tx), unit.unitTypeId, now, settings.utcOffsetMin); // gagal cepat bila tarif belum diatur
        }

        const bill = await tx.bill.create({ data: { number: await nextBillNumber(tx, now, settings.utcOffsetMin), createdById: user.id } });
        const s = await tx.session.create({
          data: {
            billId: bill.id,
            unitId: unit.id,
            activeUnitId: unit.id,
            mode: input.mode,
            packageId: pkg?.id ?? null,
            packageName: pkg?.name ?? null,
            packageDurationMin: pkg?.durationMin ?? null,
            packagePrice: pkg?.price ?? null,
            startedAt: now,
            plannedEndAt: pkg ? addMinutes(now, pkg.durationMin) : null,
            startedById: user.id,
            segments: { create: { unitId: unit.id, unitTypeId: unit.unitTypeId, startedAt: now } },
          },
        });
        if (unit.lightOverride !== null) await tx.unit.update({ where: { id: unit.id }, data: { lightOverride: null } });
        await audit(tx, { userId: user.id, action: 'session.start', entity: 'Session', entityId: s.id, data: { unitId: unit.id, mode: input.mode, packageId: pkg?.id ?? null } });
        return s;
      });
    } catch (err) {
      rethrowBusy(err, unitName);
    }
    this.touch(session.unitId);
    return session;
  }

  async stop(user: PublicUser, sessionId: string): Promise<{ session: Session; charge: TimeCharge }> {
    const { prisma, clock } = this.ctx;
    const now = clock.now();
    const settings = await getSettings(prisma);

    const result = await prisma.$transaction(async (tx) => {
      const s = await tx.session.findUnique({ where: { id: sessionId }, include: sessionParts });
      if (!s) throw notFound('Sesi');
      if (s.status === 'ENDED') throw conflict('SESSION_ENDED', 'Sesi sudah selesai');
      const endAt = s.status === 'EXPIRED' && s.endedAt ? s.endedAt : now;

      await tx.sessionSegment.updateMany({ where: { sessionId: s.id, endedAt: null }, data: { endedAt: endAt } });
      await tx.sessionPause.updateMany({ where: { sessionId: s.id, resumedAt: null }, data: { resumedAt: endAt } });
      const closed = {
        ...s,
        endedAt: endAt,
        segments: s.segments.map((g) => ({ ...g, endedAt: g.endedAt ?? endAt })),
        pauses: s.pauses.map((p) => ({ ...p, resumedAt: p.resumedAt ?? endAt })),
      };
      const charge = computeSessionCharge(closed, await loadTariffRules(tx), settings, endAt);

      const session = await tx.session.update({
        where: { id: s.id },
        data: {
          status: 'ENDED', endedAt: endAt, activeUnitId: null, endedById: user.id,
          chargeTotal: charge.total, chargeDetail: charge as unknown as Prisma.InputJsonValue,
        },
      });
      await audit(tx, { userId: user.id, action: 'session.stop', entity: 'Session', entityId: s.id, data: { total: charge.total } });
      return { session, charge };
    });

    this.touch(result.session.unitId);
    return result;
  }
}
```

- [ ] **Step 4: Implementasi rute**

`apps/server/src/modules/sessions/sessions.routes.ts`:
```ts
import { SESSION_MODES } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { requireAuth } from '../auth/guard';
import { buildUnitView } from '../board/board';

const idParam = z.object({ id: z.string().min(1) });
const startSchema = z.object({ unitId: z.string().min(1), mode: z.enum(SESSION_MODES), packageId: z.string().min(1).optional() });

export function sessionsRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const auth = { preHandler: requireAuth };

    app.post('/sessions', auth, async (req) => {
      const s = await ctx.sessions.start(req.user!, startSchema.parse(req.body));
      return { unit: await buildUnitView(ctx, s.unitId) };
    });

    app.post('/sessions/:id/stop', auth, async (req) => {
      const { id } = idParam.parse(req.params);
      const { session, charge } = await ctx.sessions.stop(req.user!, id);
      return { unit: await buildUnitView(ctx, session.unitId), charge };
    });
  };
}
```

- [ ] **Step 5: Wiring**

`apps/server/src/context.ts` — tambahkan:
```ts
import type { SessionService } from './modules/sessions/sessions.service';
// di interface AppContext:
  sessions: SessionService;
```

`apps/server/src/app.ts` — ubah pembuatan `ctx` dan daftarkan rute:
```ts
import { sessionsRoutes } from './modules/sessions/sessions.routes';
import { SessionService } from './modules/sessions/sessions.service';
// ...
  const ctx = { prisma: deps.prisma, clock: deps.clock, config: deps.config, bus, devices } as AppContext;
  ctx.sessions = new SessionService(ctx);
// ... di plugin /api, setelah devicesRoutes:
      await api.register(sessionsRoutes(ctx));
```

- [ ] **Step 6: Jalankan test, pastikan lulus**

Run: `pnpm --filter @funplay/server test && pnpm --filter @funplay/server typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server
git commit -m "feat(server): start and stop sessions with bill numbering and light control"
```

---

### Task 12: Sesi — tambah waktu, pindah meja, pause & lanjut

**Files:**
- Modify: `apps/server/src/modules/sessions/sessions.service.ts`, `apps/server/src/modules/sessions/sessions.routes.ts`
- Test: `apps/server/test/sessions-actions.test.ts`

**Interfaces:**
- Consumes: Task 6 (`approveWithPin`), Task 11.
- Produces (method baru `SessionService`):
  - `extend(user, sessionId, input: { minutes: number; requestId: string }): Promise<Session>` — hanya PACKAGE (400 `EXTEND_OPEN`); idempoten per `requestId`; sesi EXPIRED dihidupkan lagi dengan segmen baru mulai sekarang dan `plannedEndAt = now + minutes`.
  - `move(user, sessionId, toUnitId): Promise<{ from: string; to: string }>` — hanya RUNNING/PAUSED (409 `SESSION_NOT_ACTIVE`); 400 `SAME_UNIT`; 409 `UNIT_BUSY` / `UNIT_MAINTENANCE`.
  - `pause(user, sessionId, approvalPin?): Promise<Session>` — hanya RUNNING (409 `SESSION_NOT_RUNNING`), butuh persetujuan.
  - `resume(user, sessionId): Promise<Session>` — hanya PAUSED (409 `SESSION_NOT_PAUSED`); `plannedEndAt` digeser sebesar durasi pause.
  - Rute: `POST /api/sessions/:id/extend { minutes (1..600), requestId (8..64 karakter) }`, `POST /api/sessions/:id/move { toUnitId }` (→ `{ unit }` meja tujuan), `POST /api/sessions/:id/pause { approvalPin? }`, `POST /api/sessions/:id/resume` — semua → `{ unit: UnitView }`.

- [ ] **Step 1: Tulis test yang gagal**

`apps/server/test/sessions-actions.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginAs, makeApp, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let users: Awaited<ReturnType<typeof seedUsers>>;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  users = await seedUsers();
  b = await seedBasics();
  t = await makeApp();
  cookie = await loginAs(t.app, 'kasir');
});
afterEach(() => t.app.close());

const sim = () => t.sims.get(b.device.id)!;
const post = (url: string, payload: Record<string, unknown> = {}) => t.app.inject({ method: 'POST', url, headers: { cookie }, payload });
const startPkg = async (unitId = b.m1.id, packageId = b.pkg1.id) => (await post('/api/sessions', { unitId, mode: 'PACKAGE', packageId })).json().unit.session;
const startOpen = async (unitId = b.m1.id) => (await post('/api/sessions', { unitId, mode: 'OPEN' })).json().unit.session;

describe('pause & resume', () => {
  it('kasir tanpa PIN ditolak', async () => {
    const s = await startPkg();
    const res = await post(`/api/sessions/${s.id}/pause`);
    expect(res.json().error.code).toBe('APPROVAL_REQUIRED');
  });

  it('pause 10 menit menggeser plannedEndAt 10 menit', async () => {
    const s = await startPkg(); // 10:00–11:00 WIB
    t.clock.advanceMinutes(20);
    const p = await post(`/api/sessions/${s.id}/pause`, { approvalPin: '1111' });
    expect(p.json().unit.session.status).toBe('PAUSED');
    const pauseRow = await prisma.sessionPause.findFirstOrThrow();
    expect(pauseRow.approvedById).toBe(users.supervisor.id);
    t.clock.advanceMinutes(10);
    const r = await post(`/api/sessions/${s.id}/resume`);
    expect(r.json().unit.session).toMatchObject({ status: 'RUNNING', plannedEndAt: '2026-10-01T04:10:00.000Z' });
  });

  it('lampu mati saat pause bila pengaturan pauseKeepsLightOn=false', async () => {
    await prisma.setting.update({ where: { id: 1 }, data: { pauseKeepsLightOn: false } });
    const s = await startOpen();
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(true));
    await post(`/api/sessions/${s.id}/pause`, { approvalPin: '1111' });
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(false));
    await post(`/api/sessions/${s.id}/resume`);
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(true));
  });

  it('resume tanpa pause → 409', async () => {
    const s = await startOpen();
    expect((await post(`/api/sessions/${s.id}/resume`)).json().error.code).toBe('SESSION_NOT_PAUSED');
  });
});

describe('extend', () => {
  it('menambah 30 menit sekali walau requestId dikirim dua kali', async () => {
    const s = await startPkg();
    const body = { minutes: 30, requestId: 'req-00000001' };
    await post(`/api/sessions/${s.id}/extend`, body);
    const res = await post(`/api/sessions/${s.id}/extend`, body);
    expect(res.statusCode).toBe(200);
    expect(res.json().unit.session.plannedEndAt).toBe('2026-10-01T04:30:00.000Z');
    expect(await prisma.sessionExtension.count()).toBe(1);
  });

  it('open billing tidak bisa ditambah waktu', async () => {
    const s = await startOpen();
    const res = await post(`/api/sessions/${s.id}/extend`, { minutes: 30, requestId: 'req-00000002' });
    expect(res.json().error.code).toBe('EXTEND_OPEN');
  });
});

describe('pindah meja', () => {
  it('memindah sesi, lampu ikut pindah, tagihan per tipe meja', async () => {
    const s = await startOpen(b.m1.id);
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(true));
    t.clock.advanceMinutes(30);
    const res = await post(`/api/sessions/${s.id}/move`, { toUnitId: b.v1.id });
    expect(res.statusCode).toBe(200);
    expect(res.json().unit).toMatchObject({ id: b.v1.id });
    expect(res.json().unit.session.segments).toHaveLength(2);
    await vi.waitFor(() => expect(sim().snapshot()).toEqual([false, false, true, false]));

    t.clock.advanceMinutes(30);
    const stop = await post(`/api/sessions/${s.id}/stop`);
    expect(stop.json().charge.lines.map((l: { label: string; minutes: number; amount: number }) => [l.label, l.minutes, l.amount])).toEqual([
      ['Reguler Siang', 30, 20000],
      ['VIP', 30, 40000],
    ]);
  });

  it('tidak bisa pindah ke meja terpakai / maintenance / meja yang sama', async () => {
    const s = await startOpen(b.m1.id);
    await startOpen(b.m2.id);
    expect((await post(`/api/sessions/${s.id}/move`, { toUnitId: b.m2.id })).json().error.code).toBe('UNIT_BUSY');
    await prisma.unit.update({ where: { id: b.v1.id }, data: { state: 'MAINTENANCE' } });
    expect((await post(`/api/sessions/${s.id}/move`, { toUnitId: b.v1.id })).json().error.code).toBe('UNIT_MAINTENANCE');
    expect((await post(`/api/sessions/${s.id}/move`, { toUnitId: b.m1.id })).json().error.code).toBe('SAME_UNIT');
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- sessions-actions`
Expected: FAIL — 404 pada `/api/sessions/:id/pause` dst.

- [ ] **Step 3: Implementasi — tambahkan ke `SessionService`**

Di `apps/server/src/modules/sessions/sessions.service.ts`, tambahkan import `approveWithPin` dan method berikut di dalam class:
```ts
import { approveWithPin } from '../auth/auth.service';
```

```ts
  private async loadForUpdate(tx: Db, sessionId: string) {
    const s = await tx.session.findUnique({ where: { id: sessionId } });
    if (!s) throw notFound('Sesi');
    if (s.status === 'ENDED') throw conflict('SESSION_ENDED', 'Sesi sudah selesai');
    return s;
  }

  async extend(user: PublicUser, sessionId: string, input: { minutes: number; requestId: string }): Promise<Session> {
    const { prisma, clock } = this.ctx;
    const now = clock.now();
    const session = await prisma.$transaction(async (tx) => {
      const dup = await tx.sessionExtension.findUnique({ where: { requestId: input.requestId } });
      if (dup) return tx.session.findUniqueOrThrow({ where: { id: dup.sessionId } });

      const s = await this.loadForUpdate(tx, sessionId);
      if (s.mode === 'OPEN' || !s.plannedEndAt) throw badRequest('EXTEND_OPEN', 'Sesi open billing tidak perlu tambah waktu');
      await tx.sessionExtension.create({ data: { sessionId: s.id, minutes: input.minutes, requestId: input.requestId, createdById: user.id } });

      let updated: Session;
      if (s.status === 'EXPIRED') {
        const unit = await tx.unit.findUniqueOrThrow({ where: { id: s.unitId } });
        await tx.sessionSegment.create({ data: { sessionId: s.id, unitId: unit.id, unitTypeId: unit.unitTypeId, startedAt: now } });
        updated = await tx.session.update({
          where: { id: s.id },
          data: { status: 'RUNNING', endedAt: null, warnedAt: null, plannedEndAt: addMinutes(now, input.minutes) },
        });
      } else {
        updated = await tx.session.update({
          where: { id: s.id },
          data: { plannedEndAt: addMinutes(s.plannedEndAt, input.minutes), warnedAt: null },
        });
      }
      await audit(tx, { userId: user.id, action: 'session.extend', entity: 'Session', entityId: s.id, data: { minutes: input.minutes } });
      return updated;
    });
    this.touch(session.unitId);
    return session;
  }

  async move(user: PublicUser, sessionId: string, toUnitId: string): Promise<{ from: string; to: string }> {
    const { prisma, clock } = this.ctx;
    const now = clock.now();
    const target = await prisma.unit.findUnique({ where: { id: toUnitId }, select: { name: true } });
    let result: { from: string; to: string };
    try {
      result = await prisma.$transaction(async (tx) => {
        const s = await this.loadForUpdate(tx, sessionId);
        if (s.status !== 'RUNNING' && s.status !== 'PAUSED') throw conflict('SESSION_NOT_ACTIVE', 'Sesi tidak sedang berjalan');
        if (s.unitId === toUnitId) throw badRequest('SAME_UNIT', 'Pilih meja lain');
        const to = await tx.unit.findUnique({ where: { id: toUnitId }, include: { activeSession: true } });
        if (!to) throw notFound('Meja tujuan');
        if (to.state === 'MAINTENANCE') throw conflict('UNIT_MAINTENANCE', `${to.name} sedang maintenance`);
        if (to.activeSession) throw conflict('UNIT_BUSY', `${to.name} sedang dipakai`);

        await tx.sessionSegment.updateMany({ where: { sessionId: s.id, endedAt: null }, data: { endedAt: now } });
        await tx.sessionSegment.create({ data: { sessionId: s.id, unitId: to.id, unitTypeId: to.unitTypeId, startedAt: now } });
        await tx.session.update({ where: { id: s.id }, data: { unitId: to.id, activeUnitId: to.id } });
        if (to.lightOverride !== null) await tx.unit.update({ where: { id: to.id }, data: { lightOverride: null } });
        await audit(tx, { userId: user.id, action: 'session.move', entity: 'Session', entityId: s.id, data: { from: s.unitId, to: to.id } });
        return { from: s.unitId, to: to.id };
      });
    } catch (err) {
      rethrowBusy(err, target?.name ?? 'Meja tujuan');
    }
    this.touch(result.from, result.to);
    return result;
  }

  async pause(user: PublicUser, sessionId: string, approvalPin?: string): Promise<Session> {
    const { prisma, clock } = this.ctx;
    const approvedById = await approveWithPin(prisma, clock, user, approvalPin);
    const now = clock.now();
    const session = await prisma.$transaction(async (tx) => {
      const s = await this.loadForUpdate(tx, sessionId);
      if (s.status !== 'RUNNING') throw conflict('SESSION_NOT_RUNNING', 'Hanya sesi yang berjalan yang bisa di-pause');
      await tx.sessionPause.create({ data: { sessionId: s.id, pausedAt: now, approvedById } });
      const updated = await tx.session.update({ where: { id: s.id }, data: { status: 'PAUSED' } });
      await audit(tx, { userId: user.id, action: 'session.pause', entity: 'Session', entityId: s.id, approvedById });
      return updated;
    });
    this.touch(session.unitId);
    return session;
  }

  async resume(user: PublicUser, sessionId: string): Promise<Session> {
    const { prisma, clock } = this.ctx;
    const now = clock.now();
    const session = await prisma.$transaction(async (tx) => {
      const s = await this.loadForUpdate(tx, sessionId);
      if (s.status !== 'PAUSED') throw conflict('SESSION_NOT_PAUSED', 'Sesi tidak sedang di-pause');
      const open = await tx.sessionPause.findFirstOrThrow({ where: { sessionId: s.id, resumedAt: null } });
      await tx.sessionPause.update({ where: { id: open.id }, data: { resumedAt: now } });
      const pausedMs = now.getTime() - open.pausedAt.getTime();
      const updated = await tx.session.update({
        where: { id: s.id },
        data: {
          status: 'RUNNING',
          plannedEndAt: s.plannedEndAt ? new Date(s.plannedEndAt.getTime() + pausedMs) : null,
          warnedAt: null,
        },
      });
      await audit(tx, { userId: user.id, action: 'session.resume', entity: 'Session', entityId: s.id, data: { pausedMs } });
      return updated;
    });
    this.touch(session.unitId);
    return session;
  }
```

- [ ] **Step 4: Implementasi rute**

Tambahkan ke `sessionsRoutes` di `apps/server/src/modules/sessions/sessions.routes.ts`:
```ts
const extendSchema = z.object({ minutes: z.number().int().min(1).max(600), requestId: z.string().min(8).max(64) });
const moveSchema = z.object({ toUnitId: z.string().min(1) });
const pauseSchema = z.object({ approvalPin: z.string().optional() });
```
```ts
    app.post('/sessions/:id/extend', auth, async (req) => {
      const { id } = idParam.parse(req.params);
      const s = await ctx.sessions.extend(req.user!, id, extendSchema.parse(req.body));
      return { unit: await buildUnitView(ctx, s.unitId) };
    });

    app.post('/sessions/:id/move', auth, async (req) => {
      const { id } = idParam.parse(req.params);
      const { to } = await ctx.sessions.move(req.user!, id, moveSchema.parse(req.body).toUnitId);
      return { unit: await buildUnitView(ctx, to) };
    });

    app.post('/sessions/:id/pause', auth, async (req) => {
      const { id } = idParam.parse(req.params);
      const s = await ctx.sessions.pause(req.user!, id, pauseSchema.parse(req.body ?? {}).approvalPin);
      return { unit: await buildUnitView(ctx, s.unitId) };
    });

    app.post('/sessions/:id/resume', auth, async (req) => {
      const { id } = idParam.parse(req.params);
      const s = await ctx.sessions.resume(req.user!, id);
      return { unit: await buildUnitView(ctx, s.unitId) };
    });
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `pnpm --filter @funplay/server test && pnpm --filter @funplay/server typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): extend, move, pause and resume sessions"
```

---

### Task 13: Scheduler — peringatan, auto-stop paket, pemulihan setelah restart

**Files:**
- Create: `apps/server/src/modules/scheduler/scheduler.ts`
- Modify: `apps/server/src/context.ts`, `apps/server/src/app.ts`
- Test: `apps/server/test/scheduler.test.ts`

**Interfaces:**
- Consumes: `emitAlert`, `getSettings`, `audit`, `DeviceManager.applyUnit`.
- Produces:
  - `class Scheduler` — `constructor(ctx: AppContext)`; `tick(): Promise<void>`; `start(intervalMs = 1000)`; `stop()`
  - `AppContext.scheduler: Scheduler`
  - `buildApp` dengan `startLoops: true` menjalankan `scheduler.tick()` sekali saat boot (pemulihan) lalu setiap detik.
  - Alert: `SESSION_WARNING` (warning, sekali per `warnedAt`), `SESSION_EXPIRED` (danger).

**Aturan:** sesi PACKAGE `RUNNING` dengan `now ≥ plannedEndAt` → `EXPIRED`, `endedAt = plannedEndAt` (bukan `now`, sehingga waktu server mati tidak ditagih), segmen terbuka ditutup di `plannedEndAt`, lampu dimatikan. Sesi `PAUSED` tidak diproses. Transisi memakai `updateMany where status='RUNNING'` agar tidak bentrok dengan stop manual.

- [ ] **Step 1: Tulis test yang gagal**

`apps/server/test/scheduler.test.ts`:
```ts
import type { AlertEvent } from '@funplay/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginAs, makeApp, prisma, resetDb, seedBasics, seedUsers, T0 } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let cookie: string;
let alerts: AlertEvent[];

beforeEach(async () => {
  await resetDb();
  await seedUsers();
  b = await seedBasics();
  t = await makeApp();
  cookie = await loginAs(t.app, 'kasir');
  alerts = [];
  t.ctx.bus.on('alert', (a) => alerts.push(a));
});
afterEach(() => t.app.close());

const sim = () => t.sims.get(b.device.id)!;
const post = (url: string, payload: Record<string, unknown> = {}) => t.app.inject({ method: 'POST', url, headers: { cookie }, payload });

describe('Scheduler.tick', () => {
  it('memberi peringatan sekali ketika sisa ≤ 5 menit', async () => {
    await post('/api/sessions', { unitId: b.m1.id, mode: 'PACKAGE', packageId: b.pkg1.id }); // berakhir 11:00
    t.clock.advanceMinutes(54);
    await t.ctx.scheduler.tick();
    expect(alerts).toHaveLength(0);
    t.clock.advanceMinutes(2); // 10:56
    await t.ctx.scheduler.tick();
    await t.ctx.scheduler.tick();
    expect(alerts.filter((a) => a.type === 'SESSION_WARNING')).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ unitId: b.m1.id, level: 'warning' });
  });

  it('auto-stop paket: EXPIRED, endedAt = plannedEndAt, lampu mati, tagihan = harga paket', async () => {
    const s = (await post('/api/sessions', { unitId: b.m1.id, mode: 'PACKAGE', packageId: b.pkg1.id })).json().unit.session;
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(true));
    t.clock.advanceMinutes(61);
    await t.ctx.scheduler.tick();
    const row = await prisma.session.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.status).toBe('EXPIRED');
    expect(row.endedAt?.toISOString()).toBe('2026-10-01T04:00:00.000Z');
    expect(alerts.map((a) => a.type)).toContain('SESSION_EXPIRED');
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(false));

    t.clock.advanceMinutes(20);
    const stop = await post(`/api/sessions/${s.id}/stop`);
    expect(stop.json().charge.total).toBe(45000);
  });

  it('tambah waktu setelah EXPIRED menghidupkan sesi lagi tanpa menagih jeda', async () => {
    const s = (await post('/api/sessions', { unitId: b.m1.id, mode: 'PACKAGE', packageId: b.pkg1.id })).json().unit.session;
    t.clock.advanceMinutes(60);
    await t.ctx.scheduler.tick();
    t.clock.advanceMinutes(5); // 11:05
    const ext = await post(`/api/sessions/${s.id}/extend`, { minutes: 30, requestId: 'req-expired-01' });
    expect(ext.json().unit.session).toMatchObject({ status: 'RUNNING', plannedEndAt: '2026-10-01T04:35:00.000Z' });
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(true));
    t.clock.advanceMinutes(30);
    const stop = await post(`/api/sessions/${s.id}/stop`);
    expect(stop.json().charge.total).toBe(45000 + 20000);
  });

  it('sesi PAUSED tidak di-expire', async () => {
    const s = (await post('/api/sessions', { unitId: b.m1.id, mode: 'PACKAGE', packageId: b.pkg1.id })).json().unit.session;
    await post(`/api/sessions/${s.id}/pause`, { approvalPin: '1111' });
    t.clock.advanceMinutes(90);
    await t.ctx.scheduler.tick();
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('PAUSED');
  });
});

describe('restart recovery', () => {
  it('server mati melewati akhir paket → EXPIRED di plannedEndAt; sesi open tetap menyala di device baru', async () => {
    await post('/api/sessions', { unitId: b.m1.id, mode: 'PACKAGE', packageId: b.pkg1.id });
    await post('/api/sessions', { unitId: b.m2.id, mode: 'OPEN' });
    await t.app.close();

    t = await makeApp({ now: new Date(T0.getTime() + 3 * 60 * 60_000) }); // 13:00 WIB, simulator baru (semua relay OFF)
    await t.ctx.scheduler.tick();
    await t.ctx.devices.reconcileAll();

    const pkgSession = await prisma.session.findFirstOrThrow({ where: { unitId: b.m1.id } });
    expect(pkgSession.status).toBe('EXPIRED');
    expect(pkgSession.endedAt?.toISOString()).toBe('2026-10-01T04:00:00.000Z');
    expect(sim().snapshot().slice(0, 2)).toEqual([false, true]);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- scheduler`
Expected: FAIL — `t.ctx.scheduler` undefined.

- [ ] **Step 3: Implementasi**

`apps/server/src/modules/scheduler/scheduler.ts`:
```ts
import type { AppContext } from '../../context';
import { emitAlert } from '../../lib/alerts';
import { audit } from '../audit/audit';
import { getSettings } from '../settings/settings.service';

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly ctx: AppContext) {}

  start(intervalMs = 1000): void {
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (err) {
      console.error('[scheduler] tick gagal', err);
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<void> {
    const { prisma, clock, bus } = this.ctx;
    const now = clock.now();
    const settings = await getSettings(prisma);
    const sessions = await prisma.session.findMany({
      where: { status: 'RUNNING', plannedEndAt: { not: null } },
      include: { unit: { select: { id: true, name: true } } },
    });

    for (const s of sessions) {
      const end = s.plannedEndAt!;
      if (now.getTime() >= end.getTime()) {
        await this.expire(s.id, s.unit.id, s.unit.name, end);
        continue;
      }
      const leftMs = end.getTime() - now.getTime();
      if (!s.warnedAt && leftMs <= settings.warnBeforeMin * 60_000) {
        await prisma.session.update({ where: { id: s.id }, data: { warnedAt: now } });
        emitAlert(bus, clock, {
          level: 'warning',
          type: 'SESSION_WARNING',
          unitId: s.unit.id,
          message: `${s.unit.name}: sisa waktu ${Math.ceil(leftMs / 60_000)} menit`,
        });
        bus.emit('unit.changed', s.unit.id);
      }
    }
  }

  private async expire(sessionId: string, unitId: string, unitName: string, endAt: Date): Promise<void> {
    const { prisma, clock, bus, devices } = this.ctx;
    const changed = await prisma.$transaction(async (tx) => {
      const r = await tx.session.updateMany({ where: { id: sessionId, status: 'RUNNING' }, data: { status: 'EXPIRED', endedAt: endAt } });
      if (r.count === 0) return false;
      await tx.sessionSegment.updateMany({ where: { sessionId, endedAt: null }, data: { endedAt: endAt } });
      await audit(tx, { userId: null, action: 'session.expire', entity: 'Session', entityId: sessionId });
      return true;
    });
    if (!changed) return;
    emitAlert(bus, clock, { level: 'danger', type: 'SESSION_EXPIRED', unitId, message: `${unitName}: waktu habis` });
    void devices.applyUnit(unitId);
    bus.emit('unit.changed', unitId);
  }
}
```

`apps/server/src/context.ts` — tambahkan:
```ts
import type { Scheduler } from './modules/scheduler/scheduler';
// di interface AppContext:
  scheduler: Scheduler;
```

`apps/server/src/app.ts` — setelah `ctx.sessions = new SessionService(ctx);` tambahkan `ctx.scheduler = new Scheduler(ctx);` (import dari `./modules/scheduler/scheduler`), lalu ganti blok start & onClose di akhir `buildApp` menjadi:
```ts
  await devices.start({ loop: startLoops });
  if (startLoops) {
    await ctx.scheduler.tick(); // pemulihan: expire paket yang lewat selama server mati
    ctx.scheduler.start();
  }
  app.addHook('onClose', async () => {
    ctx.scheduler.stop();
    await devices.stop();
  });
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter @funplay/server test && pnpm --filter @funplay/server typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): scheduler for warnings, package auto-stop and restart recovery"
```

---

### Task 14: Realtime Socket.IO

**Files:**
- Create: `apps/server/src/modules/realtime/realtime.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/realtime.test.ts`

**Interfaces:**
- Consumes: `userFromToken`, `SESSION_COOKIE`, `buildBoard`, `buildUnitView`, `Bus`.
- Produces: `attachRealtime(app, ctx): Server` — path `/socket.io`; autentikasi dari cookie `fp_session` (ditolak → `connect_error` `UNAUTHORIZED`). Event ke klien (room `board`):
  - `board` (`BoardSnapshot`) — saat connect dan saat `board.changed`
  - `unit` (`UnitView`) — saat `unit.changed` (jika meja sudah dihapus → kirim `board`)
  - `alert` (`AlertEvent`), `device` (`DeviceStatusView`)

- [ ] **Step 1: Tulis test yang gagal**

`apps/server/test/realtime.test.ts`:
```ts
import type { BoardSnapshot, UnitView } from '@funplay/shared';
import { io, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { loginAs, makeApp, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let url: string;
let sockets: Socket[] = [];

beforeEach(async () => {
  await resetDb();
  await seedUsers();
  b = await seedBasics();
  t = await makeApp();
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = t.app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  url = `http://127.0.0.1:${addr.port}`;
});
afterEach(async () => {
  sockets.forEach((s) => s.disconnect());
  sockets = [];
  await t.app.close();
});

function connect(cookie?: string): Socket {
  const s = io(url, { path: '/socket.io', transports: ['websocket'], extraHeaders: cookie ? { cookie } : {}, reconnection: false });
  sockets.push(s);
  return s;
}

it('mengirim snapshot board saat terhubung', async () => {
  const cookie = await loginAs(t.app, 'kasir');
  const s = connect(cookie);
  const board = await new Promise<BoardSnapshot>((resolve) => s.once('board', resolve));
  expect(board.units).toHaveLength(3);
  expect(board.serverTime).toBe('2026-10-01T03:00:00.000Z');
});

it('mengirim update meja saat sesi dimulai', async () => {
  const cookie = await loginAs(t.app, 'kasir');
  const s = connect(cookie);
  await new Promise((resolve) => s.once('board', resolve));
  const update = new Promise<UnitView>((resolve) => {
    s.on('unit', (u: UnitView) => {
      if (u.id === b.m1.id && u.session) resolve(u);
    });
  });
  await t.app.inject({ method: 'POST', url: '/api/sessions', headers: { cookie }, payload: { unitId: b.m1.id, mode: 'OPEN' } });
  expect((await update).session?.status).toBe('RUNNING');
});

it('menolak koneksi tanpa login', async () => {
  const s = connect();
  const err = await new Promise<Error>((resolve) => s.once('connect_error', resolve));
  expect(err.message).toBe('UNAUTHORIZED');
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- realtime`
Expected: FAIL — timeout menunggu event `board` / koneksi gagal (belum ada server Socket.IO).

- [ ] **Step 3: Implementasi**

`apps/server/src/modules/realtime/realtime.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import type { AppContext } from '../../context';
import { SESSION_COOKIE, userFromToken } from '../auth/auth.service';
import { buildBoard, buildUnitView } from '../board/board';

export function attachRealtime(app: FastifyInstance, ctx: AppContext): Server {
  const io = new Server(app.server, { path: '/socket.io', serveClient: false });

  io.use(async (socket, next) => {
    try {
      const cookies = app.parseCookie(socket.request.headers.cookie ?? '');
      const raw = cookies[SESSION_COOKIE];
      const un = raw ? app.unsignCookie(raw) : null;
      const user = un?.valid && un.value ? await userFromToken(ctx.prisma, ctx.clock, un.value) : null;
      if (!user) return next(new Error('UNAUTHORIZED'));
      socket.data.user = user;
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  io.on('connection', async (socket) => {
    await socket.join('board');
    socket.emit('board', await buildBoard(ctx));
  });

  const room = () => io.to('board');
  const log = (err: unknown) => app.log.warn({ err }, 'realtime gagal');

  ctx.bus.on('unit.changed', (unitId) => {
    void buildUnitView(ctx, unitId)
      .then(async (view) => (view ? room().emit('unit', view) : room().emit('board', await buildBoard(ctx))))
      .catch(log);
  });
  ctx.bus.on('board.changed', () => {
    void buildBoard(ctx).then((b) => room().emit('board', b)).catch(log);
  });
  ctx.bus.on('alert', (a) => room().emit('alert', a));
  ctx.bus.on('device.changed', (d) => room().emit('device', d));

  app.addHook('onClose', async () => {
    await io.close();
  });
  return io;
}
```

Ubah `apps/server/src/app.ts` — setelah blok `app.register(... { prefix: '/api' })` tambahkan:
```ts
import { attachRealtime } from './modules/realtime/realtime';
// ...
  attachRealtime(app, ctx);
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter @funplay/server test && pnpm --filter @funplay/server typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): socket.io realtime board updates"
```

---

### Task 15: Seed data demo & entrypoint server

**Files:**
- Create: `apps/server/src/seed-data.ts`, `apps/server/src/seed.ts`, `apps/server/src/main.ts`
- Test: `apps/server/test/seed.test.ts`

**Interfaces:**
- Consumes: `hashSecret`, Prisma.
- Produces: `seedDemo(prisma, outletType: OutletType): Promise<boolean>` — `false` bila sudah ada user (idempoten). Membuat: pengaturan, user `owner/owner123` (PIN 1234), `supervisor/super123` (PIN 1111), `kasir/kasir123`, device "Simulator Relay A" 8 channel, 8 meja/unit, tarif, paket. CLI `pnpm --filter @funplay/server db:seed` (env `SEED_OUTLET_TYPE=PLAYSTATION` opsional). `main.ts` menjalankan server produksi/dev.

- [ ] **Step 1: Tulis test yang gagal**

`apps/server/test/seed.test.ts`:
```ts
import { beforeEach, expect, it } from 'vitest';
import { seedDemo } from '../src/seed-data';
import { prisma, resetDb } from './helpers';

beforeEach(() => resetDb());

it('seed billiard membuat 8 meja, 3 user, dan idempoten', async () => {
  expect(await seedDemo(prisma, 'BILLIARD')).toBe(true);
  expect(await prisma.unit.count()).toBe(8);
  expect(await prisma.user.count()).toBe(3);
  expect(await prisma.tariff.count()).toBe(4);
  expect((await prisma.setting.findUniqueOrThrow({ where: { id: 1 } })).outletType).toBe('BILLIARD');
  expect(await seedDemo(prisma, 'BILLIARD')).toBe(false);
  expect(await prisma.unit.count()).toBe(8);
});

it('seed playstation memakai tipe PS4/PS5', async () => {
  await seedDemo(prisma, 'PLAYSTATION');
  const types = (await prisma.unitType.findMany({ orderBy: { name: 'asc' } })).map((t) => t.name);
  expect(types).toEqual(['PS4', 'PS5']);
  expect((await prisma.unit.findFirstOrThrow({ orderBy: { sortOrder: 'asc' } })).name).toBe('PS4 #1');
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- seed`
Expected: FAIL — `../src/seed-data` tidak ditemukan.

- [ ] **Step 3: Implementasi**

`apps/server/src/seed-data.ts`:
```ts
import type { PrismaClient } from '@prisma/client';
import type { OutletType } from '@funplay/shared';
import { hashSecret } from './modules/auth/password';

interface TypeSeed {
  name: string;
  color: string;
  tariffs: { name: string; startMin: number; endMin: number; pricePerHour: number }[];
  packages: { name: string; durationMin: number; price: number }[];
  units: string[];
}

const BILLIARD: TypeSeed[] = [
  {
    name: 'Reguler', color: '#7C3AED',
    tariffs: [
      { name: 'Reguler Siang', startMin: 480, endMin: 1080, pricePerHour: 40000 },
      { name: 'Reguler Malam', startMin: 1080, endMin: 480, pricePerHour: 50000 },
    ],
    packages: [
      { name: 'Paket 2 Jam Reguler', durationMin: 120, price: 75000 },
      { name: 'Paket 3 Jam Reguler', durationMin: 180, price: 105000 },
    ],
    units: ['Meja 1', 'Meja 2', 'Meja 3', 'Meja 4', 'Meja 5', 'Meja 6'],
  },
  {
    name: 'VIP', color: '#F59E0B',
    tariffs: [
      { name: 'VIP Siang', startMin: 480, endMin: 1080, pricePerHour: 60000 },
      { name: 'VIP Malam', startMin: 1080, endMin: 480, pricePerHour: 75000 },
    ],
    packages: [{ name: 'Paket 2 Jam VIP', durationMin: 120, price: 110000 }],
    units: ['VIP 1', 'VIP 2'],
  },
];

const PLAYSTATION: TypeSeed[] = [
  {
    name: 'PS4', color: '#06B6D4',
    tariffs: [{ name: 'PS4', startMin: 0, endMin: 1440, pricePerHour: 10000 }],
    packages: [{ name: 'Paket 3 Jam PS4', durationMin: 180, price: 25000 }],
    units: ['PS4 #1', 'PS4 #2', 'PS4 #3', 'PS4 #4'],
  },
  {
    name: 'PS5', color: '#7C3AED',
    tariffs: [{ name: 'PS5', startMin: 0, endMin: 1440, pricePerHour: 15000 }],
    packages: [{ name: 'Paket 3 Jam PS5', durationMin: 180, price: 40000 }],
    units: ['PS5 #1', 'PS5 #2', 'PS5 #3', 'PS5 #4'],
  },
];

export async function seedDemo(prisma: PrismaClient, outletType: OutletType): Promise<boolean> {
  if ((await prisma.user.count()) > 0) return false;

  await prisma.setting.upsert({ where: { id: 1 }, create: { id: 1, outletType }, update: { outletType } });

  const users = [
    { name: 'Owner', username: 'owner', password: 'owner123', pin: '1234', role: 'OWNER' as const },
    { name: 'Supervisor', username: 'supervisor', password: 'super123', pin: '1111', role: 'SUPERVISOR' as const },
    { name: 'Kasir', username: 'kasir', password: 'kasir123', pin: null, role: 'KASIR' as const },
  ];
  for (const u of users) {
    await prisma.user.create({
      data: { name: u.name, username: u.username, role: u.role, passwordHash: await hashSecret(u.password), pinHash: u.pin ? await hashSecret(u.pin) : null },
    });
  }

  const device = await prisma.device.create({ data: { name: 'Simulator Relay A', driver: 'simulator', channels: 8 } });
  let channel = 1;
  for (const t of outletType === 'PLAYSTATION' ? PLAYSTATION : BILLIARD) {
    const type = await prisma.unitType.create({ data: { name: t.name, color: t.color } });
    await prisma.tariff.createMany({ data: t.tariffs.map((x) => ({ ...x, unitTypeId: type.id })) });
    await prisma.package.createMany({ data: t.packages.map((x) => ({ ...x, unitTypeId: type.id })) });
    for (const name of t.units) {
      await prisma.unit.create({ data: { name, unitTypeId: type.id, deviceId: device.id, relayChannel: channel, sortOrder: channel } });
      channel++;
    }
  }
  return true;
}
```

`apps/server/src/seed.ts`:
```ts
import { PrismaClient } from '@prisma/client';
import { OUTLET_TYPES, type OutletType } from '@funplay/shared';
import { seedDemo } from './seed-data';

const prisma = new PrismaClient();
const raw = process.env.SEED_OUTLET_TYPE ?? 'BILLIARD';
if (!(OUTLET_TYPES as readonly string[]).includes(raw)) throw new Error(`SEED_OUTLET_TYPE tidak valid: ${raw}`);

const created = await seedDemo(prisma, raw as OutletType);
console.log(created ? `Data demo ${raw} dibuat. Login: owner/owner123, supervisor/super123, kasir/kasir123` : 'Sudah ada data, seed dilewati.');
await prisma.$disconnect();
```

`apps/server/src/main.ts`:
```ts
import { PrismaClient } from '@prisma/client';
import { buildApp } from './app';
import { loadConfig } from './config';
import { systemClock } from './lib/clock';

const config = loadConfig();
const prisma = new PrismaClient();
const { app } = await buildApp({ prisma, clock: systemClock, config });
await app.listen({ port: config.PORT, host: config.HOST });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm --filter @funplay/server test && pnpm --filter @funplay/server typecheck`
Expected: PASS.

- [ ] **Step 5: Verifikasi manual server berjalan**

```bash
cd apps/server && pnpm exec prisma migrate deploy && pnpm db:seed && pnpm dev
# terminal lain:
curl -s -c /tmp/fp.txt -X POST localhost:3000/api/auth/login -H 'content-type: application/json' -d '{"username":"kasir","password":"kasir123"}'
curl -s -b /tmp/fp.txt localhost:3000/api/board | head -c 300
```
Expected: login mengembalikan `{"user":{...,"role":"KASIR"}}`; `/api/board` mengembalikan JSON dengan 8 meja. Hentikan server dengan Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): demo seed data and server entrypoint"
```

---

### Task 16: Scaffold web — tema Playful Violet, util, komponen UI, login, app shell

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`
- Create: `apps/web/src/main.tsx`, `App.tsx`, `styles.css`, `test-setup.ts`
- Create: `apps/web/src/lib/api.ts`, `cn.ts`, `format.ts`, `id.ts`, `theme.ts`
- Create: `apps/web/src/stores/toast.ts`, `apps/web/src/components/Toaster.tsx`
- Create: `apps/web/src/components/ui/button.tsx`, `input.tsx`, `modal.tsx`
- Create: `apps/web/src/features/auth/auth.tsx`, `LoginPage.tsx`, `apps/web/src/features/layout/AppShell.tsx`
- Test: `apps/web/src/lib/format.test.ts`

**Interfaces:**
- Consumes: `PublicUser`, `Role` (shared); API `/api/auth/*`.
- Produces:
  - `class ApiError { status; code; message }`, `api<T>(method, path, body?): Promise<T>` (path tanpa `/api`)
  - `cn(...classes)`, `newId(): string`
  - `formatRupiah(n): string` (`Rp 86.000`), `formatDuration(ms): string` (`HH:MM:SS`), `formatMinutes(min): string` (`1 jam 30 menit`)
  - `toggleTheme()`, `initTheme()` (kelas `dark` di `<html>`, localStorage `fp-theme`)
  - `toast.success|error|info|warning(message)`, `showError(err)`; `<Toaster />`
  - `<Button variant="primary|soft|warning|danger|ghost" size="sm|md|lg">`, `<Input>`, `<Modal open onOpenChange title footer width>`
  - `useMe()` (query key `['me']`), `<RequireAuth>`, `<RequireRole roles>`, `useLogout()`; `<LoginPage>`; `<AppShell>` (sidebar + topbar + `<Outlet/>`)

- [ ] **Step 1: Paket & konfigurasi**

`apps/web/package.json`:
```json
{
  "name": "@funplay/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

Jalankan:
```bash
pnpm --filter @funplay/web add react@^19 react-dom@^19 react-router@^7 @tanstack/react-query@^5 socket.io-client@^4.8 zustand@^5 @radix-ui/react-dialog clsx tailwind-merge lucide-react @fontsource-variable/plus-jakarta-sans "@funplay/shared@workspace:*"
pnpm --filter @funplay/web add -D vite@^7 @vitejs/plugin-react tailwindcss@^4 @tailwindcss/vite@^4 typescript@^5.9 vitest@^3.2 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/react@^19 @types/react-dom@^19
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`apps/web/vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  test: { environment: 'jsdom', setupFiles: ['src/test-setup.ts'] },
});
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="id">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#7C3AED" />
    <title>FunPlay</title>
  </head>
  <body class="bg-bg text-ink antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/test-setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

`apps/web/src/styles.css`:
```css
@import 'tailwindcss';

@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --font-sans: 'Plus Jakarta Sans Variable', ui-sans-serif, system-ui, sans-serif;
  --color-primary: #7c3aed;
  --color-primary-ink: #6d28d9;
  --color-primary-soft: #ede9fe;
  --color-accent: #f59e0b;
  --color-bg: #faf8ff;
  --color-surface: #ffffff;
  --color-ink: #1e1b4b;
  --color-muted: #6b7280;
  --color-line: #ede9fe;
  --animate-pulse-soft: pulse-soft 1.6s ease-in-out infinite;

  @keyframes pulse-soft {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.78; }
  }
}

.dark {
  --color-bg: #13111c;
  --color-surface: #1e1b2e;
  --color-ink: #ede9fe;
  --color-muted: #a5a1c2;
  --color-line: #2e2a45;
  --color-primary-soft: #2e1f5e;
}

html, body, #root { height: 100%; }
```

- [ ] **Step 2: Tulis test yang gagal**

`apps/web/src/lib/format.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatDuration, formatMinutes, formatRupiah } from './format';

describe('format', () => {
  it('formatRupiah memakai titik ribuan', () => {
    expect(formatRupiah(86000)).toBe('Rp 86.000');
    expect(formatRupiah(1250000)).toBe('Rp 1.250.000');
    expect(formatRupiah(0)).toBe('Rp 0');
    expect(formatRupiah(-5000)).toBe('-Rp 5.000');
  });
  it('formatDuration HH:MM:SS', () => {
    expect(formatDuration(0)).toBe('00:00:00');
    expect(formatDuration(5_049_000)).toBe('01:24:09');
    expect(formatDuration(-10)).toBe('00:00:00');
  });
  it('formatMinutes ramah dibaca', () => {
    expect(formatMinutes(45)).toBe('45 menit');
    expect(formatMinutes(60)).toBe('1 jam');
    expect(formatMinutes(90)).toBe('1 jam 30 menit');
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/web test`
Expected: FAIL — `./format` tidak ditemukan.

- [ ] **Step 4: Implementasi lib**

`apps/web/src/lib/format.ts`:
```ts
export function formatRupiah(n: number): string {
  const sign = n < 0 ? '-' : '';
  const digits = Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}Rp ${digits}`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} menit`;
  return m ? `${h} jam ${m} menit` : `${h} jam`;
}
```

`apps/web/src/lib/api.ts`:
```ts
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (!res.ok) throw new ApiError(res.status, data.error?.code ?? 'UNKNOWN', data.error?.message ?? 'Terjadi kesalahan');
  return data as T;
}
```

`apps/web/src/lib/cn.ts`:
```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

`apps/web/src/lib/id.ts`:
```ts
let counter = 0;

/** ID unik tanpa crypto.randomUUID (tidak tersedia di http LAN). */
export function newId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
```

`apps/web/src/lib/theme.ts`:
```ts
const KEY = 'fp-theme';

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function initTheme(): void {
  document.documentElement.classList.toggle('dark', read() === 'dark');
}

export function toggleTheme(): void {
  const dark = !document.documentElement.classList.contains('dark');
  document.documentElement.classList.toggle('dark', dark);
  try {
    localStorage.setItem(KEY, dark ? 'dark' : 'light');
  } catch {
    // abaikan: mode privat
  }
}
```

`apps/web/src/stores/toast.ts`:
```ts
import { create } from 'zustand';
import { ApiError } from '../lib/api';
import { newId } from '../lib/id';

export type ToastLevel = 'info' | 'success' | 'warning' | 'danger';
export interface Toast {
  id: string;
  level: ToastLevel;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push(level: ToastLevel, message: string): void;
  dismiss(id: string): void;
}

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (level, message) => {
    const id = newId();
    set((s) => ({ toasts: [...s.toasts, { id, level, message }].slice(-5) }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 6000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  info: (m: string) => useToasts.getState().push('info', m),
  success: (m: string) => useToasts.getState().push('success', m),
  warning: (m: string) => useToasts.getState().push('warning', m),
  error: (m: string) => useToasts.getState().push('danger', m),
};

export function showError(err: unknown): void {
  toast.error(err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi');
}
```

- [ ] **Step 5: Komponen UI**

`apps/web/src/components/ui/button.tsx`:
```tsx
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

const variants = {
  primary: 'bg-primary text-white hover:bg-primary-ink shadow-sm shadow-violet-300/40',
  soft: 'bg-primary-soft text-primary-ink hover:brightness-95 dark:text-violet-200',
  warning: 'bg-amber-100 text-amber-800 hover:bg-amber-200',
  danger: 'bg-rose-500 text-white hover:bg-rose-600',
  ghost: 'text-ink hover:bg-primary-soft',
} as const;

const sizes = { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-5 text-base' } as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[.98] disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
```

`apps/web/src/components/ui/input.tsx`:
```tsx
import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20',
        className,
      )}
      {...props}
    />
  );
});
```

`apps/web/src/components/ui/modal.tsx`:
```tsx
import * as D from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Modal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  return (
    <D.Root open={props.open} onOpenChange={props.onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm" />
        <D.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-surface p-5 text-ink shadow-xl',
            props.width ?? 'max-w-md',
          )}
        >
          <D.Title className="mb-4 text-lg font-bold">{props.title}</D.Title>
          <D.Description className="sr-only">{props.title}</D.Description>
          {props.children}
          {props.footer && <div className="mt-5 flex justify-end gap-2">{props.footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
```

`apps/web/src/components/Toaster.tsx`:
```tsx
import { X } from 'lucide-react';
import { cn } from '../lib/cn';
import { useToasts } from '../stores/toast';

const styles = {
  info: 'bg-surface text-ink border-line',
  success: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  warning: 'bg-amber-50 text-amber-900 border-amber-300',
  danger: 'bg-rose-50 text-rose-900 border-rose-300',
};

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} role="status" className={cn('pointer-events-auto flex items-start gap-2 rounded-xl border p-3 text-sm font-medium shadow-lg', styles[t.level])}>
          <span className="flex-1">{t.message}</span>
          <button type="button" aria-label="Tutup" onClick={() => dismiss(t.id)}>
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Auth, login, shell, app**

`apps/web/src/features/auth/auth.tsx`:
```tsx
import type { PublicUser, Role } from '@funplay/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { api } from '../../lib/api';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<{ user: PublicUser }>('GET', '/auth/me').then((r) => r.user) });
}

export function useLogout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => api<void>('POST', '/auth/logout', {}),
    onSettled: () => {
      qc.clear();
      navigate('/login', { replace: true });
    },
  });
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isLoading) return <div className="grid h-full place-items-center text-muted">Memuat…</div>;
  if (me.isError || !me.data) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const me = useMe();
  if (!me.data || !roles.includes(me.data.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
```

`apps/web/src/features/auth/LoginPage.tsx`:
```tsx
import type { PublicUser } from '@funplay/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { api } from '../../lib/api';
import { showError } from '../../stores/toast';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const login = useMutation({
    mutationFn: () => api<{ user: PublicUser }>('POST', '/auth/login', { username, password }),
    onSuccess: (r) => {
      qc.setQueryData(['me'], r.user);
      navigate('/', { replace: true });
    },
    onError: showError,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  return (
    <div className="grid min-h-full place-items-center bg-gradient-to-br from-violet-600 via-violet-500 to-fuchsia-500 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl bg-surface p-8 shadow-2xl">
        <h1 className="mb-1 text-center text-3xl font-extrabold tracking-tight text-primary">
          Fun<span className="text-accent">Play</span>
        </h1>
        <p className="mb-6 text-center text-sm text-muted">Masuk untuk mulai shift</p>
        <label className="mb-3 block text-sm font-semibold">
          Username
          <Input className="mt-1" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="mb-6 block text-sm font-semibold">
          Password
          <Input className="mt-1" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <Button type="submit" size="lg" className="w-full" disabled={login.isPending || !username || !password}>
          Masuk
        </Button>
      </form>
    </div>
  );
}
```

`apps/web/src/features/layout/AppShell.tsx`:
```tsx
import { LayoutGrid, LogOut, Moon, Settings } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/cn';
import { toggleTheme } from '../../lib/theme';
import { useLogout, useMe } from '../auth/auth';

const ROLE_LABEL = { KASIR: 'Kasir', SUPERVISOR: 'Supervisor', OWNER: 'Owner' } as const;

export function AppShell() {
  const me = useMe().data!;
  const logout = useLogout();
  const items = [
    { to: '/', label: 'Meja', icon: LayoutGrid, show: true },
    { to: '/settings', label: 'Pengaturan', icon: Settings, show: me.role === 'OWNER' },
  ];

  return (
    <div className="flex h-full">
      <nav className="flex w-16 flex-col items-center gap-2 border-r border-line bg-surface py-4">
        <div className="mb-4 text-lg font-extrabold text-primary">F<span className="text-accent">P</span></div>
        {items.filter((i) => i.show).map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.to === '/'}
            title={i.label}
            className={({ isActive }) =>
              cn('grid h-11 w-11 place-items-center rounded-xl transition', isActive ? 'bg-primary text-white' : 'bg-primary-soft text-primary-ink hover:brightness-95')
            }
          >
            <i.icon size={20} />
          </NavLink>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-2">
          <div className="text-lg font-extrabold text-primary">
            Fun<span className="text-accent">Play</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded-full bg-primary-soft px-3 py-1 font-semibold text-primary-ink">
              {me.name} · {ROLE_LABEL[me.role]}
            </span>
            <Button variant="ghost" size="sm" aria-label="Mode gelap" onClick={toggleTheme}>
              <Moon size={16} />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => logout.mutate()}>
              <LogOut size={16} /> Keluar
            </Button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-hidden p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

`apps/web/src/App.tsx`:
```tsx
import { Route, Routes } from 'react-router';
import { Toaster } from './components/Toaster';
import { RequireAuth } from './features/auth/auth';
import { LoginPage } from './features/auth/LoginPage';
import { AppShell } from './features/layout/AppShell';

export function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<div className="text-muted">Dashboard meja (Task 17)</div>} />
        </Route>
      </Routes>
      <Toaster />
    </>
  );
}
```

`apps/web/src/main.tsx`:
```tsx
import '@fontsource-variable/plus-jakarta-sans';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { initTheme } from './lib/theme';
import './styles.css';

initTheme();
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 7: Jalankan test & build**

Run: `pnpm --filter @funplay/web test && pnpm --filter @funplay/web build`
Expected: test PASS; build menghasilkan `apps/web/dist/`.

- [ ] **Step 8: Verifikasi manual**

Jalankan server (`pnpm --filter @funplay/server dev`) dan web (`pnpm --filter @funplay/web dev`), buka `http://localhost:5173`, login `kasir/kasir123`. Expected: diarahkan ke shell dengan sidebar ungu, nama "Kasir · Kasir", tombol mode gelap mengubah tema, "Keluar" kembali ke login. Login `owner/owner123` menampilkan ikon Pengaturan.

- [ ] **Step 9: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): scaffold with violet theme, UI primitives, login and app shell"
```

---

### Task 17: Store board realtime, jam server, kartu meja, grid

**Files:**
- Create: `apps/web/src/stores/board.ts`, `apps/web/src/lib/socket.ts`, `apps/web/src/lib/beep.ts`, `apps/web/src/hooks/useNow.ts`
- Create: `apps/web/src/features/board/status.ts`, `useChargePreview.ts`, `UnitCard.tsx`, `BoardPage.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/features/layout/AppShell.tsx`
- Test: `apps/web/src/stores/board.test.ts`, `apps/web/src/features/board/UnitCard.test.tsx`

**Interfaces:**
- Consumes: event Socket.IO Task 14; `deriveUnitStatus`, `remainingMs`, `sessionElapsedMs`, `computeSessionCharge`, `outletLabels` (shared).
- Produces:
  - `computeOffset(serverTimeIso, receivedAtMs): number`
  - `useBoard` (zustand): `{ connected, offsetMs, settings, units: Record<id, UnitView>, order: string[], devices: Record<id, DeviceStatusView>, tariffs, selectedUnitId, applyBoard(b, receivedAtMs), applyUnit(u), applyDevice(d), select(id|null), setConnected(v) }`
  - `connectBoard(onAlert): () => void`, `beep(level)`
  - `useNow(): Date` (jam server, berdetak 1 detik)
  - `STATUS_STYLE: Record<UnitStatus, { card: string; label: string }>`, `unitStatusOf(unit, now, warnBeforeMin)`, `timerText(unit, status, now)`
  - `useChargePreview(session, now): TimeCharge | null`
  - `<UnitCard unit now selected onSelect>` dengan `data-testid="unit-card-<nama>"`, `data-status`, `data-light="on|off|unknown"`
  - `<BoardPage>` (grid kiri + slot panel kanan)

- [ ] **Step 1: Tulis test yang gagal**

`apps/web/src/stores/board.test.ts`:
```ts
import type { BoardSnapshot, UnitView } from '@funplay/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { computeOffset, useBoard } from './board';

const unit = (id: string, name: string, sortOrder: number): UnitView => ({
  id, name, sortOrder, unitTypeId: 'reg', unitTypeName: 'Reguler', unitTypeColor: '#7C3AED', area: '', deviceId: null,
  relayChannel: null, state: 'ACTIVE', lightOverride: null, light: null, deviceOnline: null, session: null,
});

const snapshot = (units: UnitView[]): BoardSnapshot => ({
  serverTime: '2026-10-01T03:10:00.000Z',
  settings: { outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5, pauseKeepsLightOn: true, autoOffUnexpected: false },
  units, devices: [], tariffs: [],
});

beforeEach(() => useBoard.setState(useBoard.getInitialState()));

describe('computeOffset', () => {
  it('jam PC kasir 10 menit terlambat → offset +10 menit', () => {
    expect(computeOffset('2026-10-01T03:10:00.000Z', Date.parse('2026-10-01T03:00:00.000Z'))).toBe(600_000);
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
});
```

`apps/web/src/features/board/UnitCard.test.tsx`:
```tsx
import type { UnitView } from '@funplay/shared';
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { useBoard } from '../../stores/board';
import { UnitCard } from './UnitCard';

const base: UnitView = {
  id: 'u1', name: 'Meja 1', sortOrder: 1, unitTypeId: 'reg', unitTypeName: 'Reguler', unitTypeColor: '#7C3AED', area: '',
  deviceId: 'd1', relayChannel: 1, state: 'ACTIVE', lightOverride: null, light: true, deviceOnline: true,
  session: {
    id: 's1', billId: 'b1', mode: 'PACKAGE', status: 'RUNNING', startedAt: '2026-10-01T03:00:00.000Z',
    plannedEndAt: '2026-10-01T04:00:00.000Z', endedAt: null, packageName: 'Paket 1 Jam', packageDurationMin: 60, packagePrice: 45000,
    segments: [{ unitId: 'u1', unitTypeId: 'reg', startedAt: '2026-10-01T03:00:00.000Z', endedAt: null }], pauses: [],
  },
};

beforeEach(() => {
  useBoard.setState({
    settings: { outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5, pauseKeepsLightOn: true, autoOffUnexpected: false },
    tariffs: [{ id: 't', unitTypeId: 'reg', name: 'Siang', daysMask: 127, startMin: 480, endMin: 1080, pricePerHour: 40000, priority: 0 }],
  });
});

it('paket hampir habis: status WARNING, hitung mundur, total paket', () => {
  render(<UnitCard unit={base} now={new Date('2026-10-01T03:56:00.000Z')} selected={false} onSelect={() => {}} />);
  const card = screen.getByTestId('unit-card-Meja 1');
  expect(card).toHaveAttribute('data-status', 'WARNING');
  expect(card).toHaveAttribute('data-light', 'on');
  expect(card).toHaveTextContent('00:04:00');
  expect(card).toHaveTextContent('Rp 45.000');
  expect(card).toHaveTextContent('Hampir habis');
});

it('meja kosong dan device offline', () => {
  render(<UnitCard unit={{ ...base, session: null, light: null, deviceOnline: false }} now={new Date('2026-10-01T03:00:00.000Z')} selected={false} onSelect={() => {}} />);
  expect(screen.getByTestId('unit-card-Meja 1')).toHaveAttribute('data-status', 'IDLE');
  expect(screen.getByLabelText('Device offline')).toBeInTheDocument();
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/web test`
Expected: FAIL — `./board` dan `./UnitCard` tidak ditemukan.

- [ ] **Step 3: Implementasi store, socket, jam**

`apps/web/src/stores/board.ts`:
```ts
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
  applyDevice: (d) => set((s) => ({ devices: { ...s.devices, [d.id]: d } })),
  select: (id) => set({ selectedUnitId: id }),
  setConnected: (v) => set({ connected: v }),
}));
```

`apps/web/src/lib/beep.ts`:
```ts
let audio: AudioContext | null = null;

export function beep(level: 'info' | 'warning' | 'danger'): void {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = level === 'danger' ? 880 : level === 'warning' ? 660 : 520;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + (level === 'danger' ? 0.5 : 0.25));
  } catch {
    // audio tidak tersedia (mis. belum ada interaksi pengguna)
  }
}
```

`apps/web/src/lib/socket.ts`:
```ts
import type { AlertEvent, BoardSnapshot, DeviceStatusView, UnitView } from '@funplay/shared';
import { io } from 'socket.io-client';
import { useBoard } from '../stores/board';

export function connectBoard(onAlert: (a: AlertEvent) => void): () => void {
  const socket = io({ path: '/socket.io', withCredentials: true });
  const store = useBoard.getState;
  socket.on('connect', () => store().setConnected(true));
  socket.on('disconnect', () => store().setConnected(false));
  socket.on('board', (b: BoardSnapshot) => store().applyBoard(b, Date.now()));
  socket.on('unit', (u: UnitView) => store().applyUnit(u));
  socket.on('device', (d: DeviceStatusView) => store().applyDevice(d));
  socket.on('alert', onAlert);
  return () => {
    socket.disconnect();
  };
}
```

`apps/web/src/hooks/useNow.ts`:
```ts
import { useSyncExternalStore } from 'react';
import { useBoard } from '../stores/board';

const listeners = new Set<() => void>();
let tick = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!timer) {
    timer = setInterval(() => {
      tick = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Waktu server saat ini (jam lokal + offset), berdetak tiap detik. */
export function useNow(): Date {
  const local = useSyncExternalStore(subscribe, () => tick);
  const offset = useBoard((s) => s.offsetMs);
  return new Date(local + offset);
}
```

- [ ] **Step 4: Implementasi status, preview, kartu**

`apps/web/src/features/board/status.ts`:
```ts
import { deriveUnitStatus, remainingMs, sessionElapsedMs, type UnitStatus, type UnitView } from '@funplay/shared';
import { formatDuration } from '../../lib/format';

export const STATUS_STYLE: Record<UnitStatus, { card: string; label: string }> = {
  IDLE: { card: 'bg-surface text-ink border-2 border-dashed border-violet-200 dark:border-violet-900', label: 'Kosong' },
  RUNNING: { card: 'bg-primary text-white shadow-lg shadow-violet-300/40 dark:shadow-none', label: 'Berjalan' },
  PAUSED: { card: 'bg-violet-300 text-violet-950', label: 'Pause' },
  WARNING: { card: 'bg-amber-400 text-amber-950 animate-pulse-soft', label: 'Hampir habis' },
  EXPIRED: { card: 'bg-rose-500 text-white', label: 'Habis' },
  MAINTENANCE: { card: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300', label: 'Maintenance' },
};

export function unitStatusOf(unit: UnitView, now: Date, warnBeforeMin: number): UnitStatus {
  return deriveUnitStatus({ maintenance: unit.state === 'MAINTENANCE', session: unit.session, now, warnBeforeMin });
}

export function timerText(unit: UnitView, status: UnitStatus, now: Date): string {
  const s = unit.session;
  if (!s) return status === 'MAINTENANCE' ? '—' : '00:00:00';
  if (status === 'EXPIRED') return 'Habis';
  if (s.mode === 'PACKAGE') return formatDuration(remainingMs(s, now) ?? 0);
  return formatDuration(sessionElapsedMs(s, now));
}
```

`apps/web/src/features/board/useChargePreview.ts`:
```ts
import { computeSessionCharge, type SessionView, type TimeCharge } from '@funplay/shared';
import { useBoard } from '../../stores/board';

/** Preview tagihan waktu memakai kalkulator yang sama dengan server. null bila tarif belum diatur. */
export function useChargePreview(session: SessionView | null, now: Date): TimeCharge | null {
  const tariffs = useBoard((s) => s.tariffs);
  const settings = useBoard((s) => s.settings);
  if (!session || !settings) return null;
  try {
    return computeSessionCharge(session, tariffs, settings, now);
  } catch {
    return null;
  }
}
```

`apps/web/src/features/board/UnitCard.tsx`:
```tsx
import type { UnitView } from '@funplay/shared';
import { Lightbulb, LightbulbOff, WifiOff } from 'lucide-react';
import { cn } from '../../lib/cn';
import { formatRupiah } from '../../lib/format';
import { useBoard } from '../../stores/board';
import { STATUS_STYLE, timerText, unitStatusOf } from './status';
import { useChargePreview } from './useChargePreview';

function LightBadge({ light, online }: { light: boolean | null; online: boolean | null }) {
  if (online === null) return null;
  if (!online) {
    return (
      <span aria-label="Device offline" title="Device offline" className="grid h-7 w-7 place-items-center rounded-full bg-rose-600 text-white">
        <WifiOff size={14} />
      </span>
    );
  }
  return (
    <span aria-label={light ? 'Lampu menyala' : 'Lampu mati'} className="grid h-7 w-7 place-items-center rounded-full bg-black/10">
      {light ? <Lightbulb size={14} /> : <LightbulbOff size={14} />}
    </span>
  );
}

export function UnitCard({ unit, now, selected, onSelect }: { unit: UnitView; now: Date; selected: boolean; onSelect: () => void }) {
  const warnBeforeMin = useBoard((s) => s.settings?.warnBeforeMin ?? 5);
  const status = unitStatusOf(unit, now, warnBeforeMin);
  const charge = useChargePreview(unit.session, now);
  const style = STATUS_STYLE[status];

  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`unit-card-${unit.name}`}
      data-status={status}
      data-light={unit.light === null ? 'unknown' : unit.light ? 'on' : 'off'}
      className={cn(
        'flex min-h-32 flex-col justify-between rounded-2xl p-3 text-left transition active:scale-[.98]',
        style.card,
        selected && 'ring-4 ring-accent ring-offset-2 ring-offset-bg',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-bold leading-tight">{unit.name}</div>
          <div className="text-xs opacity-80">
            {unit.unitTypeName}
            {unit.area && ` · ${unit.area}`}
          </div>
        </div>
        <LightBadge light={unit.light} online={unit.deviceOnline} />
      </div>
      <div className="text-2xl font-extrabold tabular-nums">{timerText(unit, status, now)}</div>
      <div className="flex items-center justify-between text-xs font-semibold opacity-90">
        <span>{style.label}</span>
        {charge && <span className="tabular-nums">{formatRupiah(charge.total)}</span>}
      </div>
    </button>
  );
}
```

`apps/web/src/features/board/BoardPage.tsx`:
```tsx
import { outletLabels } from '@funplay/shared';
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useNow } from '../../hooks/useNow';
import { cn } from '../../lib/cn';
import { useBoard } from '../../stores/board';
import { UnitCard } from './UnitCard';

function UnitPanelSlot() {
  return <aside className="rounded-2xl bg-surface p-4 text-sm text-muted shadow-sm">Pilih meja di sebelah kiri.</aside>;
}

export function BoardPage() {
  const { order, units, settings, connected, selectedUnitId, select } = useBoard(
    useShallow((s) => ({ order: s.order, units: s.units, settings: s.settings, connected: s.connected, selectedUnitId: s.selectedUnitId, select: s.select })),
  );
  const now = useNow();
  const [filter, setFilter] = useState<string>('ALL');
  const types = useMemo(() => [...new Set(order.map((id) => units[id]!.unitTypeName))], [order, units]);
  const visible = order.filter((id) => filter === 'ALL' || units[id]!.unitTypeName === filter);

  if (!settings) return <div className="grid h-full place-items-center text-muted">Menghubungkan ke server…</div>;
  const labels = outletLabels(settings.outletType);

  return (
    <div className="flex h-full flex-col gap-3">
      {!connected && (
        <div role="alert" className="rounded-xl bg-rose-100 px-4 py-2 text-sm font-semibold text-rose-800">
          Koneksi ke server terputus — mencoba menyambung ulang…
        </div>
      )}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_380px]">
        <section className="flex min-h-0 flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {['ALL', ...types].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFilter(t)}
                className={cn('rounded-full px-4 py-1.5 text-sm font-semibold transition', filter === t ? 'bg-primary text-white' : 'bg-primary-soft text-primary-ink')}
              >
                {t === 'ALL' ? `Semua ${labels.unit}` : t}
              </button>
            ))}
          </div>
          <div className="grid min-h-0 grid-cols-2 content-start gap-3 overflow-y-auto pb-4 sm:grid-cols-3 xl:grid-cols-4">
            {visible.map((id) => (
              <UnitCard key={id} unit={units[id]!} now={now} selected={selectedUnitId === id} onSelect={() => select(id)} />
            ))}
          </div>
        </section>
        <UnitPanelSlot />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Sambungkan socket & halaman**

Di `apps/web/src/features/layout/AppShell.tsx` tambahkan koneksi realtime + alert (import `useEffect` dari react, `connectBoard`, `beep`, `toast`):
```tsx
import { useEffect } from 'react';
import { beep } from '../../lib/beep';
import { connectBoard } from '../../lib/socket';
import { toast } from '../../stores/toast';
// di dalam AppShell(), sebelum return:
  useEffect(
    () =>
      connectBoard((a) => {
        beep(a.level);
        if (a.level === 'danger') toast.error(a.message);
        else if (a.level === 'warning') toast.warning(a.message);
        else toast.info(a.message);
      }),
    [],
  );
```

Di `apps/web/src/App.tsx` ganti elemen route index:
```tsx
import { BoardPage } from './features/board/BoardPage';
// ...
          <Route index element={<BoardPage />} />
```

- [ ] **Step 6: Jalankan test, typecheck**

Run: `pnpm --filter @funplay/web test && pnpm --filter @funplay/web typecheck`
Expected: PASS.

- [ ] **Step 7: Verifikasi manual**

Dengan server + web berjalan, login kasir. Expected: 8 kartu meja "Kosong" dengan ikon lampu mati; filter "Reguler"/"VIP" menyaring kartu. Di terminal lain mulai sesi lewat curl (`POST /api/sessions` dengan cookie kasir) → kartu berubah ungu "Berjalan" tanpa reload, timer berjalan.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): realtime board store, server clock, unit cards grid"
```

---

### Task 18: Panel detail meja & aksi sesi (mulai, tambah waktu, pindah, pause, stop)

**Files:**
- Create: `apps/web/src/stores/pin.ts`, `apps/web/src/components/PinPrompt.tsx`
- Create: `apps/web/src/features/board/actions.ts`, `ChargeLines.tsx`, `StartSession.tsx`, `ActiveSession.tsx`, `ExtendDialog.tsx`, `MoveDialog.tsx`, `StopDialog.tsx`, `UnitPanel.tsx`
- Modify: `apps/web/src/features/board/BoardPage.tsx`, `apps/web/src/App.tsx`
- Test: `apps/web/src/features/board/UnitPanel.test.tsx`

**Interfaces:**
- Consumes: API sesi Task 11–12; `useBoard`, `useNow`, `useChargePreview`, `useMe`.
- Produces:
  - `askPin(title): Promise<string | null>` (store `usePin`), `<PinPrompt />`
  - `approvalPin(role, title): Promise<string | undefined | null>` — `undefined` untuk SUPERVISOR/OWNER (tidak perlu PIN), `string` PIN kasir, `null` bila dibatalkan
  - `useSessionAction()` — mutation `{ path, body }` → `{ unit }`, menerapkan unit ke store
  - `<ChargeLines charge>`, `<UnitPanel>` (membaca `selectedUnitId`)
  - Label tombol (dipakai E2E): `Open billing`, `Paket`, `Mulai`, `+ Waktu`, `Pindah`, `Pause`, `Lanjutkan`, `Stop`, `Ya, stop`, `Konfirmasi`

- [ ] **Step 1: Tulis test yang gagal**

`apps/web/src/features/board/UnitPanel.test.tsx`:
```tsx
import type { UnitView } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBoard } from '../../stores/board';
import { UnitPanel } from './UnitPanel';

const idle: UnitView = {
  id: 'u1', name: 'Meja 1', sortOrder: 1, unitTypeId: 'reg', unitTypeName: 'Reguler', unitTypeColor: '#7C3AED', area: '',
  deviceId: null, relayChannel: null, state: 'ACTIVE', lightOverride: null, light: null, deviceOnline: null, session: null,
};

function mockFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/auth/me') return json({ user: { id: 'k', name: 'Kasir', username: 'kasir', role: 'KASIR' } });
    if (url === '/api/packages') return json([{ id: 'p1', name: 'Paket 2 Jam', unitTypeId: 'reg', durationMin: 120, price: 90000, active: true }]);
    if (url === '/api/sessions' && init?.method === 'POST') return json({ unit: { ...idle } });
    return new Response('{}', { status: 404 });
  });
}

beforeEach(() => {
  useBoard.setState({
    ...useBoard.getInitialState(),
    settings: { outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5, pauseKeepsLightOn: true, autoOffUnexpected: false },
    units: { u1: idle },
    order: ['u1'],
    selectedUnitId: 'u1',
  });
});
afterEach(() => vi.unstubAllGlobals());

it('memulai paket dari meja kosong', async () => {
  const fetchMock = mockFetch();
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UnitPanel />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Paket' }));
  await userEvent.click(await screen.findByRole('button', { name: /Paket 2 Jam/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Mulai' }));
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([u, i]) => u === '/api/sessions' && i?.method === 'POST');
    expect(call).toBeDefined();
    expect(JSON.parse(String(call![1]!.body))).toEqual({ unitId: 'u1', mode: 'PACKAGE', packageId: 'p1' });
  });
});

it('tombol Mulai nonaktif sampai paket dipilih', async () => {
  vi.stubGlobal('fetch', mockFetch());
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UnitPanel />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Paket' }));
  expect(screen.getByRole('button', { name: 'Mulai' })).toBeDisabled();
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/web test -- UnitPanel`
Expected: FAIL — `./UnitPanel` tidak ditemukan.

- [ ] **Step 3: PIN prompt & helper aksi**

`apps/web/src/stores/pin.ts`:
```ts
import type { Role } from '@funplay/shared';
import { create } from 'zustand';

interface PinState {
  open: boolean;
  title: string;
  resolve: ((pin: string | null) => void) | null;
  ask(title: string): Promise<string | null>;
  close(pin: string | null): void;
}

export const usePin = create<PinState>((set, get) => ({
  open: false,
  title: '',
  resolve: null,
  ask: (title) => new Promise((resolve) => set({ open: true, title, resolve })),
  close: (pin) => {
    get().resolve?.(pin);
    set({ open: false, resolve: null });
  },
}));

export const askPin = (title: string) => usePin.getState().ask(title);

/** undefined = tidak perlu PIN (supervisor/owner); null = dibatalkan. */
export async function approvalPin(role: Role, title: string): Promise<string | undefined | null> {
  if (role !== 'KASIR') return undefined;
  return askPin(title);
}
```

`apps/web/src/components/PinPrompt.tsx`:
```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { usePin } from '../stores/pin';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Modal } from './ui/modal';

export function PinPrompt() {
  const { open, title, close } = usePin();
  const [pin, setPin] = useState('');
  useEffect(() => {
    if (open) setPin('');
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pin.length >= 4) close(pin);
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && close(null)} title={title} width="max-w-xs">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          aria-label="PIN supervisor"
          type="password"
          inputMode="numeric"
          autoFocus
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          className="text-center text-2xl tracking-[0.5em]"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => close(null)}>Batal</Button>
          <Button type="submit" disabled={pin.length < 4}>Konfirmasi</Button>
        </div>
      </form>
    </Modal>
  );
}
```

`apps/web/src/features/board/actions.ts`:
```ts
import type { UnitView } from '@funplay/shared';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useBoard } from '../../stores/board';
import { showError } from '../../stores/toast';

export function useSessionAction() {
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body?: Record<string, unknown> }) => api<{ unit: UnitView }>('POST', path, body ?? {}),
    onSuccess: (r) => {
      useBoard.getState().applyUnit(r.unit);
      useBoard.getState().select(r.unit.id);
    },
    onError: showError,
  });
}
```

`apps/web/src/features/board/ChargeLines.tsx`:
```tsx
import type { TimeCharge } from '@funplay/shared';
import { formatMinutes, formatRupiah } from '../../lib/format';

export function ChargeLines({ charge }: { charge: TimeCharge | null }) {
  if (!charge) return <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">Tarif belum diatur untuk jam ini.</p>;
  return (
    <div className="rounded-xl bg-bg p-3 text-sm">
      {charge.lines.map((l, i) => (
        <div key={i} className="flex justify-between py-0.5">
          <span>
            {l.label} · {formatMinutes(l.minutes)}
          </span>
          <span className="tabular-nums">{formatRupiah(l.amount)}</span>
        </div>
      ))}
      <div className="mt-2 flex justify-between border-t border-line pt-2 text-base font-extrabold text-primary">
        <span>Total waktu</span>
        <span className="tabular-nums">{formatRupiah(charge.total)}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Komponen panel**

`apps/web/src/features/board/StartSession.tsx`:
```tsx
import type { PackageDto, UnitView } from '@funplay/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatMinutes, formatRupiah } from '../../lib/format';
import { toast } from '../../stores/toast';
import { useSessionAction } from './actions';

export function StartSession({ unit }: { unit: UnitView }) {
  const [mode, setMode] = useState<'OPEN' | 'PACKAGE'>('OPEN');
  const [packageId, setPackageId] = useState<string | null>(null);
  const packages = useQuery({ queryKey: ['/packages'], queryFn: () => api<PackageDto[]>('GET', '/packages') });
  const list = (packages.data ?? []).filter((p) => p.active && p.unitTypeId === unit.unitTypeId);
  const action = useSessionAction();

  const start = () =>
    action.mutate(
      { path: '/sessions', body: { unitId: unit.id, mode, ...(mode === 'PACKAGE' && packageId ? { packageId } : {}) } },
      { onSuccess: () => toast.success(`${unit.name} dimulai`) },
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-bg p-1">
        {(['OPEN', 'PACKAGE'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn('rounded-lg py-2 text-sm font-bold transition', mode === m ? 'bg-primary text-white' : 'text-primary-ink')}
          >
            {m === 'OPEN' ? 'Open billing' : 'Paket'}
          </button>
        ))}
      </div>
      {mode === 'PACKAGE' && (
        <div className="flex flex-col gap-2">
          {list.length === 0 && <p className="text-sm text-muted">Belum ada paket untuk tipe ini.</p>}
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPackageId(p.id)}
              className={cn(
                'flex justify-between rounded-xl border-2 px-3 py-2 text-left text-sm font-semibold transition',
                packageId === p.id ? 'border-primary bg-primary-soft' : 'border-line',
              )}
            >
              <span>{p.name} · {formatMinutes(p.durationMin)}</span>
              <span>{formatRupiah(p.price)}</span>
            </button>
          ))}
        </div>
      )}
      <Button size="lg" onClick={start} disabled={action.isPending || (mode === 'PACKAGE' && !packageId)}>
        Mulai
      </Button>
    </div>
  );
}
```

`apps/web/src/features/board/ExtendDialog.tsx`:
```tsx
import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { newId } from '../../lib/id';
import { useSessionAction } from './actions';

export function ExtendDialog({ sessionId, open, onClose }: { sessionId: string; open: boolean; onClose: () => void }) {
  const [minutes, setMinutes] = useState(30);
  const requestId = useMemo(() => newId(), [open]); // satu requestId per pembukaan dialog → klik ganda tidak dobel
  const action = useSessionAction();
  const submit = () => action.mutate({ path: `/sessions/${sessionId}/extend`, body: { minutes, requestId } }, { onSuccess: onClose });

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Tambah waktu"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button onClick={submit} disabled={action.isPending || minutes < 1}>Tambah {minutes} menit</Button>
        </>
      }
    >
      <div className="mb-3 grid grid-cols-4 gap-2">
        {[15, 30, 60, 120].map((m) => (
          <Button key={m} variant={minutes === m ? 'primary' : 'soft'} onClick={() => setMinutes(m)}>
            {m >= 60 ? `${m / 60} jam` : `${m} mnt`}
          </Button>
        ))}
      </div>
      <label className="text-sm font-semibold">
        Menit lain
        <Input type="number" min={1} max={600} className="mt-1" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
      </label>
    </Modal>
  );
}
```

`apps/web/src/features/board/MoveDialog.tsx`:
```tsx
import { useShallow } from 'zustand/react/shallow';
import { Modal } from '../../components/ui/modal';
import { useBoard } from '../../stores/board';
import { toast } from '../../stores/toast';
import { useSessionAction } from './actions';

export function MoveDialog({ sessionId, fromUnitId, open, onClose }: { sessionId: string; fromUnitId: string; open: boolean; onClose: () => void }) {
  const { order, units } = useBoard(useShallow((s) => ({ order: s.order, units: s.units })));
  const targets = order.map((id) => units[id]!).filter((u) => u.id !== fromUnitId && u.state === 'ACTIVE' && !u.session);
  const action = useSessionAction();

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="Pindah ke meja">
      {targets.length === 0 && <p className="text-sm text-muted">Tidak ada meja kosong.</p>}
      <div className="grid grid-cols-2 gap-2">
        {targets.map((u) => (
          <button
            key={u.id}
            type="button"
            disabled={action.isPending}
            onClick={() =>
              action.mutate(
                { path: `/sessions/${sessionId}/move`, body: { toUnitId: u.id } },
                { onSuccess: () => { toast.success(`Dipindah ke ${u.name}`); onClose(); } },
              )
            }
            className="rounded-xl border-2 border-line p-3 text-left font-semibold hover:border-primary"
          >
            {u.name}
            <div className="text-xs font-normal text-muted">{u.unitTypeName}</div>
          </button>
        ))}
      </div>
    </Modal>
  );
}
```

`apps/web/src/features/board/StopDialog.tsx`:
```tsx
import type { TimeCharge, UnitView } from '@funplay/shared';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { api } from '../../lib/api';
import { formatRupiah } from '../../lib/format';
import { useBoard } from '../../stores/board';
import { showError, toast } from '../../stores/toast';
import { ChargeLines } from './ChargeLines';

export function StopDialog(props: { unitName: string; sessionId: string; preview: TimeCharge | null; open: boolean; onClose: () => void }) {
  const stop = useMutation({
    mutationFn: () => api<{ unit: UnitView; charge: TimeCharge }>('POST', `/sessions/${props.sessionId}/stop`, {}),
    onSuccess: (r) => {
      useBoard.getState().applyUnit(r.unit);
      toast.success(`${props.unitName} selesai. Total waktu ${formatRupiah(r.charge.total)}`);
      props.onClose();
    },
    onError: showError,
  });

  return (
    <Modal
      open={props.open}
      onOpenChange={(o) => !o && props.onClose()}
      title={`Stop ${props.unitName}?`}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>Batal</Button>
          <Button variant="danger" onClick={() => stop.mutate()} disabled={stop.isPending}>Ya, stop</Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">Lampu akan dimatikan dan meja kembali kosong.</p>
      <ChargeLines charge={props.preview} />
    </Modal>
  );
}
```

`apps/web/src/features/board/ActiveSession.tsx`:
```tsx
import { localHHMM, remainingMs, sessionElapsedMs, type SessionView, type UnitStatus, type UnitView } from '@funplay/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { formatDuration } from '../../lib/format';
import { useBoard } from '../../stores/board';
import { approvalPin } from '../../stores/pin';
import { useMe } from '../auth/auth';
import { useSessionAction } from './actions';
import { ChargeLines } from './ChargeLines';
import { ExtendDialog } from './ExtendDialog';
import { MoveDialog } from './MoveDialog';
import { StopDialog } from './StopDialog';
import { useChargePreview } from './useChargePreview';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function ActiveSession({ unit, session, status, now }: { unit: UnitView; session: SessionView; status: UnitStatus; now: Date }) {
  const me = useMe().data!;
  const offset = useBoard((s) => s.settings?.utcOffsetMin ?? 420);
  const charge = useChargePreview(session, now);
  const action = useSessionAction();
  const [dialog, setDialog] = useState<null | 'extend' | 'move' | 'stop'>(null);

  const pause = async () => {
    const pin = await approvalPin(me.role, 'PIN supervisor untuk pause');
    if (pin === null) return;
    action.mutate({ path: `/sessions/${session.id}/pause`, body: pin ? { approvalPin: pin } : {} });
  };
  const resume = () => action.mutate({ path: `/sessions/${session.id}/resume` });
  const left = remainingMs(session, now);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 rounded-xl bg-bg p-3">
        <Row label="Mulai" value={localHHMM(new Date(session.startedAt), offset)} />
        <Row label="Mode" value={session.mode === 'OPEN' ? 'Open billing' : (session.packageName ?? 'Paket')} />
        <Row label="Durasi main" value={formatDuration(sessionElapsedMs(session, now))} />
        {left !== null && <Row label="Sisa waktu" value={status === 'EXPIRED' ? 'Habis' : formatDuration(left)} />}
        <Row label="Lampu" value={unit.light === null ? 'Tidak diketahui' : unit.light ? 'Menyala' : 'Mati'} />
      </div>
      <ChargeLines charge={charge} />
      <div className="grid grid-cols-2 gap-2">
        {session.mode === 'PACKAGE' && (
          <Button variant="soft" onClick={() => setDialog('extend')}>+ Waktu</Button>
        )}
        <Button variant="soft" disabled={status === 'EXPIRED'} onClick={() => setDialog('move')}>Pindah</Button>
        {session.status === 'PAUSED' ? (
          <Button variant="warning" onClick={resume} disabled={action.isPending}>Lanjutkan</Button>
        ) : (
          <Button variant="warning" onClick={pause} disabled={action.isPending || session.status !== 'RUNNING'}>Pause</Button>
        )}
      </div>
      <Button variant="danger" size="lg" onClick={() => setDialog('stop')}>Stop</Button>

      <ExtendDialog sessionId={session.id} open={dialog === 'extend'} onClose={() => setDialog(null)} />
      <MoveDialog sessionId={session.id} fromUnitId={unit.id} open={dialog === 'move'} onClose={() => setDialog(null)} />
      <StopDialog unitName={unit.name} sessionId={session.id} preview={charge} open={dialog === 'stop'} onClose={() => setDialog(null)} />
    </div>
  );
}
```

`apps/web/src/features/board/UnitPanel.tsx`:
```tsx
import { outletLabels } from '@funplay/shared';
import { useNow } from '../../hooks/useNow';
import { useBoard } from '../../stores/board';
import { ActiveSession } from './ActiveSession';
import { StartSession } from './StartSession';
import { STATUS_STYLE, unitStatusOf } from './status';

export function UnitPanel() {
  const unit = useBoard((s) => (s.selectedUnitId ? (s.units[s.selectedUnitId] ?? null) : null));
  const settings = useBoard((s) => s.settings);
  const now = useNow();

  if (!unit || !settings) {
    const label = settings ? outletLabels(settings.outletType).unit.toLowerCase() : 'meja';
    return <aside className="rounded-2xl bg-surface p-4 text-sm text-muted shadow-sm">Pilih {label} di sebelah kiri.</aside>;
  }
  const status = unitStatusOf(unit, now, settings.warnBeforeMin);

  return (
    <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-2xl bg-surface p-4 shadow-sm">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-extrabold">{unit.name}</h2>
          <p className="text-sm text-muted">{unit.unitTypeName}{unit.area && ` · ${unit.area}`}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${STATUS_STYLE[status].card}`}>{STATUS_STYLE[status].label}</span>
      </header>
      {status === 'MAINTENANCE' && <p className="rounded-xl bg-gray-100 p-3 text-sm text-gray-700">Sedang maintenance — tidak bisa dipakai.</p>}
      {status === 'IDLE' && <StartSession unit={unit} />}
      {unit.session && <ActiveSession unit={unit} session={unit.session} status={status} now={now} />}
    </aside>
  );
}
```

- [ ] **Step 5: Pasang panel & PIN prompt**

Di `apps/web/src/features/board/BoardPage.tsx`: hapus fungsi `UnitPanelSlot`, import `UnitPanel` dari `./UnitPanel`, dan ganti `<UnitPanelSlot />` dengan `<UnitPanel />`.

Di `apps/web/src/App.tsx`: import `PinPrompt` dari `./components/PinPrompt` dan render `<PinPrompt />` di samping `<Toaster />`.

- [ ] **Step 6: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/web test && pnpm --filter @funplay/web typecheck`
Expected: PASS.

- [ ] **Step 7: Verifikasi manual**

Login kasir → klik Meja 1 → Open billing → Mulai → kartu ungu, panel menampilkan durasi & tagihan berjalan. Pause → dialog PIN → isi `1111` → status Pause. Lanjutkan. Stop → dialog rincian → Ya, stop → meja kosong + toast total. Mulai paket di Meja 2 → + Waktu 30 menit → sisa waktu bertambah. Pindah ke VIP 1 → kartu VIP 1 berjalan.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): unit detail panel with start, extend, move, pause and stop"
```

---

### Task 19: Kontrol lampu manual & panel simulator

**Files:**
- Create: `apps/web/src/features/board/LightControl.tsx`, `apps/web/src/features/board/SimulatorPanel.tsx`
- Modify: `apps/web/src/features/board/UnitPanel.tsx`, `apps/web/src/features/board/BoardPage.tsx`
- Test: `apps/web/src/features/board/SimulatorPanel.test.tsx`

**Interfaces:**
- Consumes: `POST /api/units/:id/light`, `POST /api/devices/:id/simulate` (Task 10); `useBoard.devices`, `approvalPin`.
- Produces:
  - `<LightControl unit>` — tombol `Nyalakan manual`, `Matikan manual`, `Kembali otomatis` → dialog alasan (+ PIN bila kasir)
  - `<SimulatorPanel>` — tombol mengambang `Simulator` (hanya SUPERVISOR/OWNER dan bila ada device driver `simulator`); tiap relay tampil sebagai tombol berlabel nama meja (`aria-pressed` = state relay); tombol `Online`/`Offline` per device.

- [ ] **Step 1: Tulis test yang gagal**

`apps/web/src/features/board/SimulatorPanel.test.tsx`:
```tsx
import type { UnitView } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBoard } from '../../stores/board';
import { SimulatorPanel } from './SimulatorPanel';

const unit = (id: string, name: string, ch: number): UnitView => ({
  id, name, sortOrder: ch, unitTypeId: 'reg', unitTypeName: 'Reguler', unitTypeColor: '#7C3AED', area: '',
  deviceId: 'd1', relayChannel: ch, state: 'ACTIVE', lightOverride: null, light: ch === 1, deviceOnline: true, session: null,
});

beforeEach(() => {
  useBoard.setState({
    ...useBoard.getInitialState(),
    units: { a: unit('a', 'Meja 1', 1), b: unit('b', 'Meja 2', 2) },
    order: ['a', 'b'],
    devices: { d1: { id: 'd1', name: 'Sim A', driver: 'simulator', channels: 2, online: true, relays: [true, false], lastSeenAt: null } },
  });
});
afterEach(() => vi.unstubAllGlobals());

function renderAs(role: 'KASIR' | 'OWNER') {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/auth/me') return new Response(JSON.stringify({ user: { id: 'x', name: 'X', username: 'x', role } }), { status: 200 });
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SimulatorPanel />
    </QueryClientProvider>,
  );
  return fetchMock;
}

it('owner melihat relay berlabel meja dan bisa menekannya', async () => {
  const fetchMock = renderAs('OWNER');
  await userEvent.click(await screen.findByRole('button', { name: /Simulator/ }));
  const relay2 = screen.getByRole('button', { name: 'Meja 2' });
  expect(screen.getByRole('button', { name: 'Meja 1' })).toHaveAttribute('aria-pressed', 'true');
  expect(relay2).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(relay2);
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([u]) => u === '/api/devices/d1/simulate');
    expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ action: 'set', channel: 2, on: true });
  });
});

it('kasir tidak melihat simulator', async () => {
  renderAs('KASIR');
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByRole('button', { name: /Simulator/ })).toBeNull();
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/web test -- SimulatorPanel`
Expected: FAIL — `./SimulatorPanel` tidak ditemukan.

- [ ] **Step 3: Implementasi**

`apps/web/src/features/board/SimulatorPanel.tsx`:
```tsx
import { useMutation } from '@tanstack/react-query';
import { Cpu, Lightbulb, LightbulbOff, X } from 'lucide-react';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useBoard } from '../../stores/board';
import { showError } from '../../stores/toast';
import { useMe } from '../auth/auth';

type SimulateBody = { action: 'set'; channel: number; on: boolean } | { action: 'online'; online: boolean };

export function SimulatorPanel() {
  const me = useMe().data;
  const { devices, units } = useBoard(useShallow((s) => ({ devices: s.devices, units: s.units })));
  const [open, setOpen] = useState(false);
  const simulate = useMutation({
    mutationFn: ({ deviceId, body }: { deviceId: string; body: SimulateBody }) => api<void>('POST', `/devices/${deviceId}/simulate`, body),
    onError: showError,
  });

  const sims = Object.values(devices).filter((d) => d.driver === 'simulator');
  if (!me || me.role === 'KASIR' || sims.length === 0) return null;

  const unitName = (deviceId: string, ch: number) =>
    Object.values(units).find((u) => u.deviceId === deviceId && u.relayChannel === ch)?.name ?? `Channel ${ch}`;

  if (!open) {
    return (
      <Button className="fixed bottom-4 right-4 z-30 shadow-lg" onClick={() => setOpen(true)}>
        <Cpu size={16} /> Simulator
      </Button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-30 w-80 rounded-2xl border border-line bg-surface p-4 shadow-2xl">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-bold">Simulator relay</h3>
        <button type="button" aria-label="Tutup simulator" onClick={() => setOpen(false)}>
          <X size={18} />
        </button>
      </div>
      {sims.map((d) => (
        <div key={d.id} className="mb-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-semibold">{d.name}</span>
            <Button
              size="sm"
              variant={d.online ? 'soft' : 'danger'}
              onClick={() => simulate.mutate({ deviceId: d.id, body: { action: 'online', online: !d.online } })}
            >
              {d.online ? 'Online' : 'Offline'}
            </Button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: d.channels }, (_, i) => i + 1).map((ch) => {
              const on = d.relays?.[ch - 1] ?? false;
              return (
                <button
                  key={ch}
                  type="button"
                  aria-pressed={on}
                  aria-label={unitName(d.id, ch)}
                  disabled={!d.online}
                  onClick={() => simulate.mutate({ deviceId: d.id, body: { action: 'set', channel: ch, on: !on } })}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-xl p-2 text-[10px] font-semibold transition disabled:opacity-40',
                    on ? 'bg-amber-300 text-amber-950 shadow-[0_0_12px_rgba(251,191,36,.8)]' : 'bg-bg text-muted',
                  )}
                >
                  {on ? <Lightbulb size={18} /> : <LightbulbOff size={18} />}
                  <span className="truncate">{unitName(d.id, ch)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p className="text-xs text-muted">Menekan relay di sini meniru saklar fisik (untuk uji peringatan “menyala tanpa sesi”).</p>
    </div>
  );
}
```

`apps/web/src/features/board/LightControl.tsx`:
```tsx
import type { UnitView } from '@funplay/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { api } from '../../lib/api';
import { useBoard } from '../../stores/board';
import { approvalPin } from '../../stores/pin';
import { showError, toast } from '../../stores/toast';
import { useMe } from '../auth/auth';

type Mode = 'ON' | 'OFF' | 'AUTO';
const TITLE: Record<Mode, string> = { ON: 'Nyalakan manual', OFF: 'Matikan manual', AUTO: 'Kembali otomatis' };

export function LightControl({ unit }: { unit: UnitView }) {
  const me = useMe().data!;
  const [mode, setMode] = useState<Mode | null>(null);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: (vars: { mode: Mode; approvalPin?: string }) =>
      api<{ unit: UnitView }>('POST', `/units/${unit.id}/light`, { mode: vars.mode, reason, approvalPin: vars.approvalPin }),
    onSuccess: (r) => {
      useBoard.getState().applyUnit(r.unit);
      toast.success('Kontrol lampu diperbarui');
      setMode(null);
      setReason('');
    },
    onError: showError,
  });

  if (!unit.deviceId) return null;

  const submit = async () => {
    if (!mode) return;
    const pin = await approvalPin(me.role, 'PIN supervisor untuk kontrol lampu');
    if (pin === null) return;
    m.mutate({ mode, approvalPin: pin });
  };

  return (
    <section className="border-t border-line pt-3">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-bold">Lampu</span>
        {unit.lightOverride !== null && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">Manual</span>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(['ON', 'OFF', 'AUTO'] as const).map((md) => (
          <Button key={md} size="sm" variant="soft" onClick={() => setMode(md)} disabled={md === 'AUTO' && unit.lightOverride === null}>
            {TITLE[md]}
          </Button>
        ))}
      </div>
      <Modal
        open={mode !== null}
        onOpenChange={(o) => !o && setMode(null)}
        title={mode ? `${TITLE[mode]} — ${unit.name}` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMode(null)}>Batal</Button>
            <Button onClick={submit} disabled={reason.trim().length < 3 || m.isPending}>Simpan</Button>
          </>
        }
      >
        <label className="text-sm font-semibold">
          Alasan
          <Input className="mt-1" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. bersih-bersih meja" />
        </label>
        <p className="mt-2 text-xs text-muted">Tercatat di log audit.</p>
      </Modal>
    </section>
  );
}
```

Di `apps/web/src/features/board/UnitPanel.tsx`: import `LightControl` dan render `<LightControl unit={unit} />` sebagai elemen terakhir di dalam `<aside>`.

Di `apps/web/src/features/board/BoardPage.tsx`: import `SimulatorPanel` dan render `<SimulatorPanel />` sebagai anak terakhir `<div className="flex h-full flex-col gap-3">`.

- [ ] **Step 4: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/web test && pnpm --filter @funplay/web typecheck`
Expected: PASS.

- [ ] **Step 5: Verifikasi manual**

Login `owner` → tombol "Simulator" muncul. Buka, tekan relay "Meja 3" (tanpa sesi) → toast merah "Meja 3: lampu menyala tanpa sesi" + bunyi. Klik Meja 3 → Matikan manual → isi alasan → Simpan → relay mati, badge "Manual". Kembali otomatis → badge hilang. Tekan "Online" → device offline → kartu menampilkan ikon offline merah + toast "Device … terputus".

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): manual light control and relay simulator panel"
```

---

### Task 20: Halaman Pengaturan (umum, tipe, meja, device, tarif, paket, user)

**Files:**
- Create: `apps/web/src/features/settings/CrudResource.tsx`, `resources.ts`, `GeneralSettings.tsx`, `SettingsPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/features/settings/CrudResource.test.tsx`

**Interfaces:**
- Consumes: REST Task 7, 8, 10.
- Produces:
  - `type FieldType = 'text' | 'number' | 'money' | 'select' | 'checkbox' | 'time' | 'days' | 'password'`
  - `interface Field { name; label; type; required?; nullable?; omitIfEmpty?; hideInTable?; options?: { value: string; label: string }[]; optionsFrom?: { path: string; label: (row: any) => string }; defaultValue?: unknown }`
  - `interface ResourceConfig { title; path; fields: Field[]; canDelete?: boolean }`
  - `toPayload(fields, values): Record<string, unknown>`, `<CrudResource config>`
  - `RESOURCES: Record<'unitTypes' | 'units' | 'devices' | 'tariffs' | 'packages' | 'users', ResourceConfig>`
  - `<GeneralSettings>`, `<SettingsPage>` (route `/settings`, OWNER)

- [ ] **Step 1: Tulis test yang gagal**

`apps/web/src/features/settings/CrudResource.test.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CrudResource, toPayload, type Field } from './CrudResource';

afterEach(() => vi.unstubAllGlobals());

describe('toPayload', () => {
  const fields: Field[] = [
    { name: 'name', label: 'Nama', type: 'text' },
    { name: 'price', label: 'Harga', type: 'money' },
    { name: 'relayChannel', label: 'Channel', type: 'number', nullable: true },
    { name: 'deviceId', label: 'Device', type: 'select', nullable: true },
    { name: 'active', label: 'Aktif', type: 'checkbox' },
    { name: 'days', label: 'Hari', type: 'days' },
    { name: 'pin', label: 'PIN', type: 'password', omitIfEmpty: true },
  ];
  it('mengonversi nilai form ke tipe API', () => {
    expect(toPayload(fields, { name: 'A', price: '45000', relayChannel: '', deviceId: '', active: true, days: [1, 2], pin: '' })).toEqual({
      name: 'A', price: 45000, relayChannel: null, deviceId: null, active: true, days: [1, 2],
    });
  });
});

describe('CrudResource', () => {
  it('menampilkan baris dan mengirim POST saat menambah', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'n', name: 'VIP', color: '#7C3AED' }), { status: 200 });
      return new Response(JSON.stringify([{ id: 'r', name: 'Reguler', color: '#7C3AED' }]), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CrudResource
          config={{ title: 'Tipe', path: '/unit-types', canDelete: true, fields: [
            { name: 'name', label: 'Nama', type: 'text', required: true },
            { name: 'color', label: 'Warna', type: 'text', defaultValue: '#7C3AED' },
          ] }}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Reguler')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tambah' }));
    await userEvent.type(screen.getByLabelText('Nama'), 'VIP');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST');
      expect(call?.[0]).toBe('/api/unit-types');
      expect(JSON.parse(String(call![1]!.body))).toEqual({ name: 'VIP', color: '#7C3AED' });
    });
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/web test -- CrudResource`
Expected: FAIL — `./CrudResource` tidak ditemukan.

- [ ] **Step 3: Implementasi `CrudResource`**

`apps/web/src/features/settings/CrudResource.tsx`:
```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatRupiah } from '../../lib/format';
import { showError, toast } from '../../stores/toast';

export type FieldType = 'text' | 'number' | 'money' | 'select' | 'checkbox' | 'time' | 'days' | 'password';

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  nullable?: boolean;
  omitIfEmpty?: boolean;
  hideInTable?: boolean;
  options?: { value: string; label: string }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  optionsFrom?: { path: string; label: (row: any) => string };
  defaultValue?: unknown;
}

export interface ResourceConfig {
  title: string;
  path: string;
  fields: Field[];
  canDelete?: boolean;
}

type Row = { id: string } & Record<string, unknown>;
type Values = Record<string, unknown>;

const DAY_LABELS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

export function toPayload(fields: Field[], values: Values): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.name];
    const empty = v === '' || v === undefined || v === null;
    if (f.omitIfEmpty && empty) continue;
    switch (f.type) {
      case 'number':
      case 'money':
        out[f.name] = empty ? (f.nullable ? null : 0) : Number(v);
        break;
      case 'checkbox':
        out[f.name] = Boolean(v);
        break;
      case 'select':
        out[f.name] = empty ? (f.nullable ? null : '') : v;
        break;
      case 'days':
        out[f.name] = Array.isArray(v) ? v : [];
        break;
      default:
        out[f.name] = empty ? '' : v;
    }
  }
  return out;
}

function initialValues(fields: Field[], row: Row | null): Values {
  const v: Values = {};
  for (const f of fields) {
    if (row && f.type !== 'password') v[f.name] = row[f.name] ?? (f.type === 'checkbox' ? false : '');
    else v[f.name] = f.defaultValue ?? (f.type === 'checkbox' ? true : f.type === 'days' ? [0, 1, 2, 3, 4, 5, 6] : '');
  }
  return v;
}

function useOptions(f: Field) {
  const q = useQuery({
    queryKey: [f.optionsFrom?.path ?? 'none'],
    queryFn: () => api<Row[]>('GET', f.optionsFrom!.path),
    enabled: !!f.optionsFrom,
  });
  if (f.options) return f.options;
  return (q.data ?? []).map((r) => ({ value: r.id, label: f.optionsFrom!.label(r) }));
}

function SelectField({ f, value, onChange }: { f: Field; value: unknown; onChange: (v: unknown) => void }) {
  const options = useOptions(f);
  return (
    <select
      id={`f-${f.name}`}
      className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm"
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{f.nullable ? '— tidak ada —' : '— pilih —'}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function FieldInput({ f, value, onChange }: { f: Field; value: unknown; onChange: (v: unknown) => void }) {
  switch (f.type) {
    case 'select':
      return <SelectField f={f} value={value} onChange={onChange} />;
    case 'checkbox':
      return <input id={`f-${f.name}`} type="checkbox" className="h-5 w-5 accent-violet-600" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
    case 'days': {
      const days = (value as number[]) ?? [];
      return (
        <div className="flex flex-wrap gap-1" id={`f-${f.name}`}>
          {DAY_LABELS.map((d, i) => (
            <button
              key={d}
              type="button"
              onClick={() => onChange(days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())}
              className={cn('rounded-lg px-2 py-1 text-xs font-bold', days.includes(i) ? 'bg-primary text-white' : 'bg-primary-soft text-primary-ink')}
            >
              {d}
            </button>
          ))}
        </div>
      );
    }
    default:
      return (
        <Input
          id={`f-${f.name}`}
          type={f.type === 'money' ? 'number' : f.type === 'time' ? 'time' : f.type}
          required={f.required}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

function display(f: Field, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (f.type === 'money') return formatRupiah(Number(v));
  if (f.type === 'checkbox') return v ? 'Ya' : 'Tidak';
  if (f.type === 'days') return (v as number[]).map((d) => DAY_LABELS[d]).join(', ');
  return String(v);
}

function CellValue({ f, row }: { f: Field; row: Row }) {
  const options = useOptions(f);
  if (f.type === 'select') return <>{options.find((o) => o.value === row[f.name])?.label ?? display(f, row[f.name])}</>;
  return <>{display(f, row[f.name])}</>;
}

export function CrudResource({ config }: { config: ResourceConfig }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: [config.path], queryFn: () => api<Row[]>('GET', config.path) });
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [values, setValues] = useState<Values>({});

  const open = (row: Row | 'new') => {
    setEditing(row);
    setValues(initialValues(config.fields, row === 'new' ? null : row));
  };
  const done = () => {
    void qc.invalidateQueries({ queryKey: [config.path] });
    setEditing(null);
    toast.success('Tersimpan');
  };
  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing === 'new' ? api('POST', config.path, payload) : api('PATCH', `${config.path}/${(editing as Row).id}`, payload),
    onSuccess: done,
    onError: showError,
  });
  const del = useMutation({ mutationFn: (id: string) => api('DELETE', `${config.path}/${id}`), onSuccess: done, onError: showError });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fields = editing === 'new' ? config.fields : config.fields.map((f) => (f.type === 'password' ? { ...f, omitIfEmpty: true } : f));
    save.mutate(toPayload(fields, values));
  };
  const cols = config.fields.filter((f) => !f.hideInTable && f.type !== 'password');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{config.title}</h2>
        <Button onClick={() => open('new')}>
          <Plus size={16} /> Tambah
        </Button>
      </div>
      <div className="overflow-x-auto rounded-2xl bg-surface shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-primary-soft text-left text-primary-ink">
            <tr>
              {cols.map((f) => <th key={f.name} className="px-3 py-2 font-bold">{f.label}</th>)}
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((row) => (
              <tr key={row.id} className="border-t border-line">
                {cols.map((f) => (
                  <td key={f.name} className="px-3 py-2"><CellValue f={f} row={row} /></td>
                ))}
                <td className="flex justify-end gap-1 px-3 py-2">
                  <Button size="sm" variant="ghost" aria-label="Ubah" onClick={() => open(row)}><Pencil size={14} /></Button>
                  {config.canDelete && (
                    <Button size="sm" variant="ghost" aria-label="Hapus" onClick={() => window.confirm('Hapus data ini?') && del.mutate(row.id)}>
                      <Trash2 size={14} />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? `Tambah ${config.title}` : `Ubah ${config.title}`}>
        <form onSubmit={submit} className="flex flex-col gap-3">
          {config.fields.map((f) => (
            <div key={f.name} className="flex flex-col gap-1 text-sm font-semibold">
              <label htmlFor={`f-${f.name}`}>{f.label}</label>
              <FieldInput f={f} value={values[f.name]} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />
            </div>
          ))}
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>Batal</Button>
            <Button type="submit" disabled={save.isPending}>Simpan</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 4: Resource, pengaturan umum, halaman**

`apps/web/src/features/settings/resources.ts`:
```ts
import type { ResourceConfig } from './CrudResource';

const unitTypeSelect = { name: 'unitTypeId', label: 'Tipe', type: 'select' as const, required: true, optionsFrom: { path: '/unit-types', label: (r: { name: string }) => r.name } };

export const RESOURCES = {
  unitTypes: {
    title: 'Tipe',
    path: '/unit-types',
    canDelete: true,
    fields: [
      { name: 'name', label: 'Nama', type: 'text', required: true },
      { name: 'color', label: 'Warna (#RRGGBB)', type: 'text', defaultValue: '#7C3AED' },
    ],
  },
  units: {
    title: 'Meja / Unit',
    path: '/units',
    canDelete: true,
    fields: [
      { name: 'name', label: 'Nama', type: 'text', required: true },
      unitTypeSelect,
      { name: 'area', label: 'Area', type: 'text' },
      { name: 'deviceId', label: 'Device', type: 'select', nullable: true, optionsFrom: { path: '/devices', label: (r: { name: string }) => r.name } },
      { name: 'relayChannel', label: 'Channel relay', type: 'number', nullable: true },
      { name: 'state', label: 'Status', type: 'select', defaultValue: 'ACTIVE', options: [{ value: 'ACTIVE', label: 'Aktif' }, { value: 'MAINTENANCE', label: 'Maintenance' }] },
      { name: 'sortOrder', label: 'Urutan', type: 'number', defaultValue: '0' },
    ],
  },
  devices: {
    title: 'Device',
    path: '/devices',
    canDelete: true,
    fields: [
      { name: 'name', label: 'Nama', type: 'text', required: true },
      { name: 'driver', label: 'Driver', type: 'select', defaultValue: 'simulator', options: [{ value: 'simulator', label: 'Simulator' }] },
      { name: 'channels', label: 'Jumlah channel', type: 'number', defaultValue: '8' },
    ],
  },
  tariffs: {
    title: 'Tarif',
    path: '/tariffs',
    canDelete: true,
    fields: [
      { name: 'name', label: 'Nama', type: 'text', required: true },
      unitTypeSelect,
      { name: 'days', label: 'Hari', type: 'days' },
      { name: 'start', label: 'Mulai', type: 'time', defaultValue: '08:00' },
      { name: 'end', label: 'Selesai', type: 'time', defaultValue: '18:00' },
      { name: 'pricePerHour', label: 'Harga / jam', type: 'money', required: true },
      { name: 'priority', label: 'Prioritas', type: 'number', defaultValue: '0' },
      { name: 'active', label: 'Aktif', type: 'checkbox' },
    ],
  },
  packages: {
    title: 'Paket',
    path: '/packages',
    canDelete: true,
    fields: [
      { name: 'name', label: 'Nama', type: 'text', required: true },
      unitTypeSelect,
      { name: 'durationMin', label: 'Durasi (menit)', type: 'number', required: true },
      { name: 'price', label: 'Harga', type: 'money', required: true },
      { name: 'active', label: 'Aktif', type: 'checkbox' },
    ],
  },
  users: {
    title: 'User',
    path: '/users',
    fields: [
      { name: 'name', label: 'Nama', type: 'text', required: true },
      { name: 'username', label: 'Username', type: 'text', required: true },
      { name: 'role', label: 'Peran', type: 'select', defaultValue: 'KASIR', options: [{ value: 'KASIR', label: 'Kasir' }, { value: 'SUPERVISOR', label: 'Supervisor' }, { value: 'OWNER', label: 'Owner' }] },
      { name: 'password', label: 'Password', type: 'password' },
      { name: 'pin', label: 'PIN (4–6 digit, opsional)', type: 'password', omitIfEmpty: true },
      { name: 'active', label: 'Aktif', type: 'checkbox' },
    ],
  },
} satisfies Record<string, ResourceConfig>;
```

`apps/web/src/features/settings/GeneralSettings.tsx`:
```tsx
import type { PublicSettings } from '@funplay/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { api } from '../../lib/api';
import { showError, toast } from '../../stores/toast';

export function GeneralSettings() {
  const q = useQuery({ queryKey: ['/settings'], queryFn: () => api<PublicSettings>('GET', '/settings') });
  const [v, setV] = useState<PublicSettings | null>(null);
  useEffect(() => {
    if (q.data) setV(q.data);
  }, [q.data]);
  const save = useMutation({
    mutationFn: (body: PublicSettings) => api<PublicSettings>('PUT', '/settings', body),
    onSuccess: () => toast.success('Pengaturan disimpan'),
    onError: showError,
  });
  if (!v) return null;

  const num = (k: keyof PublicSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value) });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(v);
  };

  return (
    <form onSubmit={submit} className="grid max-w-xl gap-4 rounded-2xl bg-surface p-5 shadow-sm">
      <label className="text-sm font-semibold">Jenis outlet
        <select className="mt-1 h-10 w-full rounded-xl border border-line bg-surface px-3" value={v.outletType} onChange={(e) => setV({ ...v, outletType: e.target.value as PublicSettings['outletType'] })}>
          <option value="BILLIARD">Billiard (Meja)</option>
          <option value="PLAYSTATION">PlayStation (Unit)</option>
        </select>
      </label>
      <label className="text-sm font-semibold">Nama outlet<Input className="mt-1" value={v.outletName} onChange={(e) => setV({ ...v, outletName: e.target.value })} /></label>
      <label className="text-sm font-semibold">Alamat<Input className="mt-1" value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /></label>
      <div className="grid grid-cols-3 gap-3">
        <label className="text-sm font-semibold">Blok pembulatan (menit)<Input className="mt-1" type="number" value={v.roundingBlockMin} onChange={num('roundingBlockMin')} /></label>
        <label className="text-sm font-semibold">Minimum main (menit)<Input className="mt-1" type="number" value={v.minChargeMin} onChange={num('minChargeMin')} /></label>
        <label className="text-sm font-semibold">Peringatan (menit)<Input className="mt-1" type="number" value={v.warnBeforeMin} onChange={num('warnBeforeMin')} /></label>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" className="h-5 w-5 accent-violet-600" checked={v.pauseKeepsLightOn} onChange={(e) => setV({ ...v, pauseKeepsLightOn: e.target.checked })} />
        Lampu tetap menyala saat pause
      </label>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" className="h-5 w-5 accent-violet-600" checked={v.autoOffUnexpected} onChange={(e) => setV({ ...v, autoOffUnexpected: e.target.checked })} />
        Matikan otomatis lampu yang menyala tanpa sesi
      </label>
      <Button type="submit" disabled={save.isPending} className="justify-self-start">Simpan</Button>
    </form>
  );
}
```

`apps/web/src/features/settings/SettingsPage.tsx`:
```tsx
import { useState } from 'react';
import { cn } from '../../lib/cn';
import { CrudResource } from './CrudResource';
import { GeneralSettings } from './GeneralSettings';
import { RESOURCES } from './resources';

const TABS = [
  { key: 'general', label: 'Umum' },
  { key: 'unitTypes', label: 'Tipe' },
  { key: 'units', label: 'Meja / Unit' },
  { key: 'devices', label: 'Device' },
  { key: 'tariffs', label: 'Tarif' },
  { key: 'packages', label: 'Paket' },
  { key: 'users', label: 'User' },
] as const;

export function SettingsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('general');
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn('rounded-full px-4 py-1.5 text-sm font-semibold', tab === t.key ? 'bg-primary text-white' : 'bg-primary-soft text-primary-ink')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'general' ? <GeneralSettings /> : <CrudResource key={tab} config={RESOURCES[tab]} />}
    </div>
  );
}
```

Di `apps/web/src/App.tsx` tambahkan route (import `RequireRole` dari `./features/auth/auth` dan `SettingsPage`):
```tsx
          <Route
            path="settings"
            element={
              <RequireRole roles={['OWNER']}>
                <SettingsPage />
              </RequireRole>
            }
          />
```

- [ ] **Step 5: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/web test && pnpm --filter @funplay/web typecheck`
Expected: PASS.

- [ ] **Step 6: Verifikasi manual**

Login owner → Pengaturan. Tab Umum: ubah jenis outlet ke PlayStation → Simpan → kembali ke Meja, label filter menjadi "Semua Unit". Kembalikan ke Billiard. Tab Tarif: tambah tarif "Weekend" hari Sab+Min 00:00–24:00 prioritas 10 → muncul di tabel. Tab Meja: ubah "Meja 6" status Maintenance → kartu abu-abu di dashboard. Tab User: tambah kasir baru dan login dengannya.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): settings pages for outlet, units, devices, tariffs, packages and users"
```

---

### Task 21: Server menyajikan build web + E2E Playwright + README

**Files:**
- Modify: `apps/server/src/app.ts`
- Create: `apps/server/test/static.test.ts`
- Create: `playwright.config.ts`, `scripts/e2e-server.sh`, `e2e/kasir.spec.ts`, `README.md`

**Interfaces:**
- Consumes: semua task sebelumnya.
- Produces: bila `WEB_DIST` diisi, server menyajikan file statis + fallback SPA (`index.html`) untuk semua URL non-`/api` dan non-`/socket.io`; `/api/*` yang tidak ada → 404 JSON. Perintah root `pnpm e2e`.

- [ ] **Step 1: Tulis test yang gagal**

`apps/server/test/static.test.ts`:
```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { FakeClock } from '../src/lib/clock';
import { prisma, resetDb, T0 } from './helpers';

let app: Awaited<ReturnType<typeof buildApp>>['app'];

beforeEach(async () => {
  await resetDb();
  const dir = mkdtempSync(join(tmpdir(), 'fp-web-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>FunPlay</title>');
  ({ app } = await buildApp({ prisma, clock: new FakeClock(T0), config: { ...loadConfig(), WEB_DIST: dir }, startLoops: false }));
  await app.ready();
});
afterEach(() => app.close());

it('menyajikan index.html untuk route SPA', async () => {
  const res = await app.inject({ method: 'GET', url: '/settings' });
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('<title>FunPlay</title>');
});

it('API yang tidak ada tetap 404 JSON', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/tidak-ada' });
  expect(res.statusCode).toBe(404);
  expect(res.json().error.code).toBe('NOT_FOUND');
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- static`
Expected: FAIL — `/settings` mengembalikan 404.

- [ ] **Step 3: Implementasi**

Di `apps/server/src/app.ts` tambahkan import `fastifyStatic from '@fastify/static'` dan, **sebelum** `attachRealtime(app, ctx);`, sisipkan:
```ts
  if (deps.config.WEB_DIST) {
    await app.register(fastifyStatic, { root: deps.config.WEB_DIST, wildcard: false });
  }
  app.setNotFoundHandler((req, reply) => {
    if (!deps.config.WEB_DIST || req.url.startsWith('/api') || req.url.startsWith('/socket.io')) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Tidak ditemukan' } });
    }
    return reply.sendFile('index.html');
  });
```

Run: `pnpm --filter @funplay/server test && pnpm --filter @funplay/server typecheck`
Expected: PASS.

- [ ] **Step 4: E2E Playwright**

Jalankan: `pnpm add -D -w @playwright/test && pnpm exec playwright install chromium`

`scripts/e2e-server.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export DATABASE_URL="${E2E_DATABASE_URL:-postgresql://funplay:funplay@localhost:5432/funplay_e2e}"
export COOKIE_SECRET="e2e-secret-e2e-secret-e2e-secret-e2e"
export NODE_ENV=production PORT=3100 HOST=127.0.0.1 WEB_DIST="$PWD/apps/web/dist"
pnpm --filter @funplay/web build
cd apps/server
pnpm exec prisma migrate reset --force --skip-seed --skip-generate
pnpm exec tsx src/seed.ts
exec pnpm exec tsx src/main.ts
```
Lalu: `chmod +x scripts/e2e-server.sh`

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3100', locale: 'id-ID' },
  webServer: {
    command: 'bash scripts/e2e-server.sh',
    url: 'http://127.0.0.1:3100/api/health',
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
```

`e2e/kasir.spec.ts`:
```ts
import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.getByTestId('unit-card-Meja 1')).toBeVisible();
}

test('kasir menjalankan dan menghentikan meja (open billing)', async ({ page }) => {
  await login(page, 'kasir', 'kasir123');
  const card = page.getByTestId('unit-card-Meja 1');
  await expect(card).toHaveAttribute('data-status', 'IDLE');
  await card.click();
  await page.getByRole('button', { name: 'Open billing' }).click();
  await page.getByRole('button', { name: 'Mulai', exact: true }).click();
  await expect(card).toHaveAttribute('data-status', 'RUNNING');
  await expect(card).toHaveAttribute('data-light', 'on');

  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: 'Ya, stop' }).click();
  await expect(card).toHaveAttribute('data-status', 'IDLE');
  await expect(card).toHaveAttribute('data-light', 'off');
});

test('kasir memulai paket lalu pause dengan PIN supervisor', async ({ page }) => {
  await login(page, 'kasir', 'kasir123');
  const card = page.getByTestId('unit-card-Meja 2');
  await card.click();
  await page.getByRole('button', { name: 'Paket', exact: true }).click();
  await page.getByRole('button', { name: /Paket 2 Jam Reguler/ }).click();
  await page.getByRole('button', { name: 'Mulai', exact: true }).click();
  await expect(card).toHaveAttribute('data-status', 'RUNNING');

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByLabel('PIN supervisor').fill('1111');
  await page.getByRole('button', { name: 'Konfirmasi' }).click();
  await expect(card).toHaveAttribute('data-status', 'PAUSED');

  await page.getByRole('button', { name: 'Lanjutkan' }).click();
  await expect(card).toHaveAttribute('data-status', 'RUNNING');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: 'Ya, stop' }).click();
  await expect(card).toHaveAttribute('data-status', 'IDLE');
});
```

Run: `pnpm e2e`
Expected: 2 test PASS (Playwright membangun web, mereset DB `funplay_e2e`, seed, menjalankan server di port 3100).

- [ ] **Step 5: README**

`README.md`:
````markdown
# FunPlay

POS billiard & PlayStation terintegrasi IoT (Arduino + relay). Spec: `docs/superpowers/specs/2026-09-29-funplay-pos-design.md`.

## Persiapan
- Node.js 22 (`.nvmrc`), `corepack enable` (pnpm 10), PostgreSQL.
- Buat role/DB: lihat bagian "Persiapan Lingkungan" di `docs/superpowers/plans/2026-09-29-funplay-m1-fondasi-meja.md`.
- `cp apps/server/.env.example apps/server/.env` lalu isi `COOKIE_SECRET`.

## Development
```bash
pnpm install
pnpm --filter @funplay/server exec prisma migrate deploy
pnpm --filter @funplay/server db:seed          # SEED_OUTLET_TYPE=PLAYSTATION untuk outlet PS
pnpm dev                                       # server :3000, web :5173
```
Login demo: `owner/owner123` (PIN 1234), `supervisor/super123` (PIN 1111), `kasir/kasir123`.

## Test
```bash
pnpm test        # unit + integrasi (DB funplay_test)
pnpm e2e         # Playwright (DB funplay_e2e)
```

## Produksi (sementara, sebelum M5)
```bash
pnpm build
cd apps/server && WEB_DIST=$(pwd)/../web/dist NODE_ENV=production pnpm start
```
````

- [ ] **Step 6: Verifikasi penuh**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: semua PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server playwright.config.ts scripts e2e README.md package.json pnpm-lock.yaml
git commit -m "feat: serve web build from server, add Playwright E2E and README"
```

---

## Cakupan spec oleh plan ini (M1)

| Spec | Task |
|---|---|
| §4.1 monorepo, §4.4 prinsip (jam server, kalkulator tunggal, integer Rupiah) | 1–5, 17 |
| §4.2 modul auth, settings, units, tariffs, sessions, devices, audit, scheduler, realtime | 6–15 |
| §5 lapisan IoT: driver plug-in, simulator, desired state, rekonsiliasi, kondisi gagal, override | 9, 10, 19 |
| §6.1 sesi & tarif (open/paket, pembulatan, minimum, lintas tarif, pause, pindah, peringatan, auto-stop) | 2–4, 11–13 |
| §6.7 mode outlet billiard/PS | 4, 15, 17, 20 |
| §6.8 hak akses & PIN supervisor | 6, 10, 12, 18, 19 |
| §7 model data (subset M1) | 5 |
| §8 UI Playful Violet, layout split, alur mulai/stop, notifikasi suara | 16–20 |
| §11 recovery restart, reconnect klien, validasi, keamanan dasar | 6, 13, 14, 17 |
| §12 unit, integrasi, driver, E2E | semua task, 21 |

**Di luar M1 (sesuai §14):** produk/pesanan/checkout/pembayaran/struk/shift (M2), booking & member (M3), stok & laporan (M4), Docker/installer/backup/driver Arduino asli (M5).

