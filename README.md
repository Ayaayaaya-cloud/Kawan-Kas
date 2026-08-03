# Kawan Kas - Aplikasi Keuangan Internal (PWA + Google Sheet Real-Time)

Aplikasi pencatatan keuangan internal, multi-device, database Google Spreadsheet
asli, login email+password sederhana, dan scan struk otomatis (OCR). Semua
environment gratis: GitHub Pages (hosting), Google Sheets (database),
Google Apps Script (backend), Google Drive (simpan foto struk).

**Tidak perlu Google Cloud Console / OAuth Client ID sama sekali** — login
memakai email + password yang Bapak buat & simpan sendiri di spreadsheet.

## 📁 Isi Folder

- `index.html` — halaman utama + konfigurasi (API_URL) + layar login
- `style.css` — tampilan mobile-first ala fintech
- `app.js` — logika aplikasi: auth, sinkronisasi data, form, OCR
- `manifest.json` + `service-worker.js` — agar bisa di-install sebagai PWA
- `Code.gs` — **backend Google Apps Script** (paste ke Google Sheet Anda)
- `icons/` — icon aplikasi

## 🏗️ Arsitektur

```
[HP/Laptop 1] ─┐
[HP/Laptop 2] ─┼─► GitHub Pages (PWA) ─► Google Apps Script (API) ─► Google Sheet (data)
[HP/Laptop 3] ─┘                                     │
                                                      └─► Google Drive (foto struk)
```

Semua device baca/tulis ke Spreadsheet yang sama. Data ter-refresh otomatis tiap
20 detik saat Dashboard/Riwayat dibuka, atau tap "Refresh Data" manual di Setelan.

---

## 🚀 SETUP — Lakukan Berurutan (± 15 menit, tanpa Google Cloud Console)

### Langkah 1 — Buat Google Spreadsheet
1. Buka https://sheets.google.com → buat spreadsheet baru, beri nama "Kawan Kas - Database".
2. Copy **ID spreadsheet** dari URL-nya:
   `https://docs.google.com/spreadsheets/d/`**`ID_INI_YANG_DICOPY`**`/edit`

### Langkah 2 — Buat folder Google Drive untuk foto struk
1. Buka https://drive.google.com → buat folder baru, misal "Struk Kawan Kas".
2. Copy **ID folder** dari URL-nya:
   `https://drive.google.com/drive/folders/`**`ID_INI_YANG_DICOPY`**

### Langkah 3 — Pasang Backend (Code.gs) di Spreadsheet
1. Buka spreadsheet dari Langkah 1 → menu **Extensions → Apps Script**.
2. Hapus semua kode default, paste seluruh isi file `Code.gs` (disertakan di folder ini).
3. Isi 2 variabel di baris paling atas kode:
   ```js
   const SPREADSHEET_ID = 'ID dari Langkah 1';
   const DRIVE_FOLDER_ID = 'ID dari Langkah 2';
   ```
4. Di dropdown fungsi (sebelah tombol ▶ Run), pilih **setupSheets**, klik **Run**.
   - Akan diminta izin akses (Authorize) — klik lanjutkan meski muncul peringatan
     "unverified app" (klik "Advanced" → "Go to ... (unsafe)"), ini normal untuk
     script pribadi milik sendiri.
   - Setelah sukses, 3 tab baru otomatis muncul di spreadsheet: **Users**,
     **Transaksi**, **Sessions**.
5. **Tutup lalu buka ulang spreadsheet-nya** (bukan Apps Script editor, tapi
   file spreadsheet-nya) — ini supaya menu custom "Kawan Kas" muncul di menu
   bar spreadsheet (sebelah menu Help).

### Langkah 4 — Buat Akun Login untuk Tim (2-3 orang)
1. Di menu bar spreadsheet, klik **Kawan Kas → Generate Password Hash**.
2. Ketik password yang mau dipakai untuk 1 orang (contoh: `kawan123`), klik OK.
3. Akan muncul kotak berisi **hash** (deretan huruf-angka acak) — copy hash tsb.
4. Buka tab **Users**, isi 1 baris untuk orang tersebut:

   | Email              | Nama  | PasswordHash          | Role  | Aktif |
   |--------------------|-------|-----------------------|-------|-------|
   | budi@gmail.com     | Budi  | *(paste hash di sini)* | admin | TRUE  |

   - Kolom **Email** bebas — tidak harus akun Gmail asli, boleh email apapun
     yang mudah diingat orang tsb, karena hanya dipakai sebagai username.
   - Kolom **Aktif** wajib diisi `TRUE` (huruf kapital).
5. Ulangi Langkah 4.1–4.4 untuk tiap anggota tim (2-3 orang), masing-masing
   boleh pakai password berbeda.
6. Beri tahu masing-masing orang **email + password asli** mereka (bukan hash-nya)
   secara langsung/japri — jangan lewat channel yang mudah dilihat orang lain.

### Langkah 5 — Deploy sebagai Web App
1. Kembali ke Apps Script editor (Extensions → Apps Script).
2. Klik **Deploy → New deployment**.
3. Klik ikon gear ⚙️ di "Select type" → pilih **Web app**.
4. Execute as: **Me**. Who has access: **Anyone**.
5. Klik **Deploy** → copy **URL Web app** yang diakhiri `/exec`.

### Langkah 6 — Hubungkan Frontend ke Backend
1. Buka `index.html`, cari bagian:
   ```js
   window.KAWANKAS_CONFIG = {
     API_URL: 'GANTI_DENGAN_URL_WEB_APP_APPS_SCRIPT_ANDA',
   };
   ```
2. Ganti `API_URL` dengan URL dari Langkah 5.5.
3. Upload ulang `index.html` yang sudah diedit ke GitHub repo Anda (replace file lama,
   pastikan letaknya langsung di root repo, bukan di dalam subfolder).

### Langkah 7 — Selesai, Test!
1. Buka URL GitHub Pages Anda di HP/laptop.
2. Akan muncul layar login → isi email + password yang sudah dibuat di Langkah 4.
3. Coba tambah transaksi manual atau scan struk → cek apakah baris baru muncul
   otomatis di tab **Transaksi** pada spreadsheet.
4. Login dari device lain dengan akun lain yang juga terdaftar → pastikan data
   yang sama muncul (tunggu ~20 detik atau tap Refresh di Setelan).

---

## 📲 Cara Install ke HP ("Add to Home Screen")

### Android (Chrome)
1. Buka URL aplikasi di Chrome → menu titik tiga (⋮) → **"Add to Home screen"**.
2. Tap **Install**.

### iPhone (Safari)
1. Buka URL aplikasi di **Safari** (harus Safari, bukan Chrome).
2. Tap ikon **Share** → **"Add to Home Screen"** → **Add**.

---

## 🧾 Cara Pakai

1. **Login** dengan email + password yang sudah didaftarkan admin.
2. **Dashboard** menampilkan saldo, total masuk/keluar, transaksi terbaru — datanya
   langsung dari spreadsheet, sama untuk semua device yang login.
3. **Scan Struk**: ambil foto struk → OCR otomatis baca nominal/tanggal/nama toko →
   form muncul editable → foto otomatis terupload ke Google Drive di background →
   simpan → langsung masuk ke tab Transaksi di spreadsheet.
4. **Tambah Transaksi**: input manual tanpa foto.
5. **Riwayat**: semua transaksi dengan filter Masuk/Keluar.
6. **Setelan**: lihat siapa yang sedang login, logout, atau refresh data manual.

## 👥 Kelola User Tim

- **Tambah user baru**: jalankan menu Kawan Kas → Generate Password Hash, lalu
  tambah baris baru di tab Users dengan hash tsb.
- **Nonaktifkan user**: ubah kolom Aktif jadi FALSE (tanpa perlu hapus datanya).
- **Ganti password user**: generate hash baru, replace nilai di kolom PasswordHash
  baris user tsb.

## 📊 Lihat Laporan Langsung dari Spreadsheet

Karena semua transaksi masuk ke tab **Transaksi** di Google Sheet, Anda bisa langsung:
- Buat Pivot Table untuk rekap bulanan per kategori
- Pasang chart/grafik bawaan Google Sheets
- Export ke Excel/PDF kapan saja
- Hubungkan ke Looker Studio (gratis) untuk dashboard laporan yang lebih visual

## ⚠️ Catatan Keamanan & Batasan

- Password disimpan dalam bentuk **hash SHA-256** (bukan teks biasa) di kolom
  PasswordHash, jadi meskipun spreadsheet-nya dilihat orang lain, password asli
  tidak langsung terbaca.
- Ini sistem login sederhana untuk kebutuhan internal 2-3 orang — bukan
  enterprise-grade (tidak ada "lupa password" otomatis, 2FA, dsb). Untuk
  kebutuhan itu ganti password lewat menu Kawan Kas kapan saja.
- Jangan sebarkan **URL API** (`/exec`) atau URL spreadsheet secara publik.
- **Setiap kali EDIT `Code.gs`**, buat deployment baru: Deploy → Manage
  deployments → klik ✏️ pada deployment aktif → Version: **New version** → Deploy.
  URL `/exec` tetap sama, tidak perlu ganti di `index.html`.
- **OCR (Tesseract.js)** berjalan di HP, akurasi tergantung kualitas foto — hasil
  SELALU bisa diedit sebelum disimpan.
- Kalau tim berkembang lebih besar / butuh keamanan lebih tinggi, langkah
  berikutnya adalah migrasi dari Google Sheet ke database sungguhan (Supabase/
  Firebase) dengan auth yang lebih matang — beri tahu Mr. CTO kalau sudah waktunya.

## 🔧 Kustomisasi Cepat

- **Kategori transaksi**: edit `<option>` di `index.html`.
- **Aturan auto-kategori dari nama toko**: edit array `AUTO_CATEGORY_RULES` di `app.js`.
- **Warna/branding**: edit variabel CSS `--emerald-*` / `--gold-*` di `style.css`.
- **Durasi sesi login**: ubah `SESSION_DURATION_MS` di `Code.gs`.
- **Interval auto-refresh data**: ubah `POLL_INTERVAL_MS` di `app.js`.
