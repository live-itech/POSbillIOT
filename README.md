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

## Fitur transaksi (M2)
- **Shift:** satu shift terbuka untuk seluruh outlet. Buka shift (kas awal) dari tombol di header; tutup dari menu Shift (kas fisik → selisih, rekap tercetak).
- **Pesanan & bayar:** di panel meja: **+ Pesan**, **Stop** (bill tetap belum dibayar), **Stop & Bayar**. Bill tanpa sesi muncul di strip "Belum dibayar". Tagihan lepas lewat **+ Transaksi baru**.
- **Checkout:** diskon item/bill, gabung bill, split payment (Tunai, QRIS, Kartu, Transfer). Diskon di atas batas, hapus item, batal, dan void butuh PIN supervisor untuk kasir.
- **Struk:** Pengaturan → *Struk & Printer*. Driver **Simulator** menampilkan struk lewat tombol **Struk** di layar; **USB** menulis ke device file di server (mis. `/dev/usb/lp0`, user server perlu akses grup `lp`); **LAN** mengirim ESC/POS ke `host:9100`. Gunakan **Tes cetak** setelah menyimpan.
- **Pajak & service:** Pengaturan → *Pajak & Service* (persen + cakupan). Urutan hitung: subtotal → diskon → service → pajak.

## Produksi (sementara, sebelum M5)
`pnpm start` membaca `apps/server/.env` — salin dulu dari contoh (`cp apps/server/.env.example apps/server/.env`) lalu isi `DATABASE_URL` dan `COOKIE_SECRET` untuk produksi.
```bash
pnpm install
pnpm --filter @funplay/server exec prisma migrate deploy   # terapkan migrasi ke DB produksi
pnpm build
cd apps/server && WEB_DIST=$(pwd)/../web/dist NODE_ENV=production pnpm start
```
