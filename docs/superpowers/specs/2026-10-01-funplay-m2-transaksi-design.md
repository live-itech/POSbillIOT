# FunPlay M2 — Transaksi: Desain

**Tanggal:** 2026-10-01
**Status:** Disetujui (brainstorming), menunggu review tertulis
**Spec induk:** `docs/superpowers/specs/2026-09-29-funplay-pos-design.md` (§6.2–6.4, §6.8, §7, §8.4, §9, §14 baris M2)
**Dibangun di atas:** M1 "Fondasi Meja" (branch `feat/m1-fondasi-meja`)

Dokumen ini merinci M2 dan mencatat keputusan yang diambil saat brainstorming. Bila ada yang bertentangan dengan spec induk, **dokumen ini yang berlaku untuk M2**.

## 1. Tujuan

Siklus transaksi lengkap sampai struk:
mulai main → pesan FnB/layanan → stop → checkout (diskon, service, pajak, split payment) → struk tercetak → lampu mati → meja kosong.

**Hasil yang bisa dicoba:** kasir membuka shift, menjalankan meja, memesan minuman, lalu Stop & Bayar dengan split payment. Struk tampil di simulator printer. Kasir menutup shift dan melihat selisih kas.

## 2. Keputusan brainstorming

| Topik | Keputusan |
|---|---|
| Printer | Belum ada hardware. Render ESC/POS + **driver Simulator** (pratinjau di layar); driver **USB** (device file) dan **LAN** (TCP 9100) tetap dibuat dan dites terhadap server TCP palsu. |
| Shift | **Satu shift terbuka untuk seluruh outlet.** Kasir berikutnya buka shift setelah yang sebelumnya ditutup (serah terima). Supervisor/owner bertransaksi di shift yang sedang terbuka, tercatat atas nama mereka. |
| Stop tanpa bayar | **Boleh.** Stop menghentikan argo, mematikan lampu, mengosongkan meja; bill tetap OPEN di daftar "Belum dibayar". |
| Gabung bill | **Boleh.** Bill OPEN lain dapat digabung ke bill yang akan dibayar; satu struk. |
| Foto produk | **Tidak ada di M2.** Kartu produk = nama, harga, warna kategori. |
| Total bill | Kalkulator murni di `packages/shared`, dipakai pratinjau UI dan angka final server. |
| Split payment | Seluruh daftar pembayaran dikirim **dalam satu request** (satu idempotency key); lunas semua atau gagal semua. Tidak ada status "sebagian dibayar". |

## 3. Lingkup

### 3.1 Masuk M2
1. **Katalog:** kategori (nama, warna, urutan) dan produk (`STOCK` / `SERVICE`), dikelola Supervisor & Owner.
2. **Bill & pesanan:** bill dibuat otomatis saat sesi mulai (sudah di M1) atau lewat "+ Transaksi baru" (tagihan lepas). Item produk, layanan, atau **item manual** dapat ditambah ke bill OPEN. Satu bill dapat memuat beberapa sesi.
3. **Stop tanpa bayar** (lihat §2).
4. **Checkout:** subtotal → diskon item → diskon bill → service → pajak → total. Metode: Tunai (kembalian), QRIS statis (konfirmasi manual), Kartu, Transfer. Split payment. Idempotency key.
5. **Gabung bill** sebelum dibayar.
6. **Batalkan bill OPEN** (alasan wajib).
7. **Void bill PAID:** PIN supervisor + alasan; stok dikembalikan.
8. **Shift:** buka (kas awal), tutup (kas dihitung → kas seharusnya, selisih, rekap per metode), cetak rekap, riwayat.
9. **Struk:** render 80 mm (48 kolom font A), cetak otomatis setelah bayar, cetak ulang dari menu Transaksi (diaudit), tes cetak dari pengaturan.
10. **Menu Transaksi:** daftar bill (filter tanggal & status, cari nomor), detail, cetak ulang, void, bayar/batalkan bill OPEN.
11. **Pengaturan:** pajak & service (persen + cakupan), batas diskon, header/footer struk, konfigurasi printer.

### 3.2 Aturan default
- **Shift wajib terbuka** untuk: memulai sesi, menambah/mengubah item, membuat tagihan lepas, dan checkout. Tanpa shift → 409 `NO_OPEN_SHIFT`. Stop sesi, pause/resume, extend, pindah, dan kontrol lampu **tidak** butuh shift (meja yang sedang jalan harus tetap bisa dihentikan).
- **Bill OPEN boleh melewati tutup shift.** `Bill.shiftId` dan `Payment.shiftId` diisi shift saat **dibayar**.
- **Stok** berkurang saat bill dibayar; penjualan tetap diizinkan walau stok ≤ 0 (UI menandai "stok habis"). Stok masuk/penyesuaian di M4.
- **PIN supervisor** dibutuhkan KASIR untuk:
  - menghapus item atau mengurangi qty item yang sudah tersimpan di bill;
  - membatalkan bill OPEN yang tagihannya > 0;
  - diskon total (item + bill) di atas `discountApprovalPct` dari subtotal;
  - void bill PAID.
  Persetujuan dicatat di `AuditLog.approvedById` (mekanisme M1).
- **Batas diskon default 10%.** **Pajak & service default nonaktif (0%).**
- **Tidak ada pembulatan tunai;** total dibayar persis.
- **Nomor bill** tetap `FP-YYYYMMDD-NNNN` (M1, `BillCounter`).

### 3.3 Di luar M2
Saldo member & top-up, booking & DP (M3). Stok masuk/penyesuaian, laporan, ekspor (M4). Foto produk. Tampilan QR di layar. Cash drawer. Printer dapur.

## 4. Arsitektur

### 4.1 Shared (`packages/shared`)
- `billing/bill-totals.ts` — `computeBillTotals(input)` murni:
  - Input: baris (`kind`: TIME | FNB, `amount` = unitPrice×qty, diskon item `{type: AMOUNT|PERCENT, value}`), diskon bill, `{taxPct, taxScope, servicePct, serviceScope}`.
  - Kategori cakupan: baris `TIME` = BILLING; `PRODUCT`/`SERVICE`/`CUSTOM` = FNB. Cakupan: `NONE | BILLING | FNB | ALL`.
  - Langkah: diskon item (persen dibulatkan `Math.round`, dibatasi ≤ amount) → diskon bill (persen dari subtotal setelah diskon item, atau nominal; dibatasi ≤ sisa) dialokasikan **proporsional** ke baris dengan metode sisa terbesar → service = round(Σ net baris dalam `serviceScope` × servicePct/100) → pajak = round((Σ net baris dalam `taxScope` + Σ service tak-dibulatkan atas baris yang juga dalam `taxScope`) × taxPct/100) → grand total.
  - Output: per baris (`discount`, `net`), `subtotal`, `discountTotal`, `serviceTotal`, `taxTotal`, `grandTotal`. Invarian: `subtotal − discountTotal + serviceTotal + taxTotal = grandTotal`; semua integer ≥ 0.
- `billing/payment.ts` — validasi daftar pembayaran: jumlah non-tunai ≤ sisa tagihan, kembalian hanya dari tunai, total diterima ≥ grandTotal; menghasilkan `change`.
- `receipt/` — `renderReceipt(model): string[]` (baris teks 48 kolom) dan `encodeEscPos(lines, opts): Uint8Array` (init, align, bold, double-height untuk total, feed, cut). Teks yang sama dipakai simulator.
- Tipe & skema Zod untuk API M2 (pola M1).

### 4.2 Modul server baru
| Modul | Tanggung jawab |
|---|---|
| `catalog` | CRUD kategori & produk (Supervisor/Owner); produk dipakai di bill tidak bisa dihapus → nonaktifkan. |
| `orders` | Tambah/ubah/hapus baris pada bill OPEN; snapshot nama & harga saat ditambah. |
| `billing` | Daftar & detail bill, tagihan lepas, pratinjau total, gabung, batalkan, checkout, void. |
| `shifts` | Buka, tutup, rekap shift berjalan, riwayat. |
| `printing` | Bangun model struk/rekap, antrean `PrintJob`, driver `SimulatorPrinter`, `UsbPrinter` (tulis ke device file), `LanPrinter` (TCP 9100, timeout 5 dtk). |

Modul M1 yang diubah:
- `sessions`: start butuh shift terbuka; **stop** membuat baris `TIME` di bill dari `chargeTotal`/`chargeDetail` (satu baris per sesi, `breakdown` = rincian per tarif). Sesi yang di-merge ikut pindah bill.
- `settings`: field baru (§5).
- `realtime`: event `bill.changed {billId}`, `shift.changed`, `print.job {id, status}`.

### 4.3 Alur data
- **Pratinjau bill berjalan:** klien menghitung biaya waktu sesi aktif dengan kalkulator tarif (M1) + baris tersimpan, lalu `computeBillTotals`.
- **Checkout** (`POST /api/bills/:id/checkout`, body: `idempotencyKey`, `expectedGrandTotal`, `billDiscount`, `payments[]`, `approvalPin?`):
  1. Bila ada bill dengan `checkoutKey = idempotencyKey` → kembalikan hasil checkout sebelumnya (200). Bila tabrakan unik terjadi saat commit (dua request paralel dengan key sama), tangkap lalu kembalikan hasil yang tersimpan.
  2. Kunci bill (`SELECT … FOR UPDATE`); status harus OPEN (`BILL_NOT_OPEN`), tanpa sesi aktif (`SESSION_ACTIVE`), ada shift terbuka (`NO_OPEN_SHIFT`), minimal satu baris (`BILL_EMPTY`).
  3. Hitung ulang total di server dari DB. Bila ≠ `expectedGrandTotal` → 409 `TOTAL_CHANGED`.
  4. Diskon di atas batas oleh KASIR → butuh `approvalPin` valid (`APPROVAL_REQUIRED` / `PIN_INVALID`).
  5. Validasi pembayaran (`PAYMENT_INSUFFICIENT`, `PAYMENT_INVALID`).
  6. Simpan payments, `checkoutKey = idempotencyKey` (unik) dan total di bill, `StockMovement` SALE untuk baris STOCK (kurangi `stockQty`), status PAID, `paidAt`, `shiftId`. Audit `bill.paid`. Satu transaksi DB.
  7. Setelah commit: buat `PrintJob` RECEIPT dan kirim ke driver tanpa menunggu; emit `bill.changed`.
- **Gabung** (`POST /api/bills/:id/merge {sourceBillId}`): kunci kedua bill dalam urutan id; keduanya OPEN; pindahkan baris & sesi ke target; sumber → CANCELLED, `mergedIntoId`. Audit.
- **Void** (`POST /api/bills/:id/void {reason, approvalPin?}`): bill PAID → VOID; `StockMovement` VOID mengembalikan stok tepat sekali; tercatat untuk shift berjalan (rekap mengurangi metode terkait). Audit dengan penyetuju.
- **Tutup shift** (`POST /api/shifts/current/close {countedCash, note?}`): `expectedCash = openingCash + Σ tunai bersih (diterima − kembalian) shift ini − Σ tunai bill yang di-void di shift ini`; simpan `countedCash`, selisih; cetak rekap.

## 5. Model data (tambahan/perubahan Prisma)

Uang = `Int` Rupiah. Semua tabel `id`, `createdAt`, `updatedAt` (pola M1).

- `Setting` + `taxPct Int @default(0)`, `taxScope Scope @default(ALL)`, `servicePct Int @default(0)`, `serviceScope Scope @default(ALL)`, `discountApprovalPct Int @default(10)`, `receiptHeader String @default("")`, `receiptFooter String @default("Terima kasih!")`, `printerConfig Json` (default `{driver: "SIMULATOR"}`; USB: `{driver, devicePath}`; LAN: `{driver, host, port}`).
- `enum Scope { NONE BILLING FNB ALL }`.
- `Category` — name (unik), color, sortOrder, active.
- `Product` — name, categoryId, kind (`STOCK`|`SERVICE`), price, stockQty `@default(0)`, active.
- `Bill` (perluas M1): `status` + `CANCELLED`; `label String`; `shiftId?`; `billDiscountType?`, `billDiscountValue Int @default(0)`; `subtotal`, `discountTotal`, `serviceTotal`, `taxTotal`, `grandTotal` (`Int @default(0)`, diisi saat PAID); `paidAt?`, `paidById?`, `checkoutKey String? @unique`; `mergedIntoId?`; `cancelReason?`, `voidReason?`, `voidedById?`, `voidedAt?`.
- `BillLine` — billId, type (`TIME`|`PRODUCT`|`SERVICE`|`CUSTOM`), productId?, sessionId? (`@unique` untuk TIME), nameSnapshot, unitPrice, qty, discountType?, discountValue `@default(0)`, breakdown Json?, createdById.
- `Payment` — billId, shiftId, method (`CASH`|`QRIS`|`CARD`|`TRANSFER`), amount (bagian tagihan yang ditutup), received?, change?, reference?.
- `Shift` — openedById, openedAt, openingCash, closedById?, closedAt?, countedCash?, expectedCash?, note?, `openFlag Boolean? @unique` (= true saat terbuka, null saat tutup → menjamin satu shift terbuka).
- `StockMovement` — productId, qty (±), reason (`SALE`|`VOID`), billId, userId; `@@unique([billId, productId, reason])` mencegah pengembalian ganda.
- `PrintJob` — kind (`RECEIPT`|`SHIFT_REPORT`|`TEST`), billId?, shiftId?, status (`PENDING`|`DONE`|`FAILED`), error?, previewText, requestedById.

## 6. UI

- **Sidebar:** 🎱 Meja · 🧾 Transaksi · 💰 Shift (semua role) · 🍔 Produk (Supervisor, Owner) · ⚙️ Pengaturan (Owner).
- **Header:** chip shift ("Shift: Andi · sejak 08:00"). Tanpa shift → banner "Buka shift untuk mulai transaksi" + dialog kas awal; tombol Mulai/Pesan/Bayar nonaktif.
- **Layar Meja:**
  - Panel meja aktif: timer & biaya waktu (M1), daftar pesanan (ubah qty, hapus — PIN untuk kasir), subtotal sementara, tombol **+ Pesan**, **Stop**, **Stop & Bayar**.
  - **Strip "Belum dibayar"** di atas grid: chip bill OPEN tanpa sesi aktif (label + total) → buka checkout.
  - **+ Transaksi baru** → bill lepas baru → dialog Pesan.
- **Dialog Pesan:** tab kategori, pencarian, grid kartu (warna kategori, nama, harga, tanda stok habis), **Item manual** (nama + harga), keranjang kecil → Tambahkan.
- **Dialog Checkout:** kiri = rincian (baris TIME dapat dibuka per tarif, item dengan tombol diskon, diskon bill, **Gabung bill lain**, subtotal → diskon → service → pajak → TOTAL). Kanan = metode (Tunai/QRIS/Kartu/Transfer), nominal + tombol cepat (Uang pas, 20rb, 50rb, 100rb), daftar pembayaran, sisa, kembalian, **Bayar** (aktif bila cukup). PIN diminta saat Bayar bila diskon melewati batas. Sukses → toast "Lunas · kembalian Rp…".
- **Transaksi:** tabel bill (filter tanggal & status, cari nomor) → panel detail (baris, pembayaran, kasir, waktu) dengan Cetak ulang, Void (PIN + alasan); bill OPEN: Bayar, Batalkan.
- **Shift:** ringkasan shift berjalan (kas awal, penjualan per metode, void, kas seharusnya), form Tutup shift (kas fisik → selisih berwarna, catatan), riwayat shift.
- **Produk:** CRUD Kategori & Produk/Layanan (komponen CRUD M1).
- **Pengaturan:** tab baru **Pajak & Service** (termasuk batas diskon) dan **Struk & Printer** (header/footer, driver, path/host:port, **Tes cetak**).
- **Panel simulator printer** di samping simulator relay: daftar struk terakhir, pratinjau monospace 48 kolom.

## 7. Error handling & keandalan

| Situasi | Perilaku |
|---|---|
| Double-click Bayar / dua kasir bayar bill sama | Key sama → hasil sama; key beda ke bill PAID → 409 `BILL_NOT_OPEN`; bill dikunci baris. Tepat satu set pembayaran. |
| Checkout saat sesi masih jalan | 409 `SESSION_ACTIVE`; "Stop & Bayar" selalu stop dulu. |
| Total berubah dari perangkat lain | 409 `TOTAL_CHANGED`; UI memuat ulang bill. |
| Buka shift dobel | 409 `SHIFT_ALREADY_OPEN` (unique `openFlag`). |
| Printer mati / kertas habis / timeout 5 dtk | Pembayaran tetap sah; `PrintJob` FAILED; toast + tombol Cetak ulang. |
| Gabung bill | Keduanya OPEN; kunci berurutan id (anti-deadlock); bill tidak bisa digabung ke dirinya. |
| Void | Hanya PAID; stok dikembalikan tepat sekali (unique StockMovement). |
| Hapus produk yang pernah dijual | 409 `IN_USE` → gunakan nonaktif. |

Semua pesan error berbahasa Indonesia (error map M1).

## 8. Testing

- **Unit shared:** `computeBillTotals` (diskon item/bill nominal & persen, alokasi proporsional + sisa, cakupan pajak/service, batas diskon, invarian penjumlahan, nilai 0), validasi pembayaran (split, kembalian, non-tunai berlebih), render struk 48 kolom & byte ESC/POS.
- **Integrasi server:** checkout split; idempotency + bayar paralel; `TOTAL_CHANGED`; shift wajib; stop tanpa bayar lalu bayar; gabung; batalkan; void + stok; PIN (hapus item, diskon besar, void); rekap tutup shift (kas seharusnya, selisih, void); driver LAN vs server TCP palsu; printer gagal tidak membatalkan bayar.
- **Web:** dialog Pesan, Checkout (kembalian, aktif/nonaktif Bayar, PIN diskon), tutup shift.
- **E2E Playwright:**
  1. Buka shift → mulai meja → pesan minuman → Stop & Bayar split Tunai + QRIS → struk muncul di simulator → meja kosong.
  2. Tagihan lepas → bayar → void dengan PIN → tutup shift dengan selisih terlihat.
- E2E M1 tetap lulus (diperbarui: buka shift dulu).

## 9. Review focus M2

1. Bayar ganda (double-click, dua perangkat) → tepat satu pembayaran.
2. Angka pratinjau = angka final server; invarian total selalu terpenuhi.
3. Stop tanpa bayar → meja kosong, bill tetap bisa dibayar kemudian, termasuk setelah ganti shift.
4. Void mengembalikan stok tepat sekali dan rekap shift benar.
5. Printer gagal tidak pernah membatalkan atau menggandakan pembayaran.
