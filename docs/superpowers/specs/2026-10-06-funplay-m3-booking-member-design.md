# FunPlay M3 — Booking & Member: Desain

**Tanggal:** 2026-10-06
**Status:** Ditulis berdasarkan rekomendasi (instruksi tetap user: ikuti rekomendasi best practice), menunggu review tertulis
**Spec induk:** `docs/superpowers/specs/2026-09-29-funplay-pos-design.md` (§6.3, §6.5, §6.6, §6.8, §7, §8.2–8.5, §9, §14 baris M3)
**Dibangun di atas:** M2 "Transaksi" (branch `feat/m2-transaksi`, PR #2)

Dokumen ini merinci M3. Bila bertentangan dengan spec induk atau spec M2, **dokumen ini yang berlaku untuk M3**.

## 1. Tujuan

Booking dan member berjalan:
- pelanggan memesan meja untuk jam tertentu, boleh membayar DP;
- meja tampil **Booked** menjelang jadwal;
- kasir melakukan check-in dan DP otomatis terpotong saat bayar;
- booking yang tidak datang otomatis menjadi no-show;
- member mendapat diskon level otomatis, bisa top-up saldo, dan membayar dengan saldo.

**Hasil yang bisa dicoba:**
1. Kasir membuat booking Meja 2 jam 19:00 dengan DP Rp 50.000 tunai.
2. Pukul 18:45 kartu Meja 2 menjadi cyan "Booked · Budi 19:00".
3. Kasir menekan Check-in, pelanggan bermain, lalu Stop & Bayar. Pembayaran "DP booking Rp 50.000" sudah terisi, dan sisanya dibayar QRIS.
4. Member Gold (diskon billing 10%) top-up Rp 100.000, lalu membayar bill berikutnya dengan saldo.

## 2. Keputusan desain

| Topik | Keputusan | Alasan |
|---|---|---|
| Pembayaran DP | **Bill terpisah `kind = DEPOSIT`** yang langsung dibayar lewat checkout M2. Saat bill penjualan booking dibayar, DP dipakai sebagai **metode bayar `DEPOSIT`**. | Memakai ulang checkout M2 yang idempoten tanpa mengubahnya, dan menjaga aturan M2 "tidak ada bill sebagian dibayar". **Menggantikan** kalimat spec induk §6.5 "DP dibayar ke Bill OPEN yang terhubung ke booking". |
| DP melebihi tagihan | Pembayaran `DEPOSIT` mencatat `amount = min(DP, sisa tagihan)`, `received = DP`, `change = DP − amount`. Kelebihan dikembalikan **tunai** ke pelanggan dan mengurangi kas seharusnya shift. | Memakai field `received`/`change` yang sudah ada, tanpa model refund baru. |
| Saldo member | Top-up memakai **bill `kind = TOPUP`** yang dibayar lewat checkout biasa, sehingga masuk rekap shift. Pemakaian saldo memakai metode bayar **`MEMBER_BALANCE`**. Saldo tidak boleh negatif. | Sesuai spec induk §6.6. |
| Diskon level | Saat member dipasang ke bill, persen diskon level (billing & FnB) **di-snapshot ke bill**. Kalkulator shared menerapkannya sebagai diskon otomatis per baris yang tidak punya diskon item. Diskon level **tidak** dihitung untuk batas persetujuan PIN. | Angka bill tidak berubah walau level diedit belakangan. Diskon level sudah disetujui lewat aturan level. |
| Member di sesi | Member dipasang di **bill**, bukan di sesi. Bisa dipilih saat Mulai, saat check-in, atau di dialog Checkout. | YAGNI. Diskon dan saldo bekerja di tingkat bill. |
| Bentrok booking | Dua booking `BOOKED` pada meja yang sama tidak boleh bertumpang waktu: 409 `BOOKING_CONFLICT`. Dicek di bawah kunci baris `Unit`. | Tidak perlu exclusion constraint Postgres (migrasi raw SQL berisiko). |
| Mulai sesi di meja yang di-hold | Server menolak dengan 409 `BOOKING_HOLD` beserta info booking. Kasir dapat **melanjutkan dengan konfirmasi** (`ignoreBooking: true`, tercatat di audit), tanpa PIN. | Spec induk: kasir "diperingatkan", bukan dilarang. |
| No-show | Scheduler menandai `NO_SHOW` bila belum check-in `bookingNoShowMin` menit setelah jadwal. DP default **hangus**. Supervisor dapat **mengembalikan DP** sesudahnya (PIN untuk kasir). | Sesuai §6.5: default hangus, supervisor yang memutuskan. |
| Pengembalian DP | Dilakukan dengan **void bill DEPOSIT** (mekanisme void M2: PIN, alasan, uang keluar tercatat di shift berjalan). | Memakai ulang void M2. |

## 3. Lingkup

### 3.1 Masuk M3
1. **Level member:** nama, diskon billing %, diskon FnB %, urutan. Dikelola Supervisor & Owner. Seed: "Reguler" 0/0.
2. **Member:**
   - Data: kode otomatis `M0001`…, nama, no. HP (unik di antara member aktif), level, saldo, aktif.
   - Cari berdasarkan kode, nama, atau HP.
   - CRUD oleh Supervisor & Owner. Member yang pernah bertransaksi tidak dihapus, melainkan dinonaktifkan.
   - Kasir hanya dapat **mencari, memilih, dan top-up**.
3. **Saldo:**
   - Top-up (bill TOPUP, minimal Rp 1.000).
   - Bayar dengan saldo (`MEMBER_BALANCE`, hanya bila bill punya member).
   - Riwayat mutasi (`MemberBalanceTx`).
   - Void mengembalikan saldo.
4. **Member di bill:** pasang dan lepas member pada bill OPEN. Snapshot diskon level dihitung ulang setiap kali member dipasang.
5. **Booking:**
   - Buat, ubah jadwal, dan batalkan.
   - Data: meja, tanggal & jam mulai, durasi rencana (default 60 menit), nama, no. HP atau member, catatan, DP opsional.
   - Ubah jadwal hanya saat status `BOOKED`, dan bentrok diperiksa ulang.
6. **DP booking:**
   - Bila DP > 0 → bill DEPOSIT dibuat lalu dialog Checkout langsung terbuka. Bila dibatalkan, bill DEPOSIT tetap OPEN dan tampil di strip "Belum dibayar".
   - DP dipakai otomatis saat checkout bill booking (§4.3).
7. **Hold:** meja berstatus **Booked** mulai `bookingHoldMin` menit (default 15) sebelum jadwal sampai booking di-check-in, dibatalkan, atau no-show.
8. **Check-in:**
   - Dari kartu meja (saat hold) atau dari halaman Booking.
   - Memulai sesi (Open/Paket) dengan bill baru yang terhubung ke booking dan member booking.
   - Butuh shift terbuka. Meja harus kosong.
   - Boleh dilakukan sejak awal hold sampai no-show.
9. **No-show otomatis** (scheduler) + notifikasi. Notifikasi "booking akan datang" saat hold dimulai.
10. **Batalkan booking:**
    - Alasan wajib.
    - Bila DP sudah dibayar, pilih "DP hangus" atau "Kembalikan DP". Kasir butuh PIN supervisor untuk membatalkan booking ber-DP.
    - Bila bill DEPOSIT masih OPEN, bill itu ikut dibatalkan.
11. **Kembalikan DP** pada booking `NO_SHOW` atau `CANCELLED` yang DP-nya hangus. PIN untuk kasir.
12. **Struk:**
    - Nama member dan saldo akhir (bila memakai saldo atau top-up).
    - Baris "DP booking" pada pembayaran.
    - Judul "TANDA TERIMA DP" untuk bill DEPOSIT dan "TOP-UP SALDO" untuk bill TOPUP.
13. **Rekap shift:** metode `DEPOSIT` dan `MEMBER_BALANCE` tampil sebagai **non-kas**. Kas seharusnya dikurangi kembalian DP (§4.4).
14. **Pengaturan:** `bookingHoldMin` (15) dan `bookingNoShowMin` (15) di tab baru **Booking**.

### 3.2 Aturan default
- **Bill TOPUP / DEPOSIT:**
  - Satu baris saja (`TOPUP` / `DEPOSIT`) dan tidak bisa ditambah item.
  - Tanpa diskon, pajak, atau service (baris di luar semua cakupan).
  - Tidak bisa digabung.
  - Tidak bisa dibayar dengan `MEMBER_BALANCE` atau `DEPOSIT`.
- **`DEPOSIT` hanya untuk bill penjualan yang terhubung ke booking** yang DP-nya sudah dibayar (bill DEPOSIT PAID) dan belum dipakai, hangus, atau dikembalikan.
  - Amount = min(DP, sisa tagihan); server menolak nilai lain dengan `PAYMENT_INVALID`.
  - UI mengisinya otomatis dan tidak bisa diubah, hanya bisa dihapus bila pelanggan ingin DP dikembalikan terpisah.
- **`MEMBER_BALANCE`** ≤ saldo member saat dikunci; bila kurang → 409 `BALANCE_INSUFFICIENT`.
- **Void bill penjualan:**
  - Pembayaran `MEMBER_BALANCE` dikembalikan ke saldo (`REFUND`).
  - Pembayaran `DEPOSIT` dikembalikan tunai di shift void, lalu `depositOutcome` booking menjadi `REFUNDED`.
- **Void bill TOPUP:** saldo member harus ≥ nominal top-up; bila tidak → 409 `BALANCE_INSUFFICIENT`. Saldo dikurangi (`ADJUST`).
- **Void bill DEPOSIT** hanya bila DP belum dipakai. Hasilnya `depositOutcome = REFUNDED`.
- **Gabung bill:** bila hanya bill sumber yang punya `bookingId`/`memberId`, nilainya dipindah ke target. Bila keduanya punya booking atau member yang berbeda → 409 `MERGE_CONFLICT`.

### 3.3 Di luar M3
- Poin/reward.
- Kartu member fisik/QR.
- Booking online oleh pelanggan, pengingat WA/SMS.
- Booking berulang.
- Jam buka outlet (timeline menampilkan 24 jam).
- Laporan member/booking dan pengakuan pendapatan prabayar (M4).

## 4. Arsitektur

### 4.1 Shared (`packages/shared`)
- **`computeBillTotals`:**
  - Input baru opsional `memberDiscount: { timePct, fnbPct } | null`.
  - Langkah: diskon item → **diskon member** (persen dari amount, `Math.round`, hanya pada baris tanpa diskon item; `timePct` untuk baris TIME, `fnbPct` untuk FNB) → diskon bill → service → pajak.
  - Kategori cakupan baru `PREPAID` (baris `TOPUP`/`DEPOSIT`) yang tidak masuk cakupan mana pun dan tidak menerima diskon member.
  - Output per baris menambah `memberDiscount`.
  - Invarian tetap: `subtotal − discountTotal + serviceTotal + taxTotal = grandTotal`. `discountTotal` mencakup diskon member.
  - `needsDiscountApproval` tidak memasukkan diskon member.
- **`checkPayments`:**
  - Metode baru `MEMBER_BALANCE` dan `DEPOSIT`.
  - `DEPOSIT` boleh punya `received` ≥ `amount` dengan `change = received − amount`.
  - Kembalian tunai tetap hanya dari `CASH`.
- **Label:** `PAYMENT_METHOD_LABEL` + "Saldo member", "DP booking"; `BOOKING_STATUS_LABEL`.
- **Fungsi waktu:** `bookingWindow(startAt, durationMin)`, `bookingsOverlap(a, b)`, `isOnHold(booking, now, holdMin)`.
- **Struk:**
  - Renderer menerima `member?: { name, balanceAfter? }` dan judul per jenis bill.
  - Baris pembayaran DEPOSIT menampilkan "DP booking" dan "Kembali DP" bila ada kembalian.
- Tipe & skema Zod untuk API M3 (pola M2).

### 4.2 Modul server
| Modul | Tanggung jawab |
|---|---|
| `members` (baru) | CRUD level & member, pencarian, riwayat saldo, `createTopup(memberId, amount)` → bill TOPUP OPEN. |
| `bookings` (baru) | CRUD booking, cek bentrok (kunci `Unit`), DP (bill DEPOSIT), check-in (memanggil `sessions.start` dengan bill booking), batal, kembalikan DP, daftar per hari. |
| `billing` (ubah) | Pasang/lepas member di bill (snapshot diskon level), `kind` bill, tolak item pada bill TOPUP/DEPOSIT, gabung dengan aturan §3.2. Checkout menangani `MEMBER_BALANCE`/`DEPOSIT`. Saat PAID: TOPUP menambah saldo, DEPOSIT menandai booking. Void menangani pengembalian saldo/DP. |
| `sessions` (ubah) | `start` menerima `memberId?`, `billId?` (dipakai check-in), `ignoreBooking?`. Mengembalikan 409 `BOOKING_HOLD` bila meja di-hold atau paket bertabrakan dengan booking. |
| `scheduler` (ubah) | Setiap tick: notifikasi saat booking memasuki hold (sekali, `holdNotifiedAt`), no-show otomatis. |
| `board` (ubah) | `UnitView.booking`: booking `BOOKED` terdekat yang sedang di-hold (`{id, customerName, startAt, durationMin, depositPaid}`) atau null. |
| `shifts` (ubah) | Rekap per metode menandai non-kas. `expectedCash` dikurangi kembalian DP dan DP yang di-void (§4.4). |
| `printing` (ubah) | Model struk untuk member, DEPOSIT, dan TOPUP. |

**Urutan kunci global** (memperluas aturan M2): `Session → Bill → Booking → Shift (share) → Member → Product (urut id)`. Unit dikunci hanya oleh operasi booking (buat/ubah jadwal) dan tidak pernah bersamaan dengan kunci Bill. Jalur yang menyentuh bill DEPOSIT **dan** booking (batal, kembalikan DP, no-show) selalu mengunci **bill DEPOSIT dulu**, baru booking, lalu memeriksa ulang status booking. Check-in hanya mengunci booking; bill SALE yang dibuatnya adalah baris baru, sehingga tidak membentuk siklus.

### 4.3 Alur data
- **Buat booking** (`POST /api/bookings`):
  1. Kunci `Unit` FOR UPDATE.
  2. Cek bentrok dengan booking `BOOKED` lain (`BOOKING_CONFLICT`) dan meja ACTIVE.
  3. Simpan booking.
  4. Bila `depositAmount > 0`, buat bill DEPOSIT OPEN (label "DP · <nama> · <meja> <jam>", satu baris DEPOSIT) dalam transaksi yang sama. Butuh shift terbuka hanya bila ada DP.
  5. Audit, emit `booking.changed`. Response memuat `depositBillId` → UI membuka Checkout.
- **Check-in** (`POST /api/bookings/:id/check-in {mode, packageId?}`):
  1. Kunci booking. Status harus `BOOKED`, dan `now ≥ startAt − holdMin`.
  2. Buat bill SALE (`bookingId`, `memberId` + snapshot level).
  3. `sessions.start` dengan bill itu. Hold milik booking sendiri tidak dihitung.
  4. Booking → `CHECKED_IN`, `saleBillId`. Audit.
- **Checkout bill booking:**
  - Dialog membaca `bill.booking.deposit` (`{amount, available}`). Bila tersedia, dialog menambahkan baris pembayaran `DEPOSIT` otomatis.
  - Server, di bawah kunci bill lalu booking, memastikan:
    - `bill.bookingId` ada;
    - bill DEPOSIT berstatus PAID dan `depositOutcome` null;
    - `received = deposit`, `amount = min(deposit, grandTotal)`.
  - Lalu `depositOutcome = USED`, `depositUsedAmount = amount`.
- **Bayar dengan saldo:**
  - Server mengunci baris member (`SELECT … FOR UPDATE`) setelah shift.
  - `balance ≥ Σ MEMBER_BALANCE`, lalu dikurangi. `MemberBalanceTx PAYMENT (−amount)` dengan `balanceAfter`.
- **Top-up** (`POST /api/members/:id/topups {amount}`):
  1. Buat bill TOPUP OPEN (label "Top-up · <member>"); UI membuka Checkout.
  2. Saat PAID, di bawah kunci member: saldo += amount, `MemberBalanceTx TOPUP`.
- **Scheduler** (setiap tick, memakai `clock.now()`):
  - booking `BOOKED` dengan `startAt − holdMin ≤ now` dan `holdNotifiedAt` null → alert "Booking <nama> di <meja> jam <HH:MM>", set `holdNotifiedAt`;
  - booking `BOOKED` dengan `now ≥ startAt + noShowMin` → `NO_SHOW`, `depositOutcome = FORFEITED` bila DP sudah dibayar. Bill DEPOSIT yang masih OPEN dibatalkan otomatis. Lalu alert dan audit (user sistem = null).
- **Batalkan** (`POST /api/bookings/:id/cancel {reason, deposit: 'FORFEIT'|'REFUND', approvalPin?}`):
  - Status harus `BOOKED`.
  - DP sudah dibayar dan user KASIR → PIN.
  - `REFUND` → void bill DEPOSIT (memakai `CheckoutService.void` dengan alasan "Booking dibatalkan: …"), `depositOutcome = REFUNDED`.
  - `FORFEIT` → `depositOutcome = FORFEITED`.
- **Kembalikan DP** (`POST /api/bookings/:id/refund-deposit {reason, approvalPin?}`):
  - Status harus `NO_SHOW` atau `CANCELLED` dengan `depositOutcome = FORFEITED` → void bill DEPOSIT, lalu `REFUNDED`.

### 4.4 Kas seharusnya shift
```
expectedCash = openingCash
             + Σ amount  CASH    (bill PAID di shift ini)
             − Σ amount  CASH    (bill di-void di shift ini)
             − Σ change  DEPOSIT (bill PAID di shift ini)      ← kembalian DP tunai
             − Σ amount  DEPOSIT (bill di-void di shift ini)   ← DP yang dikembalikan tunai karena void penjualan
```
- `MEMBER_BALANCE` tidak memengaruhi kas.
- DP yang dikembalikan lewat void bill DEPOSIT sudah tercakup baris "CASH di-void" (bila DP dibayar tunai). Bila DP dibayar non-tunai, pengembaliannya tercatat per metode di rekap void.

## 5. Model data (tambahan/perubahan Prisma)

Uang = `Int` Rupiah. Migrasi lewat `prisma migrate diff` (pola M2), tanpa `migrate reset`/`migrate dev`.

- `Setting` + `bookingHoldMin Int @default(15)`, `bookingNoShowMin Int @default(15)`.
- `enum BillKind { SALE TOPUP DEPOSIT }`; `Bill` + `kind BillKind @default(SALE)`, `memberId String?`, `memberName String?` (snapshot), `memberTimeDiscountPct Int @default(0)`, `memberFnbDiscountPct Int @default(0)`, `bookingId String?` (bill SALE booking).
- `LineType` + `TOPUP`, `DEPOSIT`.
- `PaymentMethod` + `MEMBER_BALANCE`, `DEPOSIT`.
- `MemberLevel` — id, name (unik), timeDiscountPct, fnbDiscountPct, sortOrder, active.
- `Member` — id, code (unik), name, phone, levelId, balance `Int @default(0)` (CHECK ≥ 0 lewat logika server), active, createdAt, updatedAt; `@@index([phone])`.
- `MemberCounter` — id = 1, next Int (pola `BillCounter`).
- `enum BalanceTxType { TOPUP PAYMENT REFUND ADJUST }`; `MemberBalanceTx` — memberId, type, amount (±), balanceAfter, billId?, userId?, note?, createdAt; `@@unique([billId, type])` mencegah efek ganda per bill.
- `enum BookingStatus { BOOKED CHECKED_IN NO_SHOW CANCELLED }`; `enum DepositOutcome { USED FORFEITED REFUNDED }`.
- `Booking`:
  - unitId, customerName, phone, memberId?, startAt, durationMin, note;
  - status, depositAmount `@default(0)`, depositBillId? (unik), depositOutcome?, depositUsedAmount `@default(0)`, saleBillId? (unik);
  - holdNotifiedAt?, cancelReason?, createdById, createdAt, updatedAt;
  - `@@index([unitId, startAt])`, `@@index([status, startAt])`.

## 6. UI

- **Sidebar:** 🎱 Meja · 📅 Booking · 🧾 Transaksi · 👤 Member · 💰 Shift · 🍔 Produk · ⚙️ Pengaturan.
  - Booking dan Member terlihat oleh semua role.
  - Tombol kelola member dan level hanya untuk Supervisor/Owner.
- **Layar Meja:**
  - Kartu meja yang di-hold berwarna cyan muda `#CFFAFE` dengan teks "Booked · <nama> <HH:MM>" (ikon 💰 bila DP sudah dibayar).
  - Panel meja Booked: info booking + tombol **Check-in** (dialog Open/Paket) dan **Mulai lain** (walk-in, memicu konfirmasi bentrok).
  - **StartSession:** pemilih member opsional (cari kode/nama/HP).
  - Bila server membalas `BOOKING_HOLD` → dialog "Meja ini dibooking <nama> jam <HH:MM>. Tetap mulai?" → **Tetap mulai** mengirim ulang dengan `ignoreBooking: true`.
- **Halaman Booking:**
  - Pemilih tanggal (default hari ini).
  - Timeline: baris per meja, kolom per jam 00–24, scroll otomatis ke jam sekarang, garis "sekarang".
  - Blok booking berwarna per status. Klik blok → panel detail dengan aksi **Check-in**, **Ubah jadwal**, **Batalkan**, **Kembalikan DP**, dan **Bayar DP** (bila bill DEPOSIT masih OPEN).
  - Tombol **+ Booking** membuka dialog: meja, tanggal, jam, durasi (30/60/90/120/lainnya), member *atau* nama + HP, catatan, DP. Simpan → bila DP > 0, Checkout bill DEPOSIT terbuka.
  - Daftar ringkas di bawah timeline: booking hari ini urut jam.
- **Halaman Member:**
  - Tabel (cari kode/nama/HP) dengan kolom kode, nama, HP, level, saldo.
  - Panel detail: data, riwayat saldo, tombol **Top-up** (dialog nominal + tombol cepat 50rb/100rb/200rb → Checkout bill TOPUP), **Ubah**, **Nonaktifkan**.
  - Tab **Level** (Supervisor/Owner) memakai komponen CRUD M1.
- **Dialog Checkout:**
  - Baris **Member: <nama> (<level>) · saldo Rp…** dengan tombol **Pilih member** / **Lepas**.
  - Rincian menampilkan "Diskon member" per baris.
  - Metode bayar + **Saldo** (aktif bila ada member, maksimal min(saldo, sisa)).
  - Pembayaran **DP booking** terisi otomatis untuk bill booking.
  - Untuk bill TOPUP/DEPOSIT: diskon, gabung, dan pemilih member disembunyikan; metode Saldo dan DP tidak tersedia.
- **Pengaturan:** tab **Booking** (hold menit, no-show menit).
- **Notifikasi** (toast + suara M1): "Booking akan datang", "No-show".

## 7. Error handling & keandalan

| Situasi | Perilaku |
|---|---|
| Dua kasir membuat booking bertumpuk bersamaan | Kunci baris Unit → yang kedua 409 `BOOKING_CONFLICT`. |
| Walk-in di meja yang di-hold | 409 `BOOKING_HOLD` + info; lanjut hanya dengan `ignoreBooking: true` (diaudit). |
| Check-in saat meja masih dipakai | 409 `UNIT_BUSY`; kasir menghentikan sesi sebelumnya dulu. |
| Check-in terlambat (sudah no-show) | 409 `BOOKING_NOT_ACTIVE`; booking baru dibuat bila perlu. |
| Bayar saldo paralel dari dua perangkat | Kunci baris Member → saldo tidak pernah negatif; yang kalah 409 `BALANCE_INSUFFICIENT` (seluruh checkout gagal). |
| DP dipakai dan dikembalikan bersamaan | Kunci baris Booking → hanya satu yang berhasil (`DEPOSIT_NOT_AVAILABLE`). |
| Checkout ulang dengan key sama | Idempotensi M2; efek saldo/DP tidak terulang (unik `MemberBalanceTx(billId,type)`; status booking dicek di bawah kunci). |
| Void top-up yang saldonya sudah terpakai | 409 `BALANCE_INSUFFICIENT`. |
| Scheduler & check-in bersamaan pada batas no-show | Keduanya mengunci baris Booking; yang kedua melihat status baru dan berhenti (scheduler) atau mendapat 409 (check-in). |

Semua pesan error berbahasa Indonesia (error map M1/M2).

## 8. Testing

- **Unit shared:**
  - `computeBillTotals` dengan diskon member (TIME vs FNB, baris berdiskon item dilewati, baris PREPAID, invarian);
  - `needsDiscountApproval` mengabaikan diskon member;
  - `checkPayments` (`DEPOSIT` dengan kembalian, `MEMBER_BALANCE`);
  - fungsi overlap/hold booking;
  - struk DEPOSIT/TOPUP/member.
- **Integrasi server:**
  - CRUD level & member, kode otomatis, HP unik;
  - top-up → saldo;
  - bayar saldo (cukup, kurang, paralel);
  - void bill bersaldo → refund; void top-up;
  - booking bentrok (berurutan & paralel);
  - hold → `BOOKING_HOLD` & `ignoreBooking`;
  - DP → check-in → checkout dengan DEPOSIT (DP < total, DP > total → kembalian, kas seharusnya);
  - batal FORFEIT/REFUND (PIN);
  - no-show scheduler (clock palsu) + kembalikan DP;
  - void bill penjualan ber-DP;
  - gabung bill dengan booking/member;
  - rekap shift non-kas.
- **Web:**
  - dialog Booking (validasi, DP membuka checkout);
  - timeline menempatkan blok;
  - Checkout dengan member/saldo/DP;
  - dialog konfirmasi `BOOKING_HOLD`;
  - halaman Member + top-up.
- **E2E Playwright:**
  1. Buat member → top-up 100rb → mulai meja dengan member → Stop & Bayar sebagian dengan saldo → saldo berkurang di halaman Member.
  2. Booking dengan DP tunai untuk jam sekarang + 10 menit → kartu meja Booked → Check-in → Stop & Bayar: DP terisi otomatis, sisa tunai → booking CHECKED_IN.
- E2E M1/M2 tetap lulus.

## 9. Review focus M3

1. **Saldo:** tidak pernah negatif dan tidak pernah bergerak dua kali untuk satu bill (bayar paralel, idempotensi, void).
2. **DP:** dipakai, hangus, atau dikembalikan **tepat satu kali**; kas seharusnya shift benar untuk DP tunai, kembalian DP, dan void.
3. **Booking:** tidak pernah bertumpuk; hold dan no-show tepat waktu menurut `clock`; check-in hanya sekali.
4. **Diskon member:** angka pratinjau sama dengan angka server; diskon level tidak memicu PIN; snapshot tidak berubah saat level diedit.
5. **Urutan kunci:** `Session → Bill → Booking → Shift → Member → Product` dipatuhi semua jalur baru (tanpa deadlock).
