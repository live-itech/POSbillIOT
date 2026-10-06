# Protokol Relay Controller Arduino (v2.ino)

Referensi untuk driver `tcp-client` FunPlay (M5). Sumber: `v2.ino` dari klien.

## Hardware

- Arduino **Mega 2560** (memakai pin 2–53).
- Modul Ethernet **ENC28J60** (library `UIPEthernet`), plus `AESLib` dan `EEPROM`.
- 48 channel relay: channel `n` (1..48) = pin `n + 1`. Grup 1 = channel 1–24, grup 2 = channel 25–48.

## Transport

- POS membuka koneksi TCP ke Arduino, port **12321**.
- Default jaringan: IP `192.168.137.254`, netmask `/24`, gateway `192.168.137.1`.
- **Satu koneksi = satu perintah.** Kirim 32 byte, terima 34 byte, lalu Arduino menutup koneksi.
- Arduino menunggu 32 byte maksimal 1 detik setelah koneksi diterima.
- Arduino hanya melayani satu klien per putaran `loop()`, jadi perintah harus dikirim berurutan (antre).
- Port Serial (9600 baud) menerima format pesan yang sama.

## Framing

Request (32 byte):

```
[ IV (16 byte) ][ AES-128-CBC ciphertext (16 byte) ]
```

Plaintext = 8 byte (v2) atau 4 byte (v1), padding PKCS7 sampai 16 byte.

Response (34 byte):

```
[ 32 byte ][ 0x0D 0x0A ]
```

- Perintah yang mengembalikan data (tipe `0`, `70`): 32 byte = IV + ciphertext, plaintext 8 byte (atau 4 byte untuk request v1).
- Perintah lain: **tidak dienkripsi**; byte pertama = kode status, sisanya nol.

AES key default: ASCII `hfio123456abcdef`. Key yang disimpan di EEPROM hanya boleh `0-9` dan `a-z`;
kalau tidak valid, Arduino kembali ke key default.

## Kode status (byte pertama response tak terenkripsi)

| Kode | Arti |
|---|---|
| `0x00` | Sukses |
| `0xF9` | Key enkripsi salah |
| `0xFA` | Tidak ada respon ke klien |
| `0xFB` | AES key berhasil diperbarui |
| `0xFC` | Konfigurasi tersimpan, perlu restart Arduino |
| `0xFD` | Panjang pesan salah |
| `0xFE` | Reset Ethernet |
| `0xFF` | Error umum / perintah tidak dikenal |

## Perintah (plaintext 8 byte, big-endian, `uint64`)

Nibble paling atas (bit 60–63) = **tipe**, nibble berikutnya (bit 56–59) = **grup/state/subtipe**.

| Tipe | Format | Fungsi |
|---|---|---|
| `0` | `0G 00 00 00 00 00 00 00` | Baca status grup `G` (1/2). Response terenkripsi: `0G` + 24 bit status di 3 byte terakhir (bit 23 = channel pertama grup). Kalau `G > 2`, byte pertama `0xFF`. |
| `1` | `1G .. .. .. .. MM MM MM` | Set 24 relay grup `G` sekaligus dari bitmask 24 bit terbawah (bit 23 = channel pertama). |
| `2` | `2S .. .. .. .. .. .. CC` | Set **satu** relay: `S` = 1 ON / 0 OFF, `CC` = channel (1..48). Response `0x00`. |
| `3` | `3G .. .. .. MM MM MM ..` | Blink 3x beberapa relay grup `G` (bitmask di bit 8–31), lalu ON. |
| `4` | `4S .. .. .. .. N. .. CC` | Blink satu relay `N` kali (1–5, default 3; nibble di bit 20–23), lalu state `S`. |
| `70` | `70 C0 ...` | Baca konfigurasi: `C`=1 IP/CIDR/gateway di EEPROM, 2 = IP aktif, 3 = MAC. |
| `71` | `71 A B C D CIDR G3 G4` | Simpan IP `A.B.C.D`, CIDR, gateway `A.B.G3.G4`. → `0xFC` |
| `72` | `72 M1..M6` (bit 0–47) | Simpan MAC. → `0xFC` |
| `73` | `73 CO K1..K6` | Tulis AES key 6 karakter per potongan (`C` 0 = mulai, 1 = lanjut, 2 = commit; `O` = offset potongan). Commit → `0xFB` |
| `77` | `77 .. .. .. .. .. .. SS` | Polaritas relay: `SS > 0` = aktif HIGH, `0` = aktif LOW. → `0xFC` |
| `78` | `78 .. .. .. .. .. HH LL` | Delay blink (ms). → `0xFC` |
| `79` | `79 .. .. .. .. .. .. LL` | Delay loop (ms). → `0xFC` |
| `7F` | `7F ...` | Factory reset EEPROM. → `0xFC` |

Request v1 (plaintext 4 byte) diubah ke format 8 byte: byte 0 tetap, byte 1–3 pindah ke byte 5–7.
Perintah tipe `7x` ditolak untuk v1.

## Pemetaan ke `DeviceDriver` FunPlay

| Driver | Perintah |
|---|---|
| `setRelay(ch, on)` | tipe `2`, ACK = response byte 0 `0x00` |
| `readAll()` / heartbeat | tipe `0` grup 1 lalu grup 2 |
| Peringatan waktu habis (opsional) | tipe `4` |

## Perilaku dan catatan

- Koneksi putus: relay **tetap** di state terakhir.
- Reboot / listrik mati: semua relay **OFF**. Server harus mengirim ulang desired state setelah device online.
- Tombol reset ada di pin 1 (bentrok dengan TX Serial). Tahan 5 detik = factory reset.
- Firmware tidak memvalidasi channel; driver **wajib** membatasi channel 1..48 (channel 0 menulis pin 1).
- Bug kecil firmware: `processType77` menulis `stateByte[1]` (di luar batas array).
- Kompatibilitas AES `AESLib` (CBC + PKCS7) harus diverifikasi ke perangkat asli sebelum go-live.
