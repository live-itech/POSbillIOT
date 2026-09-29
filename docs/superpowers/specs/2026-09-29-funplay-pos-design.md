# FunPlay — POS Billiard & PlayStation Terintegrasi IoT

**Tanggal:** 2026-09-29
**Status:** Draft untuk review
**Pemilik:** LIVE IT

---

## 1. Latar Belakang & Tujuan

FunPlay adalah aplikasi Point of Sale untuk outlet **billiard** atau **PlayStation** yang terhubung langsung ke perangkat IoT (Arduino + relay) lewat Ethernet/LAN. Setiap meja/unit dikendalikan oleh POS: lampu meja (billiard) atau stop kontak TV/konsol (PS) hanya menyala bila ada sesi tercatat.

**Tujuan utama:**
1. **Anti-kecurangan** — meja/unit tidak bisa dipakai "di luar catatan"; semua tindakan manual tercatat.
2. **Operasional kasir mudah & menyenangkan** — tampilan per meja, realtime, flat design dengan warna cerah.
3. **POS lengkap** — billing waktu, FnB, layanan non-stok, booking, member, shift, laporan.
4. **Fleksibel** — jenis outlet (billiard/PS) diatur dari pengaturan; protokol Arduino bisa diganti tanpa mengubah modul lain.

**Klien pertama:** satu outlet billiard. Aplikasi dirancang agar bisa dipasang ulang di outlet lain (satu server per outlet).

**Kriteria sukses versi 1:**
- Kasir bisa menjalankan seluruh siklus: mulai sesi → pesan FnB → bayar → struk tercetak → lampu mati, tanpa pelatihan panjang.
- Tagihan waktu selalu akurat terhadap aturan tarif, termasuk lintas tarif dan pindah meja.
- Setiap nyala/mati device dan tindakan sensitif memiliki jejak audit.
- Sistem pulih otomatis setelah listrik padam / server restart tanpa kehilangan argo.

## 2. Lingkup

### 2.1 Masuk versi 1
Dashboard meja realtime · sesi (open billing & paket) · tarif fleksibel · pesanan FnB & layanan (stok, non-stok, item manual) · checkout & split payment · diskon, pajak, service · cetak struk · shift kasir · booking + DP · member + level diskon + saldo deposit · stok sederhana · laporan · kontrol & log device · pengaturan (outlet, meja, device, tarif, user, printer) · mode billiard/PS.

### 2.2 Di luar versi 1 (fase berikutnya)
Integrasi payment gateway QRIS dinamis · poin/reward member · resep/bahan baku · kitchen/bar display & printer dapur · multi-outlet & dashboard cloud owner · laporan lanjutan (jam sibuk, utilisasi) · cash drawer.

## 3. Keputusan Utama

| Topik | Keputusan |
|---|---|
| Bentuk aplikasi | Web app dengan **server lokal** di outlet (jalan tanpa internet) |
| Server | Mini-PC **Linux** (Ubuntu Server LTS / Debian), headless |
| Backend | Node.js + TypeScript, **Fastify**, **Socket.IO**, **Prisma** |
| Database | **PostgreSQL** |
| Frontend | **React + Vite + Tailwind CSS + shadcn/ui** |
| Struktur repo | Monorepo **pnpm workspaces** |
| Deploy | **Docker Compose** (app + PostgreSQL), auto-start saat boot |
| Remote | **Tailscale** (atau ZeroTier) + SSH |
| Printer | Thermal **80mm**, ESC/POS; mendukung **USB di server** (rekomendasi) dan **LAN** |
| Cash drawer | Tidak ada |
| Printer dapur | Tidak ada — satu printer di kasir |
| Bahasa & mata uang | Indonesia, Rupiah |
| Gaya visual | **Playful Violet** (flat, ungu + kuning/cyan), toggle terang/gelap |
| Layout kasir | **Split tetap**: grid meja kiri + panel detail kanan; responsif jadi drawer di tablet/HP |
| Nama produk | **FunPlay** (cek ketersediaan merek sebelum komersial) |

## 4. Arsitektur

### 4.1 Struktur repo

```
funplay/
├── apps/
│   ├── server/        # Fastify + Socket.IO + Prisma
│   └── web/           # React + Vite + Tailwind + shadcn/ui
├── packages/
│   └── shared/        # tipe, skema zod, kalkulator tarif, konstanta status
├── deploy/            # docker-compose.yml, install.sh, update.sh, backup
└── docs/
```

### 4.2 Modul server

Setiap modul punya satu tanggung jawab, berkomunikasi lewat service interface, dan dapat dites terpisah.

| Modul | Tanggung jawab |
|---|---|
| `auth` | Login, sesi cookie, PIN supervisor, role & izin |
| `settings` | Jenis outlet, pajak, service, pembulatan, minimum main, menit peringatan, struk, printer |
| `units` | Tipe unit, meja/unit, area, pemetaan ke device & channel relay, status maintenance |
| `tariffs` | CRUD tarif & paket; perhitungan memakai `shared/billing` |
| `sessions` | Mulai, tambah waktu, pindah, pause/resume, stop sesi |
| `catalog` | Kategori, produk stok, layanan non-stok |
| `orders` | Tambah/ubah/hapus item pada bill (termasuk item manual) |
| `billing` | Bill, checkout, diskon, pajak/service, split payment, void |
| `shifts` | Buka/tutup shift, kas awal, rekap, selisih |
| `bookings` | Reservasi, DP, hold otomatis, no-show otomatis, check-in |
| `members` | Member, level, saldo, top-up |
| `inventory` | Stok masuk, penyesuaian, pengurangan otomatis saat jual |
| `reports` | Laporan pendapatan & operasional |
| `devices` | Gateway IoT (lihat §5) |
| `printing` | Render & kirim struk ESC/POS (USB/LAN) |
| `audit` | Pencatatan aksi penting & persetujuan supervisor |
| `scheduler` | Peringatan hampir habis, auto-stop paket, hold & no-show booking, rekonsiliasi device |
| `realtime` | Broadcast event ke klien via Socket.IO |

### 4.3 Alur data (contoh: mulai sesi)

1. Kasir klik **Mulai** di Meja 3 → `POST /sessions`.
2. Server: validasi (meja kosong, tidak maintenance, shift terbuka) → transaksi DB: buat `Bill` (OPEN) + `Session` + `SessionSegment` + `AuditLog`.
3. `devices` mengatur *desired state* relay Meja 3 = ON dan mengirim perintah.
4. `realtime` broadcast `unit.updated` ke semua klien; saat ACK diterima, broadcast status lampu.

### 4.4 Prinsip

- **Jam otoritatif di server.** Klien menghitung tampilan timer dari `startedAt` + selisih jam server (dikirim saat connect). Jam PC kasir tidak memengaruhi tagihan.
- **Kalkulator tarif tunggal** di `packages/shared/billing` — fungsi murni, dipakai untuk preview di UI dan tagihan final.
- **Uang = integer Rupiah.** Tidak ada float.
- **Semua uang masuk lewat `Bill` → `Payment`** (billing, FnB, DP booking, top-up member) agar rekap shift konsisten.
- **Transaksi yang sudah PAID tidak dihapus**, hanya VOID dengan alasan + persetujuan supervisor.

## 5. Lapisan IoT / Arduino

### 5.1 Model

- Satu **Device** = satu Arduino + Ethernet shield, mengontrol N relay (mis. 8/16 channel).
- Setiap **Unit** dipetakan ke `(deviceId, relayChannel)`. Unit tanpa device diperbolehkan (tanpa kontrol lampu).

### 5.2 Antarmuka driver

```ts
interface DeviceDriver {
  start(): Promise<void>;
  stop(): Promise<void>;
  setRelay(channel: number, on: boolean): Promise<void>; // resolve saat ACK
  readAll?(): Promise<boolean[]>;                        // opsional, bila device mendukung
  on(event: 'online' | 'offline' | 'state', cb: (...args: any[]) => void): void;
}
```

Format pesan dipisah sebagai **codec** (mis. teks `ON3\n` / `OFF3\n`, atau JSON) sehingga driver transport dan format bisa dikombinasikan.

| Driver | Arah koneksi |
|---|---|
| `tcp-client` | POS membuka TCP ke `host:port` Arduino |
| `http-client` | POS memanggil endpoint HTTP Arduino |
| `inbound` | Arduino menghubungi POS (TCP listener atau HTTP polling endpoint di server) |
| `simulator` | Device virtual untuk development/demo; panel lampu virtual di UI |

Driver & codec dipilih per device di Pengaturan. Setelah script Arduino dari klien diterima, hanya driver/codec yang disesuaikan.

### 5.3 Desired state & rekonsiliasi

- Server menurunkan *desired state* setiap relay dari sesi aktif (+ override manual yang sah).
- Rekonsiliasi dijalankan **setiap 10 detik** (dapat diatur) dan **setiap device tersambung kembali**: kirim ulang state yang benar.
- Bila device mendukung `readAll`, state aktual dibandingkan dengan desired state.

### 5.4 Kondisi gagal

| Kondisi | Perilaku |
|---|---|
| Heartbeat hilang > X detik (default 15) | Device ditandai offline; badge merah di kartu meja; notifikasi; `DeviceEvent` |
| Perintah gagal / timeout | Transaksi **tidak diblokir**; retry dengan backoff; peringatan "Lampu Meja N belum merespons" |
| Relay ON tanpa sesi (dari `readAll`) | Peringatan anti-kecurangan + log; opsi pengaturan: matikan otomatis |
| Override manual | Wajib PIN supervisor + alasan; tercatat di `AuditLog` & `DeviceEvent` |

### 5.5 Kebutuhan untuk programmer Arduino (lampiran untuk klien)

1. Saat koneksi ke server putus, **pertahankan state relay terakhir** (jangan matikan lampu).
2. Sediakan perintah **set relay** per channel dengan balasan ACK.
3. Sediakan **ping/heartbeat** dan, bila memungkinkan, perintah **baca status semua relay**.
4. Gunakan **IP statis** atau reservasi DHCP.
5. Dokumentasikan format pesan & port agar bisa dibuatkan codec.

## 6. Aturan Bisnis

### 6.1 Sesi & tarif
- **Mode:** *Open billing* (argo berjalan) atau *Paket* (durasi tetap, bayar di muka opsional, auto-stop).
- **Pembulatan:** waktu dihitung per menit lalu dibulatkan ke atas per blok (default 15 menit, dapat diatur).
- **Minimum main:** default 60 menit, dapat diatur (0 = nonaktif).
- **Tarif** per tipe unit, per hari, per rentang jam, dengan prioritas. Sesi yang melewati pergantian tarif (termasuk lewat tengah malam) dipecah per rentang dan dihitung sesuai tarif masing-masing. Pembulatan & minimum diterapkan pada **total durasi sesi**, lalu selisih pembulatan dibebankan pada rentang terakhir.
- **Paket:** harga tetap untuk durasi tertentu; tambah waktu setelah paket dihitung dengan tarif normal (atau paket tambahan).
- **Peringatan:** default 5 menit sebelum habis (suara + notifikasi). Saat habis, paket auto-stop → lampu mati, meja status "Habis – menunggu bayar".
- **Pause:** hanya dengan PIN supervisor; durasi pause tidak ditagih; lampu saat pause mengikuti pengaturan (default: tetap ON).
- **Pindah meja:** membuat `SessionSegment` baru; tiap segmen dihitung dengan tarif tipe unit segmen tersebut; lampu meja lama OFF, meja baru ON.
- **Gabung tagihan:** beberapa sesi boleh berada dalam satu `Bill`.

### 6.2 Pesanan
- Item **stok** mengurangi stok saat bill dibayar.
- Item **layanan** (non-stok) — mis. sewa stick, coach, loker, stik PS tambahan.
- **Item manual** — nama & harga diketik kasir; tercatat di audit.

### 6.3 Pembayaran
- Metode: Tunai, QRIS (QR statis, konfirmasi manual), Kartu debit/kredit, Transfer, Saldo member.
- **Split payment** diperbolehkan (beberapa metode dalam satu bill).
- Tunai: input nominal diterima → kembalian otomatis.
- **Diskon** per item atau per transaksi (nominal/persen). Diskon di atas batas (dapat diatur) butuh PIN supervisor.
- **Pajak & service charge**: persen, aktif/nonaktif, dan cakupannya (billing, FnB, atau keduanya) dapat diatur. Urutan: subtotal → diskon → service → pajak.
- **Void** bill PAID: PIN supervisor + alasan; stok & saldo member dikembalikan.
- Setiap aksi bayar membawa **idempotency key** untuk mencegah pembayaran ganda.

### 6.4 Shift
- Transaksi hanya bisa dilakukan bila kasir memiliki shift terbuka.
- Buka shift: kas awal. Tutup shift: input kas dihitung → sistem menampilkan kas seharusnya, selisih, dan rekap per metode bayar; cetak rekap.

### 6.5 Booking
- Booking unit untuk tanggal & jam tertentu, durasi rencana, nama & no. HP (atau member), **DP opsional**.
- DP dibayar ke `Bill` berstatus OPEN yang terhubung ke booking.
- Meja berstatus **Booked** mulai X menit sebelum jadwal (default 15) — kasir diperingatkan bila mencoba memulai sesi lain yang bentrok.
- **No-show** otomatis bila belum check-in Y menit setelah jadwal (default 15). Nasib DP (hangus/dikembalikan) diputuskan supervisor saat membatalkan; default hangus dan dicatat sebagai pendapatan.
- **Check-in** → sesi dimulai dalam bill booking sehingga DP otomatis terpotong.

### 6.6 Member
- Data: kode, nama, no. HP, level, saldo.
- **Level** menentukan diskon % billing dan % FnB (otomatis saat member dipilih di sesi/bill).
- **Saldo deposit:** top-up (melalui Bill tipe TOPUP, sehingga masuk rekap shift), dipakai sebagai metode bayar; saldo tidak boleh negatif.
- Poin/reward: di luar versi 1.

### 6.7 Mode outlet
- `BILLIARD`: label "Meja", ikon 🎱, contoh tipe Reguler/VIP.
- `PLAYSTATION`: label "Unit", ikon 🎮, contoh tipe PS4/PS5/VIP Room.
- Hanya label, ikon, dan data contoh yang berbeda; logika sama.

### 6.8 Hak akses

| Aksi | Kasir | Supervisor | Owner |
|---|:-:|:-:|:-:|
| Mulai/stop sesi, pesan, bayar, booking, top-up | ✅ | ✅ | ✅ |
| Pause, diskon di atas batas, void, override device, batalkan booking ber-DP | PIN supervisor | ✅ | ✅ |
| Kelola produk & member | ❌ | ✅ | ✅ |
| Pengaturan, tarif, user, device, laporan penuh | ❌ | ❌ | ✅ |

Persetujuan PIN supervisor dicatat di `AuditLog.approvedBy`.

## 7. Model Data

Semua tabel memiliki `id`, `createdAt`, `updatedAt`. Uang = `Int` (Rupiah).

**Pengaturan & master**
- `Setting` — outletType (BILLIARD|PLAYSTATION), outletName, address, taxPct, taxScope, servicePct, serviceScope, roundingBlockMin, minChargeMin, warnBeforeMin, pauseKeepsLightOn, autoOffUnexpected, discountApprovalThreshold, bookingHoldMin, bookingNoShowMin, receiptHeader, receiptFooter, printerConfig (JSON).
- `User` — name, username, passwordHash, pinHash, role (KASIR|SUPERVISOR|OWNER), active, failedPinCount, lockedUntil.
- `UnitType` — name, color.
- `Unit` — name, unitTypeId, area, deviceId?, relayChannel?, status (ACTIVE|MAINTENANCE), sortOrder.
- `Device` — name, driver, codec, host?, port?, config (JSON), online, lastSeenAt.
- `Tariff` — unitTypeId, daysMask, startTime, endTime, pricePerHour, priority, active.
- `Package` — name, unitTypeId, durationMin, price, active.
- `Category` — name, sortOrder.
- `Product` — name, categoryId, kind (STOCK|SERVICE), price, cost, stockQty, imageUrl?, active.

**Operasional**
- `Bill` — number (`FP-YYYYMMDD-NNNN`), kind (SALE|TOPUP), status (OPEN|PAID|VOID), memberId?, bookingId?, shiftId?, subtotal, discountTotal, serviceTotal, taxTotal, grandTotal, paidAt?, voidReason?, createdById.
- `BillLine` — billId, type (TIME|PRODUCT|SERVICE|CUSTOM|TOPUP), productId?, sessionId?, nameSnapshot, unitPriceSnapshot, qty, discount, total, breakdown (JSON, rincian per tarif untuk TIME).
- `Payment` — billId, method (CASH|QRIS|CARD|TRANSFER|MEMBER_BALANCE), amount, received?, change?, reference?, idempotencyKey (unique), shiftId.
- `Session` — billId, unitId (unit saat ini), mode (OPEN|PACKAGE), packageId?, startedAt, plannedEndAt?, endedAt?, status (RUNNING|PAUSED|EXPIRED|ENDED), memberId?.
- `SessionSegment` — sessionId, unitId, startedAt, endedAt?.
- `SessionPause` — sessionId, pausedAt, resumedAt?, approvedById.
- `Shift` — userId, openedAt, closedAt?, openingCash, countedCash?, expectedCash?, note?.
- `StockMovement` — productId, qty (±), reason (SALE|PURCHASE|ADJUST|VOID), billId?, userId, note?.

**Booking & member**
- `Booking` — unitId, customerName, phone, memberId?, startAt, durationMin, status (BOOKED|CHECKED_IN|NO_SHOW|CANCELLED), billId?.
- `MemberLevel` — name, timeDiscountPct, fnbDiscountPct.
- `Member` — code, name, phone, levelId, balance, active.
- `MemberBalanceTx` — memberId, type (TOPUP|PAYMENT|REFUND|ADJUST), amount (±), billId?, userId.

**Log**
- `AuditLog` — at, userId, action, entity, entityId, data (JSON), approvedById?.
- `DeviceEvent` — at, deviceId, channel?, type (CMD_ON|CMD_OFF|ACK|FAIL|ONLINE|OFFLINE|UNEXPECTED_ON), detail (JSON).

## 8. Antarmuka Pengguna

### 8.1 Gaya visual — Playful Violet
- Primer ungu `#7C3AED`, aksen kuning `#F59E0B`, latar `#FAF8FF`, teks `#1E1B4B`.
- Warna status konsisten:

| Status | Warna |
|---|---|
| Kosong | putih, border putus-putus ungu muda |
| Berjalan | ungu `#7C3AED` |
| Hampir habis | kuning `#FBBF24` |
| Habis / menunggu bayar | merah muda `#F43F5E` |
| Booked | cyan muda `#CFFAFE` |
| Maintenance / offline | abu-abu + titik merah |

- Flat, sudut membulat, tombol besar ramah layar sentuh, angka tabular. Mode gelap tersedia di pengaturan.

### 8.2 Navigasi (sidebar ikon)
🎱 Meja · 📅 Booking · 🧾 Transaksi · 🍔 Produk & Layanan · 👤 Member · 💰 Shift · 📊 Laporan · ⚙️ Pengaturan (menu disembunyikan sesuai role).

### 8.3 Layar Meja (utama)
- **Kiri:** filter tab (Semua / per tipe / per area), grid kartu meja dengan nama, status, timer, tagihan berjalan, ikon lampu, indikator device. Tombol **+ Transaksi baru** (tagihan lepas).
- **Kanan (panel tetap):** detail meja terpilih — info sesi, rincian billing & pesanan, total, tombol **+ Pesan**, **+ Waktu**, **Pindah**, **Pause**, **Stop & Bayar**; untuk meja kosong: **Mulai** (open/paket, pilih member); untuk booked: **Check-in**.
- Di tablet/HP panel menjadi drawer.

### 8.4 Alur utama
1. **Mulai main:** pilih meja kosong → Open/Paket → (opsional) member → Mulai.
2. **Pesan:** + Pesan → grid produk bergambar, kategori, pencarian, dan **Item manual**.
3. **Checkout:** Stop & Bayar → rincian billing per tarif, FnB, diskon, service, pajak, total → metode bayar (split) → Bayar → struk tercetak → lampu OFF → meja kosong.
4. **Tagihan lepas:** + Transaksi baru → pesan → bayar.
5. **Booking:** layar Booking (timeline per meja) → tambah booking + DP; check-in dari kartu meja.
6. **Shift:** buka shift saat login pertama bila belum ada; tutup shift dari menu Shift.

### 8.5 Notifikasi
Suara + toast untuk: hampir habis, habis, device offline, perintah device gagal, relay ON tanpa sesi, booking akan datang, no-show.

## 9. Struk

- Printer thermal 80mm, ESC/POS; koneksi **USB di server** (via device file) atau **LAN** (raw TCP port 9100), dipilih di pengaturan.
- Isi: header outlet, no. bill, tanggal, kasir, meja & rentang waktu, rincian billing per tarif, item, diskon, service, pajak, total, pembayaran, kembalian, saldo member (bila ada), footer.
- Cetak ulang dari menu Transaksi (tercatat di audit). Cetak rekap tutup shift.

## 10. Laporan

- Pendapatan harian/rentang tanggal (billing vs FnB vs layanan, per metode bayar).
- Per meja/unit (jam terpakai & pendapatan).
- Per shift & per kasir.
- Produk/layanan terlaris.
- Transaksi void & diskon (dengan penyetuju).
- Log device & audit (filter tanggal/meja/jenis).
- Ekspor CSV.

## 11. Error Handling & Keandalan

- **Recovery saat start:** muat sesi RUNNING/PAUSED dari DB, susun ulang jadwal scheduler, jalankan rekonsiliasi device.
- **Klien terputus:** Socket.IO auto-reconnect lalu sinkronisasi penuh state; banner "Koneksi terputus" selama offline.
- **Transaksi atomik** untuk checkout (bill PAID, payment, stok, saldo member, tutup sesi, desired state OFF).
- **Idempotency key** pada pembayaran & aksi sesi yang rawan double-click.
- **Validasi** input dengan zod di server (dan shared di klien).
- **Pesan error** berbahasa Indonesia untuk pengguna; detail teknis di log server (pino).
- **Keamanan:** argon2 untuk password/PIN; cookie sesi httpOnly; lock sementara setelah 5 kali salah PIN; akses hanya dari LAN/Tailscale.

## 12. Testing

- **Unit (Vitest):** kalkulator tarif — pembulatan, minimum, lintas tarif, lintas tengah malam, pause, pindah meja, paket + tambah waktu, diskon member, pajak/service; codec device.
- **Integrasi (Vitest + PostgreSQL test):** alur sesi → pesan → bayar → stok/saldo → rekap shift; void; booking → check-in; no-show.
- **Driver device:** server TCP/HTTP palsu untuk skenario ACK, timeout, putus, reconnect, rekonsiliasi.
- **E2E (Playwright):** alur kasir utama memakai driver simulator.

## 13. Deploy & Operasional

- `deploy/docker-compose.yml`: service `app` (server yang juga menyajikan build web) + `db` (PostgreSQL), volume data, `restart: unless-stopped`.
- `install.sh`: pasang Docker, set IP statis bila perlu, pull/build image, migrasi DB, seed data awal (owner, pengaturan default sesuai jenis outlet).
- `update.sh`: backup → pull versi baru → migrasi → restart.
- **Backup** harian `pg_dump`, simpan 30 hari lokal; opsional unggah ke cloud bila ada internet.
- **Remote:** Tailscale + SSH (panduan di `docs/`).
- Rekomendasi hardware klien: mini-PC (mis. Intel N100), switch LAN, **UPS** untuk server + switch + Arduino, printer thermal 80mm USB.

## 14. Milestone

Spec ini mencakup seluruh versi 1. Rencana implementasi ditulis **per milestone**.

| # | Milestone | Isi | Hasil yang bisa dicoba |
|---|---|---|---|
| M1 | **Fondasi & Meja** | Monorepo, login/role/PIN, pengaturan dasar, tipe unit & meja, device + driver **simulator**, kalkulator tarif, sesi (open/paket, tambah waktu, pindah, pause, stop), dashboard realtime, scheduler peringatan/auto-stop | Meja bisa dijalankan; lampu virtual ON/OFF realtime |
| M2 | **Transaksi** | Produk & layanan, pesanan, bill, checkout, split payment, diskon/pajak/service, cetak struk, shift, void, transaksi lepas | Siklus transaksi lengkap sampai struk |
| M3 | **Booking & Member** | Booking + DP + hold/no-show + check-in, member, level, saldo & top-up | Booking dan member berjalan |
| M4 | **Stok & Laporan** | Stok masuk/penyesuaian, semua laporan, ekspor CSV, penampil audit & log device | Owner bisa memantau |
| M5 | **Deploy & Hardware** | Docker Compose, install/update/backup, panduan Tailscale, driver & codec Arduino asli (setelah script klien diterima) | Siap dipasang di outlet |

## 15. Pertanyaan Terbuka

1. **Protokol Arduino** (arah koneksi, format pesan, port, dukungan baca status) — menunggu script dari klien; ditangani di M5 lewat driver/codec.
2. **Jumlah meja, tipe, dan daftar tarif** aktual klien — diisi saat setup, tidak memblokir pengembangan.
3. **Pengecekan merek "FunPlay"** sebelum dijual ke outlet lain.
