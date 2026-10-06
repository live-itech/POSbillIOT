# FunPlay M3 — Booking & Member: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Booking meja dengan DP, tampilan meja **Booked** menjelang jadwal, check-in yang memakai DP otomatis saat bayar, no-show otomatis, serta member dengan level dan diskon level otomatis — di atas M2 "Transaksi".

**Architecture:** Kalkulator total bill di `packages/shared` diperluas dengan diskon member (snapshot persen level di bill) dan cakupan `PREPAID` untuk baris DP; validasi pembayaran menerima metode `DEPOSIT` dengan aturan nominal yang ketat. DP adalah **bill terpisah `kind = DEPOSIT`** yang dibayar lewat checkout M2 yang sudah idempoten; saat bill penjualan booking dibayar, DP dipakai sebagai metode `DEPOSIT` di bawah kunci baris `Booking`. Server menambah modul `members` (level & member) dan `bookings` (CRUD, bentrok di bawah kunci `Unit`, DP, check-in lewat `SessionService.startTx`, batal, kembalikan DP, no-show dari scheduler), serta mengubah `billing` (member di bill, `DEPOSIT`, void yang mengembalikan DP, gabung), `sessions` (`BOOKING_HOLD`/`ignoreBooking`), `board` (`UnitView.booking`), `shifts` (rekap non-kas) dan `printing`. Web menambah halaman Booking (timeline 24 jam) dan Member, pemilih member, kartu meja Booked + check-in, dan perubahan dialog Checkout.

**Tech Stack:** sama dengan M1/M2 — Node.js 22, pnpm 10, TypeScript 5, Fastify 5, Prisma 6, PostgreSQL, Socket.IO 4, zod 3, Vitest 3, React 19, Vite 7, Tailwind CSS 4, TanStack Query 5, zustand 5, Radix Dialog, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-06-funplay-m3-booking-member-design.md` (mengikat; mengesampingkan spec induk `docs/superpowers/specs/2026-09-29-funplay-pos-design.md` §6.5, §6.6, §6.8, §7, §8 bila bertentangan). **Saldo member, top-up, dan metode bayar saldo tidak ada di M3.**

## Global Constraints

Nilai mengikat dari spec M3 (dikutip apa adanya) dan aturan M2 yang tetap berlaku:

- Uang = integer Rupiah (`Int`); tidak ada float untuk uang. Persen = integer 0–100.
- Kalkulator total bill tunggal di `packages/shared`, dipakai pratinjau web dan angka final server. Urutan M3: **diskon item → diskon member (persen dari amount, `Math.round`, hanya pada baris tanpa diskon item; `timePct` untuk baris TIME, `fnbPct` untuk FNB) → diskon bill → service → pajak**.
- Kategori cakupan `PREPAID` (baris `DEPOSIT`) tidak masuk cakupan mana pun dan tidak menerima diskon member (juga tidak menerima diskon item/bill).
- Invarian tetap: `subtotal − discountTotal + serviceTotal + taxTotal = grandTotal`; `discountTotal` mencakup diskon member. `needsDiscountApproval` **tidak** memasukkan diskon member.
- Saat member dipasang ke bill, persen diskon level (billing & FnB) **di-snapshot ke bill**, dihitung ulang setiap kali member dipasang. Bill tidak berubah walau level diedit belakangan.
- Member dipasang di **bill**, bukan di sesi (bisa dipilih saat Mulai, saat check-in lewat member booking, atau di dialog Checkout).
- Member: kode otomatis `M0001`…, no. HP unik di antara member aktif, CRUD oleh Supervisor & Owner, kasir hanya mencari & memilih. Member yang pernah bertransaksi tidak dihapus, melainkan dinonaktifkan. Seed level: **"Reguler" 0/0**.
- DP = **bill terpisah `kind = DEPOSIT`** yang langsung dibayar lewat checkout M2. Bill DEPOSIT: satu baris saja (`DEPOSIT`), tidak bisa ditambah item, tanpa diskon/pajak/service, tidak bisa digabung, tidak bisa dibayar dengan `DEPOSIT`.
- Pembayaran `DEPOSIT` hanya untuk bill penjualan yang terhubung ke booking yang DP-nya sudah dibayar (bill DEPOSIT PAID) dan belum dipakai, hangus, atau dikembalikan: **`amount = min(DP, sisa tagihan)`, `received = DP`, `change = DP − amount`**; server menolak nilai lain dengan `PAYMENT_INVALID`. Kelebihan dikembalikan **tunai**. UI mengisinya otomatis dan tidak bisa diubah, hanya bisa dihapus.
- Kas seharusnya shift:
  ```
  expectedCash = openingCash
               + Σ amount  CASH    (bill PAID di shift ini)
               − Σ amount  CASH    (bill di-void di shift ini)
               − Σ change  DEPOSIT (bill PAID di shift ini)
               − Σ amount  DEPOSIT (bill di-void di shift ini)
  ```
- Void bill penjualan: pembayaran `DEPOSIT` dikembalikan tunai di shift void, `depositOutcome = REFUNDED`. Void bill DEPOSIT hanya bila DP belum dipakai → `REFUNDED`.
- Gabung bill: bila hanya bill sumber yang punya `bookingId`/`memberId`, nilainya dipindah ke target; keduanya punya booking, atau member berbeda → 409 `MERGE_CONFLICT`.
- Booking: dua booking `BOOKED` pada meja yang sama tidak boleh bertumpang waktu (jendela `[startAt, startAt + durasi)`, bersebelahan boleh) → 409 `BOOKING_CONFLICT`, dicek di bawah kunci baris `Unit`. Durasi default 60 menit (pilihan 30/60/90/120/lainnya; server 15–720).
- Hold: meja **Booked** mulai `bookingHoldMin` menit (**default 15**) sebelum jadwal sampai booking di-check-in, dibatalkan, atau no-show. No-show bila belum check-in `bookingNoShowMin` menit (**default 15**) setelah jadwal; DP default **hangus**. Semua waktu dari `clock`.
- Mulai sesi di meja yang di-hold (atau paket yang menabrak booking) → 409 `BOOKING_HOLD` + info booking; lanjut hanya dengan `ignoreBooking: true` (diaudit), **tanpa PIN**.
- Check-in: butuh shift terbuka, meja kosong, boleh sejak awal hold sampai no-show; memulai sesi (Open/Paket) dengan bill SALE baru yang terhubung ke booking dan member booking.
- PIN supervisor untuk KASIR (tambahan M3): batal booking yang DP-nya sudah dibayar, kembalikan DP. Aturan PIN M2 tetap (hapus/kurangi item, batal bill bertagihan, diskon di atas batas, void).
- Shift wajib (M2) + M3: buat booking ber-DP, check-in, pasang member di bill. Tanpa shift → 409 `NO_OPEN_SHIFT`.
- **Urutan kunci global:** `Session → Bill → Booking → Shift (share) → Product (urut id)`. Unit dikunci hanya oleh buat/ubah jadwal booking dan tidak pernah bersamaan dengan kunci Bill. Jalur yang menyentuh bill DEPOSIT **dan** booking (batal, kembalikan DP, no-show, check-in) selalu mengunci **bill DEPOSIT dulu**, baru booking, lalu memeriksa ulang status booking. Rinci di plan ini: baris `BillCounter` (nomor bill) selalu diambil **sebelum** `Unit`, dan ubah jadwal mengunci `Booking → Unit` (check-in juga `Booking → Unit` lewat mulai sesi), sehingga tidak ada siklus.
- Split payment satu request, satu idempotency key; lunas semua atau gagal semua; tidak ada "sebagian dibayar". Kembalian tunai hanya dari `CASH` (`change`), kembalian DP terpisah (`depositChange`).
- Struk 80 mm = 48 kolom. Kegagalan cetak tidak pernah membatalkan pembayaran.
- Kartu meja di-hold: cyan muda **`#CFFAFE`**, teks **"Booked · <nama> <HH:MM>"**, ikon 💰 bila DP sudah dibayar.
- Bahasa UI & pesan error: Indonesia. Jangan pakai `crypto.randomUUID()` di browser — pakai `newId()`.
- Jangan menjalankan `prisma migrate reset`/`migrate dev`. Migrasi dibuat dengan `prisma migrate diff` lalu diterapkan `prisma migrate deploy` (global-setup test). Jangan menyentuh DB dev `funplay`.

## Review Focus

1. **Member di bill** — pasang/lepas mengubah snapshot dengan benar; snapshot dihitung ulang saat dipasang ulang; bill PAID tidak berubah saat level diedit (Task 5, test "pasang/lepas member di bill OPEN…" & "bill PAID tidak berubah saat level diedit").
2. **DP tepat satu kali** — dipakai/hangus/dikembalikan sekali: checkout ulang key sama tidak mengulang efek (Task 8, "checkout ulang dengan key sama…"), void bill DP yang sudah dipakai ditolak (Task 8, "void bill DP…"), pakai vs kembalikan bersamaan → satu menang (Task 9, "DP dipakai dan dikembalikan bersamaan…"). Kas seharusnya untuk DP tunai, kembalian DP, dan void (Task 10, "rekap shift: DP tunai lalu dipakai dengan kembalian…" & "DP lebih kecil dari total…").
3. **Booking** — tidak pernah bertumpuk, termasuk paralel (Task 6, "dua booking bentrok paralel…"); hold & no-show tepat waktu menurut `clock` (Task 7, "meja tampil Booked mulai hold"; Task 9, "no-show otomatis menurut clock…"); check-in hanya sekali (Task 7, "check-in saat meja dipakai… paralel → satu berhasil").
4. **Diskon member** — pratinjau = server: kalkulator tunggal (Task 2) dengan angka yang sama di test server (Task 5, Rp 51.200) dan web (Task 12, Rp 51.200); diskon level tidak memicu PIN (Task 2 "needsDiscountApproval mengabaikan diskon member", Task 5 "… tidak butuh PIN walau besar"); snapshot tidak berubah saat level diedit (Task 5).
5. **Urutan kunci** — semua jalur baru mengikuti `Session → Bill → Booking → Shift → Product` tanpa deadlock: check-in vs scheduler (Task 9, "check-in dan scheduler bersamaan…"), checkout vs kembalikan DP (Task 9), gabung bill booking (Task 8). Setiap transaksi baru diberi komentar urutan kuncinya.

## Persiapan

Branch kerja: `feat/m3-booking-member` (bertumpuk di atas `feat/m2-transaksi`). DB `funplay_test` dan `funplay_e2e` sudah ada. `pnpm` ada di `~/.nvm/versions/node/v22.*/bin`; sebelum menjalankan perintah:
```bash
export PATH="$(ls -d ~/.nvm/versions/node/v22.*/bin | tail -1):$PATH"
```
Semua perintah `pnpm` dijalankan dari root repo kecuali disebut lain.

Catatan urutan: skema Prisma dikerjakan **di Task 1** (sebelum kalkulator shared) karena enum `PaymentMethod`/`LineType` di shared dan Prisma harus berubah bersamaan agar `pnpm typecheck` tetap hijau di setiap task.

## Struktur File (dikunci oleh plan ini)

```
packages/shared/src/
  transactions.ts          (ubah) DEPOSIT di PAYMENT_METHODS/LINE_TYPES, MANUAL_PAYMENT_METHODS, BillKind,
                           BillView.kind/member/booking, BillSummary.kind, CheckoutResult.depositChange, ShiftSummary.depositChange
  bookings.ts              status/outcome booking + label, BookingSettings, bookingWindow/bookingsOverlap/isOnHold/isNoShowDue, DTO booking
  members.ts               DTO level/member, BillMemberView, memberLabel
  views.ts                 (ubah) PublicSettings + BookingSettings, UnitView.booking, AlertType booking
  billing/bill-totals.ts   (ubah) diskon member, cakupan PREPAID
  billing/payment.ts       (ubah) metode DEPOSIT, depositChange
  receipt/receipt.ts       (ubah) judul, member, diskon member, Kembali DP
apps/server/
  prisma/schema.prisma, prisma/migrations/20261006090000_m3_booking_member/migration.sql
  src/lib/errors.ts                         (ubah) AppError.details
  src/modules/members/{members.service,members.routes}.ts
  src/modules/bookings/{booking-lock,booking-view,bookings.service,bookings.routes}.ts
  src/modules/billing/{bill-view,bills.service,bills.routes,checkout.service}.ts      (ubah)
  src/modules/sessions/{sessions.service,sessions.routes}.ts                         (ubah)
  src/modules/{board/board,scheduler/scheduler,shifts/shifts.service,printing/receipt-model,settings/settings.service,realtime/realtime}.ts (ubah)
  src/{app,context,lib/bus}.ts, src/seed-data.ts                                      (ubah)
  test/{members,member-bill,bookings,booking-checkin,booking-deposit,booking-lifecycle,booking-cash}.test.ts
apps/web/src/
  lib/{api,socket,events,format}.ts         (ubah)
  hooks/{useBill,useBookings}.ts
  features/members/{MembersPage,MemberDialog,MemberPicker,levels}.ts(x)
  features/bookings/{BookingsPage,Timeline,timeline,BookingDialog,BookingDetail,BookingActions,CheckInDialog}.ts(x)
  features/board/{UnitCard,UnitPanel,StartSession,ModePicker,BookedPanel,actions}.ts(x)
  features/checkout/{CheckoutDialog,PaymentComposer,MergeDialog}.tsx               (ubah)
  features/settings/{BookingSettings,SettingsPage}.tsx, features/shift/ShiftPage.tsx, features/transactions/BillDetail.tsx
  features/layout/AppShell.tsx, App.tsx
e2e/booking-member.spec.ts
```

---
### Task 1: Skema Prisma M3, konstanta shared, dan pengaturan Booking

**Files:**
- Modify: `packages/shared/src/transactions.ts`, `packages/shared/src/views.ts`, `packages/shared/src/index.ts`, `packages/shared/src/billing/payment.ts`
- Create: `packages/shared/src/bookings.ts`
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/20261006090000_m3_booking_member/migration.sql` (dihasilkan `prisma migrate diff`)
- Modify: `apps/server/src/modules/settings/settings.service.ts`
- Modify: `apps/web/src/features/checkout/PaymentComposer.tsx`
- Modify (fixture `PublicSettings`/`ShiftSummary`): `apps/web/src/features/board/UnitPanel.test.tsx`, `apps/web/src/features/board/UnitCard.test.tsx`, `apps/web/src/features/checkout/CheckoutDialog.test.tsx`, `apps/web/src/features/transactions/BillDetail.test.tsx`, `apps/web/src/features/orders/BillItems.test.tsx`, `apps/web/src/hooks/useBill.test.ts`, `apps/web/src/features/settings/TransactionSettings.test.tsx`, `apps/web/src/features/shift/ShiftPage.test.tsx`, `apps/web/src/stores/board.test.ts`
- Test: `apps/server/test/settings-users.test.ts`, `packages/shared/src/billing/payment.test.ts`

**Interfaces:**
- Consumes: skema & modul M2.
- Produces:
  - shared: `PAYMENT_METHODS` + `'DEPOSIT'`, `PAYMENT_METHOD_LABEL.DEPOSIT = 'DP booking'`, `MANUAL_PAYMENT_METHODS` (`CASH QRIS CARD TRANSFER`), `LINE_TYPES` + `'DEPOSIT'`, `BILL_KINDS`/`BillKind`; `BOOKING_STATUSES`/`BookingStatus`, `BOOKING_STATUS_LABEL` (`Dipesan`, `Check-in`, `Tidak datang`, `Dibatalkan`), `DEPOSIT_OUTCOMES`/`DepositOutcome`, `DEPOSIT_OUTCOME_LABEL` (`DP terpakai`, `DP hangus`, `DP dikembalikan`), `BookingSettings`, `DEFAULT_BOOKING_SETTINGS = { bookingHoldMin: 15, bookingNoShowMin: 15 }`; `PublicSettings extends TransactionSettings, BookingSettings`.
  - Prisma: enum `BillKind`, `BookingStatus`, `DepositOutcome`; `LineType.DEPOSIT`, `PaymentMethod.DEPOSIT`; `Setting.bookingHoldMin/bookingNoShowMin`; `Bill.kind/memberId/memberName/memberLevelName/memberTimeDiscountPct/memberFnbDiscountPct/bookingId`; model `MemberLevel`, `Member`, `MemberCounter`, `Booking`.
  - API: `GET/PUT /api/settings` memuat `bookingHoldMin` (0–240) dan `bookingNoShowMin` (1–240).

Catatan desain: spec §5 hanya menyebut snapshot `memberName`; plan ini menambah **`memberLevelName`** (snapshot) karena struk wajib menampilkan "nama member dan level" pada saat bayar. `Bill.bookingId`, `Booking.depositBillId`, dan `Booking.saleBillId` adalah kolom biasa (unik untuk dua yang terakhir) **tanpa relasi Prisma** agar tidak ada siklus FK Bill↔Booking; integritasnya dijaga service di bawah kunci baris.

- [ ] **Step 1: Konstanta shared**

Di `packages/shared/src/transactions.ts`, ganti tiga deklarasi pertama dan `LINE_TYPES`:
```ts
export const PAYMENT_METHODS = ['CASH', 'QRIS', 'CARD', 'TRANSFER', 'DEPOSIT'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = { CASH: 'Tunai', QRIS: 'QRIS', CARD: 'Kartu', TRANSFER: 'Transfer', DEPOSIT: 'DP booking' };
/** Metode yang bisa dipilih kasir. DEPOSIT hanya diisi otomatis dari DP booking. */
export const MANUAL_PAYMENT_METHODS = ['CASH', 'QRIS', 'CARD', 'TRANSFER'] as const satisfies readonly PaymentMethod[];
```
```ts
export const LINE_TYPES = ['TIME', 'PRODUCT', 'SERVICE', 'CUSTOM', 'DEPOSIT'] as const;
export type LineType = (typeof LINE_TYPES)[number];

/** SALE = bill penjualan biasa; DEPOSIT = bill DP booking (satu baris DEPOSIT). */
export const BILL_KINDS = ['SALE', 'DEPOSIT'] as const;
export type BillKind = (typeof BILL_KINDS)[number];
```

Buat `packages/shared/src/bookings.ts`:
```ts
export const BOOKING_STATUSES = ['BOOKED', 'CHECKED_IN', 'NO_SHOW', 'CANCELLED'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  BOOKED: 'Dipesan',
  CHECKED_IN: 'Check-in',
  NO_SHOW: 'Tidak datang',
  CANCELLED: 'Dibatalkan',
};

export const DEPOSIT_OUTCOMES = ['USED', 'FORFEITED', 'REFUNDED'] as const;
export type DepositOutcome = (typeof DEPOSIT_OUTCOMES)[number];
export const DEPOSIT_OUTCOME_LABEL: Record<DepositOutcome, string> = { USED: 'DP terpakai', FORFEITED: 'DP hangus', REFUNDED: 'DP dikembalikan' };

export interface BookingSettings {
  /** Meja tampil Booked mulai sekian menit sebelum jadwal. */
  bookingHoldMin: number;
  /** Booking yang belum check-in sekian menit setelah jadwal menjadi no-show. */
  bookingNoShowMin: number;
}

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = { bookingHoldMin: 15, bookingNoShowMin: 15 };
```

Di `packages/shared/src/views.ts`: tambah `import type { BookingSettings } from './bookings';` dan ubah deklarasi menjadi `export interface PublicSettings extends TransactionSettings, BookingSettings {` (field M1 tetap).

Di `packages/shared/src/index.ts` tambahkan di akhir:
```ts
export * from './bookings';
```

- [ ] **Step 2: Tulis test yang gagal**

Di `apps/server/test/settings-users.test.ts`, test `'GET mengembalikan default'`: tambahkan baris berikut di dalam objek `toEqual` setelah baris `printerDriver: …`:
```ts
      bookingHoldMin: 15, bookingNoShowMin: 15,
```
dan tambahkan di `describe('settings', ...)`:
```ts
  it('owner mengatur hold & no-show booking dengan batas', async () => {
    const cookie = await loginAs(t.app, 'owner');
    const ok = await t.app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie }, payload: { bookingHoldMin: 30, bookingNoShowMin: 20 } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ bookingHoldMin: 30, bookingNoShowMin: 20 });
    for (const payload of [{ bookingHoldMin: -1 }, { bookingHoldMin: 241 }, { bookingNoShowMin: 0 }, { bookingNoShowMin: 1.5 }]) {
      const res = await t.app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie }, payload });
      expect(res.statusCode).toBe(400);
    }
  });
```

Di `packages/shared/src/billing/payment.test.ts`, tambahkan di `describe('checkPayments', ...)`:
```ts
  it('DP booking ditolak tanpa konteks booking', () => {
    expect(checkPayments(10000, [{ method: 'DEPOSIT', amount: 10000 }])).toMatchObject({ ok: false, code: 'PAYMENT_INVALID' });
  });
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- settings-users && pnpm --filter @funplay/shared test -- payment`
Expected: FAIL — `bookingHoldMin` tidak ada di respons; `checkPayments` menerima DEPOSIT sebagai metode non-tunai.

- [ ] **Step 4: Ubah skema Prisma**

Di `apps/server/prisma/schema.prisma`:

1. Tambah nilai enum dan enum baru:
```prisma
enum LineType {
  TIME
  PRODUCT
  SERVICE
  CUSTOM
  DEPOSIT
}

enum PaymentMethod {
  CASH
  QRIS
  CARD
  TRANSFER
  DEPOSIT
}

enum BillKind {
  SALE
  DEPOSIT
}

enum BookingStatus {
  BOOKED
  CHECKED_IN
  NO_SHOW
  CANCELLED
}

enum DepositOutcome {
  USED
  FORFEITED
  REFUNDED
}
```
(ganti blok `enum LineType` dan `enum PaymentMethod` yang lama; tiga enum lain ditambahkan setelahnya).

2. Di `model Setting`, sebelum `updatedAt`:
```prisma
  bookingHoldMin      Int      @default(15)
  bookingNoShowMin    Int      @default(15)
```

3. Di `model Unit`, setelah `segments SessionSegment[]`:
```prisma
  bookings      Booking[]
```

4. Di `model Bill`, setelah `voidShift …`:
```prisma
  kind                  BillKind      @default(SALE)
  memberId              String?
  member                Member?       @relation(fields: [memberId], references: [id], onDelete: Restrict)
  /// Snapshot saat member dipasang (tidak berubah walau member/level diedit).
  memberName            String?
  memberLevelName       String?
  memberTimeDiscountPct Int           @default(0)
  memberFnbDiscountPct  Int           @default(0)
  /// Bill SALE milik booking (check-in). Tanpa relasi Prisma: Booking juga menunjuk Bill.
  bookingId             String?
```
dan tambahkan `@@index([bookingId])` di bawah `@@index([createdAt])`.

5. Tambahkan model baru di akhir file:
```prisma
model MemberLevel {
  id              String   @id @default(cuid())
  name            String   @unique
  timeDiscountPct Int      @default(0)
  fnbDiscountPct  Int      @default(0)
  sortOrder       Int      @default(0)
  active          Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  members         Member[]
}

model Member {
  id        String      @id @default(cuid())
  code      String      @unique
  name      String
  phone     String      @default("")
  levelId   String
  level     MemberLevel @relation(fields: [levelId], references: [id], onDelete: Restrict)
  active    Boolean     @default(true)
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt
  bills     Bill[]
  bookings  Booking[]

  @@index([phone])
}

/// Satu baris (id = 1). `next` = nomor member berikutnya; barisnya dikunci untuk setiap penulisan member.
model MemberCounter {
  id   Int @id @default(1)
  next Int @default(1)
}

model Booking {
  id                String          @id @default(cuid())
  unitId            String
  unit              Unit            @relation(fields: [unitId], references: [id], onDelete: Restrict)
  customerName      String
  phone             String          @default("")
  memberId          String?
  member            Member?         @relation(fields: [memberId], references: [id], onDelete: Restrict)
  startAt           DateTime
  durationMin       Int
  note              String          @default("")
  status            BookingStatus   @default(BOOKED)
  depositAmount     Int             @default(0)
  /// Bill DEPOSIT (DP). Tanpa relasi Prisma (lihat Bill.bookingId).
  depositBillId     String?         @unique
  depositOutcome    DepositOutcome?
  depositUsedAmount Int             @default(0)
  /// Bill SALE yang dibuat saat check-in.
  saleBillId        String?         @unique
  holdNotifiedAt    DateTime?
  cancelReason      String?
  createdById       String
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  @@index([unitId, startAt])
  @@index([status, startAt])
}
```

- [ ] **Step 5: Buat migrasi tanpa menyentuh database**

```bash
cd apps/server
OLD=$(mktemp --suffix=.prisma)
git show HEAD:apps/server/prisma/schema.prisma > "$OLD"
mkdir -p prisma/migrations/20261006090000_m3_booking_member
pnpm exec prisma migrate diff --from-schema-datamodel "$OLD" --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261006090000_m3_booking_member/migration.sql
rm "$OLD"
pnpm exec prisma generate
cd ../..
```
Expected: `migration.sql` berisi `ALTER TYPE "LineType" ADD VALUE 'DEPOSIT'`, `ALTER TYPE "PaymentMethod" ADD VALUE 'DEPOSIT'`, `CREATE TYPE "BillKind"`, `CREATE TABLE "Booking"`, `CREATE UNIQUE INDEX "Booking_depositBillId_key"`, `CREATE TABLE "MemberCounter"`. Tidak ada nilai enum baru yang dipakai sebagai default di migrasi yang sama.

- [ ] **Step 6: Ekspos pengaturan booking & tolak DEPOSIT sementara**

`apps/server/src/modules/settings/settings.service.ts` — `toPublicSettings` menambah (setelah `printerPort`):
```ts
    bookingHoldMin: s.bookingHoldMin,
    bookingNoShowMin: s.bookingNoShowMin,
```
dan `settingsUpdateSchema` menambah (setelah `printerPort`):
```ts
    bookingHoldMin: z.number().int().min(0).max(240),
    bookingNoShowMin: z.number().int().min(1).max(240),
```

`packages/shared/src/billing/payment.ts` — di awal loop `for (const p of payments)`, tepat setelah cek `isPositiveInt`, tambahkan (Task 2 menggantinya dengan aturan DEPOSIT lengkap):
```ts
    if (p.method === 'DEPOSIT') return invalid('DP booking tidak tersedia untuk bill ini');
```

`apps/web/src/features/checkout/PaymentComposer.tsx` — ganti import dan loop tombol metode agar DEPOSIT tidak bisa dipilih manual:
```ts
import { cashPayment, MANUAL_PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentInput, type PaymentMethod } from '@funplay/shared';
```
```tsx
        {MANUAL_PAYMENT_METHODS.map((m) => (
```

- [ ] **Step 7: Perbarui fixture web**

```bash
cd apps/web/src
for f in features/board/UnitPanel.test.tsx features/board/UnitCard.test.tsx features/checkout/CheckoutDialog.test.tsx \
  features/transactions/BillDetail.test.tsx features/orders/BillItems.test.tsx hooks/useBill.test.ts \
  features/settings/TransactionSettings.test.tsx features/shift/ShiftPage.test.tsx stores/board.test.ts; do
  sed -i 's/\.\.\.DEFAULT_TRANSACTION_SETTINGS }/...DEFAULT_TRANSACTION_SETTINGS, ...DEFAULT_BOOKING_SETTINGS }/; s/^import { DEFAULT_TRANSACTION_SETTINGS/import { DEFAULT_BOOKING_SETTINGS, DEFAULT_TRANSACTION_SETTINGS/' "$f"
done
sed -i 's/TRANSFER: 0 }/TRANSFER: 0, DEPOSIT: 0 }/g' features/shift/ShiftPage.test.tsx
cd ../../..
```
Expected: `grep -c DEFAULT_BOOKING_SETTINGS` bernilai 2 di setiap file tersebut; fixture `ShiftSummary` memuat `DEPOSIT: 0` di `sales` dan `voids`.

- [ ] **Step 8: Jalankan test & typecheck semua paket**

Run: `pnpm typecheck && pnpm test`
Expected: PASS (shared, server, web; test lama + 2 test baru).

- [ ] **Step 9: Commit**

```bash
git add packages/shared apps/server/prisma apps/server/src/modules/settings apps/server/test/settings-users.test.ts apps/web/src
git commit -m "feat: M3 schema, booking settings and DEPOSIT constants

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 2: Kalkulator diskon member + cakupan PREPAID, validasi pembayaran DEPOSIT (`shared`)

**Files:**
- Modify: `packages/shared/src/billing/bill-totals.ts`, `packages/shared/src/billing/payment.ts`
- Test: `packages/shared/src/billing/bill-totals.test.ts`, `packages/shared/src/billing/payment.test.ts`

**Interfaces:**
- Consumes: `Discount`, `LineType`, `Scope`, `PaymentMethod` (Task 1).
- Produces:
  - `LineScope = 'BILLING' | 'FNB' | 'PREPAID'`; `lineScope('DEPOSIT') === 'PREPAID'`.
  - `MemberDiscount { timePct: number; fnbPct: number }`; `memberDiscountPct(scope, m)`.
  - `computeBillTotals(lines, billDiscount, settings, memberDiscount: MemberDiscount | null = null): BillTotals` — `BillTotalsLine` menambah `memberDiscount`; `BillTotals` menambah `memberDiscountTotal`.
  - `needsDiscountApproval(t, pct)` = `(discountTotal − memberDiscountTotal) × 100 > subtotal × pct`.
  - `checkPayments(grandTotal, payments, opts?: PaymentCheckOptions)` dengan `PaymentCheckOptions { deposit?: number | null }`; hasil OK menambah `depositChange` (`change` = kembalian `CASH` saja).

- [ ] **Step 1: Tulis test yang gagal**

Ganti seluruh isi `packages/shared/src/billing/bill-totals.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { allocate, computeBillTotals, discountAmount, lineScope, needsDiscountApproval, type TotalsLineInput, type TotalsSettings } from './bill-totals';

const NO_TAX: TotalsSettings = { taxPct: 0, taxScope: 'ALL', servicePct: 0, serviceScope: 'ALL' };
const time = (amount: number, id = 't'): TotalsLineInput => ({ id, scope: 'BILLING', amount, discount: null });
const fnb = (amount: number, id = 'f'): TotalsLineInput => ({ id, scope: 'FNB', amount, discount: null });

describe('lineScope', () => {
  it('TIME = BILLING, DEPOSIT = PREPAID, lainnya FNB', () => {
    expect(lineScope('TIME')).toBe('BILLING');
    expect(lineScope('PRODUCT')).toBe('FNB');
    expect(lineScope('SERVICE')).toBe('FNB');
    expect(lineScope('CUSTOM')).toBe('FNB');
    expect(lineScope('DEPOSIT')).toBe('PREPAID');
  });
});

describe('discountAmount', () => {
  it('persen dibulatkan, nominal dibatasi base', () => {
    expect(discountAmount(20000, { type: 'PERCENT', value: 10 })).toBe(2000);
    expect(discountAmount(12345, { type: 'PERCENT', value: 10 })).toBe(1235);
    expect(discountAmount(5000, { type: 'AMOUNT', value: 999999 })).toBe(5000);
    expect(discountAmount(5000, { type: 'PERCENT', value: 150 })).toBe(5000);
    expect(discountAmount(5000, null)).toBe(0);
    expect(discountAmount(0, { type: 'AMOUNT', value: 100 })).toBe(0);
  });
});

describe('allocate', () => {
  it('jumlah hasil = total, sisa ke pecahan terbesar lalu indeks terkecil', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(4000, [30000, 10000])).toEqual([3000, 1000]);
    expect(allocate(5, [0, 0])).toEqual([0, 0]);
    expect(allocate(0, [10, 20])).toEqual([0, 0]);
  });
});

describe('computeBillTotals', () => {
  it('tanpa diskon/pajak: total = subtotal', () => {
    const t = computeBillTotals([time(50000), fnb(20000)], null, NO_TAX);
    expect(t).toMatchObject({ subtotal: 70000, discountTotal: 0, memberDiscountTotal: 0, serviceTotal: 0, taxTotal: 0, grandTotal: 70000 });
  });

  it('diskon item lalu diskon bill dibagi proporsional', () => {
    const t = computeBillTotals(
      [time(30000, 'a'), { ...fnb(12000, 'b'), discount: { type: 'AMOUNT', value: 2000 } }],
      { type: 'PERCENT', value: 10 },
      NO_TAX,
    );
    // setelah diskon item: 30000 + 10000 = 40000 → diskon bill 4000 → 3000 / 1000
    expect(t.itemDiscountTotal).toBe(2000);
    expect(t.billDiscountTotal).toBe(4000);
    expect(t.lines).toEqual([
      { id: 'a', amount: 30000, itemDiscount: 0, memberDiscount: 0, billDiscount: 3000, net: 27000 },
      { id: 'b', amount: 12000, itemDiscount: 2000, memberDiscount: 0, billDiscount: 1000, net: 9000 },
    ]);
    expect(t).toMatchObject({ subtotal: 42000, discountTotal: 6000, grandTotal: 36000 });
  });

  it('service FNB 10% lalu pajak ALL 11% atas net + service', () => {
    const t = computeBillTotals([time(50000), fnb(20000)], null, { taxPct: 11, taxScope: 'ALL', servicePct: 10, serviceScope: 'FNB' });
    expect(t.serviceTotal).toBe(2000);
    expect(t.taxTotal).toBe(7920); // 11% × (50000 + 20000 + 2000)
    expect(t.grandTotal).toBe(79920);
  });

  it('pajak hanya BILLING, service ALL 5%', () => {
    const t = computeBillTotals([time(50000), fnb(20000)], null, { taxPct: 10, taxScope: 'BILLING', servicePct: 5, serviceScope: 'ALL' });
    expect(t.serviceTotal).toBe(3500);
    expect(t.taxTotal).toBe(5250); // 10% × (50000 + 2500)
    expect(t.grandTotal).toBe(78750);
  });

  it('cakupan NONE menonaktifkan pajak/service', () => {
    const t = computeBillTotals([time(50000)], null, { taxPct: 11, taxScope: 'NONE', servicePct: 10, serviceScope: 'NONE' });
    expect(t).toMatchObject({ serviceTotal: 0, taxTotal: 0, grandTotal: 50000 });
  });

  it('bill kosong → semua nol', () => {
    expect(computeBillTotals([], { type: 'AMOUNT', value: 5000 }, NO_TAX)).toMatchObject({ subtotal: 0, discountTotal: 0, grandTotal: 0, lines: [] });
  });

  it('diskon member: TIME pakai timePct, FNB pakai fnbPct, dibulatkan', () => {
    const t = computeBillTotals([time(50000, 'a'), fnb(20000, 'b'), fnb(12345, 'c')], null, NO_TAX, { timePct: 10, fnbPct: 5 });
    // 5000 + 1000 + round(617,25) = 617
    expect(t.lines.map((l) => l.memberDiscount)).toEqual([5000, 1000, 617]);
    expect(t.lines.map((l) => l.net)).toEqual([45000, 19000, 11728]);
    expect(t).toMatchObject({ subtotal: 82345, memberDiscountTotal: 6617, discountTotal: 6617, grandTotal: 75728 });
  });

  it('baris dengan diskon item tidak mendapat diskon member', () => {
    const t = computeBillTotals([{ ...fnb(20000, 'a'), discount: { type: 'AMOUNT', value: 2000 } }, fnb(10000, 'b')], null, NO_TAX, { timePct: 0, fnbPct: 10 });
    expect(t.lines).toEqual([
      { id: 'a', amount: 20000, itemDiscount: 2000, memberDiscount: 0, billDiscount: 0, net: 18000 },
      { id: 'b', amount: 10000, itemDiscount: 0, memberDiscount: 1000, billDiscount: 0, net: 9000 },
    ]);
    expect(t).toMatchObject({ itemDiscountTotal: 2000, memberDiscountTotal: 1000, discountTotal: 3000, grandTotal: 27000 });
  });

  it('diskon member sebelum diskon bill; baris PREPAID di luar diskon, service, dan pajak', () => {
    const t = computeBillTotals(
      [{ id: 'dp', scope: 'PREPAID', amount: 50000, discount: { type: 'PERCENT', value: 50 } }, fnb(20000, 'f')],
      { type: 'PERCENT', value: 10 },
      { taxPct: 10, taxScope: 'ALL', servicePct: 10, serviceScope: 'ALL' },
      { timePct: 10, fnbPct: 10 },
    );
    // f: member 2000 → 18000; bill 10% = 1800 → net 16200; service 1620; pajak 10% × (16200 + 1620) = 1782
    expect(t.lines[0]).toEqual({ id: 'dp', amount: 50000, itemDiscount: 0, memberDiscount: 0, billDiscount: 0, net: 50000 });
    expect(t.lines[1]).toEqual({ id: 'f', amount: 20000, itemDiscount: 0, memberDiscount: 2000, billDiscount: 1800, net: 16200 });
    expect(t).toMatchObject({ subtotal: 70000, discountTotal: 3800, serviceTotal: 1620, taxTotal: 1782, grandTotal: 69602 });
  });

  it('invarian untuk 300 input acak (termasuk member & PREPAID)', () => {
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const lineScopes = ['BILLING', 'FNB', 'PREPAID'] as const;
    for (let k = 0; k < 300; k++) {
      const lines: TotalsLineInput[] = Array.from({ length: 1 + rnd(5) }, (_, i) => ({
        id: String(i),
        scope: lineScopes[rnd(3)]!,
        amount: rnd(200000),
        discount: rnd(3) === 0 ? { type: rnd(2) ? 'PERCENT' : 'AMOUNT', value: rnd(2) ? rnd(101) : rnd(50000) } : null,
      }));
      const scopes = ['NONE', 'BILLING', 'FNB', 'ALL'] as const;
      const member = rnd(2) ? { timePct: rnd(101), fnbPct: rnd(101) } : null;
      const t = computeBillTotals(
        lines,
        rnd(2) ? { type: 'PERCENT', value: rnd(101) } : { type: 'AMOUNT', value: rnd(100000) },
        { taxPct: rnd(21), taxScope: scopes[rnd(4)]!, servicePct: rnd(21), serviceScope: scopes[rnd(4)]! },
        member,
      );
      expect(t.grandTotal).toBe(t.subtotal - t.discountTotal + t.serviceTotal + t.taxTotal);
      expect(t.discountTotal).toBe(t.itemDiscountTotal + t.memberDiscountTotal + t.billDiscountTotal);
      expect(t.lines.reduce((a, l) => a + l.net, 0)).toBe(t.subtotal - t.discountTotal);
      for (const v of [t.subtotal, t.discountTotal, t.serviceTotal, t.taxTotal, t.grandTotal]) {
        expect(Number.isInteger(v) && v >= 0).toBe(true);
      }
      t.lines.forEach((l, i) => {
        expect(l.net).toBeGreaterThanOrEqual(0);
        if (lines[i]!.scope === 'PREPAID') expect(l.net).toBe(l.amount);
      });
    }
  });
});

describe('needsDiscountApproval', () => {
  it('hanya bila diskon > batas persen subtotal', () => {
    const base = computeBillTotals([fnb(70000)], { type: 'AMOUNT', value: 7000 }, NO_TAX);
    expect(needsDiscountApproval(base, 10)).toBe(false);
    const more = computeBillTotals([fnb(70000)], { type: 'AMOUNT', value: 7001 }, NO_TAX);
    expect(needsDiscountApproval(more, 10)).toBe(true);
    expect(needsDiscountApproval(computeBillTotals([], null, NO_TAX), 10)).toBe(false);
  });

  it('mengabaikan diskon member', () => {
    const member = computeBillTotals([fnb(70000)], null, NO_TAX, { timePct: 0, fnbPct: 50 });
    expect(member.memberDiscountTotal).toBe(35000);
    expect(needsDiscountApproval(member, 10)).toBe(false);
    // diskon bill 7001 di atas diskon member 50% → 7001 > 10% × 70000
    const extra = computeBillTotals([fnb(70000)], { type: 'AMOUNT', value: 7001 }, NO_TAX, { timePct: 0, fnbPct: 50 });
    expect(needsDiscountApproval(extra, 10)).toBe(true);
  });
});
```

Ganti seluruh isi `packages/shared/src/billing/payment.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { cashPayment, checkPayments } from './payment';

describe('checkPayments', () => {
  it('tunai dengan kembalian', () => {
    const r = checkPayments(79920, [{ method: 'CASH', amount: 79920, received: 100000 }]);
    expect(r).toEqual({ ok: true, paid: 79920, change: 20080, depositChange: 0, payments: [{ method: 'CASH', amount: 79920, received: 100000, change: 20080, reference: null }] });
  });

  it('split tunai + QRIS', () => {
    const r = checkPayments(80000, [
      { method: 'CASH', amount: 50000, received: 50000 },
      { method: 'QRIS', amount: 30000, reference: 'ABC123' },
    ]);
    expect(r).toMatchObject({ ok: true, paid: 80000, change: 0 });
    if (r.ok) expect(r.payments[1]).toEqual({ method: 'QRIS', amount: 30000, received: null, change: null, reference: 'ABC123' });
  });

  it('tunai tanpa received = uang pas', () => {
    expect(checkPayments(15000, [{ method: 'CASH', amount: 15000 }])).toMatchObject({ ok: true, change: 0 });
  });

  it('kurang bayar → PAYMENT_INSUFFICIENT', () => {
    expect(checkPayments(80000, [{ method: 'CARD', amount: 50000 }])).toMatchObject({ ok: false, code: 'PAYMENT_INSUFFICIENT' });
  });

  it('jumlah bagian melebihi total → PAYMENT_INVALID', () => {
    expect(checkPayments(80000, [{ method: 'CASH', amount: 50000 }, { method: 'QRIS', amount: 40000 }])).toMatchObject({ ok: false, code: 'PAYMENT_INVALID' });
  });

  it('kembalian dari non-tunai ditolak', () => {
    expect(checkPayments(10000, [{ method: 'QRIS', amount: 10000, received: 20000 }])).toMatchObject({ ok: false, code: 'PAYMENT_INVALID' });
  });

  it('uang diterima kurang dari bagian tunai ditolak', () => {
    expect(checkPayments(10000, [{ method: 'CASH', amount: 10000, received: 5000 }])).toMatchObject({ ok: false, code: 'PAYMENT_INVALID' });
  });

  it('nominal 0, negatif, atau pecahan ditolak', () => {
    expect(checkPayments(10000, [{ method: 'CASH', amount: 0 }])).toMatchObject({ ok: false, code: 'PAYMENT_INVALID' });
    expect(checkPayments(10000, [{ method: 'CARD', amount: 10000.5 }])).toMatchObject({ ok: false, code: 'PAYMENT_INVALID' });
  });

  it('total 0 boleh tanpa pembayaran', () => {
    expect(checkPayments(0, [])).toEqual({ ok: true, paid: 0, change: 0, depositChange: 0, payments: [] });
    expect(checkPayments(5000, [])).toMatchObject({ ok: false, code: 'PAYMENT_INSUFFICIENT' });
  });
});

describe('checkPayments — DP booking (DEPOSIT)', () => {
  it('DP < total: DP utuh + sisa tunai', () => {
    const r = checkPayments(80000, [{ method: 'DEPOSIT', amount: 50000, received: 50000 }, { method: 'CASH', amount: 30000 }], { deposit: 50000 });
    expect(r).toMatchObject({ ok: true, paid: 80000, change: 0, depositChange: 0 });
  });

  it('DP > total: amount = total, kembalian DP terpisah dari kembalian tunai', () => {
    const r = checkPayments(40000, [{ method: 'DEPOSIT', amount: 40000, received: 50000 }], { deposit: 50000 });
    expect(r).toEqual({
      ok: true, paid: 40000, change: 0, depositChange: 10000,
      payments: [{ method: 'DEPOSIT', amount: 40000, received: 50000, change: 10000, reference: null }],
    });
  });

  it('received kosong = DP utuh', () => {
    expect(checkPayments(40000, [{ method: 'DEPOSIT', amount: 40000 }], { deposit: 50000 })).toMatchObject({ ok: true, depositChange: 10000 });
  });

  it('nominal selain min(DP, total) atau received ≠ DP ditolak', () => {
    expect(checkPayments(80000, [{ method: 'DEPOSIT', amount: 30000, received: 50000 }, { method: 'CASH', amount: 50000 }], { deposit: 50000 })).toMatchObject({ ok: false, code: 'PAYMENT_INVALID' });
    expect(checkPayments(40000, [{ method: 'DEPOSIT', amount: 40000, received: 40000 }], { deposit: 50000 })).toMatchObject({ ok: false, code: 'PAYMENT_INVALID' });
  });

  it('tanpa DP tersedia atau dipakai dua kali ditolak', () => {
    expect(checkPayments(10000, [{ method: 'DEPOSIT', amount: 10000 }])).toMatchObject({ ok: false, code: 'PAYMENT_INVALID' });
    expect(checkPayments(10000, [{ method: 'DEPOSIT', amount: 10000 }], { deposit: 0 })).toMatchObject({ ok: false, code: 'PAYMENT_INVALID' });
    expect(
      checkPayments(80000, [{ method: 'DEPOSIT', amount: 40000 }, { method: 'DEPOSIT', amount: 40000 }], { deposit: 40000 }),
    ).toMatchObject({ ok: false, code: 'PAYMENT_INVALID' });
  });
});

describe('cashPayment', () => {
  it('bagian = min(uang diterima, sisa)', () => {
    expect(cashPayment(30000, 50000)).toEqual({ method: 'CASH', amount: 30000, received: 50000 });
    expect(cashPayment(30000, 20000)).toEqual({ method: 'CASH', amount: 20000, received: 20000 });
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/shared test -- bill-totals payment`
Expected: FAIL — `lineScope('DEPOSIT')` = `'FNB'`, `memberDiscount`/`memberDiscountTotal`/`depositChange` tidak ada.

- [ ] **Step 3: Implementasi kalkulator**

Ganti seluruh isi `packages/shared/src/billing/bill-totals.ts`:
```ts
import type { Discount, LineType, Scope } from '../transactions';

/** PREPAID = baris DEPOSIT (DP booking): di luar semua cakupan dan tanpa diskon apa pun. */
export type LineScope = 'BILLING' | 'FNB' | 'PREPAID';
export const lineScope = (type: LineType): LineScope => (type === 'TIME' ? 'BILLING' : type === 'DEPOSIT' ? 'PREPAID' : 'FNB');

/** Persen diskon level member yang di-snapshot ke bill. */
export interface MemberDiscount { timePct: number; fnbPct: number }

export interface TotalsLineInput { id: string; scope: LineScope; amount: number; discount: Discount | null }
export interface TotalsSettings { taxPct: number; taxScope: Scope; servicePct: number; serviceScope: Scope }
export interface BillTotalsLine { id: string; amount: number; itemDiscount: number; memberDiscount: number; billDiscount: number; net: number }
export interface BillTotals {
  lines: BillTotalsLine[];
  subtotal: number;
  itemDiscountTotal: number;
  memberDiscountTotal: number;
  billDiscountTotal: number;
  discountTotal: number;
  serviceTotal: number;
  taxTotal: number;
  grandTotal: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const inScope = (scope: Scope, s: LineScope) => s !== 'PREPAID' && (scope === 'ALL' || scope === s);

/** Nilai diskon dalam Rupiah atas `base`: persen dibulatkan, hasil selalu 0..base. */
export function discountAmount(base: number, d: Discount | null): number {
  if (!d || base <= 0 || d.value <= 0) return 0;
  const raw = d.type === 'PERCENT' ? Math.round((base * Math.min(d.value, 100)) / 100) : Math.round(d.value);
  return Math.min(raw, base);
}

/** Bagi `total` ke `weights` secara proporsional (metode sisa terbesar). Jumlah hasil selalu = total. */
export function allocate(total: number, weights: number[]): number[] {
  const all = sum(weights);
  if (total <= 0 || all <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / all);
  const out = exact.map((e) => Math.floor(e));
  let rest = total - sum(out);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e), w: weights[i]! }))
    .sort((a, b) => b.frac - a.frac || b.w - a.w || a.i - b.i);
  for (const o of order) {
    if (rest <= 0) break;
    out[o.i]! += 1;
    rest--;
  }
  return out;
}

/** Persen diskon member untuk satu baris: timePct untuk BILLING, fnbPct untuk FNB, 0 untuk PREPAID. */
export function memberDiscountPct(scope: LineScope, m: MemberDiscount | null): number {
  if (!m || scope === 'PREPAID') return 0;
  return scope === 'BILLING' ? m.timePct : m.fnbPct;
}

/**
 * Total bill: subtotal → diskon item → diskon member (baris tanpa diskon item) → diskon bill (dibagi
 * proporsional ke baris non-PREPAID) → service atas net baris dalam `serviceScope` → pajak atas
 * (net + service tak-dibulatkan) baris dalam `taxScope`. Baris PREPAID (DP) tidak pernah didiskon,
 * diservice, atau dipajaki. Semua hasil integer Rupiah; dipakai pratinjau web dan angka final server.
 */
export function computeBillTotals(
  lines: TotalsLineInput[],
  billDiscount: Discount | null,
  s: TotalsSettings,
  memberDiscount: MemberDiscount | null = null,
): BillTotals {
  const prepaid = lines.map((l) => l.scope === 'PREPAID');
  const itemDisc = lines.map((l, i) => (prepaid[i] ? 0 : discountAmount(l.amount, l.discount)));
  const memberDisc = lines.map((l, i) =>
    itemDisc[i]! > 0 ? 0 : discountAmount(l.amount, { type: 'PERCENT', value: memberDiscountPct(l.scope, memberDiscount) }),
  );
  const afterMember = lines.map((l, i) => l.amount - itemDisc[i]! - memberDisc[i]!);
  const weights = afterMember.map((a, i) => (prepaid[i] ? 0 : a));
  const billDiscountTotal = discountAmount(sum(weights), billDiscount);
  const share = allocate(billDiscountTotal, weights);
  const out: BillTotalsLine[] = lines.map((l, i) => ({
    id: l.id,
    amount: l.amount,
    itemDiscount: itemDisc[i]!,
    memberDiscount: memberDisc[i]!,
    billDiscount: share[i]!,
    net: afterMember[i]! - share[i]!,
  }));

  let serviceBase = 0;
  let taxBaseX100 = 0; // basis pajak × 100 agar service per baris tetap integer
  lines.forEach((l, i) => {
    const net = out[i]!.net;
    const svcX100 = inScope(s.serviceScope, l.scope) ? net * s.servicePct : 0;
    if (inScope(s.serviceScope, l.scope)) serviceBase += net;
    if (inScope(s.taxScope, l.scope)) taxBaseX100 += net * 100 + svcX100;
  });
  const serviceTotal = Math.round((serviceBase * s.servicePct) / 100);
  const taxTotal = Math.round((taxBaseX100 * s.taxPct) / 10000);

  const subtotal = sum(lines.map((l) => l.amount));
  const itemDiscountTotal = sum(itemDisc);
  const memberDiscountTotal = sum(memberDisc);
  const discountTotal = itemDiscountTotal + memberDiscountTotal + billDiscountTotal;
  return {
    lines: out,
    subtotal,
    itemDiscountTotal,
    memberDiscountTotal,
    billDiscountTotal,
    discountTotal,
    serviceTotal,
    taxTotal,
    grandTotal: subtotal - discountTotal + serviceTotal + taxTotal,
  };
}

/** True bila diskon (tanpa diskon member) melebihi `pct` persen subtotal (butuh PIN supervisor untuk kasir). */
export function needsDiscountApproval(t: BillTotals, pct: number): boolean {
  return (t.discountTotal - t.memberDiscountTotal) * 100 > t.subtotal * pct;
}
```

- [ ] **Step 4: Implementasi validasi pembayaran**

Ganti seluruh isi `packages/shared/src/billing/payment.ts`:
```ts
import type { PaymentMethod } from '../transactions';

export interface PaymentInput {
  method: PaymentMethod;
  /** Bagian tagihan yang ditutup metode ini. */
  amount: number;
  /** Tunai: uang yang diserahkan pelanggan (≥ amount; kosong = uang pas). DEPOSIT: DP booking utuh. */
  received?: number | null;
  reference?: string | null;
}
export interface CheckedPayment { method: PaymentMethod; amount: number; received: number | null; change: number | null; reference: string | null }
export interface PaymentCheckOptions {
  /** DP booking yang tersedia untuk bill ini; kosong/0 = metode DEPOSIT tidak boleh dipakai. */
  deposit?: number | null;
}
export type PaymentCheck =
  | { ok: true; paid: number; change: number; depositChange: number; payments: CheckedPayment[] }
  | { ok: false; code: 'PAYMENT_INSUFFICIENT' | 'PAYMENT_INVALID'; message: string };

const invalid = (message: string): PaymentCheck => ({ ok: false, code: 'PAYMENT_INVALID', message });
const isPositiveInt = (n: number) => Number.isInteger(n) && n > 0;

/**
 * Validasi split payment. DEPOSIT (DP booking) hanya sah bila `opts.deposit` > 0, dipakai sekali,
 * dengan `amount = min(DP, total)` dan `received = DP`; kelebihannya menjadi `depositChange`
 * (dikembalikan tunai). `change` hanya kembalian dari pembayaran CASH.
 */
export function checkPayments(grandTotal: number, payments: PaymentInput[], opts: PaymentCheckOptions = {}): PaymentCheck {
  const checked: CheckedPayment[] = [];
  for (const p of payments) {
    if (!isPositiveInt(p.amount)) return invalid('Nominal pembayaran harus bilangan bulat lebih dari 0');
    const reference = p.reference?.trim() || null;
    if (p.method === 'DEPOSIT') {
      const dp = opts.deposit ?? 0;
      if (dp <= 0) return invalid('DP booking tidak tersedia untuk bill ini');
      if (checked.some((c) => c.method === 'DEPOSIT')) return invalid('DP booking hanya bisa dipakai sekali');
      const received = p.received ?? dp;
      if (received !== dp || p.amount !== Math.min(dp, grandTotal)) return invalid('Nominal DP booking tidak sesuai');
      checked.push({ method: 'DEPOSIT', amount: p.amount, received, change: received - p.amount, reference: null });
      continue;
    }
    if (p.method !== 'CASH') {
      if (p.received != null) return invalid('Kembalian hanya untuk pembayaran tunai');
      checked.push({ method: p.method, amount: p.amount, received: null, change: null, reference });
      continue;
    }
    const received = p.received ?? p.amount;
    if (!Number.isInteger(received) || received < p.amount) return invalid('Uang diterima kurang dari nominal tunai');
    checked.push({ method: 'CASH', amount: p.amount, received, change: received - p.amount, reference });
  }
  const paid = checked.reduce((a, p) => a + p.amount, 0);
  if (paid > grandTotal) return invalid('Pembayaran melebihi total tagihan');
  if (paid < grandTotal) return { ok: false, code: 'PAYMENT_INSUFFICIENT', message: 'Pembayaran belum mencukupi total tagihan' };
  const changeOf = (m: PaymentMethod) => checked.filter((c) => c.method === m).reduce((a, c) => a + (c.change ?? 0), 0);
  return { ok: true, paid, change: changeOf('CASH'), depositChange: changeOf('DEPOSIT'), payments: checked };
}

/** Tunai yang diserahkan pelanggan → bagian tagihan yang ditutup (sisanya jadi kembalian). */
export function cashPayment(remaining: number, received: number): PaymentInput {
  return { method: 'CASH', amount: Math.min(received, remaining), received };
}
```

- [ ] **Step 5: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/shared test && pnpm typecheck && pnpm --filter @funplay/server test -- checkout bills`
Expected: PASS. Server memakai `pay.change` (kini kembalian tunai saja — sama dengan M2 karena M2 hanya punya kembalian tunai); `linesTotals` server belum mengirim member (Task 5).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/billing
git commit -m "feat(shared): member discount, PREPAID scope and DEPOSIT payment rules

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 3: DTO & fungsi waktu booking/member, renderer struk M3 (`shared`)

**Files:**
- Modify: `packages/shared/src/bookings.ts`, `packages/shared/src/receipt/receipt.ts`, `packages/shared/src/index.ts`
- Create: `packages/shared/src/members.ts`
- Test: `packages/shared/src/bookings.test.ts`, `packages/shared/src/receipt/receipt.test.ts`

**Interfaces:**
- Consumes: `addMinutes`, `MS_PER_MIN` (`time.ts`), `BillStatus` (`transactions.ts`), `UnitView` (`views.ts`), konstanta Task 1.
- Produces:
  - `bookingWindow(startAt, durationMin): { start: Date; end: Date }` (end eksklusif), `bookingsOverlap(a, b): boolean`, `isOnHold(b, now, holdMin): boolean`, `isNoShowDue(b, now, noShowMin): boolean`, `holdStartsAt(startAt, holdMin): Date`.
  - DTO: `BookingView`, `UnitBookingView`, `BookingHoldInfo`, `BillBookingView`, `CreateBookingResult`, `CheckInResult`; `MemberLevelDto`, `MemberDto`, `BillMemberView`, `memberLabel(m) → "<nama> (<level>)"`.
  - `ReceiptModel` menambah opsional `title`, `member`, `lines[].memberDiscount`, `depositChange`; `ShiftReportModel` menambah opsional `depositChange`. Baris struk: judul tengah tebal, `Member: <nama> (<level>)`, `  Diskon member  -X`, `Kembali DP  X`; rekap: `  Kembali DP  -X`.

- [ ] **Step 1: Tulis test yang gagal**

`packages/shared/src/bookings.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { bookingsOverlap, bookingWindow, holdStartsAt, isNoShowDue, isOnHold } from './bookings';
import { memberLabel } from './members';

const at = '2026-10-01T12:00:00.000Z'; // 19:00 WIB

describe('bookingWindow & bookingsOverlap', () => {
  it('jendela [mulai, mulai + durasi)', () => {
    const w = bookingWindow(at, 90);
    expect(w.start.toISOString()).toBe(at);
    expect(w.end.toISOString()).toBe('2026-10-01T13:30:00.000Z');
  });

  it('tumpang tindih, bersebelahan tidak', () => {
    const a = { startAt: at, durationMin: 60 };
    expect(bookingsOverlap(a, { startAt: '2026-10-01T12:30:00.000Z', durationMin: 60 })).toBe(true);
    expect(bookingsOverlap(a, { startAt: '2026-10-01T11:30:00.000Z', durationMin: 120 })).toBe(true); // mencakup
    expect(bookingsOverlap(a, { startAt: at, durationMin: 30 })).toBe(true);
    expect(bookingsOverlap(a, { startAt: '2026-10-01T13:00:00.000Z', durationMin: 30 })).toBe(false); // mulai tepat saat a selesai
    expect(bookingsOverlap(a, { startAt: '2026-10-01T11:00:00.000Z', durationMin: 60 })).toBe(false); // selesai tepat saat a mulai
  });
});

describe('hold & no-show', () => {
  const b = { status: 'BOOKED' as const, startAt: at };
  it('hold mulai holdMin sebelum jadwal dan bertahan selama BOOKED', () => {
    expect(isOnHold(b, new Date('2026-10-01T11:44:59.000Z'), 15)).toBe(false);
    expect(isOnHold(b, new Date('2026-10-01T11:45:00.000Z'), 15)).toBe(true);
    expect(isOnHold(b, new Date('2026-10-01T13:00:00.000Z'), 15)).toBe(true);
    expect(isOnHold({ ...b, status: 'CHECKED_IN' }, new Date('2026-10-01T12:00:00.000Z'), 15)).toBe(false);
    expect(holdStartsAt(at, 15).toISOString()).toBe('2026-10-01T11:45:00.000Z');
  });

  it('no-show jatuh tempo noShowMin setelah jadwal', () => {
    expect(isNoShowDue(b, new Date('2026-10-01T12:14:59.000Z'), 15)).toBe(false);
    expect(isNoShowDue(b, new Date('2026-10-01T12:15:00.000Z'), 15)).toBe(true);
    expect(isNoShowDue({ ...b, status: 'CANCELLED' }, new Date('2026-10-01T13:00:00.000Z'), 15)).toBe(false);
  });
});

describe('memberLabel', () => {
  it('nama (level)', () => {
    expect(memberLabel({ name: 'Sinta', levelName: 'Gold' })).toBe('Sinta (Gold)');
  });
});
```

Tambahkan di akhir `packages/shared/src/receipt/receipt.test.ts`:
```ts
describe('renderReceipt — M3', () => {
  it('judul TANDA TERIMA DP untuk bill DEPOSIT', () => {
    expect(renderReceipt({ ...model, title: 'TANDA TERIMA DP' })).toContainEqual({ text: 'TANDA TERIMA DP', align: 'center', bold: true });
  });

  it('member, diskon member per baris, DP booking, dan Kembali DP', () => {
    const lines = renderReceipt({
      ...model,
      member: { name: 'Sinta', levelName: 'Gold' },
      lines: [{ name: 'Meja 2 - Open billing', qty: 1, unitPrice: 40000, amount: 40000, discount: 0, memberDiscount: 4000, details: [] }],
      subtotal: 40000,
      discountTotal: 4000,
      grandTotal: 36000,
      payments: [{ label: 'DP booking', amount: 50000 }],
      change: 0,
      depositChange: 14000,
    });
    const text = toPlainText(lines);
    for (const l of lines) expect(l.text.length).toBeLessThanOrEqual(RECEIPT_WIDTH);
    expect(text).toContain('Member: Sinta (Gold)');
    expect(text).toContain(twoCols('  Diskon member', '-4.000'));
    expect(text).toContain(twoCols('DP booking', '50.000'));
    expect(text).toContain(twoCols('Kembali DP', '14.000'));
    expect(text).not.toContain('Kembalian');
  });

  it('rekap shift menampilkan Kembali DP di bawah penjualan', () => {
    const text = toPlainText(
      renderShiftReport({
        outletName: 'FunPlay', openedAt: '01/10/2026 08:00', closedAt: '01/10/2026 16:00', openedBy: 'Andi', closedBy: 'Andi',
        openingCash: 100000, sales: [{ label: 'Tunai', amount: 50000 }, { label: 'DP booking (non-kas)', amount: 40000 }],
        voids: [], billCount: 2, voidCount: 0, expectedCash: 140000, countedCash: 140000, note: null, depositChange: 10000,
      }),
    );
    expect(text).toContain(twoCols('  DP booking (non-kas)', '40.000'));
    expect(text).toContain(twoCols('  Kembali DP', '-10.000'));
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/shared test -- bookings receipt`
Expected: FAIL — `bookingWindow`/`./members` tidak ada; judul/member/Kembali DP tidak dirender.

- [ ] **Step 3: Implementasi fungsi waktu & DTO**

Tambahkan di akhir `packages/shared/src/bookings.ts` (import diletakkan di baris paling atas file):
```ts
import { addMinutes, MS_PER_MIN } from './time';
import type { BillStatus } from './transactions';
import type { UnitView } from './views';
```
```ts
type Instant = Date | string;
const ms = (t: Instant) => new Date(t).getTime();

export interface BookingTimeLike { startAt: Instant; durationMin: number }

/** Jendela booking [start, end): end eksklusif sehingga booking bersebelahan tidak bentrok. */
export function bookingWindow(startAt: Instant, durationMin: number): { start: Date; end: Date } {
  const start = new Date(startAt);
  return { start, end: addMinutes(start, durationMin) };
}

export function bookingsOverlap(a: BookingTimeLike, b: BookingTimeLike): boolean {
  const x = bookingWindow(a.startAt, a.durationMin);
  const y = bookingWindow(b.startAt, b.durationMin);
  return x.start.getTime() < y.end.getTime() && y.start.getTime() < x.end.getTime();
}

export const holdStartsAt = (startAt: Instant, holdMin: number): Date => addMinutes(new Date(startAt), -holdMin);

/** Meja di-hold sejak `holdMin` menit sebelum jadwal selama booking masih BOOKED (sampai check-in/batal/no-show). */
export function isOnHold(b: { status: BookingStatus; startAt: Instant }, now: Date, holdMin: number): boolean {
  return b.status === 'BOOKED' && now.getTime() >= ms(b.startAt) - holdMin * MS_PER_MIN;
}

/** Booking BOOKED yang belum check-in `noShowMin` menit setelah jadwal. */
export function isNoShowDue(b: { status: BookingStatus; startAt: Instant }, now: Date, noShowMin: number): boolean {
  return b.status === 'BOOKED' && now.getTime() >= ms(b.startAt) + noShowMin * MS_PER_MIN;
}

export interface BookingView {
  id: string;
  unitId: string;
  unitName: string;
  customerName: string;
  phone: string;
  memberId: string | null;
  memberCode: string | null;
  startAt: string;
  durationMin: number;
  note: string;
  status: BookingStatus;
  depositAmount: number;
  depositBillId: string | null;
  /** Status bill DEPOSIT: OPEN = DP belum dibayar, PAID = sudah dibayar, VOID = dikembalikan. */
  depositBillStatus: BillStatus | null;
  depositOutcome: DepositOutcome | null;
  depositUsedAmount: number;
  saleBillId: string | null;
  cancelReason: string | null;
  createdByName: string;
  createdAt: string;
}

/** Booking yang sedang menahan meja (kartu "Booked"). */
export interface UnitBookingView { id: string; customerName: string; startAt: string; durationMin: number; depositPaid: boolean }

/** `error.details.booking` pada 409 BOOKING_HOLD. */
export interface BookingHoldInfo { id: string; customerName: string; startAt: string }

/** Booking yang terhubung ke bill. `deposit` hanya untuk bill SALE booking ber-DP. */
export interface BillBookingView {
  id: string;
  customerName: string;
  startAt: string;
  status: BookingStatus;
  deposit: { amount: number; available: boolean } | null;
}

export interface CreateBookingResult { booking: BookingView; depositBillId: string | null }
export interface CheckInResult { unit: UnitView | null; booking: BookingView }
```

Buat `packages/shared/src/members.ts`:
```ts
export interface MemberLevelDto { id: string; name: string; timeDiscountPct: number; fnbDiscountPct: number; sortOrder: number; active: boolean }

export interface MemberDto {
  id: string;
  code: string;
  name: string;
  phone: string;
  levelId: string;
  levelName: string;
  active: boolean;
  createdAt: string;
}

/** Member di bill: nama, level, dan persen diskon adalah snapshot saat member dipasang. */
export interface BillMemberView { id: string; code: string; name: string; levelName: string; timeDiscountPct: number; fnbDiscountPct: number }

export const memberLabel = (m: { name: string; levelName: string }): string => `${m.name} (${m.levelName})`;
```

Tambahkan di akhir `packages/shared/src/index.ts`:
```ts
export * from './members';
```

- [ ] **Step 4: Renderer struk**

Di `packages/shared/src/receipt/receipt.ts`, ganti `interface ReceiptModel`, `renderReceipt`, `interface ShiftReportModel`, dan `renderShiftReport` dengan:
```ts
export interface ReceiptModel {
  outletName: string;
  address: string;
  header: string;
  footer: string;
  billNumber: string;
  printedAt: string;
  cashier: string;
  label: string;
  /** Judul di bawah header, mis. "TANDA TERIMA DP" untuk bill DEPOSIT. */
  title?: string | null;
  member?: { name: string; levelName: string } | null;
  sessions: { unitName: string; start: string; end: string }[];
  lines: { name: string; qty: number; unitPrice: number; amount: number; discount: number; memberDiscount?: number; details: string[] }[];
  subtotal: number;
  discountTotal: number;
  serviceTotal: number;
  taxTotal: number;
  grandTotal: number;
  payments: { label: string; amount: number }[];
  /** Kembalian dari pembayaran tunai. */
  change: number;
  /** Kelebihan DP booking yang dikembalikan tunai. */
  depositChange?: number;
  copy: 'REPRINT' | 'VOID' | null;
}

export function renderReceipt(m: ReceiptModel): PrintLine[] {
  const out: PrintLine[] = [center(m.outletName, { bold: true, tall: true })];
  if (m.address.trim()) out.push(center(m.address.trim()));
  for (const h of multiline(m.header)) out.push(center(h));
  out.push(rule());
  if (m.title) out.push(center(m.title, { bold: true }));
  if (m.copy === 'REPRINT') out.push(center('** CETAK ULANG **', { bold: true }));
  if (m.copy === 'VOID') out.push(center('** VOID **', { bold: true }));
  out.push({ text: cut(`No. ${m.billNumber}`) }, { text: cut(`Tanggal ${m.printedAt}`) }, { text: cut(`Kasir ${m.cashier}`) });
  if (m.label) out.push({ text: cut(m.label) });
  if (m.member) out.push({ text: cut(`Member: ${m.member.name} (${m.member.levelName})`) });
  for (const s of m.sessions) out.push({ text: cut(`${s.unitName} ${s.start}-${s.end}`) });
  out.push(rule());

  for (const l of m.lines) {
    if (l.qty === 1) out.push({ text: twoCols(l.name, formatAmount(l.amount)) });
    else out.push({ text: cut(l.name) }, { text: twoCols(`  ${l.qty} x ${formatAmount(l.unitPrice)}`, formatAmount(l.amount)) });
    for (const d of l.details) out.push({ text: cut(`  ${d}`) });
    if (l.discount > 0) out.push({ text: twoCols('  Diskon', `-${formatAmount(l.discount)}`) });
    if ((l.memberDiscount ?? 0) > 0) out.push({ text: twoCols('  Diskon member', `-${formatAmount(l.memberDiscount ?? 0)}`) });
  }
  out.push(rule());
  out.push({ text: twoCols('Subtotal', formatAmount(m.subtotal)) });
  if (m.discountTotal > 0) out.push({ text: twoCols('Total diskon', `-${formatAmount(m.discountTotal)}`) });
  if (m.serviceTotal > 0) out.push({ text: twoCols('Service', formatAmount(m.serviceTotal)) });
  if (m.taxTotal > 0) out.push({ text: twoCols('Pajak', formatAmount(m.taxTotal)) });
  out.push({ text: twoCols('TOTAL', formatAmount(m.grandTotal)), bold: true, tall: true });
  out.push(rule());
  for (const p of m.payments) out.push({ text: twoCols(p.label, formatAmount(p.amount)) });
  if (m.change > 0) out.push({ text: twoCols('Kembalian', formatAmount(m.change)) });
  if ((m.depositChange ?? 0) > 0) out.push({ text: twoCols('Kembali DP', formatAmount(m.depositChange ?? 0)) });
  const footer = multiline(m.footer);
  if (footer.length) {
    out.push(rule());
    for (const f of footer) out.push(center(f));
  }
  return out;
}

export interface ShiftReportModel {
  outletName: string;
  openedAt: string;
  closedAt: string;
  openedBy: string;
  closedBy: string;
  openingCash: number;
  sales: { label: string; amount: number }[];
  voids: { label: string; amount: number }[];
  billCount: number;
  voidCount: number;
  expectedCash: number;
  countedCash: number;
  note: string | null;
  /** Kembalian DP booking (tunai keluar) di shift ini. */
  depositChange?: number;
}

export function renderShiftReport(m: ShiftReportModel): PrintLine[] {
  const out: PrintLine[] = [center('REKAP SHIFT', { bold: true, tall: true }), center(m.outletName), rule()];
  out.push(
    { text: cut(`Buka  ${m.openedAt} (${m.openedBy})`) },
    { text: cut(`Tutup ${m.closedAt} (${m.closedBy})`) },
    rule(),
    { text: twoCols('Kas awal', formatAmount(m.openingCash)) },
    { text: 'Penjualan', bold: true },
  );
  for (const s of m.sales) out.push({ text: twoCols(`  ${s.label}`, formatAmount(s.amount)) });
  if ((m.depositChange ?? 0) > 0) out.push({ text: twoCols('  Kembali DP', `-${formatAmount(m.depositChange ?? 0)}`) });
  if (m.voids.length) {
    out.push({ text: 'Void', bold: true });
    for (const v of m.voids) out.push({ text: twoCols(`  ${v.label}`, `-${formatAmount(v.amount)}`) });
  }
  out.push(
    { text: twoCols('Jumlah bill', String(m.billCount)) },
    { text: twoCols('Jumlah void', String(m.voidCount)) },
    rule(),
    { text: twoCols('Kas seharusnya', formatAmount(m.expectedCash)) },
    { text: twoCols('Kas dihitung', formatAmount(m.countedCash)) },
    { text: twoCols('Selisih', formatAmount(m.countedCash - m.expectedCash)), bold: true },
  );
  if (m.note?.trim()) out.push(rule(), { text: cut(`Catatan: ${m.note.trim()}`) });
  return out;
}
```

- [ ] **Step 5: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/shared test && pnpm typecheck`
Expected: PASS (field struk baru opsional sehingga `buildReceiptModel` server tetap kompilasi).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): booking time helpers, member/booking DTOs and M3 receipt lines

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 4: Level & member (server)

**Files:**
- Create: `apps/server/src/modules/members/members.service.ts`, `apps/server/src/modules/members/members.routes.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/members.test.ts`

**Interfaces:**
- Consumes: model `MemberLevel`, `Member`, `MemberCounter` (Task 1); `MemberLevelDto`, `MemberDto` (Task 3); `requireAuth`, `requireRole`, `audit`.
- Produces:
  - API: `GET /api/member-levels` (semua role), `POST/PATCH/DELETE /api/member-levels[/:id]` (Supervisor/Owner); `GET /api/members?q=&active=true|false` (semua role; cari kode/nama/HP, maks 50, urut nama), `GET /api/members/:id`, `POST /api/members` `{ name, phone?, levelId }`, `PATCH /api/members/:id` `{ name?, phone?, levelId?, active? }`, `DELETE /api/members/:id` (Supervisor/Owner).
  - Error: 409 `PHONE_TAKEN`, 409 `MEMBER_IN_USE`, 409 `MEMBER_INACTIVE`, 400 `LEVEL_INACTIVE`, 409 `IN_USE` (level masih dipakai).
  - Helper (dipakai Task 5–7): `requireActiveMember(db, memberId)`, `memberSnapshot(member | null)` → `{ memberId, memberName, memberLevelName, memberTimeDiscountPct, memberFnbDiscountPct }`, `toMemberDto`, `toLevelDto`, `memberCode(n)`.

- [ ] **Step 1: Tulis test yang gagal**

`apps/server/test/members.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let users: Awaited<ReturnType<typeof seedUsers>>;
let spv: string;
let kasir: string;

beforeEach(async () => {
  await resetDb();
  users = await seedUsers();
  await seedBasics();
  t = await makeApp();
  spv = await loginAs(t.app, 'supervisor');
  kasir = await loginAs(t.app, 'kasir');
});
afterEach(() => t.app.close());

const req = (cookie: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie }, payload: payload as object });
const gold = async () => (await req(spv, 'POST', '/api/member-levels', { name: 'Gold', timeDiscountPct: 10, fnbDiscountPct: 5 })).json() as { id: string };
const addMember = (body: Record<string, unknown>, cookie = spv) => req(cookie, 'POST', '/api/members', body);

describe('level member', () => {
  it('hanya supervisor/owner yang mengelola; semua role boleh melihat', async () => {
    expect((await req(kasir, 'POST', '/api/member-levels', { name: 'Gold' })).statusCode).toBe(403);
    const res = await req(spv, 'POST', '/api/member-levels', { name: 'Gold', timeDiscountPct: 10, fnbDiscountPct: 5 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Gold', timeDiscountPct: 10, fnbDiscountPct: 5, sortOrder: 0, active: true });
    expect((await req(kasir, 'GET', '/api/member-levels')).json()).toHaveLength(1);
    const id = res.json().id;
    expect((await req(spv, 'PATCH', `/api/member-levels/${id}`, { fnbDiscountPct: 101 })).statusCode).toBe(400);
    expect((await req(spv, 'PATCH', `/api/member-levels/${id}`, { fnbDiscountPct: 0 })).json().fnbDiscountPct).toBe(0);
  });
});

describe('member', () => {
  it('kode otomatis berurutan; cari kode/nama/HP; kasir hanya mencari', async () => {
    const level = await gold();
    const a = await addMember({ name: 'Sinta', phone: '0811', levelId: level.id });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ code: 'M0001', name: 'Sinta', phone: '0811', levelName: 'Gold', active: true });
    expect((await addMember({ name: 'Budi', phone: '0822', levelId: level.id })).json().code).toBe('M0002');
    const names = async (q: string) => ((await req(kasir, 'GET', `/api/members?q=${q}`)).json() as { name: string }[]).map((m) => m.name);
    expect(await names('m0002')).toEqual(['Budi']);
    expect(await names('sin')).toEqual(['Sinta']);
    expect(await names('0811')).toEqual(['Sinta']);
    expect((await addMember({ name: 'Rina', levelId: level.id }, kasir)).statusCode).toBe(403);
    expect((await addMember({ name: 'Rina', levelId: 'tidak-ada' })).statusCode).toBe(404);
  });

  it('no. HP unik di antara member aktif', async () => {
    const level = await gold();
    const sinta = (await addMember({ name: 'Sinta', phone: '0811', levelId: level.id })).json();
    const dup = await addMember({ name: 'Rina', phone: '0811', levelId: level.id });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('PHONE_TAKEN');
    expect((await req(spv, 'PATCH', `/api/members/${sinta.id}`, { active: false })).statusCode).toBe(200);
    expect((await addMember({ name: 'Rina', phone: '0811', levelId: level.id })).statusCode).toBe(200);
    expect((await req(spv, 'PATCH', `/api/members/${sinta.id}`, { active: true })).json().error.code).toBe('PHONE_TAKEN');
    expect((await addMember({ name: 'Tanpa HP 1', levelId: level.id })).statusCode).toBe(200);
    expect((await addMember({ name: 'Tanpa HP 2', levelId: level.id })).statusCode).toBe(200);
    expect((await req(kasir, 'GET', '/api/members?active=false')).json().map((m: { name: string }) => m.name)).toEqual(['Sinta']);
  });

  it('dua pendaftaran paralel dengan HP sama → tepat satu berhasil', async () => {
    const level = await gold();
    const [x, y] = await Promise.all([
      addMember({ name: 'Sinta', phone: '0811', levelId: level.id }),
      addMember({ name: 'Rina', phone: '0811', levelId: level.id }),
    ]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    expect(await prisma.member.count()).toBe(1);
  });

  it('member yang pernah bertransaksi tidak bisa dihapus; level yang dipakai juga tidak', async () => {
    const level = await gold();
    const m = (await addMember({ name: 'Sinta', phone: '0811', levelId: level.id })).json();
    await prisma.bill.create({ data: { number: 'FP-TEST-0001', createdById: users.kasir.id, memberId: m.id } });
    const del = await req(spv, 'DELETE', `/api/members/${m.id}`);
    expect(del.statusCode).toBe(409);
    expect(del.json().error.code).toBe('MEMBER_IN_USE');
    expect((await req(spv, 'DELETE', `/api/member-levels/${level.id}`)).json().error.code).toBe('IN_USE');
    const fresh = (await addMember({ name: 'Budi', levelId: level.id })).json();
    expect((await req(spv, 'DELETE', `/api/members/${fresh.id}`)).statusCode).toBe(204);
  });

  it('level nonaktif tidak bisa dipilih', async () => {
    const level = await gold();
    await req(spv, 'PATCH', `/api/member-levels/${level.id}`, { active: false });
    expect((await addMember({ name: 'Sinta', levelId: level.id })).json().error.code).toBe('LEVEL_INACTIVE');
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- members`
Expected: FAIL — route `/api/member-levels` dan `/api/members` 404.

- [ ] **Step 3: Service member**

`apps/server/src/modules/members/members.service.ts`:
```ts
import type { Member, MemberLevel } from '@prisma/client';
import type { MemberDto, MemberLevelDto } from '@funplay/shared';
import { z } from 'zod';
import type { Db } from '../../db';
import { badRequest, conflict, notFound } from '../../lib/errors';

export type MemberWithLevel = Member & { level: MemberLevel };

export const toLevelDto = (l: MemberLevel): MemberLevelDto => ({
  id: l.id, name: l.name, timeDiscountPct: l.timeDiscountPct, fnbDiscountPct: l.fnbDiscountPct, sortOrder: l.sortOrder, active: l.active,
});

export const toMemberDto = (m: MemberWithLevel): MemberDto => ({
  id: m.id, code: m.code, name: m.name, phone: m.phone, levelId: m.levelId, levelName: m.level.name, active: m.active, createdAt: m.createdAt.toISOString(),
});

const pct = z.number().int().min(0).max(100);
const levelFields = {
  name: z.string().trim().min(1).max(40),
  timeDiscountPct: pct,
  fnbDiscountPct: pct,
  sortOrder: z.number().int().min(0).max(9999),
  active: z.boolean(),
};
export const levelCreateSchema = z.object({
  ...levelFields,
  timeDiscountPct: pct.default(0),
  fnbDiscountPct: pct.default(0),
  sortOrder: levelFields.sortOrder.default(0),
  active: levelFields.active.default(true),
});
export const levelPatchSchema = z.object(levelFields).partial();

const phone = z.string().trim().max(20).regex(/^[0-9+\- ]*$/, 'No. HP hanya boleh berisi angka');
export const memberCreateSchema = z.object({ name: z.string().trim().min(1).max(60), phone: phone.default(''), levelId: z.string().min(1) });
export const memberPatchSchema = z
  .object({ name: z.string().trim().min(1).max(60), phone, levelId: z.string().min(1), active: z.boolean() })
  .partial();
export const memberQuerySchema = z.object({ q: z.string().trim().max(40).optional(), active: z.enum(['true', 'false']).optional() });

export const memberCode = (n: number): string => `M${String(n).padStart(4, '0')}`;

/**
 * Kunci baris MemberCounter (dibuat bila belum ada) dan kembalikan nomor berikutnya. Semua penulisan
 * member melewati kunci ini sehingga kode berurutan dan cek HP unik bebas race.
 */
export async function lockMemberCounter(tx: Db): Promise<number> {
  await tx.$executeRaw`INSERT INTO "MemberCounter" (id, "next") VALUES (1, 1) ON CONFLICT (id) DO NOTHING`;
  const rows = await tx.$queryRaw<{ next: number }[]>`SELECT "next" FROM "MemberCounter" WHERE id = 1 FOR UPDATE`;
  return rows[0]!.next;
}

export async function assertPhoneFree(tx: Db, phoneNo: string, exceptId: string | null): Promise<void> {
  if (!phoneNo) return;
  const other = await tx.member.findFirst({ where: { phone: phoneNo, active: true, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (other) throw conflict('PHONE_TAKEN', `No. HP sudah dipakai member aktif ${other.code}`);
}

export async function requireLevel(tx: Db, levelId: string): Promise<MemberLevel> {
  const l = await tx.memberLevel.findUnique({ where: { id: levelId } });
  if (!l) throw notFound('Level');
  if (!l.active) throw badRequest('LEVEL_INACTIVE', `Level ${l.name} tidak aktif`);
  return l;
}

/** Member aktif beserta level, untuk dipasang ke bill atau booking. */
export async function requireActiveMember(db: Db, memberId: string): Promise<MemberWithLevel> {
  const m = await db.member.findUnique({ where: { id: memberId }, include: { level: true } });
  if (!m) throw notFound('Member');
  if (!m.active) throw conflict('MEMBER_INACTIVE', `Member ${m.name} tidak aktif`);
  return m;
}

/** Kolom snapshot member di Bill: diskon level disalin saat dipasang (tidak ikut berubah bila level diedit). */
export function memberSnapshot(m: MemberWithLevel | null) {
  return {
    memberId: m?.id ?? null,
    memberName: m?.name ?? null,
    memberLevelName: m?.level.name ?? null,
    memberTimeDiscountPct: m?.level.timeDiscountPct ?? 0,
    memberFnbDiscountPct: m?.level.fnbDiscountPct ?? 0,
  };
}
```

- [ ] **Step 4: Route member**

`apps/server/src/modules/members/members.routes.ts`:
```ts
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { conflict, notFound } from '../../lib/errors';
import { audit } from '../audit/audit';
import { requireAuth, requireRole } from '../auth/guard';
import {
  assertPhoneFree, levelCreateSchema, levelPatchSchema, lockMemberCounter, memberCode, memberCreateSchema, memberPatchSchema,
  memberQuerySchema, requireLevel, toLevelDto, toMemberDto,
} from './members.service';

const idParam = z.object({ id: z.string().min(1) });

export function membersRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const auth = { preHandler: requireAuth };
    const editor = { preHandler: requireRole('SUPERVISOR', 'OWNER') };

    app.get('/member-levels', auth, async () =>
      (await ctx.prisma.memberLevel.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })).map(toLevelDto),
    );

    app.post('/member-levels', editor, async (req) => {
      const l = await ctx.prisma.memberLevel.create({ data: levelCreateSchema.parse(req.body) });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'member_level.create', entity: 'MemberLevel', entityId: l.id });
      return toLevelDto(l);
    });

    app.patch('/member-levels/:id', editor, async (req) => {
      const { id } = idParam.parse(req.params);
      const data = levelPatchSchema.parse(req.body);
      const l = await ctx.prisma.memberLevel.update({ where: { id }, data });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'member_level.update', entity: 'MemberLevel', entityId: id, data });
      return toLevelDto(l);
    });

    app.delete('/member-levels/:id', editor, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await ctx.prisma.memberLevel.delete({ where: { id } });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'member_level.delete', entity: 'MemberLevel', entityId: id });
      return reply.status(204).send();
    });

    app.get('/members', auth, async (req) => {
      const f = memberQuerySchema.parse(req.query);
      const rows = await ctx.prisma.member.findMany({
        where: {
          ...(f.active ? { active: f.active === 'true' } : {}),
          ...(f.q
            ? { OR: [{ code: { contains: f.q, mode: 'insensitive' } }, { name: { contains: f.q, mode: 'insensitive' } }, { phone: { contains: f.q } }] }
            : {}),
        },
        include: { level: true },
        orderBy: { name: 'asc' },
        take: 50,
      });
      return rows.map(toMemberDto);
    });

    app.get('/members/:id', auth, async (req) => {
      const m = await ctx.prisma.member.findUnique({ where: { id: idParam.parse(req.params).id }, include: { level: true } });
      if (!m) throw notFound('Member');
      return toMemberDto(m);
    });

    app.post('/members', editor, async (req) => {
      const input = memberCreateSchema.parse(req.body);
      const m = await ctx.prisma.$transaction(async (tx) => {
        const n = await lockMemberCounter(tx);
        await requireLevel(tx, input.levelId);
        await assertPhoneFree(tx, input.phone, null);
        await tx.memberCounter.update({ where: { id: 1 }, data: { next: n + 1 } });
        const created = await tx.member.create({ data: { ...input, code: memberCode(n) }, include: { level: true } });
        await audit(tx, { userId: req.user!.id, action: 'member.create', entity: 'Member', entityId: created.id, data: { code: created.code } });
        return created;
      });
      return toMemberDto(m);
    });

    app.patch('/members/:id', editor, async (req) => {
      const { id } = idParam.parse(req.params);
      const data = memberPatchSchema.parse(req.body);
      const m = await ctx.prisma.$transaction(async (tx) => {
        await lockMemberCounter(tx);
        const cur = await tx.member.findUnique({ where: { id } });
        if (!cur) throw notFound('Member');
        if (data.levelId && data.levelId !== cur.levelId) await requireLevel(tx, data.levelId);
        if (data.active ?? cur.active) await assertPhoneFree(tx, data.phone ?? cur.phone, id);
        const updated = await tx.member.update({ where: { id }, data, include: { level: true } });
        await audit(tx, { userId: req.user!.id, action: 'member.update', entity: 'Member', entityId: id, data });
        return updated;
      });
      return toMemberDto(m);
    });

    app.delete('/members/:id', editor, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const used = (await ctx.prisma.bill.count({ where: { memberId: id } })) + (await ctx.prisma.booking.count({ where: { memberId: id } }));
      if (used > 0) throw conflict('MEMBER_IN_USE', 'Member sudah pernah bertransaksi. Nonaktifkan saja.');
      await ctx.prisma.member.delete({ where: { id } });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'member.delete', entity: 'Member', entityId: id });
      return reply.status(204).send();
    });
  };
}
```

Di `apps/server/src/app.ts`: tambah `import { membersRoutes } from './modules/members/members.routes';` dan di blok `/api` setelah `await api.register(productsRoutes(ctx));`:
```ts
      await api.register(membersRoutes(ctx));
```

- [ ] **Step 5: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/server test -- members && pnpm --filter @funplay/server typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/members apps/server/src/app.ts apps/server/test/members.test.ts
git commit -m "feat(server): member levels and members with auto code and unique phone

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 5: Member di bill — snapshot diskon, pasang/lepas, mulai sesi dengan member, aturan bill DEPOSIT & gabung

**Files:**
- Modify: `packages/shared/src/transactions.ts`
- Modify: `apps/server/src/modules/billing/bill-view.ts`, `apps/server/src/modules/billing/bills.service.ts`, `apps/server/src/modules/billing/bills.routes.ts`
- Modify: `apps/server/src/modules/sessions/sessions.service.ts`, `apps/server/src/modules/sessions/sessions.routes.ts`
- Modify: `apps/server/src/lib/bus.ts`, `apps/server/src/modules/realtime/realtime.ts`
- Create: `apps/server/src/modules/bookings/booking-lock.ts`
- Modify: `apps/web/src/hooks/useBill.ts`
- Modify (fixture `BillView`): `apps/web/src/features/checkout/CheckoutDialog.test.tsx`, `apps/web/src/features/orders/BillItems.test.tsx`, `apps/web/src/hooks/useBill.test.ts`, `apps/web/src/features/transactions/BillDetail.test.tsx`
- Test: `apps/server/test/member-bill.test.ts`, `apps/web/src/hooks/useBill.test.ts`

**Interfaces:**
- Consumes: `computeBillTotals(..., memberDiscount)`, `MemberDiscount` (Task 2); `BillMemberView`, `BillKind` (Task 1/3); `requireActiveMember`, `memberSnapshot` (Task 4).
- Produces:
  - shared: `BillView.kind: BillKind`, `BillView.member: BillMemberView | null`, `BillSummary.kind: BillKind`.
  - server: `memberDiscountOf(bill)`, `TotalsBill`, `linesTotals(bill, settings)` kini memakai snapshot member; `billInclude` memuat `member.code`; `lockBooking(tx, bookingId)` (`bookings/booking-lock.ts`); event bus `'booking.changed'` → socket `'booking'` `{ id }`.
  - API: `PUT /api/bills/:id/member` `{ memberId: string | null }` → `BillView` (butuh shift; bill OPEN SALE); `POST /api/sessions` menerima `memberId?`.
  - Error: 409 `DEPOSIT_BILL_LOCKED` (tambah item, ubah item, diskon, member, batal manual, gabung pada bill DEPOSIT), 409 `MERGE_CONFLICT`, 409 `MEMBER_INACTIVE`.
  - web: `computeBillPreview` memakai `bill.member` (angka pratinjau = server).

- [ ] **Step 1: Tambah field shared**

Di `packages/shared/src/transactions.ts`: tambah `import type { BillMemberView } from './members';` di atas, lalu di `interface BillView` setelah `status: BillStatus;`:
```ts
  kind: BillKind;
  /** Snapshot member saat dipasang (diskon level ikut di-snapshot). */
  member: BillMemberView | null;
```
dan di `interface BillSummary` setelah `status: BillStatus;`:
```ts
  kind: BillKind;
```

Perbarui fixture web:
```bash
cd apps/web/src
for f in features/checkout/CheckoutDialog.test.tsx features/orders/BillItems.test.tsx hooks/useBill.test.ts features/transactions/BillDetail.test.tsx; do
  sed -i "s/voidedAt: null,/voidedAt: null, kind: 'SALE', member: null,/" "$f"
done
cd ../../..
```

- [ ] **Step 2: Tulis test yang gagal**

`apps/server/test/member-bill.test.ts`:
```ts
import type { MemberLevel, Member } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, openShift, prisma, resetDb, seedBasics, seedUsers, T0 } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let users: Awaited<ReturnType<typeof seedUsers>>;
let cookie: string;
let teh: { id: string };
let gold: MemberLevel;
let sinta: Member;

beforeEach(async () => {
  await resetDb();
  users = await seedUsers();
  b = await seedBasics();
  await openShift(users.kasir.id);
  const cat = await prisma.category.create({ data: { name: 'Minuman' } });
  teh = await prisma.product.create({ data: { name: 'Es Teh', categoryId: cat.id, kind: 'STOCK', price: 8000, stockQty: 10 } });
  gold = await prisma.memberLevel.create({ data: { name: 'Gold', timeDiscountPct: 10, fnbDiscountPct: 5 } });
  sinta = await prisma.member.create({ data: { code: 'M0001', name: 'Sinta', phone: '0811', levelId: gold.id } });
  t = await makeApp();
  cookie = await loginAs(t.app, 'kasir');
});
afterEach(() => t.app.close());

const req = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie }, payload: payload as object });
const pay = (billId: string, total: number, key = 'key-0000001') =>
  req('POST', `/api/bills/${billId}/checkout`, { idempotencyKey: key, expectedGrandTotal: total, payments: [{ method: 'CASH', amount: total }] });

/** Meja 1 open billing 60 menit (Rp40.000) + 2 Es Teh (Rp16.000). */
async function sessionBill(memberId?: string): Promise<string> {
  const s = (await req('POST', '/api/sessions', { unitId: b.m1.id, mode: 'OPEN', ...(memberId ? { memberId } : {}) })).json().unit.session;
  await req('POST', `/api/bills/${s.billId}/items`, { items: [{ productId: teh.id, qty: 2 }] });
  t.clock.advanceMinutes(60);
  await req('POST', `/api/sessions/${s.id}/stop`, {});
  return s.billId;
}

async function standalone(memberId?: string): Promise<string> {
  const bill = (await req('POST', '/api/bills')).json();
  await req('POST', `/api/bills/${bill.id}/items`, { items: [{ productId: teh.id, qty: 1 }] });
  if (memberId) await req('PUT', `/api/bills/${bill.id}/member`, { memberId });
  return bill.id;
}

describe('member di bill', () => {
  it('mulai sesi dengan member: snapshot diskon level di bill', async () => {
    const s = (await req('POST', '/api/sessions', { unitId: b.m1.id, mode: 'OPEN', memberId: sinta.id })).json().unit.session;
    const bill = (await req('GET', `/api/bills/${s.billId}`)).json();
    expect(bill.kind).toBe('SALE');
    expect(bill.member).toEqual({ id: sinta.id, code: 'M0001', name: 'Sinta', levelName: 'Gold', timeDiscountPct: 10, fnbDiscountPct: 5 });
    expect((await req('POST', '/api/sessions', { unitId: b.m2.id, mode: 'OPEN', memberId: 'tidak-ada' })).statusCode).toBe(404);
  });

  it('diskon member masuk total server dan tidak butuh PIN walau besar', async () => {
    const billId = await sessionBill(sinta.id);
    // waktu 40.000 − 10% = 36.000; teh 16.000 − 5% = 15.200 → 51.200
    const res = await pay(billId, 51200);
    expect(res.statusCode).toBe(200);
    expect(res.json().bill.stored).toEqual({ subtotal: 56000, discountTotal: 4800, serviceTotal: 0, taxTotal: 0, grandTotal: 51200 });

    const platinum = await prisma.memberLevel.create({ data: { name: 'Platinum', timeDiscountPct: 50, fnbDiscountPct: 50 } });
    const budi = await prisma.member.create({ data: { code: 'M0002', name: 'Budi', levelId: platinum.id } });
    t.clock.set(T0);
    const other = await sessionBill(budi.id);
    // 56.000 − 50% = 28.000; kasir tanpa PIN karena diskon level tidak dihitung untuk batas persetujuan
    expect((await pay(other, 28000, 'key-0000002')).statusCode).toBe(200);
  });

  it('pasang/lepas member di bill OPEN; snapshot dihitung ulang saat dipasang ulang', async () => {
    const billId = await standalone();
    const on = await req('PUT', `/api/bills/${billId}/member`, { memberId: sinta.id });
    expect(on.statusCode).toBe(200);
    expect(on.json().member).toMatchObject({ name: 'Sinta', fnbDiscountPct: 5 });
    await prisma.memberLevel.update({ where: { id: gold.id }, data: { fnbDiscountPct: 20 } });
    expect((await req('GET', `/api/bills/${billId}`)).json().member.fnbDiscountPct).toBe(5);
    expect((await req('PUT', `/api/bills/${billId}/member`, { memberId: sinta.id })).json().member.fnbDiscountPct).toBe(20);
    expect((await req('PUT', `/api/bills/${billId}/member`, { memberId: null })).json().member).toBeNull();
    await prisma.member.update({ where: { id: sinta.id }, data: { active: false } });
    expect((await req('PUT', `/api/bills/${billId}/member`, { memberId: sinta.id })).json().error.code).toBe('MEMBER_INACTIVE');
    expect(await prisma.auditLog.count({ where: { action: 'bill.member' } })).toBe(3);
  });

  it('bill PAID tidak berubah saat level diedit', async () => {
    const billId = await standalone(sinta.id);
    expect((await pay(billId, 7600)).statusCode).toBe(200); // 8.000 − 5%
    await prisma.memberLevel.update({ where: { id: gold.id }, data: { fnbDiscountPct: 50 } });
    const view = (await req('GET', `/api/bills/${billId}`)).json();
    expect(view.stored.grandTotal).toBe(7600);
    expect(view.member.fnbDiscountPct).toBe(5);
    expect((await req('PUT', `/api/bills/${billId}/member`, { memberId: null })).json().error.code).toBe('BILL_NOT_OPEN');
  });

  it('pasang member butuh shift', async () => {
    const billId = await standalone();
    await req('POST', '/api/shifts/current/close', { countedCash: 0 });
    expect((await req('PUT', `/api/bills/${billId}/member`, { memberId: sinta.id })).json().error.code).toBe('NO_OPEN_SHIFT');
  });

  it('gabung: member sumber pindah ke target; member berbeda → MERGE_CONFLICT', async () => {
    const a = await standalone();
    const s = await standalone(sinta.id);
    const merged = await req('POST', `/api/bills/${a}/merge`, { sourceBillId: s });
    expect(merged.statusCode).toBe(200);
    expect(merged.json().member).toMatchObject({ name: 'Sinta', levelName: 'Gold' });
    const budi = await prisma.member.create({ data: { code: 'M0002', name: 'Budi', levelId: gold.id } });
    const c = await standalone(budi.id);
    const d = await standalone(sinta.id);
    expect((await req('POST', `/api/bills/${c}/merge`, { sourceBillId: d })).json().error.code).toBe('MERGE_CONFLICT');
  });
});

describe('bill DEPOSIT', () => {
  it('tidak bisa diubah, digabung, atau dibatalkan manual; total tanpa pajak/service', async () => {
    const dep = await prisma.bill.create({
      data: {
        number: 'FP-DP-0001', label: 'DP · Budi', kind: 'DEPOSIT', createdById: users.kasir.id,
        lines: { create: { type: 'DEPOSIT', nameSnapshot: 'DP booking', unitPrice: 50000, qty: 1, createdById: users.kasir.id } },
      },
    });
    const code = async (r: ReturnType<typeof req>) => (await r).json().error.code;
    expect(await code(req('POST', `/api/bills/${dep.id}/items`, { items: [{ productId: teh.id, qty: 1 }] }))).toBe('DEPOSIT_BILL_LOCKED');
    expect(await code(req('PUT', `/api/bills/${dep.id}/discount`, { discount: { type: 'PERCENT', value: 10 } }))).toBe('DEPOSIT_BILL_LOCKED');
    expect(await code(req('PUT', `/api/bills/${dep.id}/member`, { memberId: sinta.id }))).toBe('DEPOSIT_BILL_LOCKED');
    expect(await code(req('POST', `/api/bills/${dep.id}/cancel`, { reason: 'x', approvalPin: '1111' }))).toBe('DEPOSIT_BILL_LOCKED');
    const other = await standalone();
    expect(await code(req('POST', `/api/bills/${other}/merge`, { sourceBillId: dep.id }))).toBe('DEPOSIT_BILL_LOCKED');
    await prisma.setting.update({ where: { id: 1 }, data: { taxPct: 10, servicePct: 5 } });
    const res = await pay(dep.id, 50000);
    expect(res.statusCode).toBe(200);
    expect(res.json().bill.stored).toEqual({ subtotal: 50000, discountTotal: 0, serviceTotal: 0, taxTotal: 0, grandTotal: 50000 });
  });
});
```

Tambahkan di `apps/web/src/hooks/useBill.test.ts`:
```ts
it('pratinjau memakai snapshot diskon member — sama dengan server (Rp 51.200)', () => {
  const bill: BillView = {
    id: 'b2', number: 'FP-2', label: 'Meja 1', status: 'OPEN', createdAt: '', createdByName: 'k', billDiscount: null,
    lines: [
      { id: 'l1', type: 'TIME', productId: null, sessionId: 's1', name: 'Meja 1 - Open billing', unitPrice: 40000, qty: 1, discount: null, breakdown: null },
      { id: 'l2', type: 'PRODUCT', productId: 'p', sessionId: null, name: 'Es Teh', unitPrice: 8000, qty: 2, discount: null, breakdown: null },
    ],
    activeSessions: [], payments: [], stored: null, paidAt: null, paidByName: null, shiftId: null, mergedIntoId: null, cancelReason: null, voidReason: null, voidedAt: null,
    kind: 'SALE', member: { id: 'm1', code: 'M0001', name: 'Sinta', levelName: 'Gold', timeDiscountPct: 10, fnbDiscountPct: 5 },
  };
  const p = computeBillPreview(bill, settings, [], new Date('2026-10-01T04:00:00Z'));
  expect(p.totals).toMatchObject({ subtotal: 56000, memberDiscountTotal: 4800, grandTotal: 51200 });
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- member-bill && pnpm --filter @funplay/web test -- useBill`
Expected: FAIL — `bill.kind`/`bill.member` tidak ada di respons, route `PUT /bills/:id/member` 404, pratinjau web 56.000.

- [ ] **Step 4: Event bus booking & kunci booking**

`apps/server/src/lib/bus.ts` — tambahkan di `BusEvents`:
```ts
  'booking.changed': [bookingId: string];
```
`apps/server/src/modules/realtime/realtime.ts` — setelah baris `ctx.bus.on('shift.changed', ...)`:
```ts
  ctx.bus.on('booking.changed', (id) => room().emit('booking', { id }));
```

`apps/server/src/modules/bookings/booking-lock.ts`:
```ts
import type { Db } from '../../db';
import { notFound } from '../../lib/errors';

/** SELECT … FOR UPDATE baris Booking. Urutan kunci global: Session → Bill → Booking → Shift → Product. */
export async function lockBooking(tx: Db, bookingId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
  if (!rows.length) throw notFound('Booking');
}
```

- [ ] **Step 5: View bill dengan member**

Ganti seluruh isi `apps/server/src/modules/billing/bill-view.ts`:
```ts
import type { Prisma, BillLine } from '@prisma/client';
import {
  computeBillTotals, DISCOUNT_TYPES, lineScope,
  type BillKind, type BillSummary, type BillTotals, type BillView, type ChargeLine, type Discount, type MemberDiscount, type PublicSettings,
  type TotalsLineInput,
} from '@funplay/shared';
import { z } from 'zod';
import type { Db } from '../../db';
import { notFound } from '../../lib/errors';
import { toSessionView } from '../board/board';
import { sessionParts } from '../sessions/sessions.service';
import { userNames } from '../shifts/shifts.service';

export const discountSchema = z
  .object({ type: z.enum(DISCOUNT_TYPES), value: z.number().int().min(0) })
  .refine((d) => d.type !== 'PERCENT' || d.value <= 100, { message: 'Diskon persen maksimal 100' });

export const billInclude = {
  lines: { orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' } },
  sessions: { where: { status: { not: 'ENDED' } }, include: { ...sessionParts, unit: { select: { name: true } } } },
  member: { select: { code: true } },
} satisfies Prisma.BillInclude;
export type BillRow = Prisma.BillGetPayload<{ include: typeof billInclude }>;

/** Kolom bill yang dibutuhkan kalkulator total (baris tersimpan + diskon bill + snapshot member). */
export interface TotalsBill {
  lines: BillLine[];
  billDiscountType: Discount['type'] | null;
  billDiscountValue: number;
  memberId: string | null;
  memberTimeDiscountPct: number;
  memberFnbDiscountPct: number;
}

export const lineDiscount = (l: Pick<BillLine, 'discountType' | 'discountValue'>): Discount | null =>
  l.discountType ? { type: l.discountType, value: l.discountValue } : null;

export const billDiscountOf = (b: { billDiscountType: Discount['type'] | null; billDiscountValue: number }): Discount | null =>
  b.billDiscountType ? { type: b.billDiscountType, value: b.billDiscountValue } : null;

/** Snapshot diskon level di bill; null bila bill tanpa member. */
export const memberDiscountOf = (b: Pick<TotalsBill, 'memberId' | 'memberTimeDiscountPct' | 'memberFnbDiscountPct'>): MemberDiscount | null =>
  b.memberId ? { timePct: b.memberTimeDiscountPct, fnbPct: b.memberFnbDiscountPct } : null;

export const totalsInput = (lines: BillLine[]): TotalsLineInput[] =>
  lines.map((l) => ({ id: l.id, scope: lineScope(l.type), amount: l.unitPrice * l.qty, discount: lineDiscount(l) }));

/** Total dari baris tersimpan (sesi yang masih berjalan tidak ikut), termasuk diskon member. */
export function linesTotals(bill: TotalsBill, settings: PublicSettings, discount: Discount | null = billDiscountOf(bill)): BillTotals {
  return computeBillTotals(totalsInput(bill.lines), discount, settings, memberDiscountOf(bill));
}

export async function lockBill(tx: Db, billId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Bill" WHERE id = ${billId} FOR UPDATE`;
  if (!rows.length) throw notFound('Bill');
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function toBillView(db: Db, b: BillRow): Promise<BillView> {
  const names = await userNames(db, [b.createdById, b.paidById]);
  return {
    id: b.id,
    number: b.number,
    label: b.label,
    status: b.status,
    kind: b.kind,
    member: b.memberId
      ? {
          id: b.memberId,
          code: b.member?.code ?? '',
          name: b.memberName ?? '',
          levelName: b.memberLevelName ?? '',
          timeDiscountPct: b.memberTimeDiscountPct,
          fnbDiscountPct: b.memberFnbDiscountPct,
        }
      : null,
    createdAt: b.createdAt.toISOString(),
    createdByName: names.get(b.createdById) ?? '-',
    billDiscount: billDiscountOf(b),
    lines: b.lines.map((l) => ({
      id: l.id,
      type: l.type,
      productId: l.productId,
      sessionId: l.sessionId,
      name: l.nameSnapshot,
      unitPrice: l.unitPrice,
      qty: l.qty,
      discount: lineDiscount(l),
      breakdown: (l.breakdown as ChargeLine[] | null) ?? null,
    })),
    activeSessions: b.sessions.map((s) => ({ ...toSessionView(s), unitName: s.unit.name })),
    payments: b.payments.map((p) => ({
      id: p.id, method: p.method, amount: p.amount, received: p.received, change: p.change, reference: p.reference, createdAt: p.createdAt.toISOString(),
    })),
    stored:
      b.status === 'PAID' || b.status === 'VOID'
        ? { subtotal: b.subtotal, discountTotal: b.discountTotal, serviceTotal: b.serviceTotal, taxTotal: b.taxTotal, grandTotal: b.grandTotal }
        : null,
    paidAt: iso(b.paidAt),
    paidByName: b.paidById ? (names.get(b.paidById) ?? '-') : null,
    shiftId: b.shiftId,
    mergedIntoId: b.mergedIntoId,
    cancelReason: b.cancelReason,
    voidReason: b.voidReason,
    voidedAt: iso(b.voidedAt),
  };
}

export async function loadBillView(db: Db, billId: string): Promise<BillView> {
  const b = await db.bill.findUnique({ where: { id: billId }, include: billInclude });
  if (!b) throw notFound('Bill');
  return toBillView(db, b);
}

export function toBillSummary(
  b: TotalsBill & {
    id: string; number: string; label: string; status: BillSummary['status']; kind: BillKind; createdAt: Date; paidAt: Date | null; grandTotal: number;
    sessions: { status: string }[];
  },
  settings: PublicSettings,
): BillSummary {
  const stored = b.status === 'PAID' || b.status === 'VOID';
  return {
    id: b.id,
    number: b.number,
    label: b.label,
    status: b.status,
    kind: b.kind,
    createdAt: b.createdAt.toISOString(),
    paidAt: iso(b.paidAt),
    total: stored ? b.grandTotal : linesTotals(b, settings).grandTotal,
    hasActiveSession: b.sessions.some((s) => s.status !== 'ENDED'),
  };
}
```

- [ ] **Step 6: Bill service — guard DEPOSIT, pasang member, gabung**

Di `apps/server/src/modules/billing/bills.service.ts`:

1. Tambah import:
```ts
import { lockBooking } from '../bookings/booking-lock';
import { memberSnapshot, requireActiveMember } from '../members/members.service';
```

2. Setelah fungsi `requireOpenBill`, tambahkan:
```ts
/** Bill OPEN yang isinya boleh diubah: bill DP booking (kind DEPOSIT) hanya satu baris dan dikunci. */
async function requireOpenSaleBill(tx: Db, billId: string) {
  const bill = await requireOpenBill(tx, billId);
  if (bill.kind === 'DEPOSIT') throw conflict('DEPOSIT_BILL_LOCKED', 'Bill DP booking tidak bisa diubah');
  return bill;
}
```

3. Di `addItems`, `updateLine`, `deleteLine`, dan `setBillDiscount`, ganti pemanggilan `requireOpenBill(tx, billId)` menjadi `requireOpenSaleBill(tx, billId)`.

4. Tambahkan method setelah `setBillDiscount`:
```ts
  /** Pasang (memberId) atau lepas (null) member. Persen diskon level di-snapshot ulang setiap kali dipasang. */
  async setMember(user: PublicUser, billId: string, memberId: string | null): Promise<BillView> {
    const { prisma } = this.ctx;
    await prisma.$transaction(async (tx) => {
      await requireOpenShift(tx);
      await requireOpenSaleBill(tx, billId);
      const m = memberId ? await requireActiveMember(tx, memberId) : null;
      const snap = memberSnapshot(m);
      await tx.bill.update({ where: { id: billId }, data: snap });
      await audit(tx, {
        userId: user.id, action: 'bill.member', entity: 'Bill', entityId: billId,
        data: { memberId: snap.memberId, timePct: snap.memberTimeDiscountPct, fnbPct: snap.memberFnbDiscountPct },
      });
    });
    this.changed(billId);
    return loadBillView(prisma, billId);
  }
```

5. Di `cancel`: tepat setelah `if (!pre) throw notFound('Bill');` tambahkan
```ts
    if (pre.kind === 'DEPOSIT') throw conflict('DEPOSIT_BILL_LOCKED', 'Bill DP booking dibatalkan lewat menu Booking');
```
dan di dalam transaksinya ganti `const locked = await requireOpenBill(tx, billId);` menjadi `const locked = await requireOpenSaleBill(tx, billId);`.

6. Ganti seluruh method `merge` dengan:
```ts
  async merge(user: PublicUser, targetId: string, sourceId: string): Promise<BillView> {
    const { prisma } = this.ctx;
    if (targetId === sourceId) throw badRequest('SAME_BILL', 'Pilih bill lain untuk digabung');
    const moved = await prisma.$transaction(async (tx) => {
      await requireOpenShift(tx);
      // urutan kunci global: sesi → bill → booking (sama dengan stop/checkout)
      await tx.$queryRaw`SELECT id FROM "Session" WHERE "billId" IN (${targetId}, ${sourceId}) AND status <> 'ENDED' ORDER BY id FOR UPDATE`;
      for (const id of [targetId, sourceId].sort()) await lockBill(tx, id); // urutan tetap → tidak deadlock
      const [target, source] = await Promise.all([
        tx.bill.findUniqueOrThrow({ where: { id: targetId } }),
        tx.bill.findUniqueOrThrow({ where: { id: sourceId }, include: { sessions: { where: { status: { not: 'ENDED' } } } } }),
      ]);
      if (target.status !== 'OPEN' || source.status !== 'OPEN') throw conflict('BILL_NOT_OPEN', 'Hanya bill yang belum dibayar yang bisa digabung');
      if (target.kind === 'DEPOSIT' || source.kind === 'DEPOSIT') throw conflict('DEPOSIT_BILL_LOCKED', 'Bill DP booking tidak bisa digabung');
      if (target.bookingId && source.bookingId) throw conflict('MERGE_CONFLICT', 'Kedua bill terhubung ke booking yang berbeda');
      if (target.memberId && source.memberId && target.memberId !== source.memberId) {
        throw conflict('MERGE_CONFLICT', 'Kedua bill memakai member yang berbeda');
      }
      if (source.bookingId) {
        await lockBooking(tx, source.bookingId);
        await tx.booking.update({ where: { id: source.bookingId }, data: { saleBillId: targetId } });
      }
      await tx.billLine.updateMany({ where: { billId: sourceId }, data: { billId: targetId } });
      await tx.session.updateMany({ where: { billId: sourceId }, data: { billId: targetId } });
      await tx.bill.update({
        where: { id: sourceId },
        data: { status: 'CANCELLED', mergedIntoId: targetId, cancelReason: `Digabung ke ${target.number}`, bookingId: null },
      });
      await tx.bill.update({
        where: { id: targetId },
        data: {
          label: `${target.label} + ${source.label}`,
          ...(source.bookingId ? { bookingId: source.bookingId } : {}),
          ...(!target.memberId && source.memberId
            ? {
                memberId: source.memberId,
                memberName: source.memberName,
                memberLevelName: source.memberLevelName,
                memberTimeDiscountPct: source.memberTimeDiscountPct,
                memberFnbDiscountPct: source.memberFnbDiscountPct,
              }
            : {}),
        },
      });
      await audit(tx, {
        userId: user.id, action: 'bill.merge', entity: 'Bill', entityId: targetId,
        data: { sourceBillId: sourceId, bookingId: source.bookingId, memberId: source.memberId },
      });
      return { units: source.sessions.map((s) => s.unitId), bookingId: source.bookingId };
    });
    for (const unitId of moved.units) this.ctx.bus.emit('unit.changed', unitId); // SessionView.billId berubah
    if (moved.bookingId) this.ctx.bus.emit('booking.changed', moved.bookingId);
    this.changed(targetId, sourceId);
    return loadBillView(prisma, targetId);
  }
```

`apps/server/src/modules/billing/bills.routes.ts` — tambahkan setelah route `PUT /bills/:id/discount`:
```ts
    app.put('/bills/:id/member', auth, async (req) =>
      ctx.bills.setMember(req.user!, idParam.parse(req.params).id, z.object({ memberId: z.string().min(1).nullable() }).parse(req.body).memberId),
    );
```

- [ ] **Step 7: Mulai sesi dengan member**

Di `apps/server/src/modules/sessions/sessions.service.ts`:
1. Tambah import `import { memberSnapshot, requireActiveMember } from '../members/members.service';`.
2. Ubah tanda tangan `start` menjadi:
```ts
  async start(user: PublicUser, input: { unitId: string; mode: SessionMode; packageId?: string; memberId?: string | null }): Promise<Session> {
```
3. Di dalam transaksinya, tepat sebelum `const bill = await tx.bill.create(`:
```ts
        const member = input.memberId ? await requireActiveMember(tx, input.memberId) : null;
```
4. Ganti pembuatan bill dan audit `session.start` menjadi:
```ts
        const bill = await tx.bill.create({
          data: { number: await nextBillNumber(tx, now, settings.utcOffsetMin), label: unit.name, createdById: user.id, ...memberSnapshot(member) },
        });
```
```ts
        await audit(tx, { userId: user.id, action: 'session.start', entity: 'Session', entityId: s.id, data: { unitId: unit.id, mode: input.mode, packageId: pkg?.id ?? null, memberId: member?.id ?? null } });
```

`apps/server/src/modules/sessions/sessions.routes.ts` — ganti `startSchema`:
```ts
const startSchema = z.object({
  unitId: z.string().min(1),
  mode: z.enum(SESSION_MODES),
  packageId: z.string().min(1).optional(),
  memberId: z.string().min(1).nullable().optional(),
});
```

- [ ] **Step 8: Pratinjau web memakai member**

Di `apps/web/src/hooks/useBill.ts`, ganti baris `return { totals: computeBillTotals(lines, bill.billDiscount, settings), liveTime };` dengan:
```ts
  const member = bill.member ? { timePct: bill.member.timeDiscountPct, fnbPct: bill.member.fnbDiscountPct } : null;
  return { totals: computeBillTotals(lines, bill.billDiscount, settings, member), liveTime };
```

- [ ] **Step 9: Jalankan test & typecheck**

Run: `pnpm typecheck && pnpm --filter @funplay/server test && pnpm --filter @funplay/web test`
Expected: PASS (termasuk test M2 `bills`, `checkout`, `printing`).

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/transactions.ts apps/server/src apps/server/test/member-bill.test.ts apps/web/src
git commit -m "feat: member on bill with level discount snapshot; DEPOSIT bill guards and merge rules

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 6: Booking — buat, ubah jadwal, daftar per hari, bentrok di bawah kunci Unit, bill DEPOSIT

**Files:**
- Create: `apps/server/src/modules/bookings/booking-view.ts`, `apps/server/src/modules/bookings/bookings.service.ts`, `apps/server/src/modules/bookings/bookings.routes.ts`
- Modify: `apps/server/src/context.ts`, `apps/server/src/app.ts`
- Test: `apps/server/test/bookings.test.ts`

**Interfaces:**
- Consumes: `lockBooking` (Task 5), `requireActiveMember` (Task 4), `nextBillNumber`, `requireOpenShift`, `getSettings`, `userNames`; `bookingWindow`, `bookingsOverlap`, `BookingView`, `CreateBookingResult` (Task 3); bus `'booking.changed'` (Task 5).
- Produces:
  - `ctx.bookings: BookingService` dengan `list({ from, to, status? })`, `get(id)`, `create(user, BookingInput)`, `update(user, id, BookingPatch)`, `changed(bookingId, ...unitIds)`; `MAX_BOOKING_MIN = 720`.
  - `booking-view.ts`: `bookingInclude`, `BookingRow`, `toBookingViews(db, rows)`, `loadBookingView(db, id)`.
  - API: `GET /api/bookings?from=&to=&status=` (startAt dalam `[from, to)`, urut jam), `GET /api/bookings/:id`, `POST /api/bookings` `{ unitId, startAt (ISO), durationMin 15–720, customerName?, phone?, memberId?, note?, depositAmount ≥ 0 }` → `CreateBookingResult`, `PATCH /api/bookings/:id` (field yang sama tanpa `depositAmount`) → `BookingView`.
  - Bill DEPOSIT: label **`DP · <nama> · <meja> <HH:MM>`**, satu baris `DEPOSIT` bernama `DP booking <meja> <dd/mm/yyyy HH:MM>`.
  - Error: 409 `BOOKING_CONFLICT`, 409 `BOOKING_NOT_ACTIVE`, 409 `UNIT_MAINTENANCE`, 400 `BOOKING_IN_PAST`, 400 `CUSTOMER_REQUIRED`, 409 `NO_OPEN_SHIFT` (hanya bila DP > 0).

- [ ] **Step 1: Tulis test yang gagal**

`apps/server/test/bookings.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, openShift, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  const users = await seedUsers();
  b = await seedBasics();
  await openShift(users.kasir.id);
  t = await makeApp(); // Kamis 1 Okt 2026 10:00 WIB
  cookie = await loginAs(t.app, 'kasir');
});
afterEach(() => t.app.close());

const req = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie }, payload: payload as object });
/** Default: Meja 2, 19:00–20:00 WIB. */
const book = (over: Record<string, unknown> = {}) =>
  req('POST', '/api/bookings', { unitId: b.m2.id, startAt: '2026-10-01T12:00:00.000Z', durationMin: 60, customerName: 'Budi', phone: '0812', ...over });

describe('buat booking', () => {
  it('tanpa DP: BOOKED, tanpa bill, diaudit', async () => {
    const res = await book();
    expect(res.statusCode).toBe(200);
    expect(res.json().depositBillId).toBeNull();
    expect(res.json().booking).toMatchObject({
      unitId: b.m2.id, unitName: 'Meja 2', customerName: 'Budi', phone: '0812', startAt: '2026-10-01T12:00:00.000Z', durationMin: 60,
      status: 'BOOKED', depositAmount: 0, depositBillId: null, depositBillStatus: null, depositOutcome: null, createdByName: 'kasir',
    });
    expect(await prisma.bill.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'booking.create' } })).toBe(1);
  });

  it('bentrok di meja yang sama ditolak; bersebelahan, meja lain, dan booking batal tidak dihitung', async () => {
    expect((await book()).statusCode).toBe(200);
    const clash = await book({ startAt: '2026-10-01T12:30:00.000Z' });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error).toMatchObject({ code: 'BOOKING_CONFLICT', message: 'Jadwal bentrok dengan booking Budi jam 19:00' });
    expect((await book({ startAt: '2026-10-01T11:30:00.000Z', durationMin: 30 })).statusCode).toBe(200); // 18:30–19:00
    expect((await book({ startAt: '2026-10-01T13:00:00.000Z' })).statusCode).toBe(200); // 20:00–21:00
    expect((await book({ unitId: b.m1.id, startAt: '2026-10-01T12:30:00.000Z' })).statusCode).toBe(200);
    await prisma.booking.updateMany({ where: { unitId: b.m1.id }, data: { status: 'CANCELLED' } });
    expect((await book({ unitId: b.m1.id })).statusCode).toBe(200);
  });

  it('dua booking bentrok paralel → tepat satu berhasil', async () => {
    const [x, y] = await Promise.all([book(), book({ customerName: 'Rina' })]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    expect(await prisma.booking.count()).toBe(1);
  });

  it('DP > 0: bill DEPOSIT OPEN satu baris; dibayar lewat checkout; DP butuh shift', async () => {
    const res = await book({ depositAmount: 50000 });
    const depId = res.json().depositBillId as string;
    expect(res.json().booking).toMatchObject({ depositAmount: 50000, depositBillId: depId, depositBillStatus: 'OPEN' });
    const bill = (await req('GET', `/api/bills/${depId}`)).json();
    expect(bill).toMatchObject({ kind: 'DEPOSIT', label: 'DP · Budi · Meja 2 19:00', status: 'OPEN', member: null });
    expect(bill.lines).toEqual([expect.objectContaining({ type: 'DEPOSIT', name: 'DP booking Meja 2 01/10/2026 19:00', unitPrice: 50000, qty: 1 })]);
    expect((await req('POST', `/api/bills/${depId}/items`, { items: [{ custom: { name: 'x', price: 1000 }, qty: 1 }] })).json().error.code).toBe('DEPOSIT_BILL_LOCKED');
    const paid = await req('POST', `/api/bills/${depId}/checkout`, { idempotencyKey: 'dp-0000001', expectedGrandTotal: 50000, payments: [{ method: 'CASH', amount: 50000 }] });
    expect(paid.statusCode).toBe(200);
    expect((await req('GET', `/api/bookings/${res.json().booking.id}`)).json().depositBillStatus).toBe('PAID');

    await req('POST', '/api/shifts/current/close', { countedCash: 0 });
    expect((await book({ unitId: b.m1.id, depositAmount: 10000 })).json().error.code).toBe('NO_OPEN_SHIFT');
    expect((await book({ unitId: b.m1.id })).statusCode).toBe(200);
  });

  it('booking untuk member: nama & HP dari member', async () => {
    const lv = await prisma.memberLevel.create({ data: { name: 'Gold', timeDiscountPct: 10 } });
    const m = await prisma.member.create({ data: { code: 'M0001', name: 'Sinta', phone: '0811', levelId: lv.id } });
    const res = await book({ customerName: undefined, phone: undefined, memberId: m.id });
    expect(res.json().booking).toMatchObject({ customerName: 'Sinta', phone: '0811', memberId: m.id, memberCode: 'M0001' });
  });

  it('validasi: jadwal lewat, nama kosong, durasi, meja maintenance', async () => {
    expect((await book({ startAt: '2026-10-01T01:00:00.000Z' })).json().error.code).toBe('BOOKING_IN_PAST'); // 08:00–09:00
    expect((await book({ customerName: '', startAt: '2026-10-01T15:00:00.000Z' })).json().error.code).toBe('CUSTOMER_REQUIRED');
    expect((await book({ durationMin: 10 })).statusCode).toBe(400);
    await prisma.unit.update({ where: { id: b.m1.id }, data: { state: 'MAINTENANCE' } });
    expect((await book({ unitId: b.m1.id })).json().error.code).toBe('UNIT_MAINTENANCE');
  });
});

describe('ubah jadwal & daftar', () => {
  it('hanya BOOKED; bentrok diperiksa ulang', async () => {
    const a = (await book()).json().booking;
    const c = (await book({ startAt: '2026-10-01T14:00:00.000Z', customerName: 'Rina' })).json().booking; // 21:00
    expect((await req('PATCH', `/api/bookings/${c.id}`, { startAt: '2026-10-01T12:30:00.000Z' })).json().error.code).toBe('BOOKING_CONFLICT');
    expect((await req('PATCH', `/api/bookings/${c.id}`, { startAt: '2026-10-01T13:00:00.000Z' })).json()).toMatchObject({ startAt: '2026-10-01T13:00:00.000Z' });
    expect((await req('PATCH', `/api/bookings/${a.id}`, { unitId: b.m1.id, note: 'dekat jendela' })).json()).toMatchObject({ unitName: 'Meja 1', note: 'dekat jendela' });
    await prisma.booking.update({ where: { id: a.id }, data: { status: 'CANCELLED' } });
    expect((await req('PATCH', `/api/bookings/${a.id}`, { durationMin: 90 })).json().error.code).toBe('BOOKING_NOT_ACTIVE');
  });

  it('daftar per hari lokal outlet', async () => {
    await book();
    await book({ startAt: '2026-10-02T03:00:00.000Z' });
    const day = await req('GET', '/api/bookings?from=2026-09-30T17:00:00.000Z&to=2026-10-01T17:00:00.000Z');
    expect(day.json().map((x: { startAt: string }) => x.startAt)).toEqual(['2026-10-01T12:00:00.000Z']);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- bookings`
Expected: FAIL — route `/api/bookings` 404.

- [ ] **Step 3: View booking**

`apps/server/src/modules/bookings/booking-view.ts`:
```ts
import type { Prisma } from '@prisma/client';
import type { BookingView } from '@funplay/shared';
import type { Db } from '../../db';
import { notFound } from '../../lib/errors';
import { userNames } from '../shifts/shifts.service';

export const bookingInclude = { unit: { select: { name: true } }, member: { select: { code: true } } } satisfies Prisma.BookingInclude;
export type BookingRow = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

export async function toBookingViews(db: Db, rows: BookingRow[]): Promise<BookingView[]> {
  const depIds = rows.map((r) => r.depositBillId).filter((x): x is string => !!x);
  const deps = depIds.length ? await db.bill.findMany({ where: { id: { in: depIds } }, select: { id: true, status: true } }) : [];
  const depStatus = new Map(deps.map((d) => [d.id, d.status]));
  const names = await userNames(db, rows.map((r) => r.createdById));
  return rows.map((r) => ({
    id: r.id,
    unitId: r.unitId,
    unitName: r.unit.name,
    customerName: r.customerName,
    phone: r.phone,
    memberId: r.memberId,
    memberCode: r.member?.code ?? null,
    startAt: r.startAt.toISOString(),
    durationMin: r.durationMin,
    note: r.note,
    status: r.status,
    depositAmount: r.depositAmount,
    depositBillId: r.depositBillId,
    depositBillStatus: r.depositBillId ? (depStatus.get(r.depositBillId) ?? null) : null,
    depositOutcome: r.depositOutcome,
    depositUsedAmount: r.depositUsedAmount,
    saleBillId: r.saleBillId,
    cancelReason: r.cancelReason,
    createdByName: names.get(r.createdById) ?? '-',
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function loadBookingView(db: Db, id: string): Promise<BookingView> {
  const row = await db.booking.findUnique({ where: { id }, include: bookingInclude });
  if (!row) throw notFound('Booking');
  return (await toBookingViews(db, [row]))[0]!;
}
```

- [ ] **Step 4: Service booking**

`apps/server/src/modules/bookings/bookings.service.ts`:
```ts
import {
  addMinutes, bookingsOverlap, bookingWindow, formatReceiptDate, localHHMM,
  type BookingStatus, type BookingView, type CreateBookingResult, type PublicUser,
} from '@funplay/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { audit } from '../audit/audit';
import { requireActiveMember } from '../members/members.service';
import { nextBillNumber } from '../sessions/sessions.service';
import { getSettings } from '../settings/settings.service';
import { requireOpenShift } from '../shifts/shifts.service';
import { lockBooking } from './booking-lock';
import { bookingInclude, loadBookingView, toBookingViews } from './booking-view';

/** Durasi booking maksimum (menit); juga batas jendela pencarian bentrok. */
export const MAX_BOOKING_MIN = 720;

export interface BookingInput {
  unitId: string;
  startAt: Date;
  durationMin: number;
  customerName?: string;
  phone?: string;
  memberId?: string | null;
  note?: string;
  depositAmount: number;
}
export type BookingPatch = Partial<Omit<BookingInput, 'depositAmount'>>;

/** Kunci baris Unit — hanya dipakai buat/ubah jadwal booking. */
async function lockUnit(tx: Db, unitId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Unit" WHERE id = ${unitId} FOR UPDATE`;
  if (!rows.length) throw notFound('Meja');
  return tx.unit.findUniqueOrThrow({ where: { id: unitId } });
}

/** Nama & HP pelanggan dari input, dilengkapi data member bila `memberId` diisi. */
async function customerOf(tx: Db, input: { customerName?: string; phone?: string; memberId?: string | null }) {
  if (input.memberId) {
    const m = await requireActiveMember(tx, input.memberId);
    return { name: input.customerName?.trim() || m.name, phone: input.phone?.trim() || m.phone, memberId: m.id };
  }
  const name = input.customerName?.trim() ?? '';
  if (!name) throw badRequest('CUSTOMER_REQUIRED', 'Nama pelanggan wajib diisi');
  return { name, phone: input.phone?.trim() ?? '', memberId: null };
}

/** Tolak bila ada booking BOOKED lain di meja yang sama yang jendelanya beririsan. Pemanggil memegang kunci Unit. */
async function assertNoConflict(tx: Db, unitId: string, startAt: Date, durationMin: number, exceptId: string | null, utcOffsetMin: number) {
  const { end } = bookingWindow(startAt, durationMin);
  const near = await tx.booking.findMany({
    where: {
      unitId,
      status: 'BOOKED',
      startAt: { gt: addMinutes(startAt, -MAX_BOOKING_MIN), lt: end },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    orderBy: { startAt: 'asc' },
  });
  const clash = near.find((x) => bookingsOverlap(x, { startAt, durationMin }));
  if (clash) throw conflict('BOOKING_CONFLICT', `Jadwal bentrok dengan booking ${clash.customerName} jam ${localHHMM(clash.startAt, utcOffsetMin)}`);
}

export class BookingService {
  constructor(private readonly ctx: AppContext) {}

  /** Setelah commit: daftar booking dan kartu meja (hold) di klien diperbarui. */
  changed(bookingId: string, ...unitIds: (string | null | undefined)[]): void {
    this.ctx.bus.emit('booking.changed', bookingId);
    for (const id of new Set(unitIds.filter((x): x is string => !!x))) this.ctx.bus.emit('unit.changed', id);
  }

  async list(filter: { from: Date; to: Date; status?: BookingStatus }): Promise<BookingView[]> {
    const rows = await this.ctx.prisma.booking.findMany({
      where: { startAt: { gte: filter.from, lt: filter.to }, ...(filter.status ? { status: filter.status } : {}) },
      include: bookingInclude,
      orderBy: [{ startAt: 'asc' }, { createdAt: 'asc' }],
    });
    return toBookingViews(this.ctx.prisma, rows);
  }

  get(id: string): Promise<BookingView> {
    return loadBookingView(this.ctx.prisma, id);
  }

  async create(user: PublicUser, input: BookingInput): Promise<CreateBookingResult> {
    const { prisma, clock } = this.ctx;
    const now = clock.now();
    const settings = await getSettings(prisma);
    const off = settings.utcOffsetMin;
    if (bookingWindow(input.startAt, input.durationMin).end.getTime() <= now.getTime()) {
      throw badRequest('BOOKING_IN_PAST', 'Jadwal booking sudah lewat');
    }
    const r = await prisma.$transaction(async (tx) => {
      // Nomor bill (BillCounter) diambil sebelum kunci Unit — urutannya sama dengan mulai sesi
      // (buat bill dulu, baru memperbarui Unit), sehingga tidak ada siklus kunci.
      const billNumber = input.depositAmount > 0 ? await nextBillNumber(tx, now, off) : null;
      if (billNumber) await requireOpenShift(tx);
      const unit = await lockUnit(tx, input.unitId);
      if (unit.state !== 'ACTIVE') throw conflict('UNIT_MAINTENANCE', `${unit.name} sedang maintenance`);
      const who = await customerOf(tx, input);
      await assertNoConflict(tx, unit.id, input.startAt, input.durationMin, null, off);
      const booking = await tx.booking.create({
        data: {
          unitId: unit.id,
          customerName: who.name,
          phone: who.phone,
          memberId: who.memberId,
          startAt: input.startAt,
          durationMin: input.durationMin,
          note: input.note?.trim() ?? '',
          depositAmount: input.depositAmount,
          createdById: user.id,
        },
      });
      let depositBillId: string | null = null;
      if (billNumber) {
        const bill = await tx.bill.create({
          data: {
            number: billNumber,
            label: `DP · ${who.name} · ${unit.name} ${localHHMM(input.startAt, off)}`,
            kind: 'DEPOSIT',
            createdById: user.id,
            lines: {
              create: {
                type: 'DEPOSIT',
                nameSnapshot: `DP booking ${unit.name} ${formatReceiptDate(input.startAt, off)}`,
                unitPrice: input.depositAmount,
                qty: 1,
                createdById: user.id,
              },
            },
          },
        });
        depositBillId = bill.id;
        await tx.booking.update({ where: { id: booking.id }, data: { depositBillId } });
      }
      await audit(tx, {
        userId: user.id, action: 'booking.create', entity: 'Booking', entityId: booking.id,
        data: { unitId: unit.id, startAt: input.startAt.toISOString(), durationMin: input.durationMin, depositAmount: input.depositAmount, memberId: who.memberId },
      });
      return { id: booking.id, unitId: unit.id, depositBillId };
    });
    this.changed(r.id, r.unitId);
    if (r.depositBillId) this.ctx.bus.emit('bill.changed', r.depositBillId);
    return { booking: await loadBookingView(prisma, r.id), depositBillId: r.depositBillId };
  }

  async update(user: PublicUser, id: string, input: BookingPatch): Promise<BookingView> {
    const { prisma, clock } = this.ctx;
    const now = clock.now();
    const settings = await getSettings(prisma);
    const off = settings.utcOffsetMin;
    const r = await prisma.$transaction(async (tx) => {
      // urutan kunci: Booking → Unit (check-in juga Booking → Unit lewat mulai sesi)
      await lockBooking(tx, id);
      const bk = await tx.booking.findUniqueOrThrow({ where: { id } });
      if (bk.status !== 'BOOKED') throw conflict('BOOKING_NOT_ACTIVE', 'Booking sudah tidak aktif');
      const unitId = input.unitId ?? bk.unitId;
      for (const u of [...new Set([bk.unitId, unitId])].sort()) await lockUnit(tx, u);
      const unit = await tx.unit.findUniqueOrThrow({ where: { id: unitId } });
      const startAt = input.startAt ?? bk.startAt;
      const durationMin = input.durationMin ?? bk.durationMin;
      const rescheduled = unitId !== bk.unitId || startAt.getTime() !== bk.startAt.getTime();
      if (rescheduled || durationMin !== bk.durationMin) {
        if (unit.state !== 'ACTIVE') throw conflict('UNIT_MAINTENANCE', `${unit.name} sedang maintenance`);
        if (bookingWindow(startAt, durationMin).end.getTime() <= now.getTime()) throw badRequest('BOOKING_IN_PAST', 'Jadwal booking sudah lewat');
        await assertNoConflict(tx, unitId, startAt, durationMin, id, off);
      }
      const who =
        input.customerName !== undefined || input.phone !== undefined || input.memberId !== undefined
          ? await customerOf(tx, {
              customerName: input.customerName ?? bk.customerName,
              phone: input.phone ?? bk.phone,
              memberId: input.memberId === undefined ? bk.memberId : input.memberId,
            })
          : { name: bk.customerName, phone: bk.phone, memberId: bk.memberId };
      await tx.booking.update({
        where: { id },
        data: {
          unitId, startAt, durationMin, customerName: who.name, phone: who.phone, memberId: who.memberId,
          ...(input.note !== undefined ? { note: input.note.trim() } : {}),
          ...(rescheduled ? { holdNotifiedAt: null } : {}),
        },
      });
      await audit(tx, {
        userId: user.id, action: 'booking.update', entity: 'Booking', entityId: id,
        data: {
          from: { unitId: bk.unitId, startAt: bk.startAt.toISOString(), durationMin: bk.durationMin },
          to: { unitId, startAt: startAt.toISOString(), durationMin },
        },
      });
      return { from: bk.unitId, to: unitId };
    });
    this.changed(id, r.from, r.to);
    return loadBookingView(prisma, id);
  }
}
```

- [ ] **Step 5: Route & registrasi**

`apps/server/src/modules/bookings/bookings.routes.ts`:
```ts
import { BOOKING_STATUSES } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { requireAuth } from '../auth/guard';
import { MAX_BOOKING_MIN } from './bookings.service';

const idParam = z.object({ id: z.string().min(1) });
const fields = {
  unitId: z.string().min(1),
  startAt: z.string().datetime().transform((s) => new Date(s)),
  durationMin: z.number().int().min(15).max(MAX_BOOKING_MIN),
  customerName: z.string().trim().max(60).optional(),
  phone: z.string().trim().max(20).optional(),
  memberId: z.string().min(1).nullable().optional(),
  note: z.string().trim().max(200).optional(),
};
const createSchema = z.object({ ...fields, depositAmount: z.number().int().min(0).max(100_000_000).default(0) });
const patchSchema = z.object(fields).partial();
const listSchema = z.object({ from: z.string().datetime(), to: z.string().datetime(), status: z.enum(BOOKING_STATUSES).optional() });

export function bookingsRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const auth = { preHandler: requireAuth };

    app.get('/bookings', auth, async (req) => {
      const f = listSchema.parse(req.query);
      return ctx.bookings.list({ from: new Date(f.from), to: new Date(f.to), status: f.status });
    });
    app.get('/bookings/:id', auth, async (req) => ctx.bookings.get(idParam.parse(req.params).id));
    app.post('/bookings', auth, async (req) => ctx.bookings.create(req.user!, createSchema.parse(req.body)));
    app.patch('/bookings/:id', auth, async (req) => ctx.bookings.update(req.user!, idParam.parse(req.params).id, patchSchema.parse(req.body)));
  };
}
```

`apps/server/src/context.ts` — tambah `import type { BookingService } from './modules/bookings/bookings.service';` dan field `bookings: BookingService;` di `AppContext`.

`apps/server/src/app.ts` — tambah import:
```ts
import { BookingService } from './modules/bookings/bookings.service';
import { bookingsRoutes } from './modules/bookings/bookings.routes';
```
setelah `ctx.checkout = new CheckoutService(ctx);`:
```ts
  ctx.bookings = new BookingService(ctx);
```
dan di blok `/api` setelah `await api.register(checkoutRoutes(ctx));`:
```ts
      await api.register(bookingsRoutes(ctx));
```

- [ ] **Step 6: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/server test -- bookings && pnpm --filter @funplay/server typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src apps/server/test/bookings.test.ts
git commit -m "feat(server): bookings with unit-locked conflict check and DEPOSIT bill

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 7: Hold di layar Meja, `BOOKING_HOLD` + `ignoreBooking`, dan check-in

**Files:**
- Modify: `packages/shared/src/views.ts`
- Modify: `apps/server/src/lib/errors.ts`
- Modify: `apps/server/src/modules/sessions/sessions.service.ts`, `apps/server/src/modules/sessions/sessions.routes.ts`
- Modify: `apps/server/src/modules/board/board.ts`
- Modify: `apps/server/src/modules/bookings/bookings.service.ts`, `apps/server/src/modules/bookings/bookings.routes.ts`
- Modify (fixture `UnitView`): `apps/web/src/features/board/UnitCard.test.tsx`, `apps/web/src/features/board/UnitPanel.test.tsx`, `apps/web/src/features/board/SimulatorPanel.test.tsx`, `apps/web/src/stores/board.test.ts`
- Test: `apps/server/test/booking-checkin.test.ts`

**Interfaces:**
- Consumes: `isOnHold`, `holdStartsAt`, `bookingsOverlap`, `UnitBookingView`, `BookingHoldInfo` (Task 3); `memberSnapshot`/`requireActiveMember` (Task 4); `lockBill` (M2), `lockBooking` (Task 5); `BookingService` (Task 6).
- Produces:
  - shared: `UnitView.booking: UnitBookingView | null` (booking BOOKED terawal yang sedang di-hold, atau null).
  - `AppError(status, code, message, details?)`; respons error memuat `error.details` bila ada.
  - `StartInput { unitId, mode, packageId?, memberId?, ignoreBooking? }`, `SessionService.start(user, StartInput)`, `SessionService.startTx(tx, user, input, { now, settings }, { bookingId? })`, `SessionService.touch(...unitIds)` (kini publik), `findBookingClash(tx, unitId, now, packageMin, holdMin, exceptBookingId?)`.
  - `holdBookings(db, now, holdMin, unitIds?)`, `toUnitView(u, devices, booking?)`.
  - `BookingService.checkIn(user, id, { mode, packageId? }) → { unitId }`.
  - API: `POST /api/sessions` menerima `ignoreBooking?: boolean`; 409 `BOOKING_HOLD` dengan pesan **"<meja> dibooking <nama> jam <HH:MM>"** dan `details.booking: BookingHoldInfo`. `POST /api/bookings/:id/check-in` `{ mode, packageId? }` → `CheckInResult` (`{ unit, booking }`).
  - Error check-in: 409 `BOOKING_NOT_ACTIVE`, 409 `BOOKING_TOO_EARLY` ("Check-in baru bisa mulai HH:MM"), 409 `UNIT_BUSY`, 409 `NO_OPEN_SHIFT`.
  - Audit: `session.start_ignore_booking` (entity Booking), `booking.check_in`.

- [ ] **Step 1: Tulis test yang gagal**

`apps/server/test/booking-checkin.test.ts`:
```ts
import type { BoardSnapshot } from '@funplay/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, openShift, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let users: Awaited<ReturnType<typeof seedUsers>>;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  users = await seedUsers();
  b = await seedBasics();
  await openShift(users.kasir.id);
  t = await makeApp(); // 10:00 WIB
  cookie = await loginAs(t.app, 'kasir');
});
afterEach(() => t.app.close());

const req = (method: 'GET' | 'POST', url: string, payload?: unknown) => t.app.inject({ method, url, headers: { cookie }, payload: payload as object });
/** Meja 2, 10:30–11:30 WIB; hold mulai 10:15. */
const book = (over: Record<string, unknown> = {}) =>
  req('POST', '/api/bookings', { unitId: b.m2.id, startAt: '2026-10-01T03:30:00.000Z', durationMin: 60, customerName: 'Budi', ...over });
const checkIn = (id: string, body: Record<string, unknown> = { mode: 'OPEN' }) => req('POST', `/api/bookings/${id}/check-in`, body);
const unitM2 = async () => ((await req('GET', '/api/board')).json() as BoardSnapshot).units.find((u) => u.id === b.m2.id)!;

describe('hold', () => {
  it('meja tampil Booked mulai hold', async () => {
    const bk = (await book()).json().booking;
    expect((await unitM2()).booking).toBeNull();
    t.clock.advanceMinutes(15);
    expect((await unitM2()).booking).toEqual({ id: bk.id, customerName: 'Budi', startAt: '2026-10-01T03:30:00.000Z', durationMin: 60, depositPaid: false });
  });

  it('mulai sesi di meja yang di-hold → BOOKING_HOLD; ignoreBooking melanjutkan dan diaudit', async () => {
    const bk = (await book()).json().booking;
    t.clock.advanceMinutes(15);
    const res = await req('POST', '/api/sessions', { unitId: b.m2.id, mode: 'OPEN' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toEqual({
      code: 'BOOKING_HOLD',
      message: 'Meja 2 dibooking Budi jam 10:30',
      details: { booking: { id: bk.id, customerName: 'Budi', startAt: '2026-10-01T03:30:00.000Z' } },
    });
    const ok = await req('POST', '/api/sessions', { unitId: b.m2.id, mode: 'OPEN', ignoreBooking: true });
    expect(ok.statusCode).toBe(200);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'session.start_ignore_booking' } });
    expect(log).toMatchObject({ entityId: bk.id, userId: users.kasir.id });
  });

  it('paket yang menabrak booking ditolak sebelum hold; open billing boleh', async () => {
    await book();
    expect((await req('POST', '/api/sessions', { unitId: b.m2.id, mode: 'PACKAGE', packageId: b.pkg1.id })).json().error.code).toBe('BOOKING_HOLD'); // 10:00–11:00
    expect((await req('POST', '/api/sessions', { unitId: b.m2.id, mode: 'OPEN' })).statusCode).toBe(200);
  });
});

describe('check-in', () => {
  it('terlalu awal ditolak; sesi + bill booking + member; hold sendiri tidak dihitung; hanya sekali', async () => {
    const gold = await prisma.memberLevel.create({ data: { name: 'Gold', timeDiscountPct: 10 } });
    const sinta = await prisma.member.create({ data: { code: 'M0001', name: 'Sinta', levelId: gold.id } });
    const bk = (await book({ memberId: sinta.id })).json().booking;
    expect((await checkIn(bk.id)).json().error).toMatchObject({ code: 'BOOKING_TOO_EARLY', message: 'Check-in baru bisa mulai 10:15' });
    t.clock.advanceMinutes(15);
    const res = await checkIn(bk.id);
    expect(res.statusCode).toBe(200);
    const session = res.json().unit.session;
    expect(session).toMatchObject({ mode: 'OPEN', status: 'RUNNING' });
    expect(res.json().unit.booking).toBeNull();
    expect(res.json().booking).toMatchObject({ status: 'CHECKED_IN', saleBillId: session.billId });
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: session.billId } })).bookingId).toBe(bk.id);
    expect((await req('GET', `/api/bills/${session.billId}`)).json().member).toMatchObject({ name: 'Sinta', levelName: 'Gold', timeDiscountPct: 10 });
    expect((await checkIn(bk.id)).json().error.code).toBe('BOOKING_NOT_ACTIVE');
    expect(await prisma.auditLog.count({ where: { action: 'booking.check_in' } })).toBe(1);
  });

  it('check-in saat meja dipakai → UNIT_BUSY; check-in paralel → satu berhasil', async () => {
    const bk = (await book()).json().booking;
    t.clock.advanceMinutes(15);
    const walkIn = (await req('POST', '/api/sessions', { unitId: b.m2.id, mode: 'OPEN', ignoreBooking: true })).json().unit.session;
    expect((await checkIn(bk.id)).json().error.code).toBe('UNIT_BUSY');
    await req('POST', `/api/sessions/${walkIn.id}/stop`, {});
    const [x, y] = await Promise.all([checkIn(bk.id), checkIn(bk.id)]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    expect(await prisma.session.count({ where: { status: { not: 'ENDED' } } })).toBe(1);
  });

  it('check-in membatalkan bill DP yang belum dibayar; tanpa shift ditolak tanpa efek', async () => {
    const created = (await book({ depositAmount: 20000 })).json();
    t.clock.advanceMinutes(15);
    await req('POST', '/api/shifts/current/close', { countedCash: 0 });
    expect((await checkIn(created.booking.id)).json().error.code).toBe('NO_OPEN_SHIFT');
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: created.depositBillId } })).status).toBe('OPEN');
    await req('POST', '/api/shifts', { openingCash: 0 });
    expect((await checkIn(created.booking.id)).statusCode).toBe(200);
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: created.depositBillId } })).status).toBe('CANCELLED');
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- booking-checkin`
Expected: FAIL — `unit.booking` undefined, sesi di meja yang di-hold tetap dimulai, route check-in 404.

- [ ] **Step 3: `UnitView.booking` & detail error**

`packages/shared/src/views.ts` — ubah import menjadi `import type { BookingSettings, UnitBookingView } from './bookings';` dan tambahkan di `interface UnitView` setelah `session: SessionView | null;`:
```ts
  /** Booking BOOKED terawal yang sedang menahan meja (hold), atau null. */
  booking: UnitBookingView | null;
```

Perbarui fixture web:
```bash
cd apps/web/src
sed -i 's/\(deviceOnline: [a-z]*,\)/\1 booking: null,/' features/board/UnitCard.test.tsx features/board/UnitPanel.test.tsx features/board/SimulatorPanel.test.tsx stores/board.test.ts
cd ../../..
```
Expected: setiap objek `UnitView` lengkap di keempat file memuat `booking: null` (objek inline `{ ...base, ..., deviceOnline: false }` tidak berubah karena mewarisi `base`).

`apps/server/src/lib/errors.ts` — ganti kelas `AppError` dan cabang `AppError` di error handler:
```ts
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** Data tambahan untuk klien, mis. info booking pada BOOKING_HOLD. */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
```
```ts
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
    }
```

- [ ] **Step 4: `startTx`, hold, dan `ignoreBooking`**

Di `apps/server/src/modules/sessions/sessions.service.ts`:

1. Ganti import paling atas menjadi:
```ts
import { Prisma, type Booking, type Session } from '@prisma/client';
import {
  addMinutes, bookingsOverlap, computeSessionCharge, findTariff, isOnHold, localDateKey, localHHMM, NoTariffError, sessionElapsedMs,
  type ChargeSettings, type PublicSettings, type PublicUser, type SessionLike, type SessionMode, type TariffRule, type TimeCharge,
} from '@funplay/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
```
(import `audit`, `approveWithPin`, `loadTariffRules`, `requireOpenShift`, `getSettings`, `memberSnapshot`/`requireActiveMember` tetap.)

2. Setelah fungsi `stopCharge`, tambahkan:
```ts
export interface StartInput { unitId: string; mode: SessionMode; packageId?: string; memberId?: string | null; ignoreBooking?: boolean }
export interface StartEnv { now: Date; settings: PublicSettings }

/**
 * Booking BOOKED yang menghalangi sesi baru: sedang di-hold, atau (paket) jendelanya beririsan dengan
 * [now, now + durasi paket). `exceptBookingId` = booking yang sedang check-in (hold miliknya tidak dihitung).
 */
export async function findBookingClash(
  tx: Db, unitId: string, now: Date, packageMin: number | null, holdMin: number, exceptBookingId?: string,
): Promise<Booking | null> {
  const rows = await tx.booking.findMany({
    where: {
      unitId,
      status: 'BOOKED',
      startAt: { lte: addMinutes(now, Math.max(holdMin, packageMin ?? 0)) },
      ...(exceptBookingId ? { id: { not: exceptBookingId } } : {}),
    },
    orderBy: { startAt: 'asc' },
  });
  return rows.find((x) => isOnHold(x, now, holdMin) || (packageMin !== null && bookingsOverlap(x, { startAt: now, durationMin: packageMin }))) ?? null;
}
```

3. Ubah `protected touch(...unitIds: string[]): void {` menjadi `touch(...unitIds: string[]): void {` (dipanggil juga oleh check-in).

4. Ganti seluruh method `start` dengan:
```ts
  async start(user: PublicUser, input: StartInput): Promise<Session> {
    const { prisma, clock } = this.ctx;
    const env: StartEnv = { now: clock.now(), settings: await getSettings(prisma) };
    const unitName = (await prisma.unit.findUnique({ where: { id: input.unitId }, select: { name: true } }))?.name ?? 'Meja';
    let session: Session;
    try {
      session = await prisma.$transaction((tx) => this.startTx(tx, user, input, env));
    } catch (err) {
      rethrowBusy(err, unitName);
    }
    this.touch(session.unitId);
    return session;
  }

  /**
   * Inti mulai sesi di dalam transaksi pemanggil (dipakai juga check-in booking). Pemanggil wajib
   * memanggil `touch(unitId)` setelah commit dan `rethrowBusy` bila gagal.
   */
  async startTx(tx: Db, user: PublicUser, input: StartInput, env: StartEnv, opts: { bookingId?: string } = {}): Promise<Session> {
    const { now, settings } = env;
    await requireOpenShift(tx);
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

    const clash = await findBookingClash(tx, unit.id, now, pkg?.durationMin ?? null, settings.bookingHoldMin, opts.bookingId);
    if (clash && !input.ignoreBooking) {
      throw new AppError(409, 'BOOKING_HOLD', `${unit.name} dibooking ${clash.customerName} jam ${localHHMM(clash.startAt, settings.utcOffsetMin)}`, {
        booking: { id: clash.id, customerName: clash.customerName, startAt: clash.startAt.toISOString() },
      });
    }

    const member = input.memberId ? await requireActiveMember(tx, input.memberId) : null;
    const bill = await tx.bill.create({
      data: {
        number: await nextBillNumber(tx, now, settings.utcOffsetMin),
        label: unit.name,
        createdById: user.id,
        bookingId: opts.bookingId ?? null,
        ...memberSnapshot(member),
      },
    });
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
    await audit(tx, {
      userId: user.id, action: 'session.start', entity: 'Session', entityId: s.id,
      data: { unitId: unit.id, mode: input.mode, packageId: pkg?.id ?? null, memberId: member?.id ?? null, bookingId: opts.bookingId ?? null },
    });
    if (clash) {
      await audit(tx, { userId: user.id, action: 'session.start_ignore_booking', entity: 'Booking', entityId: clash.id, data: { sessionId: s.id, unitId: unit.id } });
    }
    return s;
  }
```

`apps/server/src/modules/sessions/sessions.routes.ts` — tambahkan ke `startSchema`:
```ts
  ignoreBooking: z.boolean().optional(),
```

- [ ] **Step 5: Booking di view meja**

Di `apps/server/src/modules/board/board.ts`:
1. Ganti import shared menjadi `import { addMinutes, type BoardSnapshot, type SessionView, type UnitBookingView, type UnitView } from '@funplay/shared';` dan tambah `import type { Db } from '../../db';`.
2. Tambahkan setelah `toSessionView`:
```ts
/** Booking BOOKED yang sedang di-hold per meja (yang terawal), plus status DP. */
export async function holdBookings(db: Db, now: Date, holdMin: number, unitIds?: string[]): Promise<Map<string, UnitBookingView>> {
  const rows = await db.booking.findMany({
    where: { status: 'BOOKED', startAt: { lte: addMinutes(now, holdMin) }, ...(unitIds ? { unitId: { in: unitIds } } : {}) },
    orderBy: { startAt: 'asc' },
  });
  const depIds = rows.map((r) => r.depositBillId).filter((x): x is string => !!x);
  const paid = new Set(
    (depIds.length ? await db.bill.findMany({ where: { id: { in: depIds }, status: 'PAID' }, select: { id: true } }) : []).map((x) => x.id),
  );
  const out = new Map<string, UnitBookingView>();
  for (const r of rows) {
    if (out.has(r.unitId)) continue;
    out.set(r.unitId, {
      id: r.id, customerName: r.customerName, startAt: r.startAt.toISOString(), durationMin: r.durationMin,
      depositPaid: !!r.depositBillId && paid.has(r.depositBillId),
    });
  }
  return out;
}
```
3. Ganti `toUnitView`, `buildUnitView`, dan `buildBoard` dengan:
```ts
export function toUnitView(u: UnitRow, devices: DeviceManager, booking: UnitBookingView | null = null): UnitView {
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
    booking,
  };
}

export async function buildUnitView(ctx: AppContext, unitId: string): Promise<UnitView | null> {
  const [u, settings] = await Promise.all([ctx.prisma.unit.findUnique({ where: { id: unitId }, include: unitInclude }), getSettings(ctx.prisma)]);
  if (!u) return null;
  const holds = await holdBookings(ctx.prisma, ctx.clock.now(), settings.bookingHoldMin, [u.id]);
  return toUnitView(u, ctx.devices, holds.get(u.id) ?? null);
}

export async function buildBoard(ctx: AppContext): Promise<BoardSnapshot> {
  const [settings, units, tariffs] = await Promise.all([
    getSettings(ctx.prisma),
    ctx.prisma.unit.findMany({ include: unitInclude, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    loadTariffRules(ctx.prisma),
  ]);
  const holds = await holdBookings(ctx.prisma, ctx.clock.now(), settings.bookingHoldMin);
  return {
    serverTime: ctx.clock.now().toISOString(),
    settings,
    units: units.map((u) => toUnitView(u, ctx.devices, holds.get(u.id) ?? null)),
    devices: ctx.devices.status(),
    tariffs,
  };
}
```

- [ ] **Step 6: Check-in**

Di `apps/server/src/modules/bookings/bookings.service.ts`:
1. Ubah import shared menjadi:
```ts
import {
  addMinutes, bookingsOverlap, bookingWindow, formatReceiptDate, holdStartsAt, isOnHold, localHHMM,
  type BookingStatus, type BookingView, type CreateBookingResult, type PublicUser, type SessionMode,
} from '@funplay/shared';
```
tambah `import { lockBill } from '../billing/bill-view';`, dan ganti `import { nextBillNumber } from '../sessions/sessions.service';` menjadi:
```ts
import { nextBillNumber, rethrowBusy } from '../sessions/sessions.service';
```

2. Tambahkan method di kelas `BookingService`:
```ts
  /**
   * Check-in: mulai sesi (Open/Paket) dengan bill SALE baru yang terhubung ke booking & member booking.
   * Urutan kunci: bill DEPOSIT → Booking → (mulai sesi: BillCounter, Unit). Bill DP yang belum dibayar dibatalkan.
   */
  async checkIn(user: PublicUser, id: string, input: { mode: SessionMode; packageId?: string }): Promise<{ unitId: string }> {
    const { prisma, clock } = this.ctx;
    const now = clock.now();
    const settings = await getSettings(prisma);
    const pre = await prisma.booking.findUnique({ where: { id }, include: { unit: { select: { name: true } } } });
    if (!pre) throw notFound('Booking');
    let r: { unitId: string; cancelledDepositBillId: string | null };
    try {
      r = await prisma.$transaction(async (tx) => {
        if (pre.depositBillId) await lockBill(tx, pre.depositBillId);
        await lockBooking(tx, id);
        const bk = await tx.booking.findUniqueOrThrow({ where: { id } });
        if (bk.status !== 'BOOKED') throw conflict('BOOKING_NOT_ACTIVE', 'Booking sudah tidak aktif');
        if (!isOnHold(bk, now, settings.bookingHoldMin)) {
          throw conflict('BOOKING_TOO_EARLY', `Check-in baru bisa mulai ${localHHMM(holdStartsAt(bk.startAt, settings.bookingHoldMin), settings.utcOffsetMin)}`);
        }
        let cancelledDepositBillId: string | null = null;
        if (bk.depositBillId) {
          const dep = await tx.bill.findUniqueOrThrow({ where: { id: bk.depositBillId } });
          if (dep.status === 'OPEN') {
            await tx.bill.update({ where: { id: dep.id }, data: { status: 'CANCELLED', cancelReason: 'DP tidak dibayar saat check-in' } });
            cancelledDepositBillId = dep.id;
          }
        }
        const session = await this.ctx.sessions.startTx(
          tx, user,
          { unitId: bk.unitId, mode: input.mode, packageId: input.packageId, memberId: bk.memberId },
          { now, settings },
          { bookingId: bk.id },
        );
        await tx.booking.update({ where: { id }, data: { status: 'CHECKED_IN', saleBillId: session.billId } });
        await audit(tx, { userId: user.id, action: 'booking.check_in', entity: 'Booking', entityId: id, data: { sessionId: session.id, billId: session.billId } });
        return { unitId: bk.unitId, cancelledDepositBillId };
      });
    } catch (err) {
      rethrowBusy(err, pre.unit.name);
    }
    this.ctx.sessions.touch(r.unitId);
    this.changed(id);
    if (r.cancelledDepositBillId) this.ctx.bus.emit('bill.changed', r.cancelledDepositBillId);
    return { unitId: r.unitId };
  }
```

Di `apps/server/src/modules/bookings/bookings.routes.ts`: ubah import shared menjadi `import { BOOKING_STATUSES, SESSION_MODES, type CheckInResult } from '@funplay/shared';`, tambah `import { buildUnitView } from '../board/board';`, tambah skema:
```ts
const checkInSchema = z.object({ mode: z.enum(SESSION_MODES), packageId: z.string().min(1).optional() });
```
dan route:
```ts
    app.post('/bookings/:id/check-in', auth, async (req): Promise<CheckInResult> => {
      const { id } = idParam.parse(req.params);
      const r = await ctx.bookings.checkIn(req.user!, id, checkInSchema.parse(req.body));
      return { unit: await buildUnitView(ctx, r.unitId), booking: await ctx.bookings.get(id) };
    });
```

- [ ] **Step 7: Jalankan test & typecheck**

Run: `pnpm typecheck && pnpm --filter @funplay/server test && pnpm --filter @funplay/web test`
Expected: PASS (test M1 `sessions`, `realtime`, `scheduler` tetap hijau — tanpa booking tidak ada hold).

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/views.ts apps/server/src apps/server/test/booking-checkin.test.ts apps/web/src
git commit -m "feat(server): booking hold on board, BOOKING_HOLD with ignoreBooking, check-in

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 8: Checkout dengan DP (`DEPOSIT`), void yang mengembalikan DP, gabung bill booking

**Files:**
- Modify: `packages/shared/src/transactions.ts`
- Modify: `apps/server/src/modules/billing/bill-view.ts`, `apps/server/src/modules/billing/checkout.service.ts`
- Modify (fixture `BillView`): `apps/web/src/features/checkout/CheckoutDialog.test.tsx`, `apps/web/src/features/orders/BillItems.test.tsx`, `apps/web/src/hooks/useBill.test.ts`, `apps/web/src/features/transactions/BillDetail.test.tsx`
- Test: `apps/server/test/booking-deposit.test.ts`

**Interfaces:**
- Consumes: `checkPayments(..., { deposit })` (Task 2); `BillBookingView` (Task 3); `lockBooking` (Task 5); booking & check-in (Task 6–7); merge Task 5.
- Produces:
  - shared: `BillView.booking: BillBookingView | null` (`deposit: { amount, available } | null` hanya untuk bill SALE booking ber-DP); `CheckoutResult.depositChange: number`.
  - server: `bookingOfBill(db, bill)` (bill-view); `CheckoutService.voidTx(tx, user, billId, reason, approvedById): Promise<BookingTouch | null>`, `CheckoutService.afterVoid(billId, touched)`, `BookingTouch { bookingId, unitId }`.
  - Aturan: checkout bill SALE booking dengan `DEPOSIT` mengunci `Booking` (setelah Bill), mensyaratkan bill DEPOSIT PAID & `depositOutcome` null, lalu `depositOutcome = USED`, `depositUsedAmount = amount`. Checkout bill DEPOSIT mensyaratkan booking `BOOKED`. Void bill SALE ber-DEPOSIT → `REFUNDED`; void bill DEPOSIT → `REFUNDED`, ditolak 409 **`DEPOSIT_USED`** bila DP sudah dipakai.
  - Error: 409 `DEPOSIT_NOT_AVAILABLE`, 409 `DEPOSIT_USED`, 409 `BOOKING_NOT_ACTIVE`, 400 `PAYMENT_INVALID`.

- [ ] **Step 1: Field shared & fixture**

Di `packages/shared/src/transactions.ts`: tambah `import type { BillBookingView } from './bookings';`, tambahkan di `interface BillView` setelah `member: BillMemberView | null;`:
```ts
  /** Booking yang terhubung (bill SALE hasil check-in, atau bill DEPOSIT miliknya). */
  booking: BillBookingView | null;
```
dan ganti `CheckoutResult`:
```ts
export interface CheckoutResult {
  bill: BillView;
  /** Kembalian tunai dari pembayaran CASH. */
  change: number;
  /** Kelebihan DP booking yang dikembalikan tunai. */
  depositChange: number;
}
```

```bash
cd apps/web/src
for f in features/checkout/CheckoutDialog.test.tsx features/orders/BillItems.test.tsx hooks/useBill.test.ts features/transactions/BillDetail.test.tsx; do
  sed -i "s/kind: 'SALE', member:/kind: 'SALE', booking: null, member:/" "$f"
done
cd ../../..
```

- [ ] **Step 2: Tulis test yang gagal**

`apps/server/test/booking-deposit.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, openShift, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  const users = await seedUsers();
  b = await seedBasics();
  await openShift(users.kasir.id, 100000);
  t = await makeApp(); // 10:00 WIB
  cookie = await loginAs(t.app, 'kasir');
});
afterEach(() => t.app.close());

const req = (method: 'GET' | 'POST', url: string, payload?: unknown) => t.app.inject({ method, url, headers: { cookie }, payload: payload as object });
const pay = (billId: string, total: number, payments: unknown[], key = 'key-0000001') =>
  req('POST', `/api/bills/${billId}/checkout`, { idempotencyKey: key, expectedGrandTotal: total, payments });
const bookingRow = (id: string) => prisma.booking.findUniqueOrThrow({ where: { id } });

/** Booking Meja 2 10:30, DP tunai dibayar (bila > 0), check-in 10:15, main 60 menit lalu stop → bill penjualan Rp40.000. */
async function checkedIn(deposit: number) {
  const created = (await req('POST', '/api/bookings', { unitId: b.m2.id, startAt: '2026-10-01T03:30:00.000Z', durationMin: 60, customerName: 'Budi', depositAmount: deposit })).json();
  if (deposit > 0) expect((await pay(created.depositBillId, deposit, [{ method: 'CASH', amount: deposit }], `dp-${created.booking.id}`)).statusCode).toBe(200);
  t.clock.advanceMinutes(15);
  const ci = await req('POST', `/api/bookings/${created.booking.id}/check-in`, { mode: 'OPEN' });
  expect(ci.statusCode).toBe(200);
  const session = ci.json().unit.session;
  t.clock.advanceMinutes(60);
  await req('POST', `/api/sessions/${session.id}/stop`, {});
  return { bookingId: created.booking.id as string, saleBillId: session.billId as string, depositBillId: created.depositBillId as string | null };
}

const DP_30_PLUS_CASH = [{ method: 'DEPOSIT', amount: 30000, received: 30000 }, { method: 'CASH', amount: 10000 }];

describe('checkout dengan DP booking', () => {
  it('DP < total: DEPOSIT dipakai + tunai, booking USED', async () => {
    const x = await checkedIn(30000);
    expect((await req('GET', `/api/bills/${x.saleBillId}`)).json().booking).toEqual({
      id: x.bookingId, customerName: 'Budi', startAt: '2026-10-01T03:30:00.000Z', status: 'CHECKED_IN', deposit: { amount: 30000, available: true },
    });
    const res = await pay(x.saleBillId, 40000, DP_30_PLUS_CASH);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ change: 0, depositChange: 0 });
    expect(await bookingRow(x.bookingId)).toMatchObject({ depositOutcome: 'USED', depositUsedAmount: 30000 });
    expect((await req('GET', `/api/bills/${x.saleBillId}`)).json().booking.deposit).toEqual({ amount: 30000, available: false });
  });

  it('DP > total: amount = total, kembalian DP dicatat', async () => {
    const x = await checkedIn(50000);
    const res = await pay(x.saleBillId, 40000, [{ method: 'DEPOSIT', amount: 40000, received: 50000 }]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ change: 0, depositChange: 10000 });
    expect(await prisma.payment.findFirstOrThrow({ where: { billId: x.saleBillId } })).toMatchObject({ method: 'DEPOSIT', amount: 40000, received: 50000, change: 10000 });
    expect((await bookingRow(x.bookingId)).depositUsedAmount).toBe(40000);
  });

  it('nominal DP salah, bill tanpa booking, atau bill DP → PAYMENT_INVALID', async () => {
    const x = await checkedIn(50000);
    expect((await pay(x.saleBillId, 40000, [{ method: 'DEPOSIT', amount: 50000, received: 50000 }])).json().error.code).toBe('PAYMENT_INVALID');
    expect((await pay(x.saleBillId, 40000, [{ method: 'DEPOSIT', amount: 40000, received: 40000 }])).json().error.code).toBe('PAYMENT_INVALID');
    const loose = (await req('POST', '/api/bills')).json();
    await req('POST', `/api/bills/${loose.id}/items`, { items: [{ custom: { name: 'Sewa stik', price: 10000 }, qty: 1 }] });
    expect((await pay(loose.id, 10000, [{ method: 'DEPOSIT', amount: 10000 }], 'key-0000002')).json().error.code).toBe('PAYMENT_INVALID');
    const other = (await req('POST', '/api/bookings', { unitId: b.m1.id, startAt: '2026-10-01T05:00:00.000Z', durationMin: 60, customerName: 'Rina', depositAmount: 20000 })).json();
    expect((await pay(other.depositBillId, 20000, [{ method: 'DEPOSIT', amount: 20000 }], 'key-0000003')).json().error.code).toBe('PAYMENT_INVALID');
    expect((await bookingRow(x.bookingId)).depositOutcome).toBeNull();
  });

  it('DP belum dibayar saat check-in → DEPOSIT ditolak DEPOSIT_NOT_AVAILABLE', async () => {
    const created = (await req('POST', '/api/bookings', { unitId: b.m2.id, startAt: '2026-10-01T03:30:00.000Z', durationMin: 60, customerName: 'Budi', depositAmount: 20000 })).json();
    t.clock.advanceMinutes(15);
    const session = (await req('POST', `/api/bookings/${created.booking.id}/check-in`, { mode: 'OPEN' })).json().unit.session;
    t.clock.advanceMinutes(60);
    await req('POST', `/api/sessions/${session.id}/stop`, {});
    expect((await req('GET', `/api/bills/${session.billId}`)).json().booking.deposit).toEqual({ amount: 20000, available: false });
    const res = await pay(session.billId, 40000, [{ method: 'DEPOSIT', amount: 20000, received: 20000 }, { method: 'CASH', amount: 20000 }]);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('DEPOSIT_NOT_AVAILABLE');
  });

  it('checkout ulang dengan key sama (juga paralel) tidak mengulang efek DP', async () => {
    const x = await checkedIn(30000);
    const [a, c] = await Promise.all([pay(x.saleBillId, 40000, DP_30_PLUS_CASH), pay(x.saleBillId, 40000, DP_30_PLUS_CASH)]);
    expect([a.statusCode, c.statusCode]).toEqual([200, 200]);
    const again = await pay(x.saleBillId, 40000, DP_30_PLUS_CASH);
    expect(again.json()).toMatchObject({ change: 0, depositChange: 0, bill: { status: 'PAID' } });
    expect(await prisma.payment.count({ where: { billId: x.saleBillId } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: 'bill.paid', entityId: x.saleBillId } })).toBe(1);
    expect((await bookingRow(x.bookingId)).depositUsedAmount).toBe(30000);
  });
});

describe('void & gabung dengan DP', () => {
  it('void bill penjualan ber-DP: DP dikembalikan tunai, booking REFUNDED', async () => {
    const x = await checkedIn(30000);
    await pay(x.saleBillId, 40000, DP_30_PLUS_CASH);
    expect((await req('POST', `/api/bills/${x.saleBillId}/void`, { reason: 'salah meja', approvalPin: '1111' })).statusCode).toBe(200);
    expect((await bookingRow(x.bookingId)).depositOutcome).toBe('REFUNDED');
    expect((await req('GET', '/api/shifts/current')).json().summary.voids).toMatchObject({ DEPOSIT: 30000, CASH: 10000 });
  });

  it('void bill DP: sebelum dipakai → REFUNDED; sesudah dipakai → DEPOSIT_USED', async () => {
    const early = (await req('POST', '/api/bookings', { unitId: b.m1.id, startAt: '2026-10-01T05:00:00.000Z', durationMin: 60, customerName: 'Rina', depositAmount: 20000 })).json();
    await pay(early.depositBillId, 20000, [{ method: 'CASH', amount: 20000 }], 'dp-rina-0001');
    expect((await req('POST', `/api/bills/${early.depositBillId}/void`, { reason: 'batal', approvalPin: '1111' })).statusCode).toBe(200);
    expect(await bookingRow(early.booking.id)).toMatchObject({ status: 'BOOKED', depositOutcome: 'REFUNDED' });

    const x = await checkedIn(30000);
    await pay(x.saleBillId, 40000, DP_30_PLUS_CASH);
    const res = await req('POST', `/api/bills/${x.depositBillId}/void`, { reason: 'x', approvalPin: '1111' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('DEPOSIT_USED');
  });

  it('gabung bill booking: booking pindah ke target; dua booking → MERGE_CONFLICT; DP dipakai di target', async () => {
    const x = await checkedIn(30000); // jam 11:15
    const a = (await req('POST', '/api/bills')).json();
    await req('POST', `/api/bills/${a.id}/items`, { items: [{ custom: { name: 'Sewa stik', price: 10000 }, qty: 1 }] });
    const merged = await req('POST', `/api/bills/${a.id}/merge`, { sourceBillId: x.saleBillId });
    expect(merged.statusCode).toBe(200);
    expect(merged.json().booking).toMatchObject({ id: x.bookingId, deposit: { amount: 30000, available: true } });
    expect((await bookingRow(x.bookingId)).saleBillId).toBe(a.id);

    const second = (await req('POST', '/api/bookings', { unitId: b.m1.id, startAt: '2026-10-01T04:30:00.000Z', durationMin: 60, customerName: 'Rina' })).json(); // 11:30
    const s2 = (await req('POST', `/api/bookings/${second.booking.id}/check-in`, { mode: 'OPEN' })).json().unit.session;
    expect((await req('POST', `/api/bills/${a.id}/merge`, { sourceBillId: s2.billId })).json().error.code).toBe('MERGE_CONFLICT');

    const res = await pay(a.id, 50000, [{ method: 'DEPOSIT', amount: 30000, received: 30000 }, { method: 'CASH', amount: 20000 }]);
    expect(res.statusCode).toBe(200);
    expect((await bookingRow(x.bookingId)).depositOutcome).toBe('USED');
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- booking-deposit`
Expected: FAIL — `bill.booking` tidak ada; `DEPOSIT` ditolak "DP booking tidak tersedia untuk bill ini"; `depositChange` tidak ada.

- [ ] **Step 4: Booking di view bill**

Di `apps/server/src/modules/billing/bill-view.ts`:
1. Tambah `type BillBookingView` ke import dari `@funplay/shared`.
2. Tambahkan setelah `lockBill`:
```ts
/** Booking milik bill: bill DEPOSIT lewat `Booking.depositBillId`, bill SALE lewat `Bill.bookingId`. */
export async function bookingOfBill(db: Db, bill: { id: string; kind: BillKind; bookingId: string | null }) {
  if (bill.kind === 'DEPOSIT') return db.booking.findUnique({ where: { depositBillId: bill.id } });
  return bill.bookingId ? db.booking.findUnique({ where: { id: bill.bookingId } }) : null;
}

/** `deposit.available` = bill DEPOSIT PAID dan DP belum dipakai, hangus, atau dikembalikan. */
async function billBooking(db: Db, b: { id: string; kind: BillKind; bookingId: string | null }): Promise<BillBookingView | null> {
  const bk = await bookingOfBill(db, b);
  if (!bk) return null;
  let deposit: BillBookingView['deposit'] = null;
  if (b.kind === 'SALE' && bk.depositAmount > 0) {
    const dep = bk.depositBillId ? await db.bill.findUnique({ where: { id: bk.depositBillId }, select: { status: true } }) : null;
    deposit = { amount: bk.depositAmount, available: dep?.status === 'PAID' && bk.depositOutcome === null };
  }
  return { id: bk.id, customerName: bk.customerName, startAt: bk.startAt.toISOString(), status: bk.status, deposit };
}
```
3. Di `toBillView`, tambahkan properti setelah `member: …,`:
```ts
    booking: await billBooking(db, b),
```

- [ ] **Step 5: Checkout & void**

Ganti seluruh isi `apps/server/src/modules/billing/checkout.service.ts`:
```ts
import { Prisma } from '@prisma/client';
import { checkPayments, needsDiscountApproval, type BillView, type CheckoutResult, type PaymentInput, type PublicUser } from '@funplay/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { audit } from '../audit/audit';
import { approveWithPin } from '../auth/auth.service';
import { lockBooking } from '../bookings/booking-lock';
import { getSettings } from '../settings/settings.service';
import { requireOpenShift } from '../shifts/shifts.service';
import { bookingOfBill, linesTotals, loadBillView, lockBill } from './bill-view';

export interface CheckoutInput { idempotencyKey: string; expectedGrandTotal: number; payments: PaymentInput[]; approvalPin?: string }
/** Booking yang tersentuh transaksi, untuk event setelah commit. */
export interface BookingTouch { bookingId: string; unitId: string }
interface Outcome { billId: string; change: number; depositChange: number; touched: BookingTouch | null }

/** Jumlah per produk stok di bill (baris produk sama bisa lebih dari satu bila harganya berbeda). */
// Urutkan per produk agar UPDATE baris Product tidak saling kunci terbalik antar checkout paralel.
const sortedStockQty = (lines: { type: string; productId: string | null; qty: number }[]) =>
  [...stockQtyByProduct(lines)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

function stockQtyByProduct(lines: { type: string; productId: string | null; qty: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) if (l.type === 'PRODUCT' && l.productId) m.set(l.productId, (m.get(l.productId) ?? 0) + l.qty);
  return m;
}

const changeOf = (payments: { method: string; change: number | null }[], method: 'CASH' | 'DEPOSIT') =>
  payments.filter((p) => p.method === method).reduce((a, p) => a + (p.change ?? 0), 0);

export class CheckoutService {
  constructor(private readonly ctx: AppContext) {}

  /** Hasil checkout sebelumnya untuk key ini (null bila belum ada). */
  private async prior(db: Db, billId: string, key: string): Promise<Outcome | null> {
    const b = await db.bill.findUnique({ where: { checkoutKey: key }, include: { payments: true } });
    if (!b) return null;
    if (b.id !== billId) throw conflict('REQUEST_ID_USED', 'ID pembayaran sudah dipakai untuk bill lain');
    return { billId: b.id, change: changeOf(b.payments, 'CASH'), depositChange: changeOf(b.payments, 'DEPOSIT'), touched: null };
  }

  async checkout(user: PublicUser, billId: string, input: CheckoutInput): Promise<CheckoutResult> {
    const { prisma, clock } = this.ctx;
    const finish = async (r: Outcome): Promise<CheckoutResult> => ({ bill: await loadBillView(prisma, r.billId), change: r.change, depositChange: r.depositChange });

    const done = await this.prior(prisma, billId, input.idempotencyKey);
    if (done) return finish(done);

    const settings = await getSettings(prisma);
    const pre = await prisma.bill.findUnique({ where: { id: billId }, include: { lines: true } });
    if (!pre) throw notFound('Bill');
    // PIN diverifikasi di luar transaksi (approveWithPin menulis ke tabel User).
    const approvedById = needsDiscountApproval(linesTotals(pre, settings), settings.discountApprovalPct)
      ? await approveWithPin(prisma, clock, user, input.approvalPin)
      : null;

    let result: Outcome;
    let replay = false;
    try {
      result = await prisma.$transaction(async (tx) => {
        await lockBill(tx, billId);
        const again = await this.prior(tx, billId, input.idempotencyKey); // request kembar yang baru selesai
        if (again) {
          replay = true;
          return again;
        }
        const bill = await tx.bill.findUniqueOrThrow({
          where: { id: billId },
          include: { lines: true, sessions: { where: { status: { not: 'ENDED' } }, select: { id: true } } },
        });
        if (bill.status !== 'OPEN') throw conflict('BILL_NOT_OPEN', 'Bill sudah dibayar atau dibatalkan');
        if (bill.sessions.length) throw conflict('SESSION_ACTIVE', 'Hentikan sesi meja terlebih dahulu');
        if (!bill.lines.length) throw badRequest('BILL_EMPTY', 'Bill masih kosong');

        // Urutan kunci: Bill → Booking → Shift (share) → Product. Status DP diperiksa ulang di bawah kunci booking.
        let touched: BookingTouch | null = null;
        let deposit: number | null = null;
        const bk = await bookingOfBill(tx, bill);
        if (bk) {
          await lockBooking(tx, bk.id);
          const fresh = await tx.booking.findUniqueOrThrow({ where: { id: bk.id } });
          touched = { bookingId: fresh.id, unitId: fresh.unitId };
          if (bill.kind === 'DEPOSIT' && fresh.status !== 'BOOKED') throw conflict('BOOKING_NOT_ACTIVE', 'Booking sudah tidak aktif');
          if (bill.kind === 'SALE' && input.payments.some((p) => p.method === 'DEPOSIT')) {
            const dep = fresh.depositBillId ? await tx.bill.findUnique({ where: { id: fresh.depositBillId }, select: { status: true } }) : null;
            if (fresh.depositAmount <= 0 || dep?.status !== 'PAID' || fresh.depositOutcome !== null) {
              throw conflict('DEPOSIT_NOT_AVAILABLE', 'DP booking sudah tidak tersedia');
            }
            deposit = fresh.depositAmount;
          }
        }
        const shift = await requireOpenShift(tx, { lock: true });

        const totals = linesTotals(bill, settings);
        if (totals.grandTotal !== input.expectedGrandTotal) throw conflict('TOTAL_CHANGED', 'Total tagihan berubah. Periksa kembali sebelum membayar.');
        if (needsDiscountApproval(totals, settings.discountApprovalPct) && !approvedById) {
          throw conflict('TOTAL_CHANGED', 'Diskon berubah. Periksa kembali sebelum membayar.');
        }
        const pay = checkPayments(totals.grandTotal, input.payments, { deposit });
        if (!pay.ok) throw badRequest(pay.code, pay.message);

        const now = clock.now();
        for (const p of pay.payments) {
          await tx.payment.create({
            data: { billId, shiftId: shift.id, method: p.method, amount: p.amount, received: p.received, change: p.change, reference: p.reference, createdAt: now },
          });
        }
        const usedDeposit = pay.payments.find((p) => p.method === 'DEPOSIT');
        if (usedDeposit && touched) {
          await tx.booking.update({ where: { id: touched.bookingId }, data: { depositOutcome: 'USED', depositUsedAmount: usedDeposit.amount } });
        }
        for (const [productId, qty] of sortedStockQty(bill.lines)) {
          await tx.product.update({ where: { id: productId }, data: { stockQty: { decrement: qty } } });
          await tx.stockMovement.create({ data: { productId, qty: -qty, reason: 'SALE', billId, userId: user.id, createdAt: now } });
        }
        await tx.bill.update({
          where: { id: billId },
          data: {
            status: 'PAID', paidAt: now, paidById: user.id, shiftId: shift.id, checkoutKey: input.idempotencyKey,
            subtotal: totals.subtotal, discountTotal: totals.discountTotal, serviceTotal: totals.serviceTotal, taxTotal: totals.taxTotal, grandTotal: totals.grandTotal,
          },
        });
        await audit(tx, {
          userId: user.id, action: 'bill.paid', entity: 'Bill', entityId: billId, approvedById,
          data: {
            grandTotal: totals.grandTotal, discountTotal: totals.discountTotal, memberDiscountTotal: totals.memberDiscountTotal,
            change: pay.change, depositChange: pay.depositChange, bookingId: touched?.bookingId ?? null,
            payments: pay.payments.map((p) => ({ method: p.method, amount: p.amount })),
          },
        });
        return { billId, change: pay.change, depositChange: pay.depositChange, touched };
      });
    } catch (err) {
      // Dua request kembar lolos bersamaan: yang kalah menabrak unik checkoutKey → kembalikan hasil pemenang.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && String(err.meta?.target ?? '').includes('checkoutKey')) {
        const won = await this.prior(prisma, billId, input.idempotencyKey);
        if (won) return finish(won);
      }
      throw err;
    }

    if (!replay) {
      this.ctx.bus.emit('bill.changed', billId);
      this.ctx.bus.emit('shift.changed');
      if (result.touched) {
        this.ctx.bus.emit('booking.changed', result.touched.bookingId);
        this.ctx.bus.emit('unit.changed', result.touched.unitId); // ikon DP di kartu meja
      }
      this.ctx.printing.later(() => this.ctx.printing.printReceipt(user.id, billId));
    }
    return finish(result);
  }

  async void(user: PublicUser, billId: string, input: { reason: string; approvalPin?: string }): Promise<BillView> {
    const { prisma, clock } = this.ctx;
    const approvedById = await approveWithPin(prisma, clock, user, input.approvalPin);
    const touched = await prisma.$transaction((tx) => this.voidTx(tx, user, billId, input.reason, approvedById));
    this.afterVoid(billId, touched);
    return loadBillView(prisma, billId);
  }

  /** Event setelah void di-commit. */
  afterVoid(billId: string, touched: BookingTouch | null): void {
    this.ctx.bus.emit('bill.changed', billId);
    this.ctx.bus.emit('shift.changed');
    if (touched) {
      this.ctx.bus.emit('booking.changed', touched.bookingId);
      this.ctx.bus.emit('unit.changed', touched.unitId);
    }
  }

  /**
   * Void bill PAID di dalam transaksi pemanggil (dipakai juga batal booking & kembalikan DP).
   * Urutan kunci: Bill → Booking → Shift (share) → Product. Bill DEPOSIT hanya bila DP belum dipakai;
   * bill SALE yang dibayar dengan DEPOSIT mengembalikan DP secara tunai. Keduanya → depositOutcome REFUNDED.
   */
  async voidTx(tx: Db, user: PublicUser, billId: string, reason: string, approvedById: string): Promise<BookingTouch | null> {
    await lockBill(tx, billId);
    const bill = await tx.bill.findUniqueOrThrow({ where: { id: billId }, include: { lines: true, payments: true } });
    if (bill.status !== 'PAID') throw conflict('BILL_NOT_PAID', 'Hanya bill lunas yang bisa di-void');
    let touched: BookingTouch | null = null;
    const bk = await bookingOfBill(tx, bill);
    if (bk) {
      await lockBooking(tx, bk.id);
      const fresh = await tx.booking.findUniqueOrThrow({ where: { id: bk.id } });
      touched = { bookingId: fresh.id, unitId: fresh.unitId };
      if (bill.kind === 'DEPOSIT') {
        if (fresh.depositOutcome === 'USED') throw conflict('DEPOSIT_USED', 'DP sudah dipakai di bill penjualan. Void bill penjualannya.');
        await tx.booking.update({ where: { id: fresh.id }, data: { depositOutcome: 'REFUNDED' } });
      } else if (bill.payments.some((p) => p.method === 'DEPOSIT')) {
        await tx.booking.update({ where: { id: fresh.id }, data: { depositOutcome: 'REFUNDED' } });
      }
    }
    const shift = await requireOpenShift(tx, { lock: true });
    const now = this.ctx.clock.now();
    for (const [productId, qty] of sortedStockQty(bill.lines)) {
      await tx.product.update({ where: { id: productId }, data: { stockQty: { increment: qty } } });
      await tx.stockMovement.create({ data: { productId, qty, reason: 'VOID', billId, userId: user.id, createdAt: now } });
    }
    await tx.bill.update({
      where: { id: billId },
      data: { status: 'VOID', voidReason: reason, voidedById: user.id, voidedAt: now, voidShiftId: shift.id },
    });
    await audit(tx, {
      userId: user.id, action: 'bill.void', entity: 'Bill', entityId: billId, approvedById,
      data: { reason, grandTotal: bill.grandTotal, bookingId: touched?.bookingId ?? null },
    });
    return touched;
  }
}
```

- [ ] **Step 6: Jalankan test & typecheck**

Run: `pnpm typecheck && pnpm --filter @funplay/server test && pnpm --filter @funplay/web test`
Expected: PASS (termasuk test M2 `checkout` — `change` tetap kembalian tunai; void paralel tetap `[200, 409]`).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/transactions.ts apps/server/src apps/server/test/booking-deposit.test.ts apps/web/src
git commit -m "feat(server): pay booking bills with DEPOSIT, refund DP on void, merge booking bills

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 9: Batal booking, kembalikan DP, no-show otomatis, dan notifikasi booking

**Files:**
- Modify: `packages/shared/src/views.ts`
- Modify: `apps/server/src/modules/bookings/bookings.service.ts`, `apps/server/src/modules/bookings/bookings.routes.ts`
- Modify: `apps/server/src/modules/scheduler/scheduler.ts`
- Test: `apps/server/test/booking-lifecycle.test.ts`

**Interfaces:**
- Consumes: `CheckoutService.voidTx` (Task 8), `approveWithPin`, `lockBill`, `lockBooking`, `isNoShowDue` (Task 3), `emitAlert`.
- Produces:
  - shared: `AlertType` + `'BOOKING_UPCOMING' | 'BOOKING_NO_SHOW'`.
  - `BookingService.cancel(user, id, { reason, deposit: 'FORFEIT' | 'REFUND', approvalPin? })`, `BookingService.refundDeposit(user, id, { reason, approvalPin? })`, `BookingService.runDue(now, settings)` (dipanggil `Scheduler.tick`).
  - API: `POST /api/bookings/:id/cancel` `{ reason (wajib), deposit? = 'FORFEIT', approvalPin? }` → `BookingView`; `POST /api/bookings/:id/refund-deposit` `{ reason, approvalPin? }` → `BookingView`.
  - Aturan: batal hanya `BOOKED`; bill DEPOSIT OPEN ikut `CANCELLED` (tanpa PIN); DP PAID → kasir butuh PIN, `REFUND` = void bill DEPOSIT (alasan **"Booking dibatalkan: <alasan>"**) → `REFUNDED`, `FORFEIT` → `FORFEITED`. Kembalikan DP (PIN kasir; alasan void **"Pengembalian DP: <alasan>"**) bila (`NO_SHOW`/`CANCELLED` + `FORFEITED`) atau (`CHECKED_IN` + DP belum dipakai, mis. pelanggan minta DP dikembalikan terpisah). No-show: `BOOKED` dan `now ≥ startAt + bookingNoShowMin` → `NO_SHOW`, DP PAID → `FORFEITED`, bill DEPOSIT OPEN → `CANCELLED`, audit `userId = null`.
  - Alert: info **"Booking <nama> di <meja> jam <HH:MM>"** (sekali, `holdNotifiedAt`), warning **"No-show: <nama> di <meja> jam <HH:MM>"**.
  - Error: 409 `BOOKING_NOT_ACTIVE`, 409 `DEPOSIT_NOT_AVAILABLE`, 403 `APPROVAL_REQUIRED`.

- [ ] **Step 1: Tulis test yang gagal**

`apps/server/test/booking-lifecycle.test.ts`:
```ts
import type { AlertEvent } from '@funplay/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, openShift, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let users: Awaited<ReturnType<typeof seedUsers>>;
let cookie: string;
let alerts: AlertEvent[];

beforeEach(async () => {
  await resetDb();
  users = await seedUsers();
  b = await seedBasics();
  await openShift(users.kasir.id, 100000);
  t = await makeApp(); // 10:00 WIB
  cookie = await loginAs(t.app, 'kasir');
  alerts = [];
  t.ctx.bus.on('alert', (a) => alerts.push(a));
});
afterEach(() => t.app.close());

const req = (method: 'GET' | 'POST', url: string, payload?: unknown) => t.app.inject({ method, url, headers: { cookie }, payload: payload as object });
/** Meja 2, 10:30–11:30 WIB. */
const book = (over: Record<string, unknown> = {}) =>
  req('POST', '/api/bookings', { unitId: b.m2.id, startAt: '2026-10-01T03:30:00.000Z', durationMin: 60, customerName: 'Budi', ...over });
async function bookWithPaidDp(amount = 50000, over: Record<string, unknown> = {}) {
  const r = (await book({ depositAmount: amount, ...over })).json();
  const p = await req('POST', `/api/bills/${r.depositBillId}/checkout`, { idempotencyKey: `dp-${r.booking.id}`, expectedGrandTotal: amount, payments: [{ method: 'CASH', amount }] });
  expect(p.statusCode).toBe(200);
  return { id: r.booking.id as string, depositBillId: r.depositBillId as string };
}
const cancel = (id: string, body: Record<string, unknown>) => req('POST', `/api/bookings/${id}/cancel`, body);
const refund = (id: string, body: Record<string, unknown>) => req('POST', `/api/bookings/${id}/refund-deposit`, body);
const summary = async () => (await req('GET', '/api/shifts/current')).json().summary;

describe('batal booking', () => {
  it('tanpa DP: tanpa PIN, alasan wajib, hanya sekali', async () => {
    const id = (await book()).json().booking.id;
    expect((await cancel(id, { reason: '' })).statusCode).toBe(400);
    expect((await cancel(id, { reason: 'tidak jadi' })).json()).toMatchObject({ status: 'CANCELLED', cancelReason: 'tidak jadi', depositOutcome: null });
    expect((await cancel(id, { reason: 'lagi' })).json().error.code).toBe('BOOKING_NOT_ACTIVE');
  });

  it('ber-DP: kasir butuh PIN; DP hangus tidak mengubah kas', async () => {
    const bk = await bookWithPaidDp();
    expect((await cancel(bk.id, { reason: 'batal', deposit: 'FORFEIT' })).json().error.code).toBe('APPROVAL_REQUIRED');
    const ok = await cancel(bk.id, { reason: 'batal', deposit: 'FORFEIT', approvalPin: '1111' });
    expect(ok.json()).toMatchObject({ status: 'CANCELLED', depositOutcome: 'FORFEITED', depositBillStatus: 'PAID' });
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'booking.cancel' } })).approvedById).toBe(users.supervisor.id);
    expect(await summary()).toMatchObject({ sales: { CASH: 50000 }, voids: { CASH: 0 }, expectedCash: 150000 });
  });

  it('ber-DP dengan REFUND: bill DP di-void, kas berkurang', async () => {
    const bk = await bookWithPaidDp();
    const ok = await cancel(bk.id, { reason: 'hujan', deposit: 'REFUND', approvalPin: '1111' });
    expect(ok.json()).toMatchObject({ status: 'CANCELLED', depositOutcome: 'REFUNDED', depositBillStatus: 'VOID' });
    expect(await prisma.bill.findUniqueOrThrow({ where: { id: bk.depositBillId } })).toMatchObject({ status: 'VOID', voidReason: 'Booking dibatalkan: hujan' });
    expect(await summary()).toMatchObject({ voids: { CASH: 50000 }, expectedCash: 100000 });
  });

  it('bill DP masih OPEN ikut dibatalkan, tanpa PIN', async () => {
    const r = (await book({ depositAmount: 50000 })).json();
    expect((await cancel(r.booking.id, { reason: 'tidak jadi' })).statusCode).toBe(200);
    expect(await prisma.bill.findUniqueOrThrow({ where: { id: r.depositBillId } })).toMatchObject({ status: 'CANCELLED', cancelReason: 'Booking dibatalkan: tidak jadi' });
  });
});

describe('scheduler booking', () => {
  it('notifikasi booking akan datang sekali saat hold dimulai', async () => {
    await book();
    await t.ctx.scheduler.tick();
    expect(alerts).toHaveLength(0);
    t.clock.advanceMinutes(15);
    await t.ctx.scheduler.tick();
    await t.ctx.scheduler.tick();
    expect(alerts).toEqual([expect.objectContaining({ type: 'BOOKING_UPCOMING', level: 'info', unitId: b.m2.id, message: 'Booking Budi di Meja 2 jam 10:30' })]);
  });

  it('no-show otomatis menurut clock: DP hangus, bill DP OPEN dibatalkan, notifikasi', async () => {
    const paid = await bookWithPaidDp();
    const open = (await book({ unitId: b.m1.id, depositAmount: 20000, customerName: 'Rina' })).json();
    t.clock.advanceMinutes(44); // 10:44
    await t.ctx.scheduler.tick();
    expect(await prisma.booking.count({ where: { status: 'BOOKED' } })).toBe(2);
    t.clock.advanceMinutes(1); // 10:45 = jadwal + 15 menit
    await t.ctx.scheduler.tick();
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: paid.id } })).toMatchObject({ status: 'NO_SHOW', depositOutcome: 'FORFEITED' });
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: open.booking.id } })).toMatchObject({ status: 'NO_SHOW', depositOutcome: null });
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: open.depositBillId } })).status).toBe('CANCELLED');
    expect(alerts.filter((a) => a.type === 'BOOKING_NO_SHOW').map((a) => a.message).sort()).toEqual([
      'No-show: Budi di Meja 2 jam 10:30',
      'No-show: Rina di Meja 1 jam 10:30',
    ]);
    expect(await prisma.auditLog.count({ where: { action: 'booking.no_show', userId: null } })).toBe(2);
  });

  it('kembalikan DP setelah no-show: PIN untuk kasir, hanya sekali', async () => {
    const bk = await bookWithPaidDp();
    t.clock.advanceMinutes(45);
    await t.ctx.scheduler.tick();
    expect((await refund(bk.id, { reason: 'sakit' })).json().error.code).toBe('APPROVAL_REQUIRED');
    const ok = await refund(bk.id, { reason: 'sakit', approvalPin: '1111' });
    expect(ok.json()).toMatchObject({ status: 'NO_SHOW', depositOutcome: 'REFUNDED', depositBillStatus: 'VOID' });
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: bk.depositBillId } })).voidReason).toBe('Pengembalian DP: sakit');
    expect((await refund(bk.id, { reason: 'sakit', approvalPin: '1111' })).json().error.code).toBe('DEPOSIT_NOT_AVAILABLE');
  });

  it('check-in dan scheduler bersamaan pada batas no-show → satu menang', async () => {
    const id = (await book()).json().booking.id;
    t.clock.advanceMinutes(45);
    const [, ci] = await Promise.all([t.ctx.scheduler.tick(), req('POST', `/api/bookings/${id}/check-in`, { mode: 'OPEN' })]);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id } });
    if (ci.statusCode === 200) {
      expect(row.status).toBe('CHECKED_IN');
      expect(await prisma.auditLog.count({ where: { action: 'booking.no_show' } })).toBe(0);
    } else {
      expect(ci.json().error.code).toBe('BOOKING_NOT_ACTIVE');
      expect(row.status).toBe('NO_SHOW');
      expect(await prisma.session.count()).toBe(0);
    }
  });

  it('DP dipakai dan dikembalikan bersamaan → hanya satu berhasil', async () => {
    const bk = await bookWithPaidDp(30000);
    t.clock.advanceMinutes(15);
    const session = (await req('POST', `/api/bookings/${bk.id}/check-in`, { mode: 'OPEN' })).json().unit.session;
    t.clock.advanceMinutes(60);
    await req('POST', `/api/sessions/${session.id}/stop`, {});
    const [payRes, refundRes] = await Promise.all([
      req('POST', `/api/bills/${session.billId}/checkout`, {
        idempotencyKey: 'key-race-0001', expectedGrandTotal: 40000,
        payments: [{ method: 'DEPOSIT', amount: 30000, received: 30000 }, { method: 'CASH', amount: 10000 }],
      }),
      refund(bk.id, { reason: 'minta tunai', approvalPin: '1111' }),
    ]);
    expect([payRes.statusCode, refundRes.statusCode].sort()).toEqual([200, 409]);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: bk.id } });
    expect(row.depositOutcome).toBe(payRes.statusCode === 200 ? 'USED' : 'REFUNDED');
    expect((payRes.statusCode === 200 ? refundRes : payRes).json().error.code).toBe('DEPOSIT_NOT_AVAILABLE');
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- booking-lifecycle`
Expected: FAIL — route cancel/refund 404, scheduler tidak memproses booking.

- [ ] **Step 3: Tipe alert**

`packages/shared/src/views.ts` — ganti `AlertType`:
```ts
export type AlertType =
  | 'SESSION_WARNING' | 'SESSION_EXPIRED' | 'DEVICE_OFFLINE' | 'DEVICE_ONLINE' | 'DEVICE_CMD_FAILED' | 'UNEXPECTED_ON'
  | 'BOOKING_UPCOMING' | 'BOOKING_NO_SHOW';
```

- [ ] **Step 4: Batal, kembalikan DP, no-show**

Di `apps/server/src/modules/bookings/bookings.service.ts`:
1. Tambah `isNoShowDue` dan `type PublicSettings` ke import `@funplay/shared`, lalu tambah import:
```ts
import { emitAlert } from '../../lib/alerts';
import { AppError } from '../../lib/errors';
import { approveWithPin } from '../auth/auth.service';
```
(gabungkan `AppError` ke import `badRequest, conflict, notFound` yang sudah ada dari `../../lib/errors`.)

2. Tambahkan method di kelas `BookingService`:
```ts
  /**
   * Batalkan booking BOOKED. Urutan kunci: bill DEPOSIT → Booking → (void: Shift). Bill DP yang masih OPEN
   * ikut dibatalkan; DP yang sudah dibayar hangus (FORFEIT) atau dikembalikan lewat void bill DEPOSIT (REFUND).
   */
  async cancel(user: PublicUser, id: string, input: { reason: string; deposit: 'FORFEIT' | 'REFUND'; approvalPin?: string }): Promise<BookingView> {
    const { prisma, clock } = this.ctx;
    const pre = await prisma.booking.findUnique({ where: { id } });
    if (!pre) throw notFound('Booking');
    const depPre = pre.depositBillId ? await prisma.bill.findUnique({ where: { id: pre.depositBillId }, select: { status: true } }) : null;
    // PIN di luar transaksi (approveWithPin menulis ke tabel User); status DP diperiksa ulang di bawah kunci.
    const approvedById = depPre?.status === 'PAID' ? await approveWithPin(prisma, clock, user, input.approvalPin) : null;
    const r = await prisma.$transaction(async (tx) => {
      if (pre.depositBillId) await lockBill(tx, pre.depositBillId);
      await lockBooking(tx, id);
      const bk = await tx.booking.findUniqueOrThrow({ where: { id } });
      if (bk.status !== 'BOOKED') throw conflict('BOOKING_NOT_ACTIVE', 'Booking sudah tidak aktif');
      const dep = bk.depositBillId ? await tx.bill.findUniqueOrThrow({ where: { id: bk.depositBillId } }) : null;
      let outcome = bk.depositOutcome;
      let voided = false;
      if (dep?.status === 'OPEN') {
        await tx.bill.update({ where: { id: dep.id }, data: { status: 'CANCELLED', cancelReason: `Booking dibatalkan: ${input.reason}` } });
      }
      const dpPaid = dep?.status === 'PAID' && bk.depositOutcome === null;
      if (dep && dpPaid) {
        if (!approvedById) throw new AppError(403, 'APPROVAL_REQUIRED', 'Aksi ini butuh PIN supervisor');
        if (input.deposit === 'REFUND') {
          await this.ctx.checkout.voidTx(tx, user, dep.id, `Booking dibatalkan: ${input.reason}`, approvedById);
          outcome = 'REFUNDED';
          voided = true;
        } else {
          outcome = 'FORFEITED';
        }
      }
      await tx.booking.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: input.reason, depositOutcome: outcome } });
      await audit(tx, {
        userId: user.id, action: 'booking.cancel', entity: 'Booking', entityId: id, approvedById,
        data: { reason: input.reason, deposit: dpPaid ? input.deposit : null },
      });
      return { unitId: bk.unitId, depositBillId: bk.depositBillId, voided };
    });
    if (r.depositBillId) this.ctx.bus.emit('bill.changed', r.depositBillId);
    if (r.voided) this.ctx.bus.emit('shift.changed');
    this.changed(id, r.unitId);
    return loadBookingView(prisma, id);
  }

  /**
   * Kembalikan DP lewat void bill DEPOSIT (PIN untuk kasir). Boleh bila DP hangus (NO_SHOW/CANCELLED) atau
   * booking sudah check-in tetapi DP belum dipakai. Urutan kunci: bill DEPOSIT → Booking → Shift.
   */
  async refundDeposit(user: PublicUser, id: string, input: { reason: string; approvalPin?: string }): Promise<BookingView> {
    const { prisma, clock } = this.ctx;
    const pre = await prisma.booking.findUnique({ where: { id } });
    if (!pre) throw notFound('Booking');
    if (!pre.depositBillId) throw conflict('DEPOSIT_NOT_AVAILABLE', 'Booking ini tidak memakai DP');
    const depositBillId = pre.depositBillId;
    const approvedById = await approveWithPin(prisma, clock, user, input.approvalPin);
    const r = await prisma.$transaction(async (tx) => {
      await lockBill(tx, depositBillId);
      await lockBooking(tx, id);
      const bk = await tx.booking.findUniqueOrThrow({ where: { id } });
      const dep = await tx.bill.findUniqueOrThrow({ where: { id: depositBillId } });
      const forfeited = (bk.status === 'NO_SHOW' || bk.status === 'CANCELLED') && bk.depositOutcome === 'FORFEITED';
      const unusedAfterCheckIn = bk.status === 'CHECKED_IN' && bk.depositOutcome === null;
      if (dep.status !== 'PAID' || !(forfeited || unusedAfterCheckIn)) throw conflict('DEPOSIT_NOT_AVAILABLE', 'DP tidak bisa dikembalikan');
      await this.ctx.checkout.voidTx(tx, user, dep.id, `Pengembalian DP: ${input.reason}`, approvedById);
      await audit(tx, {
        userId: user.id, action: 'booking.refund_deposit', entity: 'Booking', entityId: id, approvedById,
        data: { reason: input.reason, amount: bk.depositAmount },
      });
      return { unitId: bk.unitId };
    });
    this.ctx.bus.emit('bill.changed', depositBillId);
    this.ctx.bus.emit('shift.changed');
    this.changed(id, r.unitId);
    return loadBookingView(prisma, id);
  }

  /** Dipanggil scheduler setiap tick: notifikasi saat hold dimulai (sekali), lalu no-show otomatis. */
  async runDue(now: Date, settings: PublicSettings): Promise<void> {
    const { prisma, clock, bus } = this.ctx;
    const upcoming = await prisma.booking.findMany({
      where: {
        status: 'BOOKED',
        holdNotifiedAt: null,
        startAt: { lte: addMinutes(now, settings.bookingHoldMin), gt: addMinutes(now, -settings.bookingNoShowMin) },
      },
      include: { unit: { select: { name: true } } },
    });
    for (const x of upcoming) {
      const w = await prisma.booking.updateMany({ where: { id: x.id, status: 'BOOKED', holdNotifiedAt: null, startAt: x.startAt }, data: { holdNotifiedAt: now } });
      if (w.count === 0) continue;
      emitAlert(bus, clock, {
        level: 'info', type: 'BOOKING_UPCOMING', unitId: x.unitId,
        message: `Booking ${x.customerName} di ${x.unit.name} jam ${localHHMM(x.startAt, settings.utcOffsetMin)}`,
      });
      this.changed(x.id, x.unitId);
    }
    const due = await prisma.booking.findMany({
      where: { status: 'BOOKED', startAt: { lte: addMinutes(now, -settings.bookingNoShowMin) } },
      select: { id: true },
    });
    for (const d of due) {
      try {
        await this.markNoShow(d.id, now, settings);
      } catch (err) {
        console.error(`[scheduler] no-show booking ${d.id} gagal`, err);
      }
    }
  }

  /** Urutan kunci: bill DEPOSIT → Booking; status diperiksa ulang (check-in/batal/ubah jadwal bisa menang). */
  private async markNoShow(id: string, now: Date, settings: PublicSettings): Promise<void> {
    const { prisma, clock, bus } = this.ctx;
    const pre = await prisma.booking.findUnique({ where: { id } });
    if (!pre) return;
    const r = await prisma.$transaction(async (tx) => {
      if (pre.depositBillId) await lockBill(tx, pre.depositBillId);
      await lockBooking(tx, id);
      const bk = await tx.booking.findUniqueOrThrow({ where: { id }, include: { unit: { select: { name: true } } } });
      if (!isNoShowDue(bk, now, settings.bookingNoShowMin)) return null;
      const dep = bk.depositBillId ? await tx.bill.findUniqueOrThrow({ where: { id: bk.depositBillId } }) : null;
      if (dep?.status === 'OPEN') {
        await tx.bill.update({ where: { id: dep.id }, data: { status: 'CANCELLED', cancelReason: 'Booking tidak datang (no-show)' } });
      }
      const forfeit = dep?.status === 'PAID' && bk.depositOutcome === null;
      await tx.booking.update({ where: { id }, data: { status: 'NO_SHOW', ...(forfeit ? { depositOutcome: 'FORFEITED' as const } : {}) } });
      await audit(tx, { userId: null, action: 'booking.no_show', entity: 'Booking', entityId: id, data: { depositForfeited: forfeit } });
      return {
        unitId: bk.unitId,
        message: `No-show: ${bk.customerName} di ${bk.unit.name} jam ${localHHMM(bk.startAt, settings.utcOffsetMin)}`,
        cancelledDepositBillId: dep?.status === 'OPEN' ? dep.id : null,
      };
    });
    if (!r) return;
    emitAlert(bus, clock, { level: 'warning', type: 'BOOKING_NO_SHOW', unitId: r.unitId, message: r.message });
    if (r.cancelledDepositBillId) bus.emit('bill.changed', r.cancelledDepositBillId);
    this.changed(id, r.unitId);
  }
```

`apps/server/src/modules/bookings/bookings.routes.ts` — tambah skema & route:
```ts
const reason = z.string().trim().min(1, 'Alasan wajib diisi').max(200);
const cancelSchema = z.object({ reason, deposit: z.enum(['FORFEIT', 'REFUND']).default('FORFEIT'), approvalPin: z.string().optional() });
const refundSchema = z.object({ reason, approvalPin: z.string().optional() });
```
```ts
    app.post('/bookings/:id/cancel', auth, async (req) => ctx.bookings.cancel(req.user!, idParam.parse(req.params).id, cancelSchema.parse(req.body)));
    app.post('/bookings/:id/refund-deposit', auth, async (req) =>
      ctx.bookings.refundDeposit(req.user!, idParam.parse(req.params).id, refundSchema.parse(req.body)),
    );
```

- [ ] **Step 5: Scheduler**

Di `apps/server/src/modules/scheduler/scheduler.ts`, di akhir method `run()` (setelah loop sesi):
```ts
    try {
      await this.ctx.bookings.runDue(now, settings);
    } catch (err) {
      console.error('[scheduler] booking gagal diproses', err);
    }
```

- [ ] **Step 6: Jalankan test & typecheck**

Run: `pnpm typecheck && pnpm --filter @funplay/server test`
Expected: PASS (test `scheduler` M1 tetap hijau: tanpa booking `runDue` tidak berbuat apa pun).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/views.ts apps/server/src apps/server/test/booking-lifecycle.test.ts
git commit -m "feat(server): cancel booking, refund deposit, automatic no-show and booking alerts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 10: Rekap shift non-kas & kas seharusnya M3, struk member/DP

**Files:**
- Modify: `packages/shared/src/transactions.ts`
- Modify: `apps/server/src/modules/shifts/shifts.service.ts`, `apps/server/src/modules/printing/receipt-model.ts`
- Modify: `apps/web/src/features/shift/ShiftPage.tsx`, `apps/web/src/features/shift/ShiftPage.test.tsx`
- Test: `apps/server/test/booking-cash.test.ts`, `apps/web/src/features/shift/ShiftPage.test.tsx`

**Interfaces:**
- Consumes: renderer struk M3 (Task 3); checkout/void DEPOSIT (Task 8); booking & check-in (Task 6–7).
- Produces:
  - shared: `ShiftSummary.depositChange: number`.
  - `shiftSummary`: `expectedCash = openingCash + sales.CASH − voids.CASH − depositChange − voids.DEPOSIT` (spec §4.4).
  - Struk: bill DEPOSIT berjudul **"TANDA TERIMA DP"**; struk bill ber-member memuat **"Member: <nama> (<level>)"** dan **"Diskon member"** per baris; pembayaran DEPOSIT berlabel **"DP booking"** (nilai = DP utuh) dan **"Kembali DP"**; `Kembalian` hanya dari tunai. Rekap shift: **"DP booking (non-kas)"** dan **"Kembali DP"**.
  - Web Shift: baris **"Penjualan DP booking (non-kas)"** dan **"Kembalian DP (tunai keluar)"**.

- [ ] **Step 1: Tulis test yang gagal**

`apps/server/test/booking-cash.test.ts`:
```ts
import { twoCols } from '@funplay/shared';
import type { Member } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginAs, makeApp, openShift, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let cookie: string;
let sinta: Member;

beforeEach(async () => {
  await resetDb();
  const users = await seedUsers();
  b = await seedBasics();
  await openShift(users.kasir.id, 100000);
  const gold = await prisma.memberLevel.create({ data: { name: 'Gold', timeDiscountPct: 10, fnbDiscountPct: 0 } });
  sinta = await prisma.member.create({ data: { code: 'M0001', name: 'Sinta', levelId: gold.id } });
  t = await makeApp();
  cookie = await loginAs(t.app, 'kasir');
});
afterEach(() => t.app.close());

const req = (method: 'GET' | 'POST', url: string, payload?: unknown) => t.app.inject({ method, url, headers: { cookie }, payload: payload as object });
const pay = (billId: string, total: number, payments: unknown[], key = 'key-0000001') =>
  req('POST', `/api/bills/${billId}/checkout`, { idempotencyKey: key, expectedGrandTotal: total, payments });
const summary = async () => (await req('GET', '/api/shifts/current')).json().summary;
const receiptOf = (billId: string) => prisma.printJob.findFirst({ where: { billId, kind: 'RECEIPT' } });

/** Booking Meja 2 10:30 dengan DP tunai, check-in 10:15, main 60 menit (Rp40.000) lalu stop. */
async function checkedIn(deposit: number, memberId?: string) {
  const created = (await req('POST', '/api/bookings', {
    unitId: b.m2.id, startAt: '2026-10-01T03:30:00.000Z', durationMin: 60, customerName: 'Budi', depositAmount: deposit, ...(memberId ? { memberId } : {}),
  })).json();
  expect((await pay(created.depositBillId, deposit, [{ method: 'CASH', amount: deposit }], `dp-${created.booking.id}`)).statusCode).toBe(200);
  t.clock.advanceMinutes(15);
  const session = (await req('POST', `/api/bookings/${created.booking.id}/check-in`, { mode: 'OPEN' })).json().unit.session;
  t.clock.advanceMinutes(60);
  await req('POST', `/api/sessions/${session.id}/stop`, {});
  return { saleBillId: session.billId as string, depositBillId: created.depositBillId as string };
}

describe('kas seharusnya dengan DP', () => {
  it('DP tunai lalu dipakai dengan kembalian; void mengembalikan sisa DP', async () => {
    const x = await checkedIn(50000);
    expect((await pay(x.saleBillId, 40000, [{ method: 'DEPOSIT', amount: 40000, received: 50000 }])).statusCode).toBe(200);
    // 100.000 + 50.000 (DP tunai) − 10.000 (kembalian DP) = 140.000
    expect(await summary()).toMatchObject({ sales: { CASH: 50000, DEPOSIT: 40000 }, depositChange: 10000, expectedCash: 140000 });
    await req('POST', `/api/bills/${x.saleBillId}/void`, { reason: 'salah meja', approvalPin: '1111' });
    // − 40.000 DP yang dikembalikan tunai saat void → 100.000
    expect(await summary()).toMatchObject({ voids: { DEPOSIT: 40000, CASH: 0 }, depositChange: 10000, expectedCash: 100000 });
  });

  it('DP lebih kecil dari total: sisa dibayar tunai', async () => {
    const x = await checkedIn(30000);
    await pay(x.saleBillId, 40000, [{ method: 'DEPOSIT', amount: 30000, received: 30000 }, { method: 'CASH', amount: 10000 }]);
    expect(await summary()).toMatchObject({ sales: { CASH: 40000, DEPOSIT: 30000 }, depositChange: 0, expectedCash: 140000 });
  });
});

describe('struk & rekap dengan member dan DP', () => {
  it('tanda terima DP, struk member + DP, rekap shift non-kas', async () => {
    const x = await checkedIn(50000, sinta.id);
    await vi.waitFor(async () => expect(await receiptOf(x.depositBillId)).not.toBeNull());
    expect((await receiptOf(x.depositBillId))!.previewText).toContain('TANDA TERIMA DP');

    // waktu 40.000 − 10% member = 36.000; DP 50.000 → kembali DP 14.000
    expect((await pay(x.saleBillId, 36000, [{ method: 'DEPOSIT', amount: 36000, received: 50000 }])).statusCode).toBe(200);
    await vi.waitFor(async () => expect(await receiptOf(x.saleBillId)).not.toBeNull());
    const text = (await receiptOf(x.saleBillId))!.previewText;
    expect(text).toContain('Member: Sinta (Gold)');
    expect(text).toContain(twoCols('  Diskon member', '-4.000'));
    expect(text).toContain(twoCols('TOTAL', '36.000'));
    expect(text).toContain(twoCols('DP booking', '50.000'));
    expect(text).toContain(twoCols('Kembali DP', '14.000'));
    expect(text).not.toContain('Kembalian');

    await req('POST', '/api/shifts/current/close', { countedCash: 136000 });
    await vi.waitFor(async () => expect(await prisma.printJob.findFirst({ where: { kind: 'SHIFT_REPORT' } })).not.toBeNull());
    const report = (await prisma.printJob.findFirstOrThrow({ where: { kind: 'SHIFT_REPORT' } })).previewText;
    expect(report).toContain(twoCols('  DP booking (non-kas)', '36.000'));
    expect(report).toContain(twoCols('  Kembali DP', '-14.000'));
    expect(report).toContain(twoCols('Kas seharusnya', '136.000'));
  });
});
```

Di `apps/web/src/features/shift/ShiftPage.test.tsx`: jalankan
```bash
sed -i 's/voidCount: 0,/voidCount: 0, depositChange: 0,/' apps/web/src/features/shift/ShiftPage.test.tsx
```
lalu tambahkan test di akhir file:
```tsx
it('DP booking ditandai non-kas dan kembalian DP ditampilkan', async () => {
  const withDp: ShiftSummary = { ...summary, sales: { ...summary.sales, DEPOSIT: 40000 }, depositChange: 10000, expectedCash: 146000 };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/shifts/current') return json({ summary: withDp });
    if (url === '/api/shifts') return json([]);
    return new Response('{}', { status: 404 });
  }));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ShiftPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Penjualan DP booking (non-kas)')).toBeInTheDocument();
  expect(screen.getByText('Kembalian DP (tunai keluar)')).toBeInTheDocument();
  expect(screen.getByText('-Rp 10.000')).toBeInTheDocument();
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- booking-cash && pnpm --filter @funplay/web test -- ShiftPage`
Expected: FAIL — `depositChange` tidak ada, kas seharusnya tidak dikurangi kembalian DP, struk tanpa judul/member, label non-kas tidak ada.

- [ ] **Step 3: Rekap shift**

`packages/shared/src/transactions.ts` — di `interface ShiftSummary` setelah `voidCount: number;`:
```ts
  /** Σ kembalian DP booking (tunai keluar) dari pembayaran DEPOSIT di shift ini. */
  depositChange: number;
```

`apps/server/src/modules/shifts/shifts.service.ts` — ganti `shiftSummary`:
```ts
export async function shiftSummary(db: Db, s: Shift): Promise<ShiftSummary> {
  const sales = zero();
  const voids = zero();
  for (const g of await db.payment.groupBy({ by: ['method'], where: { shiftId: s.id }, _sum: { amount: true } })) {
    sales[g.method] = g._sum.amount ?? 0;
  }
  for (const g of await db.payment.groupBy({ by: ['method'], where: { bill: { voidShiftId: s.id } }, _sum: { amount: true } })) {
    voids[g.method] = g._sum.amount ?? 0;
  }
  const depositChange = (await db.payment.aggregate({ where: { shiftId: s.id, method: 'DEPOSIT' }, _sum: { change: true } }))._sum.change ?? 0;
  const [billCount, voidCount] = await Promise.all([
    db.bill.count({ where: { shiftId: s.id, status: { in: ['PAID', 'VOID'] } } }),
    db.bill.count({ where: { voidShiftId: s.id } }),
  ]);
  // Kas seharusnya (spec M3 §4.4): DEPOSIT non-kas; kembalian DP dan DP yang dikembalikan saat void keluar tunai.
  const expectedCash = s.openingCash + sales.CASH - voids.CASH - depositChange - voids.DEPOSIT;
  return { shift: await toShiftView(db, s), sales, voids, billCount, voidCount, depositChange, expectedCash };
}
```

- [ ] **Step 4: Model struk**

Di `apps/server/src/modules/printing/receipt-model.ts`:
1. Di `buildReceiptModel`, tambahkan properti setelah `label: b.label,`:
```ts
    title: b.kind === 'DEPOSIT' ? 'TANDA TERIMA DP' : null,
    member: b.memberName ? { name: b.memberName, levelName: b.memberLevelName ?? '' } : null,
```
ubah objek baris menjadi:
```ts
    lines: b.lines.map((l, i) => ({
      name: l.nameSnapshot,
      qty: l.qty,
      unitPrice: l.unitPrice,
      amount: l.unitPrice * l.qty,
      discount: totals.lines[i]!.itemDiscount,
      memberDiscount: totals.lines[i]!.memberDiscount,
      details: ((l.breakdown as ChargeLine[] | null) ?? []).map((c) => `${c.label} ${minutesLabel(c.minutes)}`),
    })),
```
dan ganti baris `change: …` menjadi:
```ts
    change: b.payments.filter((p) => p.method === 'CASH').reduce((a, p) => a + (p.change ?? 0), 0),
    depositChange: b.payments.filter((p) => p.method === 'DEPOSIT').reduce((a, p) => a + (p.change ?? 0), 0),
```
2. Di `buildShiftReportModel`, ganti `rows` dan tambahkan `depositChange`:
```ts
  const label = (m: (typeof PAYMENT_METHODS)[number]) => (m === 'DEPOSIT' ? 'DP booking (non-kas)' : PAYMENT_METHOD_LABEL[m]);
  const rows = (rec: Record<string, number>) => PAYMENT_METHODS.filter((m) => rec[m]).map((m) => ({ label: label(m), amount: rec[m]! }));
```
```ts
    depositChange: sum.depositChange,
```
(baris `depositChange` ditaruh setelah `note: s.note,`.)

- [ ] **Step 5: Halaman Shift**

Di `apps/web/src/features/shift/ShiftPage.tsx`, ganti loop penjualan di `CurrentShift`:
```tsx
        {PAYMENT_METHODS.map((m) => (
          <Row key={m} label={`Penjualan ${m === 'DEPOSIT' ? 'DP booking (non-kas)' : PAYMENT_METHOD_LABEL[m]}`} value={formatRupiah(s.sales[m])} />
        ))}
        {s.depositChange > 0 && <Row label="Kembalian DP (tunai keluar)" value={`-${formatRupiah(s.depositChange)}`} />}
```

- [ ] **Step 6: Jalankan test & typecheck**

Run: `pnpm typecheck && pnpm --filter @funplay/server test && pnpm --filter @funplay/web test`
Expected: PASS (test M2 `shifts`/`checkout`/`printing` tetap: tanpa DEPOSIT rumusnya sama dengan M2).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/transactions.ts apps/server/src apps/server/test/booking-cash.test.ts apps/web/src/features/shift
git commit -m "feat: non-cash DEPOSIT in shift summary, expected cash with DP change, member/DP receipts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 11: Web — event booking, detail error, pemilih member, halaman Member, tab Pengaturan Booking

**Files:**
- Modify: `apps/web/src/lib/api.ts`, `apps/web/src/lib/socket.ts`, `apps/web/src/lib/events.ts`
- Create: `apps/web/src/features/members/MemberPicker.tsx`, `apps/web/src/features/members/MemberDialog.tsx`, `apps/web/src/features/members/MembersPage.tsx`, `apps/web/src/features/members/levels.ts`
- Create: `apps/web/src/features/settings/BookingSettings.tsx`
- Modify: `apps/web/src/features/settings/SettingsPage.tsx`, `apps/web/src/features/layout/AppShell.tsx`, `apps/web/src/App.tsx`
- Test: `apps/web/src/lib/events.test.ts`, `apps/web/src/features/members/MemberPicker.test.tsx`, `apps/web/src/features/members/MembersPage.test.tsx`, `apps/web/src/features/settings/TransactionSettings.test.tsx`

**Interfaces:**
- Consumes: API member/level (Task 4), `PUT /api/settings` booking (Task 1), socket `'booking'` (Task 5), `MemberDto`, `MemberLevelDto`, `memberLabel` (Task 3), `CrudResource`, `useSettingsDraft`, `useMe`.
- Produces:
  - `ApiError.details?: Record<string, unknown>`; `RealtimeEvent` + `{ type: 'booking'; id }` → invalidate `['bookings']` (juga saat `resync`).
  - `MemberPickerDialog({ onPick(member: MemberDto), onClose })` — judul **"Pilih member"**, input **"Cari member"**, tombol hasil `"<kode> · <nama> · <HP> <level>"` (hanya member aktif).
  - `MembersPage` di route `/members`; sidebar **"Member"** (semua role, setelah Transaksi). Label UI (E2E): tab **"Member"** & **"Level"** (Level hanya Supervisor/Owner), input **"Cari member"**, tombol **"+ Member"**, dialog **"Tambah member"**/**"Ubah member"** dengan field **"Nama"**, **"No. HP"**, **"Level"**, tombol **"Simpan"**; panel detail tombol **"Ubah"**, **"Nonaktifkan"**/**"Aktifkan"**; tab Level = `CrudResource` judul **"Level"** (dialog **"Tambah Level"**, field **"Nama"**, **"Diskon billing (%)"**, **"Diskon FnB (%)"**, **"Urutan"**, **"Aktif"**).
  - Pengaturan tab **"Booking"**: field **"Hold sebelum jadwal (menit)"**, **"No-show setelah jadwal (menit)"**, tombol **"Simpan"**.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `apps/web/src/lib/events.test.ts` (di dalam `describe('handleRealtime', ...)`):
```ts
  it('booking → invalidate daftar booking; resync ikut memuat ulang booking', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    handleRealtime(qc, { type: 'booking', id: 'bk1' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['bookings'] });
    spy.mockClear();
    handleRealtime(qc, { type: 'resync' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['bookings'] });
  });
```

`apps/web/src/features/members/MemberPicker.test.tsx`:
```tsx
import type { MemberDto } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { MemberPickerDialog } from './MemberPicker';

const sinta: MemberDto = { id: 'm1', code: 'M0001', name: 'Sinta', phone: '0811', levelId: 'l1', levelName: 'Gold', active: true, createdAt: '2026-10-01T03:00:00.000Z' };
afterEach(() => vi.unstubAllGlobals());

it('mencari member aktif lalu memilih', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify([sinta]), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemberPickerDialog onPick={onPick} onClose={onClose} />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('dialog', { name: 'Pilih member' })).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Cari member'), 'sin');
  await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === '/api/members?active=true&q=sin')).toBe(true));
  await userEvent.click(await screen.findByRole('button', { name: /M0001 · Sinta/ }));
  expect(onPick).toHaveBeenCalledWith(sinta);
  expect(onClose).toHaveBeenCalled();
});
```

`apps/web/src/features/members/MembersPage.test.tsx`:
```tsx
import type { MemberDto, Role } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { MembersPage } from './MembersPage';

const sinta: MemberDto = { id: 'm1', code: 'M0001', name: 'Sinta', phone: '0811', levelId: 'l1', levelName: 'Gold', active: true, createdAt: '2026-10-01T03:00:00.000Z' };
afterEach(() => vi.unstubAllGlobals());

function setup(role: Role) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/auth/me') return json({ user: { id: 'u', name: 'U', username: 'u', role } });
    if (url.startsWith('/api/members') && init?.method === 'GET') return json([sinta]);
    if (url === '/api/members' && init?.method === 'POST') return json({ ...sinta, id: 'm2', code: 'M0002', name: 'Budi' });
    if (url === '/api/member-levels') return json([{ id: 'l1', name: 'Gold', timeDiscountPct: 10, fnbDiscountPct: 0, sortOrder: 0, active: true }]);
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MembersPage />
    </QueryClientProvider>,
  );
  return fetchMock;
}

it('kasir mencari dan melihat member tanpa tombol kelola', async () => {
  const f = setup('KASIR');
  expect(await screen.findByRole('row', { name: /M0001.*Sinta.*0811.*Gold/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '+ Member' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Level' })).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Cari member'), 'sin');
  await waitFor(() => expect(f.mock.calls.some(([u]) => u === '/api/members?q=sin')).toBe(true));
  await userEvent.click(screen.getByRole('row', { name: /Sinta/ }));
  expect(screen.getByRole('heading', { name: 'Sinta' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Nonaktifkan' })).not.toBeInTheDocument();
});

it('supervisor menambah member', async () => {
  const f = setup('SUPERVISOR');
  await userEvent.click(await screen.findByRole('button', { name: '+ Member' }));
  const dlg = await screen.findByRole('dialog', { name: 'Tambah member' });
  await userEvent.type(within(dlg).getByLabelText('Nama'), 'Budi');
  await userEvent.type(within(dlg).getByLabelText('No. HP'), '0822');
  await within(dlg).findByRole('option', { name: 'Gold' }); // level dimuat async
  await userEvent.selectOptions(within(dlg).getByLabelText('Level'), 'l1');
  await userEvent.click(within(dlg).getByRole('button', { name: 'Simpan' }));
  await waitFor(() => {
    const call = f.mock.calls.find(([u, i]) => u === '/api/members' && i?.method === 'POST');
    expect(JSON.parse(String(call![1]!.body))).toEqual({ name: 'Budi', phone: '0822', levelId: 'l1' });
  });
});
```

Tambahkan di `apps/web/src/features/settings/TransactionSettings.test.tsx`: import `import { BookingSettings } from './BookingSettings';` dan test:
```tsx
it('menyimpan pengaturan booking', async () => {
  const f = mockFetch();
  vi.stubGlobal('fetch', f);
  wrap(<BookingSettings />);
  const hold = await screen.findByLabelText('Hold sebelum jadwal (menit)');
  await userEvent.clear(hold);
  await userEvent.type(hold, '30');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => {
    const call = f.mock.calls.find(([u, i]) => u === '/api/settings' && i?.method === 'PUT');
    expect(JSON.parse(String(call![1]!.body))).toEqual({ bookingHoldMin: 30, bookingNoShowMin: 15 });
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/web test -- events MemberPicker MembersPage TransactionSettings`
Expected: FAIL — event `booking` tidak dikenal; modul `MemberPicker`, `MembersPage`, `BookingSettings` tidak ada.

- [ ] **Step 3: API, socket, event**

`apps/web/src/lib/api.ts` — ganti seluruh isi:
```ts
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** Data tambahan dari server, mis. `details.booking` pada BOOKING_HOLD. */
    public readonly details?: Record<string, unknown>,
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
  const data = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string; details?: Record<string, unknown> } };
  if (!res.ok) throw new ApiError(res.status, data.error?.code ?? 'UNKNOWN', data.error?.message ?? 'Terjadi kesalahan', data.error?.details);
  return data as T;
}
```

`apps/web/src/lib/socket.ts` — tambahkan varian `| { type: 'booking'; id: string }` ke `RealtimeEvent`, dan setelah baris `socket.on('bill', ...)`:
```ts
  socket.on('booking', (p: { id: string }) => onEvent({ type: 'booking', id: p.id }));
```

`apps/web/src/lib/events.ts` — tambahkan cabang sebelum `case 'resync':` dan perbarui daftar resync:
```ts
    case 'booking':
      inv('bookings');
      break;
    case 'resync':
      for (const k of ['bills', 'bill', 'shift', 'printJobs', 'bookings']) inv(k);
      break;
```

- [ ] **Step 4: Pemilih member**

`apps/web/src/features/members/MemberPicker.tsx`:
```tsx
import type { MemberDto } from '@funplay/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { api } from '../../lib/api';

/** Cari member aktif (kode/nama/HP) lalu pilih. Dipakai di Mulai sesi, Checkout, dan Booking. */
export function MemberPickerDialog({ onPick, onClose }: { onPick: (m: MemberDto) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const term = q.trim();
  const list = useQuery({
    queryKey: ['members', { q: term, active: true }],
    queryFn: () => api<MemberDto[]>('GET', `/members?${new URLSearchParams({ active: 'true', ...(term ? { q: term } : {}) })}`),
  });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Pilih member">
      <Input aria-label="Cari member" placeholder="Kode, nama, atau no. HP" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto">
        {(list.data ?? []).map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              onPick(m);
              onClose();
            }}
            className="flex items-center justify-between rounded-xl border-2 border-line px-3 py-2 text-left text-sm font-semibold hover:border-primary"
          >
            <span>{`${m.code} · ${m.name}${m.phone ? ` · ${m.phone}` : ''}`}</span>
            <span className="text-xs text-muted">{m.levelName}</span>
          </button>
        ))}
        {list.data?.length === 0 && <p className="text-sm text-muted">Member tidak ditemukan.</p>}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 5: Halaman Member**

`apps/web/src/features/members/levels.ts`:
```ts
import type { ResourceConfig } from '../settings/CrudResource';

export const LEVEL_RESOURCE: ResourceConfig = {
  title: 'Level',
  path: '/member-levels',
  canDelete: true,
  fields: [
    { name: 'name', label: 'Nama', type: 'text', required: true },
    { name: 'timeDiscountPct', label: 'Diskon billing (%)', type: 'number', defaultValue: '0' },
    { name: 'fnbDiscountPct', label: 'Diskon FnB (%)', type: 'number', defaultValue: '0' },
    { name: 'sortOrder', label: 'Urutan', type: 'number', defaultValue: '0' },
    { name: 'active', label: 'Aktif', type: 'checkbox' },
  ],
};
```

`apps/web/src/features/members/MemberDialog.tsx`:
```tsx
import type { MemberDto, MemberLevelDto } from '@funplay/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { api } from '../../lib/api';
import { showError, toast } from '../../stores/toast';

export function MemberDialog({ member, onClose }: { member: MemberDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const levels = useQuery({ queryKey: ['/member-levels'], queryFn: () => api<MemberLevelDto[]>('GET', '/member-levels') });
  const [name, setName] = useState(member?.name ?? '');
  const [phone, setPhone] = useState(member?.phone ?? '');
  const [levelId, setLevelId] = useState(member?.levelId ?? '');
  const save = useMutation({
    mutationFn: (body: { name: string; phone: string; levelId: string }) =>
      member ? api<MemberDto>('PATCH', `/members/${member.id}`, body) : api<MemberDto>('POST', '/members', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['members'] });
      toast.success('Member disimpan');
      onClose();
    },
    onError: showError,
  });
  const options = (levels.data ?? []).filter((l) => l.active || l.id === levelId);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ name: name.trim(), phone: phone.trim(), levelId });
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={member ? 'Ubah member' : 'Tambah member'}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="text-sm font-semibold">
          Nama
          <Input className="mt-1" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="text-sm font-semibold">
          No. HP
          <Input className="mt-1" inputMode="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <div className="flex flex-col gap-1 text-sm font-semibold">
          <label htmlFor="member-level">Level</label>
          <select id="member-level" required className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm" value={levelId} onChange={(e) => setLevelId(e.target.value)}>
            <option value="">— pilih —</option>
            {options.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button type="submit" disabled={save.isPending}>Simpan</Button>
        </div>
      </form>
    </Modal>
  );
}
```

`apps/web/src/features/members/MembersPage.tsx`:
```tsx
import type { MemberDto } from '@funplay/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { showError, toast } from '../../stores/toast';
import { useMe } from '../auth/auth';
import { CrudResource } from '../settings/CrudResource';
import { LEVEL_RESOURCE } from './levels';
import { MemberDialog } from './MemberDialog';

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} className={cn('rounded-full px-4 py-1.5 text-sm font-semibold', active ? 'bg-primary text-white' : 'bg-primary-soft text-primary-ink')}>
      {children}
    </button>
  );
}

export function MembersPage() {
  const me = useMe().data;
  const [tab, setTab] = useState<'members' | 'levels'>('members');
  if (!me) return null;
  const canEdit = me.role !== 'KASIR';
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <div className="flex gap-2">
        <Tab active={tab === 'members'} onClick={() => setTab('members')}>Member</Tab>
        {canEdit && <Tab active={tab === 'levels'} onClick={() => setTab('levels')}>Level</Tab>}
      </div>
      {tab === 'levels' && canEdit ? <CrudResource config={LEVEL_RESOURCE} /> : <MemberList canEdit={canEdit} />}
    </div>
  );
}

function MemberList({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const term = q.trim();
  const list = useQuery({ queryKey: ['members', { q: term }], queryFn: () => api<MemberDto[]>('GET', `/members${term ? `?q=${encodeURIComponent(term)}` : ''}`) });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<MemberDto | 'new' | null>(null);
  const selected = (list.data ?? []).find((m) => m.id === selectedId) ?? null;
  const toggle = useMutation({
    mutationFn: (m: MemberDto) => api<MemberDto>('PATCH', `/members/${m.id}`, { active: !m.active }),
    onSuccess: (m) => {
      void qc.invalidateQueries({ queryKey: ['members'] });
      toast.success(m.active ? 'Member diaktifkan' : 'Member dinonaktifkan');
    },
    onError: showError,
  });

  return (
    <div className="grid min-h-0 gap-4 lg:grid-cols-[1fr_360px]">
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Input aria-label="Cari member" placeholder="Cari kode, nama, atau no. HP" className="max-w-sm" value={q} onChange={(e) => setQ(e.target.value)} />
          {canEdit && <Button className="ml-auto" onClick={() => setEditing('new')}>+ Member</Button>}
        </div>
        <div className="overflow-x-auto rounded-2xl bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-primary-soft text-left text-primary-ink">
              <tr><th className="p-3">Kode</th><th>Nama</th><th>No. HP</th><th>Level</th><th>Status</th></tr>
            </thead>
            <tbody>
              {(list.data ?? []).map((m) => (
                <tr key={m.id} onClick={() => setSelectedId(m.id)} className={cn('cursor-pointer border-t border-line hover:bg-primary-soft/40', selectedId === m.id && 'bg-primary-soft')}>
                  <td className="p-3 font-mono text-xs">{m.code}</td>
                  <td>{m.name}</td>
                  <td>{m.phone || '—'}</td>
                  <td>{m.levelName}</td>
                  <td>{m.active ? 'Aktif' : 'Nonaktif'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data?.length === 0 && <p className="p-4 text-sm text-muted">Member tidak ditemukan.</p>}
        </div>
      </section>
      <aside>
        {selected ? (
          <section className="flex flex-col gap-2 rounded-2xl bg-surface p-4 shadow-sm">
            <h2 className="text-lg font-extrabold">{selected.name}</h2>
            <p className="text-sm text-muted">{`${selected.code} · ${selected.levelName} · ${selected.active ? 'Aktif' : 'Nonaktif'}`}</p>
            <p className="text-sm">{`No. HP: ${selected.phone || '—'}`}</p>
            {canEdit && (
              <div className="mt-2 flex gap-2">
                <Button variant="soft" onClick={() => setEditing(selected)}>Ubah</Button>
                <Button variant={selected.active ? 'danger' : 'soft'} disabled={toggle.isPending} onClick={() => toggle.mutate(selected)}>
                  {selected.active ? 'Nonaktifkan' : 'Aktifkan'}
                </Button>
              </div>
            )}
          </section>
        ) : (
          <p className="text-sm text-muted">Pilih member untuk melihat detail.</p>
        )}
      </aside>
      {editing && <MemberDialog member={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
```

- [ ] **Step 6: Tab Pengaturan Booking**

`apps/web/src/features/settings/BookingSettings.tsx`:
```tsx
import type { FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useSettingsDraft } from './useSettingsDraft';

export function BookingSettings() {
  const { v, setV, save } = useSettingsDraft();
  if (!v) return null;
  const num = (k: 'bookingHoldMin' | 'bookingNoShowMin') => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value) });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ bookingHoldMin: v.bookingHoldMin, bookingNoShowMin: v.bookingNoShowMin });
  };
  return (
    <form onSubmit={submit} className="grid max-w-xl gap-4 rounded-2xl bg-surface p-5 shadow-sm">
      <label className="text-sm font-semibold">
        Hold sebelum jadwal (menit)
        <Input className="mt-1" type="number" min={0} max={240} value={v.bookingHoldMin} onChange={num('bookingHoldMin')} />
      </label>
      <label className="text-sm font-semibold">
        No-show setelah jadwal (menit)
        <Input className="mt-1" type="number" min={1} max={240} value={v.bookingNoShowMin} onChange={num('bookingNoShowMin')} />
      </label>
      <p className="text-xs text-muted">
        Meja tampil Booked mulai sekian menit sebelum jadwal. Booking yang belum check-in sekian menit setelah jadwal otomatis menjadi no-show dan DP-nya hangus.
      </p>
      <Button type="submit" disabled={save.isPending} className="justify-self-start">Simpan</Button>
    </form>
  );
}
```

`apps/web/src/features/settings/SettingsPage.tsx` — ganti seluruh isi:
```tsx
import { useState } from 'react';
import { cn } from '../../lib/cn';
import { BookingSettings } from './BookingSettings';
import { CrudResource } from './CrudResource';
import { GeneralSettings } from './GeneralSettings';
import { PrinterSettings } from './PrinterSettings';
import { RESOURCES } from './resources';
import { TransactionSettings } from './TransactionSettings';

const TABS = [
  { key: 'general', label: 'Umum' },
  { key: 'transaction', label: 'Pajak & Service' },
  { key: 'printer', label: 'Struk & Printer' },
  { key: 'booking', label: 'Booking' },
  { key: 'unitTypes', label: 'Tipe' },
  { key: 'units', label: 'Meja / Unit' },
  { key: 'devices', label: 'Device' },
  { key: 'tariffs', label: 'Tarif' },
  { key: 'packages', label: 'Paket' },
  { key: 'users', label: 'User' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function TabBody({ tab }: { tab: TabKey }) {
  switch (tab) {
    case 'general':
      return <GeneralSettings />;
    case 'transaction':
      return <TransactionSettings />;
    case 'printer':
      return <PrinterSettings />;
    case 'booking':
      return <BookingSettings />;
    default:
      return <CrudResource key={tab} config={RESOURCES[tab]} />;
  }
}

export function SettingsPage() {
  const [tab, setTab] = useState<TabKey>('general');
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
      <TabBody tab={tab} />
    </div>
  );
}
```

- [ ] **Step 7: Sidebar & route**

`apps/web/src/features/layout/AppShell.tsx` — tambah `Users` ke import `lucide-react` dan sisipkan item setelah Transaksi:
```ts
    { to: '/members', label: 'Member', icon: Users, show: true },
```

`apps/web/src/App.tsx` — tambah `import { MembersPage } from './features/members/MembersPage';` dan route setelah `transactions`:
```tsx
          <Route path="members" element={<MembersPage />} />
```

- [ ] **Step 8: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/web test && pnpm --filter @funplay/web typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): members page, member picker, booking settings tab and booking realtime event

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 12: Web — dialog Checkout dengan member, diskon member, DP booking, dan bill DEPOSIT

**Files:**
- Modify: `apps/web/src/features/checkout/CheckoutDialog.tsx`, `apps/web/src/features/checkout/MergeDialog.tsx`, `apps/web/src/features/transactions/BillDetail.tsx`
- Test: `apps/web/src/features/checkout/CheckoutDialog.test.tsx`

**Interfaces:**
- Consumes: `BillView.kind/member/booking`, `CheckoutResult.depositChange` (Task 5, 8), `PUT /api/bills/:id/member` (Task 5), `MemberPickerDialog` (Task 11), `computeBillPreview` (Task 5), `memberLabel`.
- Produces:
  - `depositPaymentFor(bill, grandTotal, enabled): PaymentInput | null` (DEPOSIT otomatis: `amount = min(DP, total)`, `received = DP`).
  - Label UI (E2E): baris **"Member: <nama> (<level>)"** / **"Tanpa member"** dengan tombol **"Pilih member"** / **"Lepas"**; per baris **"Diskon member -Rp …"**; total `data-testid`: `checkout-subtotal`, `checkout-member-discount` (baris **"Diskon member"**), `checkout-total`, `checkout-remaining`, `checkout-change`, `checkout-deposit` (baris **"DP booking"**, tombol **"Hapus DP booking"**, lalu **"Pakai DP booking"**), `checkout-deposit-change` (baris **"Kembali DP (tunai)"**). Bill DEPOSIT: tanpa tombol **"Diskon bill"**, **"Gabung bill lain"**, **"Diskon"** per baris, dan **"Pilih member"**; metode **"DP booking"** tidak pernah tersedia manual.
  - `MergeDialog` tidak menampilkan bill DEPOSIT; `BillDetail` memisahkan **"Kembalian"** (tunai) dan **"Kembali DP"**.

- [ ] **Step 1: Tulis test yang gagal**

Ganti seluruh isi `apps/web/src/features/checkout/CheckoutDialog.test.tsx`:
```tsx
import { DEFAULT_BOOKING_SETTINGS, DEFAULT_TRANSACTION_SETTINGS, type BillView, type MemberDto } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBoard } from '../../stores/board';
import { CheckoutDialog } from './CheckoutDialog';

const bill: BillView = {
  id: 'b1', number: 'FP-20261001-0001', label: 'Meja 1', status: 'OPEN', kind: 'SALE', member: null, booking: null,
  createdAt: '2026-10-01T03:00:00.000Z', createdByName: 'Kasir', billDiscount: null,
  lines: [
    { id: 'l1', type: 'TIME', productId: null, sessionId: 's1', name: 'Meja 1 - Open billing', unitPrice: 40000, qty: 1, discount: null,
      breakdown: [{ kind: 'TARIFF', label: 'Reguler Siang', tariffId: 't', unitTypeId: 'reg', pricePerHour: 40000, minutes: 60, amount: 40000 }] },
    { id: 'l2', type: 'PRODUCT', productId: 'p1', sessionId: null, name: 'Es Teh', unitPrice: 8000, qty: 2, discount: null, breakdown: null },
  ],
  activeSessions: [], payments: [], stored: null, paidAt: null, paidByName: null, shiftId: null, mergedIntoId: null, cancelReason: null, voidReason: null, voidedAt: null,
};
const goldMember = { id: 'm1', code: 'M0001', name: 'Sinta', levelName: 'Gold', timeDiscountPct: 10, fnbDiscountPct: 5 };
const sinta: MemberDto = { id: 'm1', code: 'M0001', name: 'Sinta', phone: '0811', levelId: 'l1', levelName: 'Gold', active: true, createdAt: '2026-10-01T03:00:00.000Z' };
const withDeposit = (amount: number): BillView => ({
  ...bill,
  booking: { id: 'bk1', customerName: 'Budi', startAt: '2026-10-01T03:30:00.000Z', status: 'CHECKED_IN', deposit: { amount, available: true } },
});

function setup(b: BillView = bill, shift = true) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/auth/me') return json({ user: { id: 'k', name: 'Kasir', username: 'kasir', role: 'KASIR' } });
    if (url === '/api/shifts/current') return json({ summary: shift ? { id: 'sh1' } : null });
    if (url === '/api/bills/b1') return json(b);
    if (url === '/api/bills/b1/checkout' && init?.method === 'POST') return json({ bill: { ...b, status: 'PAID' }, change: 44000, depositChange: 0 });
    if (url === '/api/bills/b1/member' && init?.method === 'PUT') return json({ ...b, member: goldMember });
    if (url.startsWith('/api/members')) return json([sinta]);
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CheckoutDialog billId="b1" onClose={onClose} />
    </QueryClientProvider>,
  );
  return { fetchMock, onClose };
}

const body = (f: ReturnType<typeof vi.fn>) => JSON.parse(String(f.mock.calls.find(([u]) => u === '/api/bills/b1/checkout')![1]!.body));

beforeEach(() => {
  useBoard.setState({
    ...useBoard.getInitialState(),
    settings: {
      outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5,
      pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS, ...DEFAULT_BOOKING_SETTINGS,
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('tunai dengan kembalian lalu bayar', async () => {
  const { fetchMock, onClose } = setup();
  expect(await screen.findByTestId('checkout-total')).toHaveTextContent('Rp 56.000');
  await userEvent.type(screen.getByLabelText('Nominal'), '100000');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah pembayaran' }));
  expect(screen.getByTestId('checkout-change')).toHaveTextContent('Rp 44.000');
  await userEvent.click(screen.getByRole('button', { name: 'Bayar' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  const sent = body(fetchMock);
  expect(sent).toMatchObject({ expectedGrandTotal: 56000, payments: [{ method: 'CASH', amount: 56000, received: 100000 }] });
  expect(sent.idempotencyKey.length).toBeGreaterThanOrEqual(8);
});

it('split QRIS + uang pas tunai; Bayar aktif hanya saat sisa 0', async () => {
  const { fetchMock } = setup();
  await screen.findByTestId('checkout-total');
  await userEvent.click(screen.getByRole('button', { name: 'QRIS' }));
  await userEvent.type(screen.getByLabelText('Nominal'), '30000');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah pembayaran' }));
  expect(screen.getByRole('button', { name: 'Bayar' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Tunai' }));
  await userEvent.click(screen.getByRole('button', { name: 'Uang pas' }));
  await userEvent.click(screen.getByRole('button', { name: 'Bayar' }));
  await waitFor(() =>
    expect(body(fetchMock).payments).toEqual([
      { method: 'QRIS', amount: 30000, reference: null },
      { method: 'CASH', amount: 26000, received: 26000 },
    ]),
  );
});

it('sesi masih berjalan → Bayar nonaktif dengan pesan', async () => {
  setup({ ...bill, activeSessions: [{ id: 's9', billId: 'b1', unitName: 'Meja 2', mode: 'OPEN', status: 'RUNNING', startedAt: '2026-10-01T03:00:00.000Z', plannedEndAt: null, endedAt: null, packageName: null, packageDurationMin: null, packagePrice: null, segments: [], pauses: [] }] });
  expect(await screen.findByText('Hentikan sesi meja terlebih dahulu')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Bayar' })).toBeDisabled();
});

it('tanpa shift: Bayar nonaktif dengan alasan', async () => {
  setup(bill, false);
  expect(await screen.findByText('Buka shift dulu untuk menerima pembayaran')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Bayar' })).toBeDisabled();
});

it('member: diskon member per baris & total sama dengan server (Rp 51.200), tanpa PIN', async () => {
  const { fetchMock, onClose } = setup({ ...bill, member: goldMember });
  expect(await screen.findByTestId('checkout-total')).toHaveTextContent('Rp 51.200');
  expect(screen.getByText('Member: Sinta (Gold)')).toBeInTheDocument();
  expect(screen.getByTestId('checkout-member-discount')).toHaveTextContent('-Rp 4.800');
  expect(screen.getByText('Diskon member -Rp 4.000')).toBeInTheDocument();
  expect(screen.getByText('Diskon member -Rp 800')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Uang pas' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Bayar' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Bayar' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  const sent = body(fetchMock);
  expect(sent).toMatchObject({ expectedGrandTotal: 51200, payments: [{ method: 'CASH', amount: 51200, received: 51200 }] });
  expect(sent.approvalPin).toBeUndefined();
});

it('DP booking terisi otomatis; sisa dibayar tunai', async () => {
  const { fetchMock } = setup(withDeposit(50000));
  expect(await screen.findByTestId('checkout-deposit')).toHaveTextContent('Rp 50.000');
  expect(screen.getByTestId('checkout-remaining')).toHaveTextContent('Rp 6.000');
  expect(screen.queryByRole('button', { name: 'DP booking' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Uang pas' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Bayar' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Bayar' }));
  await waitFor(() =>
    expect(body(fetchMock).payments).toEqual([
      { method: 'DEPOSIT', amount: 50000, received: 50000 },
      { method: 'CASH', amount: 6000, received: 6000 },
    ]),
  );
});

it('DP melebihi total: kembali DP, bisa langsung bayar; DP bisa dihapus', async () => {
  setup(withDeposit(60000));
  expect(await screen.findByTestId('checkout-deposit-change')).toHaveTextContent('Rp 4.000');
  expect(screen.getByTestId('checkout-remaining')).toHaveTextContent('Rp 0');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Bayar' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Hapus DP booking' }));
  expect(screen.getByTestId('checkout-remaining')).toHaveTextContent('Rp 56.000');
  expect(screen.getByRole('button', { name: 'Pakai DP booking' })).toBeInTheDocument();
});

it('bill DEPOSIT: tanpa diskon, gabung, dan member', async () => {
  setup({
    ...bill, kind: 'DEPOSIT', label: 'DP · Budi · Meja 2 19:00',
    lines: [{ id: 'd1', type: 'DEPOSIT', productId: null, sessionId: null, name: 'DP booking Meja 2 01/10/2026 19:00', unitPrice: 50000, qty: 1, discount: null, breakdown: null }],
  });
  expect(await screen.findByTestId('checkout-total')).toHaveTextContent('Rp 50.000');
  for (const name of ['Diskon bill', 'Gabung bill lain', 'Pilih member', 'DP booking']) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  }
  expect(screen.queryByRole('button', { name: /^Diskon / })).not.toBeInTheDocument();
});

it('Pilih member memasang member lewat API', async () => {
  const { fetchMock } = setup();
  await userEvent.click(await screen.findByRole('button', { name: 'Pilih member' }));
  await userEvent.click(await screen.findByRole('button', { name: /M0001 · Sinta/ }));
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([u, i]) => u === '/api/bills/b1/member' && i?.method === 'PUT');
    expect(JSON.parse(String(call![1]!.body))).toEqual({ memberId: 'm1' });
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/web test -- CheckoutDialog`
Expected: FAIL — tidak ada baris member, testid `checkout-member-discount`/`checkout-deposit`, dan tombol diskon masih tampil di bill DEPOSIT.

- [ ] **Step 3: Implementasi dialog Checkout**

Ganti seluruh isi `apps/web/src/features/checkout/CheckoutDialog.tsx`:
```tsx
import { memberLabel, needsDiscountApproval, type BillView, type CheckoutResult, type PaymentInput } from '@funplay/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { useNow } from '../../hooks/useNow';
import { useHasShift } from '../../hooks/useShift';
import { billKey, useBill, useBillAction, useBillPreview } from '../../hooks/useBill';
import { api, ApiError } from '../../lib/api';
import { formatMinutes, formatRupiah } from '../../lib/format';
import { newId } from '../../lib/id';
import { useBoard } from '../../stores/board';
import { useCheckout } from '../../stores/checkout';
import { approvalPin } from '../../stores/pin';
import { showError, toast } from '../../stores/toast';
import { useMe } from '../auth/auth';
import { MemberPickerDialog } from '../members/MemberPicker';
import { DiscountEditor } from './DiscountEditor';
import { MergeDialog } from './MergeDialog';
import { PaymentComposer } from './PaymentComposer';

function Row({ label, value, testId, strong }: { label: string; value: string; testId?: string; strong?: boolean }) {
  return (
    <div className={strong ? 'flex justify-between border-t border-line pt-2 text-xl font-extrabold text-primary' : 'flex justify-between text-sm'}>
      <span>{label}</span>
      <span className="tabular-nums" data-testid={testId}>{value}</span>
    </div>
  );
}

export function CheckoutHost() {
  const { billId, close } = useCheckout();
  return billId ? <CheckoutDialog key={billId} billId={billId} onClose={close} /> : null;
}

function blockedReason(b: BillView, hasShift: boolean): string | null {
  if (b.status !== 'OPEN') return 'Bill sudah tidak bisa dibayar';
  if (b.activeSessions.length) return 'Hentikan sesi meja terlebih dahulu';
  if (!b.lines.length) return 'Bill masih kosong';
  if (!hasShift) return 'Buka shift dulu untuk menerima pembayaran';
  return null;
}

/** Pembayaran DP booking otomatis (aturan server): amount = min(DP, total), received = DP. */
export function depositPaymentFor(b: BillView, grandTotal: number, enabled: boolean): PaymentInput | null {
  const dp = b.booking?.deposit;
  if (!enabled || b.kind !== 'SALE' || !dp?.available || dp.amount <= 0 || grandTotal <= 0) return null;
  return { method: 'DEPOSIT', amount: Math.min(dp.amount, grandTotal), received: dp.amount };
}

export function CheckoutDialog({ billId, onClose }: { billId: string; onClose: () => void }) {
  const me = useMe().data;
  const hasShift = useHasShift();
  const qc = useQueryClient();
  const bill = useBill(billId);
  const settings = useBoard((s) => s.settings);
  const now = useNow();
  const preview = useBillPreview(bill.data, now);
  const action = useBillAction(billId);
  const [payments, setPaymentsRaw] = useState<PaymentInput[]>([]);
  const [useDeposit, setUseDepositRaw] = useState(true);
  const [editing, setEditing] = useState<null | 'bill' | string>(null);
  const [merging, setMerging] = useState(false);
  const [picking, setPicking] = useState(false);
  // Satu kunci per upaya pembayaran: dipakai ulang saat klik ganda/ulang, diganti saat isi pembayaran berubah.
  const key = useRef(newId());
  const setPayments = (p: PaymentInput[]) => {
    key.current = newId();
    setPaymentsRaw(p);
  };
  const setUseDeposit = (v: boolean) => {
    key.current = newId();
    setUseDepositRaw(v);
  };

  const pay = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<CheckoutResult>('POST', `/bills/${billId}/checkout`, body),
    onSuccess: (r) => {
      qc.setQueryData(billKey(billId), r.bill);
      void qc.invalidateQueries({ queryKey: ['bills'] });
      void qc.invalidateQueries({ queryKey: ['bookings'] });
      const parts = ['Lunas'];
      if (r.change > 0) parts.push(`kembalian ${formatRupiah(r.change)}`);
      if (r.depositChange > 0) parts.push(`kembali DP ${formatRupiah(r.depositChange)}`);
      toast.success(parts.join(' · '));
      onClose();
    },
    onError: (err) => {
      showError(err);
      if (err instanceof ApiError && (err.code === 'TOTAL_CHANGED' || err.code === 'DEPOSIT_NOT_AVAILABLE')) {
        setPayments([]);
        void bill.refetch();
      }
    },
  });

  if (!bill.data || !preview || !settings || !me) {
    return <Modal open onOpenChange={(o) => !o && onClose()} title="Bayar"><p className="text-sm text-muted">Memuat…</p></Modal>;
  }
  const b = bill.data;
  const t = preview.totals;
  const isDeposit = b.kind === 'DEPOSIT';
  const editable = b.status === 'OPEN' && !isDeposit;
  const depositPayment = depositPaymentFor(b, t.grandTotal, useDeposit);
  const all = depositPayment ? [depositPayment, ...payments] : payments;
  const paid = all.reduce((a, p) => a + p.amount, 0);
  const remaining = t.grandTotal - paid;
  const change = payments.reduce((a, p) => a + ((p.received ?? p.amount) - p.amount), 0);
  const depositChange = depositPayment ? (depositPayment.received ?? depositPayment.amount) - depositPayment.amount : 0;
  const otherDiscount = t.discountTotal - t.memberDiscountTotal;
  const canUseDeposit = !isDeposit && !!b.booking?.deposit?.available;
  const blocked = blockedReason(b, hasShift);

  const saveDiscount = (d: BillView['billDiscount']) => {
    const target = editing;
    setEditing(null);
    setPayments([]);
    if (target === 'bill') action.mutate({ method: 'PUT', path: `/bills/${billId}/discount`, body: { discount: d } });
    else if (target) action.mutate({ method: 'PATCH', path: `/bills/${billId}/items/${target}`, body: { discount: d } });
  };
  const setMember = (memberId: string | null) => {
    setPayments([]);
    action.mutate({ method: 'PUT', path: `/bills/${billId}/member`, body: { memberId } });
  };

  const submit = async () => {
    if (pay.isPending) return;
    let pin: string | undefined;
    if (needsDiscountApproval(t, settings.discountApprovalPct)) {
      const p = await approvalPin(me.role, 'PIN supervisor untuk diskon');
      if (p === null) return;
      pin = p;
    }
    pay.mutate({ idempotencyKey: key.current, expectedGrandTotal: t.grandTotal, payments: all, ...(pin ? { approvalPin: pin } : {}) });
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Bayar · ${b.label}`} width="max-w-4xl">
      <div className="grid gap-6 md:grid-cols-2">
        <section className="flex flex-col gap-2">
          <p className="text-xs text-muted">{b.number}{isDeposit ? ' · Tanda terima DP' : ''}</p>
          {!isDeposit && (
            <div className="flex items-center justify-between rounded-xl bg-bg p-2 text-sm">
              <span className="font-semibold">{b.member ? `Member: ${memberLabel(b.member)}` : 'Tanpa member'}</span>
              {editable &&
                (b.member ? (
                  <Button size="sm" variant="ghost" onClick={() => setMember(null)}>Lepas</Button>
                ) : (
                  <Button size="sm" variant="soft" onClick={() => setPicking(true)}>Pilih member</Button>
                ))}
            </div>
          )}
          {b.lines.map((l, i) => (
            <div key={l.id} className="rounded-xl bg-bg p-2 text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold">{l.name}{l.qty > 1 ? ` × ${l.qty}` : ''}</span>
                <span className="tabular-nums">{formatRupiah(l.unitPrice * l.qty)}</span>
              </div>
              {l.breakdown && (
                <details className="text-xs text-muted">
                  <summary>Rincian tarif</summary>
                  {l.breakdown.map((c, j) => <div key={j}>{c.label} · {formatMinutes(c.minutes)} · {formatRupiah(c.amount)}</div>)}
                </details>
              )}
              <div className="flex items-center justify-between text-xs">
                <span className="flex flex-col">
                  {t.lines[i]!.itemDiscount > 0 && <span className="text-emerald-700">Diskon -{formatRupiah(t.lines[i]!.itemDiscount)}</span>}
                  {t.lines[i]!.memberDiscount > 0 && <span className="text-emerald-700">Diskon member -{formatRupiah(t.lines[i]!.memberDiscount)}</span>}
                </span>
                {editable && (
                  <button type="button" className="font-semibold text-primary-ink" aria-label={`Diskon ${l.name}`} onClick={() => setEditing(l.id)}>Diskon</button>
                )}
              </div>
            </div>
          ))}
          {preview.liveTime.map((x) => (
            <div key={x.sessionId} className="flex justify-between rounded-xl bg-amber-50 p-2 text-sm text-amber-900">
              <span>{x.unitName} · sedang berjalan</span>
              <span className="tabular-nums">{formatRupiah(x.charge?.total ?? 0)}</span>
            </div>
          ))}
          {editable && (
            <div className="flex gap-2">
              <Button size="sm" variant="soft" onClick={() => setEditing('bill')}>Diskon bill</Button>
              <Button size="sm" variant="soft" onClick={() => setMerging(true)}>Gabung bill lain</Button>
            </div>
          )}
          <div className="mt-2 flex flex-col gap-1">
            <Row label="Subtotal" value={formatRupiah(t.subtotal)} testId="checkout-subtotal" />
            {t.memberDiscountTotal > 0 && <Row label="Diskon member" value={`-${formatRupiah(t.memberDiscountTotal)}`} testId="checkout-member-discount" />}
            {otherDiscount > 0 && <Row label="Diskon" value={`-${formatRupiah(otherDiscount)}`} />}
            {t.serviceTotal > 0 && <Row label="Service" value={formatRupiah(t.serviceTotal)} />}
            {t.taxTotal > 0 && <Row label="Pajak" value={formatRupiah(t.taxTotal)} />}
            <Row label="TOTAL" value={formatRupiah(t.grandTotal)} testId="checkout-total" strong />
          </div>
        </section>
        <section className="flex flex-col gap-3">
          {depositPayment && (
            <div className="flex items-center justify-between rounded-xl bg-cyan-50 p-2 text-sm font-semibold text-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-100">
              <span>DP booking</span>
              <span className="flex items-center gap-2 tabular-nums">
                <span data-testid="checkout-deposit">{formatRupiah(depositPayment.received ?? depositPayment.amount)}</span>
                <button type="button" aria-label="Hapus DP booking" onClick={() => setUseDeposit(false)}><X size={14} /></button>
              </span>
            </div>
          )}
          {canUseDeposit && !depositPayment && (
            <Button size="sm" variant="soft" onClick={() => setUseDeposit(true)}>Pakai DP booking</Button>
          )}
          <PaymentComposer remaining={remaining} payments={payments} onChange={setPayments} />
          <Row label="Sisa" value={formatRupiah(Math.max(0, remaining))} testId="checkout-remaining" />
          <Row label="Kembalian" value={formatRupiah(change)} testId="checkout-change" />
          {depositChange > 0 && <Row label="Kembali DP (tunai)" value={formatRupiah(depositChange)} testId="checkout-deposit-change" />}
          {remaining < 0 && <p className="text-sm text-rose-600">Pembayaran melebihi total — hapus salah satu pembayaran.</p>}
          {blocked && <p className="text-sm font-semibold text-rose-600">{blocked}</p>}
          <Button size="lg" disabled={!!blocked || remaining !== 0 || pay.isPending} onClick={submit}>Bayar</Button>
        </section>
      </div>
      {editing && (
        <DiscountEditor
          title={editing === 'bill' ? 'Diskon bill' : 'Diskon item'}
          initial={editing === 'bill' ? b.billDiscount : (b.lines.find((l) => l.id === editing)?.discount ?? null)}
          onSave={saveDiscount}
          onClose={() => setEditing(null)}
        />
      )}
      {merging && <MergeDialog targetId={billId} onClose={() => setMerging(false)} />}
      {picking && <MemberPickerDialog onPick={(m) => setMember(m.id)} onClose={() => setPicking(false)} />}
    </Modal>
  );
}
```

- [ ] **Step 4: Gabung & detail transaksi**

`apps/web/src/features/checkout/MergeDialog.tsx` — ganti baris `const others = …` menjadi:
```ts
  const others = (open.data ?? []).filter((b) => b.id !== targetId && b.kind !== 'DEPOSIT');
```

`apps/web/src/features/transactions/BillDetail.tsx` — ganti blok kembalian (`{b.payments.some((p) => (p.change ?? 0) > 0) && ( … )}`) dengan:
```tsx
          {b.payments.some((p) => p.method === 'CASH' && (p.change ?? 0) > 0) && (
            <div className="flex justify-between text-muted">
              <span>Kembalian</span>
              <span className="tabular-nums">{formatRupiah(b.payments.filter((p) => p.method === 'CASH').reduce((a, p) => a + (p.change ?? 0), 0))}</span>
            </div>
          )}
          {b.payments.some((p) => p.method === 'DEPOSIT' && (p.change ?? 0) > 0) && (
            <div className="flex justify-between text-muted">
              <span>Kembali DP</span>
              <span className="tabular-nums">{formatRupiah(b.payments.filter((p) => p.method === 'DEPOSIT').reduce((a, p) => a + (p.change ?? 0), 0))}</span>
            </div>
          )}
```

- [ ] **Step 5: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/web test && pnpm --filter @funplay/web typecheck`
Expected: PASS (termasuk `BillDetail.test` yang memeriksa "Kembalian").

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/checkout apps/web/src/features/transactions/BillDetail.tsx
git commit -m "feat(web): checkout with member picker, member discount, auto-filled booking DP

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 13: Web — layar Meja: kartu Booked, panel check-in, member saat Mulai, konfirmasi `BOOKING_HOLD`

**Files:**
- Modify: `apps/web/src/features/board/actions.ts`, `apps/web/src/features/board/StartSession.tsx`, `apps/web/src/features/board/UnitCard.tsx`, `apps/web/src/features/board/UnitPanel.tsx`
- Create: `apps/web/src/features/board/ModePicker.tsx`, `apps/web/src/features/board/BookedPanel.tsx`, `apps/web/src/features/bookings/CheckInDialog.tsx`
- Test: `apps/web/src/features/board/UnitCard.test.tsx`, `apps/web/src/features/board/StartSession.test.tsx`, `apps/web/src/features/board/BookedPanel.test.tsx`

**Interfaces:**
- Consumes: `UnitView.booking` (Task 7), `POST /api/sessions` `memberId`/`ignoreBooking` + 409 `BOOKING_HOLD` `details.booking` (Task 7), `POST /api/bookings/:id/check-in` → `CheckInResult` (Task 7), `ApiError.details`, `MemberPickerDialog` (Task 11), `localHHMM`, `memberLabel`.
- Produces:
  - `useSessionAction({ quiet? })` — `quiet(err)` true → error tidak di-toast.
  - `ModePicker({ unitTypeId, mode, onMode, packageId, onPackage })`, `StartMode`.
  - `CheckInDialog({ booking: { id, customerName, unitId }, onClose })` — dipakai layar Meja & halaman Booking.
  - Label UI (E2E): kartu `data-booked="true"`, warna `bg-[#CFFAFE]`, teks **"Booked · <nama> <HH:MM>"** (+ " 💰" bila DP dibayar), `data-status` tetap `IDLE`; panel meja Booked: tombol **"Check-in"** dan **"Mulai lain"**; dialog **"Check-in · <nama>"** dengan **"Open billing"**/**"Paket"** dan tombol **"Mulai"**; StartSession: tombol **"Pilih member"**, teks **"Member: <nama> (<level>)"**, tombol **"Lepas"**; konfirmasi hold berjudul **"Meja dibooking"** dengan teks **"Meja ini dibooking <nama> jam <HH:MM>. Tetap mulai?"** dan tombol **"Tetap mulai"** / **"Batal"**.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `apps/web/src/features/board/UnitCard.test.tsx`:
```tsx
it('meja di-hold: cyan, teks Booked dengan ikon DP, status tetap IDLE', () => {
  render(
    <UnitCard
      unit={{ ...base, session: null, booking: { id: 'bk1', customerName: 'Budi', startAt: '2026-10-01T12:00:00.000Z', durationMin: 60, depositPaid: true } }}
      now={new Date('2026-10-01T11:50:00.000Z')}
      selected={false}
      onSelect={() => {}}
    />,
  );
  const card = screen.getByTestId('unit-card-Meja 1');
  expect(card).toHaveAttribute('data-status', 'IDLE');
  expect(card).toHaveAttribute('data-booked', 'true');
  expect(card).toHaveTextContent('Booked · Budi 19:00 💰');
  expect(card.className).toContain('bg-[#CFFAFE]');
});
```

`apps/web/src/features/board/StartSession.test.tsx`:
```tsx
import { DEFAULT_BOOKING_SETTINGS, DEFAULT_TRANSACTION_SETTINGS, type MemberDto, type UnitView } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBoard } from '../../stores/board';
import { useToasts } from '../../stores/toast';
import { StartSession } from './StartSession';

const idle: UnitView = {
  id: 'u1', name: 'Meja 1', sortOrder: 1, unitTypeId: 'reg', unitTypeName: 'Reguler', unitTypeColor: '#7C3AED', area: '',
  deviceId: null, relayChannel: null, state: 'ACTIVE', lightOverride: null, light: null, deviceOnline: null, session: null, booking: null,
};
const sinta: MemberDto = { id: 'm1', code: 'M0001', name: 'Sinta', phone: '0811', levelId: 'l1', levelName: 'Gold', active: true, createdAt: '2026-10-01T03:00:00.000Z' };
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });

function setup(sessionsResponses: Response[]) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') return json({ user: { id: 'k', name: 'Kasir', username: 'kasir', role: 'KASIR' } });
    if (url === '/api/shifts/current') return json({ summary: { shift: { id: 's1' } } });
    if (url === '/api/packages') return json([]);
    if (url.startsWith('/api/members')) return json([sinta]);
    if (url === '/api/sessions' && init?.method === 'POST') return sessionsResponses.shift() ?? json({ unit: idle });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <StartSession unit={idle} />
    </QueryClientProvider>,
  );
  return fetchMock;
}
const posts = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls.filter(([u, i]) => u === '/api/sessions' && i?.method === 'POST').map(([, i]) => JSON.parse(String(i!.body)));

beforeEach(() => {
  useToasts.setState({ toasts: [] });
  useBoard.setState({
    ...useBoard.getInitialState(),
    settings: {
      outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5,
      pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS, ...DEFAULT_BOOKING_SETTINGS,
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('BOOKING_HOLD: konfirmasi tanpa toast error, lalu Tetap mulai mengirim ignoreBooking', async () => {
  const hold = json({
    error: { code: 'BOOKING_HOLD', message: 'Meja 1 dibooking Budi jam 19:00', details: { booking: { id: 'bk1', customerName: 'Budi', startAt: '2026-10-01T12:00:00.000Z' } } },
  }, 409);
  const f = setup([hold]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mulai' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Mulai' }));
  expect(await screen.findByText('Meja ini dibooking Budi jam 19:00. Tetap mulai?')).toBeInTheDocument();
  expect(useToasts.getState().toasts.some((t) => t.level === 'danger')).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Tetap mulai' }));
  await waitFor(() => expect(posts(f)).toEqual([{ unitId: 'u1', mode: 'OPEN' }, { unitId: 'u1', mode: 'OPEN', ignoreBooking: true }]));
});

it('member yang dipilih ikut dikirim saat Mulai', async () => {
  const f = setup([]);
  await userEvent.click(screen.getByRole('button', { name: 'Pilih member' }));
  await userEvent.click(await screen.findByRole('button', { name: /M0001 · Sinta/ }));
  expect(screen.getByText('Member: Sinta (Gold)')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mulai' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Mulai' }));
  await waitFor(() => expect(posts(f)).toEqual([{ unitId: 'u1', mode: 'OPEN', memberId: 'm1' }]));
});
```

`apps/web/src/features/board/BookedPanel.test.tsx`:
```tsx
import { DEFAULT_BOOKING_SETTINGS, DEFAULT_TRANSACTION_SETTINGS, type UnitView } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBoard } from '../../stores/board';
import { UnitPanel } from './UnitPanel';

const booked: UnitView = {
  id: 'u1', name: 'Meja 1', sortOrder: 1, unitTypeId: 'reg', unitTypeName: 'Reguler', unitTypeColor: '#7C3AED', area: '',
  deviceId: null, relayChannel: null, state: 'ACTIVE', lightOverride: null, light: null, deviceOnline: null, session: null,
  booking: { id: 'bk1', customerName: 'Budi', startAt: '2026-10-01T12:00:00.000Z', durationMin: 60, depositPaid: true },
};

beforeEach(() => {
  useBoard.setState({
    ...useBoard.getInitialState(),
    settings: {
      outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5,
      pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS, ...DEFAULT_BOOKING_SETTINGS,
    },
    units: { u1: booked },
    order: ['u1'],
    selectedUnitId: 'u1',
  });
});
afterEach(() => vi.unstubAllGlobals());

it('meja Booked: info booking, Mulai lain membuka mulai walk-in, Check-in mengirim check-in', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/auth/me') return json({ user: { id: 'k', name: 'Kasir', username: 'kasir', role: 'KASIR' } });
    if (url === '/api/shifts/current') return json({ summary: { shift: { id: 's1' } } });
    if (url === '/api/packages') return json([]);
    if (url === '/api/bookings/bk1/check-in' && init?.method === 'POST') return json({ unit: { ...booked, booking: null }, booking: { id: 'bk1' } });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UnitPanel />
    </QueryClientProvider>,
  );
  expect(screen.getByText('Booked · Budi 19:00')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mulai' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Mulai lain' }));
  expect(screen.getByRole('button', { name: 'Mulai' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Check-in' }));
  const dlg = await screen.findByRole('dialog', { name: 'Check-in · Budi' });
  await userEvent.click(within(dlg).getByRole('button', { name: 'Mulai' }));
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([u]) => u === '/api/bookings/bk1/check-in');
    expect(JSON.parse(String(call![1]!.body))).toEqual({ mode: 'OPEN' });
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/web test -- UnitCard StartSession BookedPanel`
Expected: FAIL — kartu tidak menampilkan Booked, StartSession tanpa member/konfirmasi, panel Booked tidak ada.

- [ ] **Step 3: Aksi sesi & pemilih mode**

Ganti seluruh isi `apps/web/src/features/board/actions.ts`:
```ts
import type { UnitView } from '@funplay/shared';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useBoard } from '../../stores/board';
import { showError } from '../../stores/toast';

/** `quiet(err)` true = error ditangani pemanggil (mis. konfirmasi BOOKING_HOLD), tidak di-toast. */
export function useSessionAction(opts: { quiet?: (err: unknown) => boolean } = {}) {
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body?: Record<string, unknown> }) => api<{ unit: UnitView }>('POST', path, body ?? {}),
    onSuccess: (r) => {
      useBoard.getState().applyActionUnit(r.unit);
      useBoard.getState().select(r.unit.id);
    },
    onError: (err) => {
      if (!opts.quiet?.(err)) showError(err);
    },
  });
}
```

`apps/web/src/features/board/ModePicker.tsx`:
```tsx
import type { PackageDto } from '@funplay/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatMinutes, formatRupiah } from '../../lib/format';

export type StartMode = 'OPEN' | 'PACKAGE';

/** Pilihan Open billing / Paket (paket aktif untuk tipe meja). Dipakai Mulai sesi dan Check-in. */
export function ModePicker(props: {
  unitTypeId: string;
  mode: StartMode;
  onMode: (m: StartMode) => void;
  packageId: string | null;
  onPackage: (id: string) => void;
}) {
  const packages = useQuery({ queryKey: ['/packages'], queryFn: () => api<PackageDto[]>('GET', '/packages') });
  const list = (packages.data ?? []).filter((p) => p.active && p.unitTypeId === props.unitTypeId);
  return (
    <>
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-bg p-1">
        {(['OPEN', 'PACKAGE'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => props.onMode(m)}
            className={cn('rounded-lg py-2 text-sm font-bold transition', props.mode === m ? 'bg-primary text-white' : 'text-primary-ink')}
          >
            {m === 'OPEN' ? 'Open billing' : 'Paket'}
          </button>
        ))}
      </div>
      {props.mode === 'PACKAGE' && (
        <div className="flex flex-col gap-2">
          {list.length === 0 && <p className="text-sm text-muted">Belum ada paket untuk tipe ini.</p>}
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => props.onPackage(p.id)}
              className={cn(
                'flex justify-between rounded-xl border-2 px-3 py-2 text-left text-sm font-semibold transition',
                props.packageId === p.id ? 'border-primary bg-primary-soft' : 'border-line',
              )}
            >
              <span>{p.name} · {formatMinutes(p.durationMin)}</span>
              <span>{formatRupiah(p.price)}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Mulai sesi dengan member & konfirmasi hold**

Ganti seluruh isi `apps/web/src/features/board/StartSession.tsx`:
```tsx
import { localHHMM, memberLabel, type BookingHoldInfo, type MemberDto, type UnitView } from '@funplay/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { useHasShift } from '../../hooks/useShift';
import { ApiError } from '../../lib/api';
import { useBoard } from '../../stores/board';
import { toast } from '../../stores/toast';
import { MemberPickerDialog } from '../members/MemberPicker';
import { useSessionAction } from './actions';
import { ModePicker, type StartMode } from './ModePicker';

const isHold = (err: unknown): err is ApiError => err instanceof ApiError && err.code === 'BOOKING_HOLD';

export function StartSession({ unit }: { unit: UnitView }) {
  const [mode, setMode] = useState<StartMode>('OPEN');
  const [packageId, setPackageId] = useState<string | null>(null);
  const [member, setMember] = useState<MemberDto | null>(null);
  const [picking, setPicking] = useState(false);
  const [hold, setHold] = useState<{ info: BookingHoldInfo | null; message: string } | null>(null);
  const offset = useBoard((s) => s.settings?.utcOffsetMin ?? 420);
  const action = useSessionAction({ quiet: isHold });
  const hasShift = useHasShift();

  const start = async (ignoreBooking = false) => {
    try {
      await action.mutateAsync({
        path: '/sessions',
        body: {
          unitId: unit.id,
          mode,
          ...(mode === 'PACKAGE' && packageId ? { packageId } : {}),
          ...(member ? { memberId: member.id } : {}),
          ...(ignoreBooking ? { ignoreBooking: true } : {}),
        },
      });
      setHold(null);
      toast.success(`${unit.name} dimulai`);
    } catch (err) {
      // BOOKING_HOLD → minta konfirmasi; error lain sudah ditampilkan oleh hook (showError)
      if (isHold(err)) setHold({ info: (err.details?.booking as BookingHoldInfo | undefined) ?? null, message: err.message });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <ModePicker unitTypeId={unit.unitTypeId} mode={mode} onMode={setMode} packageId={packageId} onPackage={setPackageId} />
      {member ? (
        <div className="flex items-center justify-between rounded-xl bg-bg p-2 text-sm">
          <span className="font-semibold">{`Member: ${memberLabel(member)}`}</span>
          <Button size="sm" variant="ghost" onClick={() => setMember(null)}>Lepas</Button>
        </div>
      ) : (
        <Button variant="soft" onClick={() => setPicking(true)}>Pilih member</Button>
      )}
      {!hasShift && <p className="text-sm text-amber-700">Buka shift dulu untuk memulai.</p>}
      <Button size="lg" onClick={() => void start()} disabled={!hasShift || action.isPending || (mode === 'PACKAGE' && !packageId)}>
        Mulai
      </Button>
      {picking && <MemberPickerDialog onPick={setMember} onClose={() => setPicking(false)} />}
      {hold && (
        <Modal
          open
          onOpenChange={(o) => !o && setHold(null)}
          title="Meja dibooking"
          footer={
            <>
              <Button variant="ghost" onClick={() => setHold(null)}>Batal</Button>
              <Button variant="warning" disabled={action.isPending} onClick={() => void start(true)}>Tetap mulai</Button>
            </>
          }
        >
          <p className="text-sm">
            {hold.info
              ? `Meja ini dibooking ${hold.info.customerName} jam ${localHHMM(new Date(hold.info.startAt), offset)}. Tetap mulai?`
              : `${hold.message}. Tetap mulai?`}
          </p>
        </Modal>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Kartu & panel Booked, dialog check-in**

`apps/web/src/features/board/UnitCard.tsx` — tambah `localHHMM` ke import shared (`import { localHHMM, type UnitView } from '@funplay/shared';`), lalu di dalam komponen setelah `const style = STATUS_STYLE[status];`:
```tsx
  const offset = useBoard((s) => s.settings?.utcOffsetMin ?? 420);
  const booked = !unit.session && unit.state === 'ACTIVE' ? unit.booking : null;
  const bookedText = booked
    ? `Booked · ${booked.customerName} ${localHHMM(new Date(booked.startAt), offset)}${booked.depositPaid ? ' 💰' : ''}`
    : null;
```
ganti atribut & kelas tombol kartu:
```tsx
      data-status={status}
      data-booked={booked ? 'true' : undefined}
      data-light={unit.light === null ? 'unknown' : unit.light ? 'on' : 'off'}
      className={cn(
        'flex min-h-32 flex-col justify-between rounded-2xl p-3 text-left transition active:scale-[.98]',
        booked ? 'border-2 border-cyan-300 bg-[#CFFAFE] text-cyan-950' : style.card,
        selected && 'ring-4 ring-accent ring-offset-2 ring-offset-bg',
      )}
```
dan label status di baris bawah:
```tsx
        <span>{bookedText ?? style.label}</span>
```

`apps/web/src/features/bookings/CheckInDialog.tsx`:
```tsx
import type { CheckInResult } from '@funplay/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { api } from '../../lib/api';
import { useBoard } from '../../stores/board';
import { showError, toast } from '../../stores/toast';
import { ModePicker, type StartMode } from '../board/ModePicker';

export function CheckInDialog({ booking, onClose }: { booking: { id: string; customerName: string; unitId: string }; onClose: () => void }) {
  const unitTypeId = useBoard((s) => s.units[booking.unitId]?.unitTypeId ?? '');
  const [mode, setMode] = useState<StartMode>('OPEN');
  const [packageId, setPackageId] = useState<string | null>(null);
  const qc = useQueryClient();
  const go = useMutation({
    mutationFn: () => api<CheckInResult>('POST', `/bookings/${booking.id}/check-in`, { mode, ...(mode === 'PACKAGE' && packageId ? { packageId } : {}) }),
    onSuccess: (r) => {
      if (r.unit) {
        useBoard.getState().applyActionUnit(r.unit);
        useBoard.getState().select(r.unit.id);
      }
      void qc.invalidateQueries({ queryKey: ['bookings'] });
      toast.success(`Check-in ${booking.customerName}`);
      onClose();
    },
    onError: showError,
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Check-in · ${booking.customerName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button disabled={go.isPending || (mode === 'PACKAGE' && !packageId)} onClick={() => go.mutate()}>Mulai</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <ModePicker unitTypeId={unitTypeId} mode={mode} onMode={setMode} packageId={packageId} onPackage={setPackageId} />
      </div>
    </Modal>
  );
}
```

`apps/web/src/features/board/BookedPanel.tsx`:
```tsx
import { localHHMM, type UnitBookingView, type UnitView } from '@funplay/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { formatMinutes } from '../../lib/format';
import { useBoard } from '../../stores/board';
import { CheckInDialog } from '../bookings/CheckInDialog';
import { StartSession } from './StartSession';

/** Panel meja yang di-hold booking: Check-in, atau Mulai lain (walk-in, memicu konfirmasi BOOKING_HOLD). */
export function BookedPanel({ unit, booking }: { unit: UnitView; booking: UnitBookingView }) {
  const offset = useBoard((s) => s.settings?.utcOffsetMin ?? 420);
  const [walkIn, setWalkIn] = useState(false);
  const [checkIn, setCheckIn] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl bg-[#CFFAFE] p-3 text-sm text-cyan-950">
        <p className="font-bold">{`Booked · ${booking.customerName} ${localHHMM(new Date(booking.startAt), offset)}`}</p>
        <p>{`Durasi ${formatMinutes(booking.durationMin)} · ${booking.depositPaid ? 'DP sudah dibayar 💰' : 'tanpa DP terbayar'}`}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button size="lg" onClick={() => setCheckIn(true)}>Check-in</Button>
        <Button size="lg" variant="soft" aria-expanded={walkIn} onClick={() => setWalkIn((v) => !v)}>Mulai lain</Button>
      </div>
      {walkIn && <StartSession unit={unit} />}
      {checkIn && <CheckInDialog booking={{ id: booking.id, customerName: booking.customerName, unitId: unit.id }} onClose={() => setCheckIn(false)} />}
    </div>
  );
}
```

`apps/web/src/features/board/UnitPanel.tsx` — tambah `import { BookedPanel } from './BookedPanel';` dan ganti baris `{status === 'IDLE' && <StartSession key={unit.id} unit={unit} />}` dengan:
```tsx
      {status === 'IDLE' &&
        (unit.booking ? <BookedPanel key={unit.id} unit={unit} booking={unit.booking} /> : <StartSession key={unit.id} unit={unit} />)}
```

- [ ] **Step 6: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/web test && pnpm --filter @funplay/web typecheck`
Expected: PASS (test `UnitPanel` M1 tetap: body mulai tanpa `memberId`/`ignoreBooking` sama persis dengan sebelumnya).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/board apps/web/src/features/bookings/CheckInDialog.tsx
git commit -m "feat(web): booked unit card and panel, check-in dialog, member on start, BOOKING_HOLD confirm

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 14: Web — halaman Booking (timeline 24 jam, daftar, dialog booking, detail & aksi)

**Files:**
- Modify: `apps/web/src/lib/format.ts`, `apps/web/src/features/layout/AppShell.tsx`, `apps/web/src/App.tsx`
- Create: `apps/web/src/hooks/useBookings.ts`
- Create: `apps/web/src/features/bookings/timeline.ts`, `apps/web/src/features/bookings/Timeline.tsx`, `apps/web/src/features/bookings/BookingDialog.tsx`, `apps/web/src/features/bookings/BookingActions.tsx`, `apps/web/src/features/bookings/BookingDetail.tsx`, `apps/web/src/features/bookings/BookingsPage.tsx`
- Test: `apps/web/src/lib/format.test.ts`, `apps/web/src/features/bookings/timeline.test.ts`, `apps/web/src/features/bookings/Timeline.test.tsx`, `apps/web/src/features/bookings/BookingDialog.test.tsx`

**Interfaces:**
- Consumes: API booking (Task 6–7, 9), `CheckInDialog` (Task 13), `MemberPickerDialog` (Task 11), `useCheckout`, `approvalPin`, `isOnHold`, `BOOKING_STATUS_LABEL`, `DEPOSIT_OUTCOME_LABEL`, `localDayRange`, `localDateInput`.
- Produces:
  - `localTimeInput(at, offset) → "HH:MM"`, `localDateTimeToIso(date, time, offset) → ISO`.
  - `blockPosition(startAt, durationMin, dayStart) → { leftPct, widthPct } | null`, `nowPosition(now, dayStart) → number | null`.
  - `useBookings({ from, to })` (query key `['bookings', range]`), `useBookingAction()` (POST → `BookingView`, invalidate `['bookings']`).
  - Route `/bookings`; sidebar **"Booking"** (semua role, setelah Meja).
  - Label UI (E2E): input **"Tanggal"**; tombol **"+ Booking"**; daftar `role="list"` bernama **"Booking hari ini"** dengan item `"<HH:MM> · <meja> · <nama> · <status>[ · DP Rp … (<hasil DP>)]"`; timeline `data-testid="timeline-row-<meja>"`, blok tombol bernama `<nama>`, garis `data-testid="timeline-now"`. Dialog **"Booking baru"**/**"Ubah jadwal"**: **"Meja"** (select), **"Tanggal"**, **"Jam"**, tombol durasi **"30 mnt" "60 mnt" "90 mnt" "120 mnt" "Lainnya"** (+ **"Durasi (menit)"**), **"Pilih member"**/**"Lepas"**, **"Nama pelanggan"**, **"No. HP"**, **"Catatan"**, **"DP (Rp)"** (hanya buat), pesan `role="alert"` **"Nama pelanggan wajib diisi"**, tombol **"Simpan booking"**. Detail: tombol **"Check-in"**, **"Bayar DP"**, **"Ubah jadwal"**, **"Batalkan"**, **"Kembalikan DP"**; dialog batal **"Batalkan booking <nama>"** dengan **"Alasan"**, pilihan **"DP hangus"**/**"Kembalikan DP"**, tombol **"Batalkan booking"**; dialog **"Kembalikan DP"** dengan **"Alasan"** dan tombol **"Kembalikan"**.

- [ ] **Step 1: Tulis test yang gagal**

Di `apps/web/src/lib/format.test.ts`, tambahkan `localDateTimeToIso, localTimeInput` ke import `./format` di baris atas, lalu tambahkan di akhir file:
```ts
describe('waktu lokal outlet untuk booking', () => {
  it('tanggal + jam lokal → ISO UTC, dan sebaliknya', () => {
    expect(localDateTimeToIso('2026-10-01', '19:00', 420)).toBe('2026-10-01T12:00:00.000Z');
    expect(localDateTimeToIso('2026-10-02', '00:30', 420)).toBe('2026-10-01T17:30:00.000Z');
    expect(localTimeInput(new Date('2026-10-01T12:05:00Z'), 420)).toBe('19:05');
  });
});
```

`apps/web/src/features/bookings/timeline.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { blockPosition, nowPosition } from './timeline';

const day = new Date('2026-09-30T17:00:00.000Z'); // 1 Okt 2026 00:00 WIB

describe('timeline', () => {
  it('blok ditempatkan per menit dalam 24 jam dan dipotong di batas hari', () => {
    const a = blockPosition('2026-10-01T12:00:00.000Z', 60, day)!; // 19:00–20:00
    expect(a.leftPct).toBeCloseTo(79.17, 2);
    expect(a.widthPct).toBeCloseTo(4.17, 2);
    const late = blockPosition('2026-10-01T16:30:00.000Z', 90, day)!; // 23:30–01:00 → sampai 24:00
    expect(late.leftPct).toBeCloseTo(97.92, 2);
    expect(late.widthPct).toBeCloseTo(2.08, 2);
    const early = blockPosition('2026-09-30T16:00:00.000Z', 120, day)!; // 23:00 kemarin – 01:00
    expect(early).toEqual({ leftPct: 0, widthPct: (60 / 1440) * 100 });
    expect(blockPosition('2026-10-01T17:00:00.000Z', 60, day)).toBeNull(); // besok
  });

  it('garis sekarang hanya untuk hari yang dipilih', () => {
    expect(nowPosition(new Date('2026-10-01T03:00:00.000Z'), day)).toBeCloseTo(41.67, 2); // 10:00
    expect(nowPosition(new Date('2026-10-01T17:00:00.000Z'), day)).toBeNull();
  });
});
```

`apps/web/src/features/bookings/Timeline.test.tsx`:
```tsx
import type { BookingView } from '@funplay/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { Timeline } from './Timeline';

const bk: BookingView = {
  id: 'bk1', unitId: 'u2', unitName: 'Meja 2', customerName: 'Budi', phone: '', memberId: null, memberCode: null,
  startAt: '2026-10-01T12:00:00.000Z', durationMin: 60, note: '', status: 'BOOKED', depositAmount: 0, depositBillId: null,
  depositBillStatus: null, depositOutcome: null, depositUsedAmount: 0, saleBillId: null, cancelReason: null, createdByName: 'kasir',
  createdAt: '2026-10-01T03:00:00.000Z',
};

it('blok booking di baris mejanya; garis sekarang untuk hari ini; klik memilih booking', async () => {
  const onSelect = vi.fn();
  render(
    <Timeline
      units={[{ id: 'u1', name: 'Meja 1' }, { id: 'u2', name: 'Meja 2' }]}
      bookings={[bk]}
      dayStart={new Date('2026-09-30T17:00:00.000Z')}
      now={new Date('2026-10-01T03:00:00.000Z')}
      offset={420}
      onSelect={onSelect}
    />,
  );
  const block = within(screen.getByTestId('timeline-row-Meja 2')).getByRole('button', { name: 'Budi' });
  expect(within(screen.getByTestId('timeline-row-Meja 1')).queryByRole('button')).toBeNull();
  expect(screen.getByTestId('timeline-now')).toBeInTheDocument();
  await userEvent.click(block);
  expect(onSelect).toHaveBeenCalledWith('bk1');
});
```

`apps/web/src/features/bookings/BookingDialog.test.tsx`:
```tsx
import { DEFAULT_BOOKING_SETTINGS, DEFAULT_TRANSACTION_SETTINGS, type UnitView } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBoard } from '../../stores/board';
import { useCheckout } from '../../stores/checkout';
import { BookingDialog } from './BookingDialog';

const unit = (id: string, name: string): UnitView => ({
  id, name, sortOrder: 1, unitTypeId: 'reg', unitTypeName: 'Reguler', unitTypeColor: '#7C3AED', area: '',
  deviceId: null, relayChannel: null, state: 'ACTIVE', lightOverride: null, light: null, deviceOnline: null, session: null, booking: null,
});

beforeEach(() => {
  useCheckout.setState({ billId: null });
  useBoard.setState({
    ...useBoard.getInitialState(),
    settings: {
      outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5,
      pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS, ...DEFAULT_BOOKING_SETTINGS,
    },
    units: { u1: unit('u1', 'Meja 1'), u2: unit('u2', 'Meja 2') },
    order: ['u1', 'u2'],
  });
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/bookings' && init?.method === 'POST') return json({ booking: { id: 'bk1' }, depositBillId: 'dp1' });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BookingDialog date="2026-10-01" onClose={onClose} />
    </QueryClientProvider>,
  );
  return { fetchMock, onClose };
}

it('nama pelanggan wajib bila tanpa member', async () => {
  const { fetchMock } = setup();
  await userEvent.selectOptions(screen.getByLabelText('Meja'), 'u2');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan booking' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Nama pelanggan wajib diisi');
  expect(fetchMock.mock.calls.some(([u]) => u === '/api/bookings')).toBe(false);
});

it('simpan dengan DP lalu Checkout bill DP terbuka', async () => {
  const { fetchMock, onClose } = setup();
  await userEvent.selectOptions(screen.getByLabelText('Meja'), 'u2');
  fireEvent.change(screen.getByLabelText('Jam'), { target: { value: '19:00' } });
  await userEvent.click(screen.getByRole('button', { name: '60 mnt' }));
  await userEvent.type(screen.getByLabelText('Nama pelanggan'), 'Budi');
  await userEvent.type(screen.getByLabelText('No. HP'), '0812');
  await userEvent.type(screen.getByLabelText('DP (Rp)'), '50000');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan booking' }));
  await waitFor(() => expect(useCheckout.getState().billId).toBe('dp1'));
  const call = fetchMock.mock.calls.find(([u, i]) => u === '/api/bookings' && i?.method === 'POST');
  expect(JSON.parse(String(call![1]!.body))).toEqual({
    unitId: 'u2', startAt: '2026-10-01T12:00:00.000Z', durationMin: 60, customerName: 'Budi', phone: '0812', note: '', memberId: null, depositAmount: 50000,
  });
  expect(onClose).toHaveBeenCalled();
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/web test -- format timeline Timeline BookingDialog`
Expected: FAIL — fungsi & komponen belum ada.

- [ ] **Step 3: Helper waktu, timeline, hook**

Tambahkan di akhir `apps/web/src/lib/format.ts`:
```ts
/** Jam lokal outlet "HH:MM" untuk <input type="time">. */
export function localTimeInput(at: Date, utcOffsetMin: number): string {
  const l = new Date(at.getTime() + utcOffsetMin * 60_000);
  return `${pad2(l.getUTCHours())}:${pad2(l.getUTCMinutes())}`;
}

/** Tanggal "YYYY-MM-DD" + jam "HH:MM" lokal outlet → ISO UTC. */
export function localDateTimeToIso(date: string, time: string, utcOffsetMin: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - utcOffsetMin * 60_000).toISOString();
}
```

`apps/web/src/features/bookings/timeline.ts`:
```ts
const DAY_MIN = 1440;
const MS_PER_MIN = 60_000;

/** Posisi blok booking (persen lebar timeline 24 jam), dipotong di batas hari; null bila di luar hari. */
export function blockPosition(startAt: string, durationMin: number, dayStart: Date): { leftPct: number; widthPct: number } | null {
  const startMin = (Date.parse(startAt) - dayStart.getTime()) / MS_PER_MIN;
  const endMin = Math.min(startMin + durationMin, DAY_MIN);
  const from = Math.max(0, startMin);
  if (endMin <= 0 || from >= DAY_MIN) return null;
  return { leftPct: (from / DAY_MIN) * 100, widthPct: ((endMin - from) / DAY_MIN) * 100 };
}

/** Posisi garis "sekarang" (persen), atau null bila `now` di luar hari yang ditampilkan. */
export function nowPosition(now: Date, dayStart: Date): number | null {
  const min = (now.getTime() - dayStart.getTime()) / MS_PER_MIN;
  return min >= 0 && min < DAY_MIN ? (min / DAY_MIN) * 100 : null;
}
```

`apps/web/src/hooks/useBookings.ts`:
```ts
import type { BookingView } from '@funplay/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { showError } from '../stores/toast';

export function useBookings(range: { from: string; to: string }) {
  return useQuery({ queryKey: ['bookings', range], queryFn: () => api<BookingView[]>('GET', `/bookings?${new URLSearchParams(range)}`) });
}

/** Aksi booking (batal, kembalikan DP): POST → BookingView, lalu muat ulang daftar. */
export function useBookingAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body: Record<string, unknown> }) => api<BookingView>('POST', path, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bookings'] }),
    onError: showError,
  });
}
```

`apps/web/src/features/bookings/Timeline.tsx`:
```tsx
import { BOOKING_STATUS_LABEL, localHHMM, type BookingStatus, type BookingView } from '@funplay/shared';
import { useEffect, useRef } from 'react';
import { cn } from '../../lib/cn';
import { blockPosition, nowPosition } from './timeline';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const BLOCK_STYLE: Record<BookingStatus, string> = {
  BOOKED: 'bg-cyan-200 text-cyan-950',
  CHECKED_IN: 'bg-emerald-200 text-emerald-950',
  NO_SHOW: 'bg-rose-200 text-rose-950',
  CANCELLED: 'bg-gray-200 text-gray-500 line-through',
};

export function Timeline(props: {
  units: { id: string; name: string }[];
  bookings: BookingView[];
  dayStart: Date;
  now: Date;
  offset: number;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const nowPct = nowPosition(props.now, props.dayStart);
  const dayKey = props.dayStart.getTime();
  useEffect(() => {
    // Gulir otomatis ke jam sekarang hanya saat tanggal berganti (bukan setiap detik).
    const el = ref.current;
    const pct = nowPosition(new Date(), new Date(dayKey));
    if (el && pct !== null) el.scrollLeft = Math.max(0, (pct / 100) * el.scrollWidth - el.clientWidth / 2);
  }, [dayKey]);

  return (
    <div ref={ref} className="overflow-x-auto rounded-2xl bg-surface shadow-sm">
      <div className="min-w-[1560px]">
        <div className="grid grid-cols-[120px_1fr] border-b border-line text-xs text-muted">
          <div />
          <div className="relative h-6">
            {HOURS.map((h) => (
              <span key={h} className="absolute top-1 -translate-x-1/2" style={{ left: `${(h / 24) * 100}%` }}>{String(h).padStart(2, '0')}</span>
            ))}
            {nowPct !== null && <div data-testid="timeline-now" className="absolute inset-y-0 w-0.5 bg-rose-500" style={{ left: `${nowPct}%` }} />}
          </div>
        </div>
        {props.units.map((u) => (
          <div key={u.id} data-testid={`timeline-row-${u.name}`} className="grid grid-cols-[120px_1fr] border-t border-line">
            <div className="px-3 py-3 text-sm font-semibold">{u.name}</div>
            <div className="relative h-12">
              {props.bookings
                .filter((b) => b.unitId === u.id)
                .map((b) => {
                  const pos = blockPosition(b.startAt, b.durationMin, props.dayStart);
                  if (!pos) return null;
                  const end = new Date(Date.parse(b.startAt) + b.durationMin * 60_000);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      title={`${b.customerName} · ${localHHMM(new Date(b.startAt), props.offset)}–${localHHMM(end, props.offset)} · ${BOOKING_STATUS_LABEL[b.status]}`}
                      onClick={() => props.onSelect(b.id)}
                      style={{ left: `${pos.leftPct}%`, width: `${pos.widthPct}%` }}
                      className={cn('absolute inset-y-1 overflow-hidden rounded-lg px-1 text-left text-xs font-semibold', BLOCK_STYLE[b.status])}
                    >
                      {b.customerName}
                    </button>
                  );
                })}
              {nowPct !== null && <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-rose-500/60" style={{ left: `${nowPct}%` }} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Dialog booking**

`apps/web/src/features/bookings/BookingDialog.tsx`:
```tsx
import { memberLabel, type BookingView, type CreateBookingResult, type MemberDto } from '@funplay/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { localDateInput, localDateTimeToIso, localTimeInput, parseRupiah } from '../../lib/format';
import { useBoard } from '../../stores/board';
import { useCheckout } from '../../stores/checkout';
import { showError, toast } from '../../stores/toast';
import { MemberPickerDialog } from '../members/MemberPicker';

const DURATIONS = [30, 60, 90, 120];
const SLOT_MS = 30 * 60_000;
const chip = (on: boolean) => cn('rounded-full px-3 py-1.5 text-sm font-semibold', on ? 'bg-primary text-white' : 'bg-primary-soft text-primary-ink');

/** Buat booking (dengan DP opsional) atau ubah jadwal booking BOOKED. */
export function BookingDialog({ booking, date, onClose }: { booking?: BookingView; date: string; onClose: () => void }) {
  const offset = useBoard((s) => s.settings?.utcOffsetMin ?? 420);
  const units = useBoard(useShallow((s) => s.order.map((id) => s.units[id]!)));
  const edit = !!booking;
  const initialDuration = booking?.durationMin ?? 60;
  const [unitId, setUnitId] = useState(booking?.unitId ?? '');
  const [day, setDay] = useState(booking ? localDateInput(new Date(booking.startAt), offset) : date);
  const [time, setTime] = useState(() => localTimeInput(booking ? new Date(booking.startAt) : new Date(Math.ceil(Date.now() / SLOT_MS) * SLOT_MS), offset));
  const [duration, setDuration] = useState(initialDuration);
  const [custom, setCustom] = useState(!DURATIONS.includes(initialDuration));
  const [customMin, setCustomMin] = useState(String(initialDuration));
  const [member, setMember] = useState<{ id: string; label: string } | null>(
    booking?.memberId ? { id: booking.memberId, label: booking.memberCode ?? booking.customerName } : null,
  );
  const [picking, setPicking] = useState(false);
  const [customerName, setCustomerName] = useState(booking?.customerName ?? '');
  const [phone, setPhone] = useState(booking?.phone ?? '');
  const [note, setNote] = useState(booking?.note ?? '');
  const [deposit, setDeposit] = useState('');
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>): Promise<string | null> => {
      if (booking) {
        await api<BookingView>('PATCH', `/bookings/${booking.id}`, body);
        return null;
      }
      return (await api<CreateBookingResult>('POST', '/bookings', body)).depositBillId;
    },
    onSuccess: (depositBillId) => {
      void qc.invalidateQueries({ queryKey: ['bookings'] });
      toast.success('Booking disimpan');
      onClose();
      if (depositBillId) useCheckout.getState().open(depositBillId); // DP > 0 → langsung bayar
    },
    onError: showError,
  });

  const pickMember = (m: MemberDto) => {
    setMember({ id: m.id, label: memberLabel(m) });
    if (!customerName.trim()) setCustomerName(m.name);
    if (!phone.trim()) setPhone(m.phone);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const minutes = custom ? Number(customMin) : duration;
    if (!unitId) return setError('Pilih meja');
    if (!member && !customerName.trim()) return setError('Nama pelanggan wajib diisi');
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 720) return setError('Durasi 15–720 menit');
    setError(null);
    save.mutate({
      unitId,
      startAt: localDateTimeToIso(day, time, offset),
      durationMin: minutes,
      customerName: customerName.trim(),
      phone: phone.trim(),
      note: note.trim(),
      memberId: member?.id ?? null,
      ...(edit ? {} : { depositAmount: parseRupiah(deposit) }),
    });
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={edit ? 'Ubah jadwal' : 'Booking baru'} width="max-w-lg">
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <div className="flex flex-col gap-1 text-sm font-semibold">
          <label htmlFor="bk-unit">Meja</label>
          <select id="bk-unit" className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">— pilih meja —</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-semibold">
            Tanggal
            <Input className="mt-1" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
          </label>
          <label className="text-sm font-semibold">
            Jam
            <Input className="mt-1" type="time" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} />
          </label>
        </div>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-semibold">Durasi</legend>
          <div className="flex flex-wrap gap-2">
            {DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={!custom && duration === d}
                className={chip(!custom && duration === d)}
                onClick={() => {
                  setCustom(false);
                  setDuration(d);
                }}
              >
                {`${d} mnt`}
              </button>
            ))}
            <button type="button" aria-pressed={custom} className={chip(custom)} onClick={() => setCustom(true)}>Lainnya</button>
          </div>
          {custom && (
            <label className="font-semibold">
              Durasi (menit)
              <Input className="mt-1" type="number" min={15} max={720} value={customMin} onChange={(e) => setCustomMin(e.target.value)} />
            </label>
          )}
        </fieldset>
        <div className="flex items-center justify-between rounded-xl bg-bg p-2 text-sm">
          <span className="font-semibold">{member ? `Member: ${member.label}` : 'Tanpa member'}</span>
          {member ? (
            <Button size="sm" variant="ghost" onClick={() => setMember(null)}>Lepas</Button>
          ) : (
            <Button size="sm" variant="soft" onClick={() => setPicking(true)}>Pilih member</Button>
          )}
        </div>
        <label className="text-sm font-semibold">
          Nama pelanggan
          <Input className="mt-1" maxLength={60} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
        </label>
        <label className="text-sm font-semibold">
          No. HP
          <Input className="mt-1" inputMode="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="text-sm font-semibold">
          Catatan
          <Input className="mt-1" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {!edit && (
          <>
            <label className="text-sm font-semibold">
              DP (Rp)
              <Input className="mt-1" inputMode="numeric" value={deposit} onChange={(e) => setDeposit(e.target.value.replace(/\D/g, ''))} />
            </label>
            <p className="text-xs text-muted">DP lebih dari 0 langsung dibayar lewat Checkout setelah disimpan.</p>
          </>
        )}
        {error && <p role="alert" className="text-sm font-semibold text-rose-600">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button type="submit" disabled={save.isPending}>Simpan booking</Button>
        </div>
      </form>
      {picking && <MemberPickerDialog onPick={pickMember} onClose={() => setPicking(false)} />}
    </Modal>
  );
}
```

- [ ] **Step 5: Aksi & detail booking**

`apps/web/src/features/bookings/BookingActions.tsx`:
```tsx
import type { BookingView } from '@funplay/shared';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { useBookingAction } from '../../hooks/useBookings';
import { formatRupiah } from '../../lib/format';
import { approvalPin } from '../../stores/pin';
import { toast } from '../../stores/toast';
import { useMe } from '../auth/auth';

/** Batalkan booking; DP yang sudah dibayar: hangus atau dikembalikan (kasir butuh PIN supervisor). */
export function CancelBookingDialog({ booking, onClose }: { booking: BookingView; onClose: () => void }) {
  const me = useMe().data;
  const [reason, setReason] = useState('');
  const [deposit, setDeposit] = useState<'FORFEIT' | 'REFUND'>('FORFEIT');
  const action = useBookingAction();
  const dpPaid = booking.depositBillStatus === 'PAID' && booking.depositOutcome === null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!me) return;
    let pin: string | undefined;
    if (dpPaid) {
      const p = await approvalPin(me.role, 'PIN supervisor untuk membatalkan booking ber-DP');
      if (p === null) return;
      pin = p;
    }
    try {
      await action.mutateAsync({
        path: `/bookings/${booking.id}/cancel`,
        body: { reason: reason.trim(), ...(dpPaid ? { deposit } : {}), ...(pin ? { approvalPin: pin } : {}) },
      });
    } catch {
      return; // sudah ditampilkan oleh hook
    }
    toast.success('Booking dibatalkan');
    onClose();
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Batalkan booking ${booking.customerName}`}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="text-sm font-semibold">
          Alasan
          <Input className="mt-1" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {dpPaid && (
          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="font-semibold">{`DP ${formatRupiah(booking.depositAmount)}`}</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="deposit" checked={deposit === 'FORFEIT'} onChange={() => setDeposit('FORFEIT')} /> DP hangus
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="deposit" checked={deposit === 'REFUND'} onChange={() => setDeposit('REFUND')} /> Kembalikan DP
            </label>
          </fieldset>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Kembali</Button>
          <Button type="submit" variant="danger" disabled={!reason.trim() || action.isPending}>Batalkan booking</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Kembalikan DP yang hangus (no-show/batal) atau belum dipakai setelah check-in. Kasir butuh PIN. */
export function RefundDepositDialog({ booking, onClose }: { booking: BookingView; onClose: () => void }) {
  const me = useMe().data;
  const [reason, setReason] = useState('');
  const action = useBookingAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!me) return;
    const pin = await approvalPin(me.role, 'PIN supervisor untuk mengembalikan DP');
    if (pin === null) return;
    try {
      await action.mutateAsync({ path: `/bookings/${booking.id}/refund-deposit`, body: { reason: reason.trim(), ...(pin ? { approvalPin: pin } : {}) } });
    } catch {
      return;
    }
    toast.success(`DP ${formatRupiah(booking.depositAmount)} dikembalikan`);
    onClose();
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Kembalikan DP">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-sm">{`DP ${formatRupiah(booking.depositAmount)} dikembalikan tunai dan tercatat sebagai void di shift berjalan.`}</p>
        <label className="text-sm font-semibold">
          Alasan
          <Input className="mt-1" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button type="submit" variant="warning" disabled={!reason.trim() || action.isPending}>Kembalikan</Button>
        </div>
      </form>
    </Modal>
  );
}
```

`apps/web/src/features/bookings/BookingDetail.tsx`:
```tsx
import { BOOKING_STATUS_LABEL, DEPOSIT_OUTCOME_LABEL, formatReceiptDate, isOnHold, localHHMM, type BookingView } from '@funplay/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { formatMinutes, formatRupiah, localDateInput } from '../../lib/format';
import { useBoard } from '../../stores/board';
import { useCheckout } from '../../stores/checkout';
import { CancelBookingDialog, RefundDepositDialog } from './BookingActions';
import { BookingDialog } from './BookingDialog';
import { CheckInDialog } from './CheckInDialog';

function depositText(b: BookingView): string {
  if (b.depositAmount === 0) return 'Tanpa DP';
  const state = b.depositOutcome
    ? DEPOSIT_OUTCOME_LABEL[b.depositOutcome]
    : b.depositBillStatus === 'PAID' ? 'sudah dibayar' : b.depositBillStatus === 'OPEN' ? 'belum dibayar' : 'tidak dibayar';
  return `${formatRupiah(b.depositAmount)} · ${state}`;
}

export function BookingDetail({ booking: b, now }: { booking: BookingView; now: Date }) {
  const settings = useBoard((s) => s.settings);
  const offset = settings?.utcOffsetMin ?? 420;
  const holdMin = settings?.bookingHoldMin ?? 15;
  const [dialog, setDialog] = useState<null | 'checkin' | 'edit' | 'cancel' | 'refund'>(null);
  const start = new Date(b.startAt);
  const end = new Date(start.getTime() + b.durationMin * 60_000);
  const dpPaid = b.depositBillStatus === 'PAID';
  const refundable =
    dpPaid &&
    (((b.status === 'NO_SHOW' || b.status === 'CANCELLED') && b.depositOutcome === 'FORFEITED') || (b.status === 'CHECKED_IN' && b.depositOutcome === null));
  const depositBillId = b.status === 'BOOKED' && b.depositBillStatus === 'OPEN' ? b.depositBillId : null;
  const close = () => setDialog(null);

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-sm">
      <header>
        <h2 className="text-xl font-extrabold">{b.customerName}</h2>
        <p className="text-sm text-muted">{BOOKING_STATUS_LABEL[b.status]}</p>
      </header>
      <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-sm">
        <dt className="text-muted">Meja</dt><dd>{b.unitName}</dd>
        <dt className="text-muted">Jadwal</dt><dd>{`${formatReceiptDate(start, offset)}–${localHHMM(end, offset)}`}</dd>
        <dt className="text-muted">Durasi</dt><dd>{formatMinutes(b.durationMin)}</dd>
        <dt className="text-muted">No. HP</dt><dd>{b.phone || '—'}</dd>
        {b.memberCode && (<><dt className="text-muted">Member</dt><dd>{b.memberCode}</dd></>)}
        {b.note && (<><dt className="text-muted">Catatan</dt><dd>{b.note}</dd></>)}
        <dt className="text-muted">DP</dt><dd>{depositText(b)}</dd>
        {b.cancelReason && (<><dt className="text-muted">Alasan batal</dt><dd>{b.cancelReason}</dd></>)}
      </dl>
      <div className="flex flex-wrap gap-2">
        {b.status === 'BOOKED' && isOnHold(b, now, holdMin) && <Button onClick={() => setDialog('checkin')}>Check-in</Button>}
        {depositBillId && <Button variant="soft" onClick={() => useCheckout.getState().open(depositBillId)}>Bayar DP</Button>}
        {b.status === 'BOOKED' && <Button variant="soft" onClick={() => setDialog('edit')}>Ubah jadwal</Button>}
        {b.status === 'BOOKED' && <Button variant="danger" onClick={() => setDialog('cancel')}>Batalkan</Button>}
        {refundable && <Button variant="warning" onClick={() => setDialog('refund')}>Kembalikan DP</Button>}
      </div>
      {dialog === 'checkin' && <CheckInDialog booking={{ id: b.id, customerName: b.customerName, unitId: b.unitId }} onClose={close} />}
      {dialog === 'edit' && <BookingDialog booking={b} date={localDateInput(start, offset)} onClose={close} />}
      {dialog === 'cancel' && <CancelBookingDialog booking={b} onClose={close} />}
      {dialog === 'refund' && <RefundDepositDialog booking={b} onClose={close} />}
    </section>
  );
}
```

- [ ] **Step 6: Halaman Booking, sidebar, route**

`apps/web/src/features/bookings/BookingsPage.tsx`:
```tsx
import { BOOKING_STATUS_LABEL, DEPOSIT_OUTCOME_LABEL, localHHMM, type BookingView } from '@funplay/shared';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useBookings } from '../../hooks/useBookings';
import { useNow } from '../../hooks/useNow';
import { cn } from '../../lib/cn';
import { formatRupiah, localDateInput, localDayRange } from '../../lib/format';
import { useBoard } from '../../stores/board';
import { BookingDetail } from './BookingDetail';
import { BookingDialog } from './BookingDialog';
import { Timeline } from './Timeline';

function depositSuffix(b: BookingView): string {
  if (b.depositAmount === 0) return '';
  const state = b.depositOutcome ? ` (${DEPOSIT_OUTCOME_LABEL[b.depositOutcome]})` : b.depositBillStatus === 'OPEN' ? ' (belum dibayar)' : '';
  return ` · DP ${formatRupiah(b.depositAmount)}${state}`;
}

export function BookingsPage() {
  const offset = useBoard((s) => s.settings?.utcOffsetMin ?? 420);
  const units = useBoard(useShallow((s) => s.order.map((id) => s.units[id]!)));
  const now = useNow();
  const [date, setDate] = useState(() => localDateInput(new Date(), offset));
  const range = localDayRange(date, offset);
  const bookings = useBookings(range);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const list = bookings.data ?? [];
  const current = list.find((b) => b.id === selected) ?? null;

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[1fr_380px]">
      <section className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-semibold">
            Tanggal
            <Input className="mt-1" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          <Button className="ml-auto" onClick={() => setCreating(true)}>+ Booking</Button>
        </div>
        <Timeline units={units} bookings={list} dayStart={new Date(range.from)} now={now} offset={offset} onSelect={setSelected} />
        <ul aria-label="Booking hari ini" className="flex flex-col gap-1 rounded-2xl bg-surface p-2 shadow-sm">
          {list.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => setSelected(b.id)}
                className={cn('w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-primary-soft/40', selected === b.id && 'bg-primary-soft')}
              >
                {`${localHHMM(new Date(b.startAt), offset)} · ${b.unitName} · ${b.customerName} · ${BOOKING_STATUS_LABEL[b.status]}${depositSuffix(b)}`}
              </button>
            </li>
          ))}
          {bookings.data?.length === 0 && <li className="p-2 text-sm text-muted">Belum ada booking.</li>}
        </ul>
      </section>
      <aside className="min-h-0 overflow-y-auto">
        {current ? <BookingDetail booking={current} now={now} /> : <p className="text-sm text-muted">Pilih booking untuk melihat detail.</p>}
      </aside>
      {creating && <BookingDialog date={date} onClose={() => setCreating(false)} />}
    </div>
  );
}
```

`apps/web/src/features/layout/AppShell.tsx` — tambah `CalendarDays` ke import `lucide-react` dan sisipkan item setelah Meja (urutan akhir: Meja · Booking · Transaksi · Member · Shift · Produk · Pengaturan):
```ts
    { to: '/bookings', label: 'Booking', icon: CalendarDays, show: true },
```

`apps/web/src/App.tsx` — tambah `import { BookingsPage } from './features/bookings/BookingsPage';` dan route setelah `<Route index …/>`:
```tsx
          <Route path="bookings" element={<BookingsPage />} />
```

- [ ] **Step 7: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/web test && pnpm --filter @funplay/web typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): bookings page with 24h timeline, booking dialog, detail actions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 15: Seed level "Reguler", E2E booking & member, README

**Files:**
- Modify: `apps/server/src/seed-data.ts`, `apps/server/test/seed.test.ts`
- Create: `e2e/booking-member.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: semua task sebelumnya; label UI dari Task 11–14 (dipakai apa adanya di bawah); helper E2E `login`, `ensureShift` (M2); produk seed **"Es Teh Manis" (8.000)**, **"Kopi Susu" (15.000)**; user **supervisor/super123**, **kasir/kasir123**; `utcOffsetMin` seed = 420.
- Produces: level member seed **"Reguler" 0/0**; spec E2E `e2e/booking-member.spec.ts` (Meja 5 untuk member, Meja 4 untuk booking — tidak dipakai spec M1/M2).

- [ ] **Step 1: Seed level (test dulu)**

Di `apps/server/test/seed.test.ts`, tambahkan di akhir test `'seed menyediakan data yang dipakai E2E'`:
```ts
  expect(await prisma.memberLevel.findUnique({ where: { name: 'Reguler' } })).toMatchObject({ timeDiscountPct: 0, fnbDiscountPct: 0, active: true });
```

Run: `pnpm --filter @funplay/server test -- seed`
Expected: FAIL — level belum ada.

Di `apps/server/src/seed-data.ts`, di dalam transaksi `seedDemo` tepat sebelum `return true;`:
```ts
    await tx.memberLevel.create({ data: { name: 'Reguler', timeDiscountPct: 0, fnbDiscountPct: 0, sortOrder: 0 } });
```

Run: `pnpm --filter @funplay/server test -- seed`
Expected: PASS.

- [ ] **Step 2: E2E booking & member**

`e2e/booking-member.spec.ts`:
```ts
import { expect, test, type Locator } from '@playwright/test';
import { ensureShift, login } from './helpers';

const rupiah = async (l: Locator) => Number((await l.innerText()).replace(/\D/g, ''));

test('member Gold: diskon member otomatis saat Stop & Bayar', async ({ page }) => {
  await login(page, 'supervisor', 'super123');
  await ensureShift(page);

  await page.getByRole('link', { name: 'Member', exact: true }).click();
  await page.getByRole('button', { name: 'Level', exact: true }).click();
  await page.getByRole('button', { name: 'Tambah' }).click();
  const lv = page.getByRole('dialog', { name: 'Tambah Level' });
  await lv.getByLabel('Nama').fill('Gold');
  await lv.getByLabel('Diskon billing (%)').fill('10');
  await lv.getByLabel('Diskon FnB (%)').fill('0');
  await lv.getByRole('button', { name: 'Simpan' }).click();
  await expect(lv).toBeHidden();

  await page.getByRole('button', { name: 'Member', exact: true }).click();
  await page.getByRole('button', { name: '+ Member' }).click();
  const md = page.getByRole('dialog', { name: 'Tambah member' });
  await md.getByLabel('Nama').fill('Sinta');
  await md.getByLabel('No. HP').fill('081234567890');
  await md.getByLabel('Level').selectOption({ label: 'Gold' });
  await md.getByRole('button', { name: 'Simpan' }).click();
  await expect(md).toBeHidden();
  await expect(page.getByRole('row', { name: /M0001.*Sinta.*Gold/ })).toBeVisible();

  await page.getByRole('link', { name: 'Meja', exact: true }).click();
  const card = page.getByTestId('unit-card-Meja 5');
  await card.click();
  await page.getByRole('button', { name: 'Pilih member' }).click();
  const picker = page.getByRole('dialog', { name: 'Pilih member' });
  await picker.getByLabel('Cari member').fill('Sinta');
  await picker.getByRole('button', { name: /Sinta/ }).click();
  await expect(page.getByText('Member: Sinta (Gold)')).toBeVisible();
  await page.getByRole('button', { name: 'Open billing' }).click();
  await page.getByRole('button', { name: 'Mulai', exact: true }).click();
  await expect(card).toHaveAttribute('data-status', 'RUNNING');

  await page.getByRole('button', { name: '+ Pesan' }).click();
  const order = page.getByRole('dialog', { name: /Pesan · Meja 5/ });
  await order.getByRole('button', { name: /Es Teh Manis/ }).click();
  await order.getByRole('button', { name: 'Tambahkan' }).click();
  await expect(order).toBeHidden();

  await page.getByRole('button', { name: 'Stop & Bayar' }).click();
  await page.getByRole('button', { name: 'Ya, stop & bayar' }).click();
  const pay = page.getByRole('dialog', { name: /Bayar · Meja 5/ });
  await expect(pay.getByText('Member: Sinta (Gold)')).toBeVisible();
  await expect(pay.getByTestId('checkout-member-discount')).toBeVisible();
  const subtotal = await rupiah(pay.getByTestId('checkout-subtotal'));
  const discount = await rupiah(pay.getByTestId('checkout-member-discount'));
  const total = await rupiah(pay.getByTestId('checkout-total'));
  // diskon billing 10% hanya atas biaya waktu (subtotal − Es Teh 8.000); FnB 0%
  expect(discount).toBe(Math.round(((subtotal - 8000) * 10) / 100));
  expect(total).toBe(subtotal - discount);
  await pay.getByRole('button', { name: 'Uang pas' }).click();
  await pay.getByRole('button', { name: 'Bayar', exact: true }).click();
  await expect(pay).toBeHidden();
  await expect(card).toHaveAttribute('data-status', 'IDLE');
});

test('booking dengan DP tunai → Booked → Check-in → DP terpakai saat bayar', async ({ page }) => {
  await login(page, 'kasir', 'kasir123');
  await ensureShift(page);

  await page.getByRole('link', { name: 'Booking', exact: true }).click();
  await page.getByRole('button', { name: '+ Booking' }).click();
  const dlg = page.getByRole('dialog', { name: 'Booking baru' });
  // jadwal = sekarang + 10 menit, jam lokal outlet (seed: UTC+7)
  const local = new Date(Date.now() + 10 * 60_000 + 420 * 60_000).toISOString();
  await dlg.getByLabel('Meja').selectOption({ label: 'Meja 4' });
  await dlg.getByLabel('Tanggal').fill(local.slice(0, 10));
  await dlg.getByLabel('Jam').fill(local.slice(11, 16));
  await dlg.getByRole('button', { name: '60 mnt' }).click();
  await dlg.getByLabel('Nama pelanggan').fill('Budi');
  await dlg.getByLabel('No. HP').fill('0812000111');
  await dlg.getByLabel('DP (Rp)').fill('50000');
  await dlg.getByRole('button', { name: 'Simpan booking' }).click();

  const dp = page.getByRole('dialog', { name: /Bayar · DP · Budi · Meja 4/ });
  await expect(dp.getByTestId('checkout-total')).toHaveText('Rp 50.000');
  await dp.getByRole('button', { name: 'Uang pas' }).click();
  await dp.getByRole('button', { name: 'Bayar', exact: true }).click();
  await expect(dp).toBeHidden();

  await page.getByRole('link', { name: 'Meja', exact: true }).click();
  const card = page.getByTestId('unit-card-Meja 4');
  await expect(card).toHaveAttribute('data-booked', 'true');
  await expect(card).toContainText('Booked · Budi');
  await expect(card).toContainText('💰');
  await card.click();
  await page.getByRole('button', { name: 'Check-in', exact: true }).click();
  const ci = page.getByRole('dialog', { name: 'Check-in · Budi' });
  await ci.getByRole('button', { name: 'Open billing' }).click();
  await ci.getByRole('button', { name: 'Mulai', exact: true }).click();
  await expect(ci).toBeHidden();
  await expect(card).toHaveAttribute('data-status', 'RUNNING');

  await page.getByRole('button', { name: '+ Pesan' }).click();
  const order = page.getByRole('dialog', { name: /Pesan · Meja 4/ });
  await order.getByRole('button', { name: /Kopi Susu/ }).click();
  await order.getByRole('button', { name: 'Tambahkan' }).click();
  await expect(order).toBeHidden();

  await page.getByRole('button', { name: 'Stop & Bayar' }).click();
  await page.getByRole('button', { name: 'Ya, stop & bayar' }).click();
  const pay = page.getByRole('dialog', { name: /Bayar · Meja 4/ });
  await expect(pay.getByTestId('checkout-deposit')).toHaveText('Rp 50.000');
  const total = await rupiah(pay.getByTestId('checkout-total'));
  expect(total).toBeGreaterThan(50000); // waktu minimum 60 menit + Kopi Susu 15.000
  await expect(pay.getByTestId('checkout-remaining')).toHaveText(`Rp ${(total - 50000).toLocaleString('id-ID')}`);
  await pay.getByRole('button', { name: 'Tunai' }).click();
  await pay.getByRole('button', { name: 'Uang pas' }).click();
  await pay.getByRole('button', { name: 'Bayar', exact: true }).click();
  await expect(pay).toBeHidden();

  await page.getByRole('link', { name: 'Booking', exact: true }).click();
  const item = page.getByRole('list', { name: 'Booking hari ini' }).getByRole('listitem').filter({ hasText: 'Budi' });
  await expect(item).toContainText('Check-in');
  await expect(item).toContainText('DP terpakai');
});
```
Catatan: tautan sidebar memakai atribut `title` sebagai nama aksesibel ("Meja", "Booking", "Member"); `exact: true` membedakan tab **"Member"** dari tombol **"+ Member"**. `toLocaleString('id-ID')` menghasilkan pemisah ribuan titik yang sama dengan `formatRupiah`. Jadwal "sekarang + 10 menit" sudah berada di jendela hold 15 menit sehingga kartu langsung Booked dan check-in diizinkan.

- [ ] **Step 3: README**

Di `README.md`, tambahkan setelah bagian "Fitur transaksi (M2)":
````markdown
## Fitur booking & member (M3)
- **Member:** menu **Member** — cari kode/nama/HP. Supervisor/Owner menambah member (kode otomatis `M0001`…, no. HP unik di antara member aktif), menonaktifkan member, dan mengatur **Level** (diskon billing % dan FnB %). Seed menyediakan level "Reguler" 0/0.
- **Member di bill:** pilih member saat **Mulai**, saat check-in (member booking), atau di dialog **Bayar** (**Pilih member**/**Lepas**). Persen diskon level disalin ke bill saat dipasang; "Diskon member" otomatis pada baris tanpa diskon item dan tidak butuh PIN.
- **Booking:** menu **Booking** — timeline 24 jam per meja dan daftar hari itu. **+ Booking** (meja, tanggal, jam, durasi, member atau nama + HP, catatan, DP). DP > 0 langsung dibayar lewat Checkout (tanda terima "TANDA TERIMA DP"); bila ditunda, tagihan DP muncul di strip "Belum dibayar".
- **Hold & check-in:** meja tampil **Booked** (cyan) mulai 15 menit sebelum jadwal. Panel meja: **Check-in** atau **Mulai lain** (walk-in, minta konfirmasi). Saat **Stop & Bayar**, "DP booking" terisi otomatis; kelebihan DP dikembalikan tunai ("Kembali DP").
- **No-show & batal:** booking yang belum check-in 15 menit setelah jadwal otomatis no-show (DP hangus). **Batalkan** (alasan wajib; DP hangus atau dikembalikan) dan **Kembalikan DP** butuh PIN supervisor untuk kasir. Menit hold & no-show diatur di Pengaturan → *Booking*.
- **Rekap shift:** "DP booking" adalah non-kas; kas seharusnya dikurangi kembalian DP dan DP yang dikembalikan saat void.
````

- [ ] **Step 4: Verifikasi penuh**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: semua PASS — 2 spec M1 (`kasir.spec.ts`), 2 spec M2 (`transaksi.spec.ts`), 2 spec M3 (`booking-member.spec.ts`). Tidak ada proses tersisa di port 3100.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/seed-data.ts apps/server/test/seed.test.ts e2e/booking-member.spec.ts README.md
git commit -m "feat: member level seed, booking & member E2E and README

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Cakupan spec oleh plan ini (M3)

| Spec M3 | Task |
|---|---|
| §2 DP = bill DEPOSIT terpisah, dipakai sebagai metode `DEPOSIT` | 1, 2, 6, 8, 12 |
| §2 DP melebihi tagihan → `amount = min`, `change` tunai, kas berkurang | 2, 8, 10, 12 |
| §2 tanpa saldo member | (tidak direncanakan — sengaja) |
| §2 diskon level di-snapshot, tidak dihitung untuk PIN | 2, 5, 12 |
| §2 member di bill (Mulai / check-in / Checkout) | 5, 7, 12, 13 |
| §2 bentrok di bawah kunci Unit (`BOOKING_CONFLICT`) | 6 |
| §2 `BOOKING_HOLD` + `ignoreBooking` diaudit tanpa PIN | 7, 13 |
| §2 no-show → DP hangus; supervisor kembalikan DP | 9, 14 |
| §2 pengembalian DP lewat void bill DEPOSIT | 8, 9 |
| §3.1-1 level member (+ seed "Reguler" 0/0) | 1, 4, 11, 15 |
| §3.1-2 member: kode otomatis, HP unik aktif, cari, CRUD Sup/Owner, nonaktif bila pernah bertransaksi, kasir hanya cari/pilih | 4, 11 |
| §3.1-4 pasang/lepas member di bill OPEN, snapshot ulang | 5, 12 |
| §3.1-5 booking: buat, ubah jadwal (cek ulang bentrok), batal; durasi default 60 | 6, 9, 14 |
| §3.1-6 DP: bill DEPOSIT + Checkout langsung; tetap OPEN di strip bila dibatalkan; dipakai otomatis | 6, 8, 12, 14 |
| §3.1-7 hold `bookingHoldMin` | 3, 7, 13 |
| §3.1-8 check-in (kartu & halaman Booking; shift; meja kosong; sejak hold sampai no-show) | 7, 13, 14 |
| §3.1-9 no-show otomatis + notifikasi; notifikasi "booking akan datang" | 9, 11 (toast/suara lewat alert M1) |
| §3.1-10 batal: alasan wajib, DP hangus/kembalikan, PIN kasir, bill DEPOSIT OPEN ikut batal | 9, 14 |
| §3.1-11 kembalikan DP (PIN kasir) | 9, 14 |
| §3.1-12 struk: member & level, "DP booking", "Kembali DP", "TANDA TERIMA DP" | 3, 10 |
| §3.1-13 rekap shift non-kas, kas seharusnya | 10 |
| §3.1-14 pengaturan `bookingHoldMin`/`bookingNoShowMin` tab Booking | 1, 11 |
| §3.2 bill DEPOSIT: satu baris, tanpa item/diskon/pajak/service, tak bisa digabung, tak bisa dibayar DEPOSIT | 2, 5, 8, 12 |
| §3.2 DEPOSIT hanya bill booking dengan DP PAID & belum dipakai; nilai lain `PAYMENT_INVALID`; UI otomatis, bisa dihapus | 2, 8, 12 |
| §3.2 void bill penjualan ber-DP → tunai, `REFUNDED`; void bill DEPOSIT hanya bila belum dipakai | 8 |
| §3.2 gabung bill booking/member, `MERGE_CONFLICT` | 5, 8 |
| §4.1 shared: `computeBillTotals` member + `PREPAID`, `checkPayments` DEPOSIT, label, fungsi waktu, struk, tipe | 1, 2, 3 |
| §4.2 modul server (members, bookings, billing, sessions, scheduler, board, shifts, printing) | 4–10 |
| §4.2 urutan kunci `Session → Bill → Booking → Shift → Product`; bill DEPOSIT dulu | 5, 6, 7, 8, 9 |
| §4.3 alur buat booking / check-in / checkout bill booking / scheduler / batal / kembalikan DP | 6, 7, 8, 9 |
| §4.4 rumus kas seharusnya | 10 |
| §5 model data | 1 |
| §6 sidebar, layar Meja, halaman Booking, halaman Member, dialog Checkout, Pengaturan, notifikasi | 11, 12, 13, 14 |
| §7 error handling (BOOKING_CONFLICT paralel, BOOKING_HOLD, UNIT_BUSY, BOOKING_NOT_ACTIVE, DEPOSIT_NOT_AVAILABLE, idempotensi, scheduler vs check-in) | 6, 7, 8, 9 |
| §8 unit shared | 2, 3 |
| §8 integrasi server | 4–10, 15 |
| §8 web (dialog Booking, timeline, Checkout member/DP, konfirmasi BOOKING_HOLD, halaman Member) | 11, 12, 13, 14 |
| §8 E2E (member Gold; booking DP → check-in → bayar) + E2E M1/M2 tetap lulus | 15 |
| §9 review focus | lihat "Review Focus" di atas |

**Di luar M3 (spec §3.3):** saldo member/top-up, poin/reward, kartu member fisik/QR, booking online & pengingat WA/SMS, booking berulang, jam buka outlet, laporan member/booking dan pengakuan pendapatan prabayar (M4).

## Konsistensi tipe & nama (self-check)

- **Kode error** (server ↔ web ↔ test): `BOOKING_CONFLICT`, `BOOKING_HOLD` (+ `details.booking: BookingHoldInfo`), `BOOKING_NOT_ACTIVE`, `BOOKING_TOO_EARLY`, `BOOKING_IN_PAST`, `CUSTOMER_REQUIRED`, `DEPOSIT_NOT_AVAILABLE`, `DEPOSIT_USED`, `DEPOSIT_BILL_LOCKED`, `MERGE_CONFLICT`, `PHONE_TAKEN`, `MEMBER_IN_USE`, `MEMBER_INACTIVE`, `LEVEL_INACTIVE`; dipakai ulang dari M1/M2: `UNIT_BUSY`, `UNIT_MAINTENANCE`, `NO_OPEN_SHIFT`, `PAYMENT_INVALID`, `APPROVAL_REQUIRED`, `BILL_NOT_OPEN`, `BILL_NOT_PAID`, `IN_USE`.
- **Shared ↔ Prisma:** `PaymentMethod`/`LineType` (+`DEPOSIT`), `BillKind`, `BookingStatus`, `DepositOutcome` berubah bersamaan di Task 1; `BILL_KINDS`, `BOOKING_STATUSES`, `DEPOSIT_OUTCOMES` sama urutannya dengan enum Prisma.
- **Field bill:** `memberId`, `memberName`, `memberLevelName`, `memberTimeDiscountPct`, `memberFnbDiscountPct`, `bookingId`, `kind` (Prisma) → `BillView.member { id, code, name, levelName, timeDiscountPct, fnbDiscountPct }`, `BillView.kind`, `BillView.booking { id, customerName, startAt, status, deposit: { amount, available } | null }`; `memberSnapshot()` (Task 4) satu-satunya penulis kolom snapshot (dipakai `setMember`, `startTx`); `memberDiscountOf()` (Task 5) satu-satunya pembaca untuk total server, `computeBillPreview` (Task 5) untuk web.
- **Kalkulator:** `computeBillTotals(lines, billDiscount, settings, memberDiscount?)` → `lines[].memberDiscount`, `memberDiscountTotal`; `needsDiscountApproval` mengurangi `memberDiscountTotal`. `checkPayments(total, payments, { deposit })` → `change` (tunai) + `depositChange`; `CheckoutResult.depositChange` dan `ShiftSummary.depositChange` memakai nama yang sama.
- **Booking:** `BookingView.depositBillStatus` (bukan boolean) dipakai detail web untuk "Bayar DP"/"Kembalikan DP"; `UnitBookingView.depositPaid` hanya untuk kartu meja. `bookingWindow`/`bookingsOverlap` (half-open) dipakai server (bentrok, paket vs booking) dan tidak diduplikasi di web; `isOnHold` dipakai server (board, check-in, start) dan web (tombol Check-in di detail).
- **Kunci:** `lockBill` (M2), `lockBooking` (`bookings/booking-lock.ts`, Task 5), `lockUnit` (privat di `bookings.service.ts`), `lockMemberCounter` (Task 4); `CheckoutService.voidTx` adalah satu-satunya jalur void (route void, batal booking REFUND, kembalikan DP).
- **Event realtime:** bus `'booking.changed'` → socket `'booking' { id }` → `RealtimeEvent { type: 'booking' }` → invalidate `['bookings']`; perubahan hold selalu juga memancarkan `'unit.changed'` agar `UnitView.booking` di kartu meja segar.
- **Label UI E2E** di Task 15 diambil dari bagian Interfaces Task 11–14 (tab "Member"/"Level", "+ Member", "Tambah member", "Tambah Level", "Diskon billing (%)", "Pilih member", "Cari member", "Member: <nama> (<level>)", "checkout-member-discount", "+ Booking", "Booking baru", "Meja", "Tanggal", "Jam", "60 mnt", "Nama pelanggan", "No. HP", "DP (Rp)", "Simpan booking", `data-booked`, "Booked · <nama>", "Check-in", "Check-in · <nama>", "checkout-deposit", "checkout-remaining", "Booking hari ini", "DP terpakai").

## Keputusan atas ambiguitas spec

1. **Snapshot nama level** — spec §5 hanya `memberName`; plan menambah `Bill.memberLevelName` agar struk menampilkan level saat bayar (§3.1-12).
2. **Relasi Bill↔Booking** — `Bill.bookingId`, `Booking.depositBillId`, `Booking.saleBillId` kolom biasa tanpa FK Prisma (menghindari siklus FK); konsistensi dijaga di bawah kunci baris.
3. **Check-in dengan DP belum dibayar** — spec tidak mengatur; plan membatalkan bill DEPOSIT yang masih OPEN saat check-in (sama seperti batal/no-show) agar tidak menggantung di strip "Belum dibayar".
4. **Batal manual bill DEPOSIT** — ditolak (`DEPOSIT_BILL_LOCKED`); bill DP hanya dibatalkan lewat batal booking/no-show/check-in agar status DP booking selalu konsisten.
5. **"Kembalikan DP" setelah check-in** — spec §3.2 mengizinkan menghapus DP di Checkout "bila pelanggan ingin DP dikembalikan terpisah" tetapi §4.3 hanya menyebut NO_SHOW/CANCELLED; plan juga mengizinkan `CHECKED_IN` + DP belum dipakai (PIN kasir), dengan kunci yang sama sehingga pakai vs kembalikan tetap tepat satu kali.
6. **Paket vs booking** — "paket bertabrakan dengan booking" = jendela paket `[now, now + durasi)` beririsan dengan jendela booking `[startAt, startAt + durasi)`; open billing hanya diblok selama hold.
7. **Hold di layar Meja** — `UnitView.booking` = booking BOOKED terawal yang sudah masuk jendela hold (tanpa batas atas; no-show oleh scheduler mengakhirinya). Kartu tetap `data-status="IDLE"` (+ `data-booked`) agar status sesi M1 tidak berubah.
8. **Urutan kunci rinci** — BillCounter (nomor bill DP) diambil sebelum kunci Unit; ubah jadwal mengunci `Booking → Unit`, sama dengan check-in (Booking → mulai sesi → Unit), sehingga tidak ada siklus.
9. **`change` vs `depositChange`** — `CheckoutResult.change` tetap kembalian tunai (kompatibel M2); kembalian DP dilaporkan terpisah dan dicetak "Kembali DP".
10. **Notifikasi hold** — dikirim sekali per booking (`holdNotifiedAt`), di-reset bila jadwal/meja diubah; booking yang sudah lewat batas no-show tidak lagi dinotifikasi "akan datang".
11. **Urutan task** — skema Prisma di Task 1 (sebelum kalkulator shared) karena enum shared & Prisma harus berubah bersamaan agar typecheck hijau di setiap task.
