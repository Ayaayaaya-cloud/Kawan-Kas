/**
 * ============================================================================
 * KAWAN KAS - BACKEND API (Google Apps Script)
 * ============================================================================
 * Backend ini menjadikan Google Spreadsheet sebagai database (tabel Transaksi,
 * Users, Sessions) dan Google Drive sebagai penyimpanan foto struk.
 *
 * LOGIN: pakai EMAIL + PASSWORD biasa yang disimpan di tab "Users" (password
 * disimpan dalam bentuk hash, bukan teks biasa). TIDAK PERLU Google Cloud
 * Console / OAuth Client ID sama sekali — jauh lebih simpel untuk setup.
 *
 * CARA SETUP — ikuti urutan ini:
 *
 * 1. Buat Google Spreadsheet baru (kosong), beri nama misalnya
 *    "Kawan Kas - Database". Copy ID-nya dari URL:
 *    https://docs.google.com/spreadsheets/d/ID_SPREADSHEET_DISINI/edit
 *
 * 2. Buat folder di Google Drive untuk simpan foto struk. Copy ID folder
 *    dari URL: https://drive.google.com/drive/folders/ID_FOLDER_DISINI
 *
 * 3. Di spreadsheet tsb, buka menu Extensions -> Apps Script.
 *    Hapus isi default, paste SELURUH kode file ini.
 *
 * 4. Isi 2 variabel di bawah ini: SPREADSHEET_ID dan DRIVE_FOLDER_ID.
 *
 * 5. Di editor Apps Script, pilih fungsi "setupSheets" dari dropdown
 *    fungsi (di sebelah tombol Run), lalu klik Run. Ini akan membuat
 *    3 tab (Users, Transaksi, Sessions) otomatis dengan header yang benar.
 *    Izinkan akses saat diminta (Authorize) — klik "Advanced" lalu
 *    "Go to ... (unsafe)" jika muncul peringatan, ini normal untuk script pribadi.
 *
 * 6. TUTUP dan BUKA ULANG spreadsheet-nya (supaya menu custom "Kawan Kas"
 *    muncul di menu bar spreadsheet, di sebelah Help).
 *
 * 7. Buka tab "Users", isi baris pertama untuk tiap anggota tim:
 *    kolom Email, Nama, Role (admin/staff), Aktif (isi TRUE).
 *    Untuk kolom PasswordHash, JANGAN diisi manual — gunakan menu:
 *    "Kawan Kas" (di menu bar spreadsheet) -> "Generate Password Hash"
 *    -> masukkan password yang diinginkan untuk user tsb -> hash yang
 *    muncul di-copy-paste ke kolom PasswordHash baris user tersebut.
 *    Ulangi untuk tiap user. Beri tahu masing-masing password aslinya
 *    (bukan hash-nya) ke orangnya langsung.
 *
 * 8. Deploy sebagai Web App:
 *    - Klik "Deploy" -> "New deployment"
 *    - Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 *    - Klik Deploy, copy URL yang diakhiri /exec
 *
 * 9. Tempel URL tsb ke variabel API_URL di file index.html (bagian
 *    KAWANKAS_CONFIG).
 *
 * CATATAN: Setiap kali Anda EDIT kode Code.gs ini, buat deployment BARU
 * (Deploy -> Manage deployments -> Edit -> New version) agar perubahan
 * aktif di URL yang sama.
 * ============================================================================
 */

const SPREADSHEET_ID = 'GANTI_DENGAN_ID_SPREADSHEET_ANDA';
const DRIVE_FOLDER_ID = 'GANTI_DENGAN_ID_FOLDER_DRIVE_ANDA';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // sesi login berlaku 7 hari
const PASSWORD_SALT = 'kawankas-salt-ganti-jika-mau-2026'; // opsional diganti, bukan wajib

/* ============================================================
   SETUP AWAL — jalankan sekali dari editor Apps Script
   ============================================================ */
function setupSheets() {
  getSheet('Users');
  getSheet('Transaksi');
  getSheet('Sessions');
  Logger.log('Setup selesai. Buka ulang spreadsheet, lalu isi tab "Users".');
}

/* ============================================================
   MENU CUSTOM DI SPREADSHEET — untuk generate hash password
   ============================================================ */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Kawan Kas')
    .addItem('Generate Password Hash', 'showHashDialog')
    .addToUi();
}

function showHashDialog() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt(
    'Generate Password Hash',
    'Ketik password yang ingin dipakai untuk user ini (contoh: kawan123):',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const password = resp.getResponseText().trim();
  if (!password) {
    ui.alert('Password tidak boleh kosong.');
    return;
  }
  const hash = hashPassword(password);
  ui.alert(
    'Hash Password Berhasil Dibuat',
    'Copy teks di bawah ini ke kolom "PasswordHash" pada baris user yang sesuai di tab Users:\n\n' + hash +
    '\n\nJangan lupa beri tahu password ASLI-nya ("' + password + '") ke orang yang bersangkutan secara langsung/japri.',
    ui.ButtonSet.OK
  );
}

function hashPassword(password) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + PASSWORD_SALT);
  return digest.map((b) => ((b < 0 ? b + 256 : b).toString(16).padStart(2, '0'))).join('');
}

/* ============================================================
   ENTRY POINT
   ============================================================ */
function doPost(e) {
  let result;
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    switch (action) {
      case 'login':
        result = handleLogin(body.email, body.password);
        break;
      case 'verifySession':
        result = handleVerifySession(body.token);
        break;
      case 'getTransactions':
        result = withSession(body.token, () => getTransactionsList());
        break;
      case 'addTransaction':
        result = withSession(body.token, (user) => addTransactionRow(body.data, user));
        break;
      case 'uploadReceipt':
        result = withSession(body.token, () => uploadReceiptFile(body.base64data, body.filename, body.mimeType));
        break;
      case 'logout':
        result = handleLogout(body.token);
        break;
      default:
        result = { success: false, error: 'Aksi tidak dikenal: ' + action };
    }
  } catch (err) {
    result = { success: false, error: err.toString() };
  }
  return jsonResponse(result);
}

function doGet(e) {
  return jsonResponse({ status: 'Kawan Kas API aktif' });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
   AUTH — LOGIN EMAIL + PASSWORD
   ============================================================ */
function handleLogin(email, password) {
  if (!email || !password) return { success: false, error: 'Email dan password wajib diisi' };

  const userRecord = findUserByEmail(email);
  if (!userRecord) {
    return { success: false, error: 'Email "' + email + '" belum terdaftar. Hubungi admin.' };
  }
  if (!userRecord.aktif) {
    return { success: false, error: 'Akun ini belum diaktifkan. Hubungi admin.' };
  }
  const inputHash = hashPassword(password);
  if (inputHash !== userRecord.passwordHash) {
    return { success: false, error: 'Password salah' };
  }

  const token = createSession(userRecord.email, userRecord.nama);
  return { success: true, token: token, email: userRecord.email, name: userRecord.nama, role: userRecord.role };
}

function findUserByEmail(email) {
  const sheet = getSheet('Users');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === String(email).trim().toLowerCase()) {
      const aktifRaw = data[i][4];
      const aktif = aktifRaw === true || String(aktifRaw).trim().toUpperCase() === 'TRUE';
      return {
        email: data[i][0],
        nama: data[i][1],
        passwordHash: data[i][2],
        role: data[i][3],
        aktif: aktif,
      };
    }
  }
  return null;
}

function createSession(email, name) {
  const sheet = getSheet('Sessions');
  const token = Utilities.getUuid();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DURATION_MS);
  sheet.appendRow([token, email, name, now.toISOString(), expires.toISOString()]);
  return token;
}

function handleVerifySession(token) {
  const user = getSessionUser(token);
  if (!user) return { success: false, error: 'Sesi tidak valid, silakan login ulang' };
  return { success: true, email: user.email, name: user.name };
}

function getSessionUser(token) {
  if (!token) return null;
  const sheet = getSheet('Sessions');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === token) {
      const expires = new Date(data[i][4]);
      if (isNaN(expires.getTime()) || expires.getTime() < Date.now()) return null;
      return { email: data[i][1], name: data[i][2] };
    }
  }
  return null;
}

function withSession(token, fn) {
  const user = getSessionUser(token);
  if (!user) return { success: false, error: 'Sesi tidak valid, silakan login ulang' };
  return fn(user);
}

function handleLogout(token) {
  const sheet = getSheet('Sessions');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === token) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return { success: true };
}

/* ============================================================
   TRANSAKSI (baca & tulis ke tab "Transaksi")
   ============================================================ */
function getTransactionsList() {
  const sheet = getSheet('Transaksi');
  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    rows.push({
      id: data[i][0],
      timestamp: data[i][1],
      date: formatDateCell(data[i][2]),
      type: data[i][3],
      amount: Number(data[i][4]) || 0,
      category: data[i][5],
      description: data[i][6],
      receiptLink: data[i][7] || '',
      createdBy: data[i][8] || '',
    });
  }
  rows.reverse(); // transaksi terbaru tampil duluan
  return { success: true, transactions: rows };
}

function formatDateCell(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return val;
}

function addTransactionRow(tx, user) {
  if (!tx || !tx.date || !tx.amount || !tx.type) {
    return { success: false, error: 'Data transaksi tidak lengkap' };
  }
  const sheet = getSheet('Transaksi');
  const id = 'tx_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  const now = new Date();
  sheet.appendRow([
    id,
    now.toISOString(),
    tx.date,
    tx.type,
    Number(tx.amount),
    tx.category || 'Lainnya',
    tx.description || '',
    tx.receiptLink || '',
    user.name + ' (' + user.email + ')',
  ]);
  return { success: true, id: id };
}

/* ============================================================
   UPLOAD STRUK KE GOOGLE DRIVE
   ============================================================ */
function uploadReceiptFile(base64data, filename, mimeType) {
  if (!base64data) return { success: false, error: 'Tidak ada data gambar' };
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const bytes = Utilities.base64Decode(base64data);
  const blob = Utilities.newBlob(bytes, mimeType || 'image/jpeg', filename || ('struk_' + Date.now() + '.jpg'));
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { success: true, url: file.getUrl(), fileId: file.getId() };
}

/* ============================================================
   HELPER — Ambil / buat sheet tab dengan header default
   ============================================================ */
function getSheet(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === 'Users') {
      sheet.appendRow(['Email', 'Nama', 'PasswordHash', 'Role', 'Aktif']);
      sheet.getRange('A1:E1').setFontWeight('bold');
    }
    if (name === 'Transaksi') {
      sheet.appendRow(['ID', 'Timestamp', 'Tanggal', 'Jenis', 'Nominal', 'Kategori', 'Deskripsi', 'ReceiptLink', 'DibuatOleh']);
      sheet.getRange('A1:I1').setFontWeight('bold');
    }
    if (name === 'Sessions') {
      sheet.appendRow(['Token', 'Email', 'Nama', 'DibuatPada', 'Kadaluarsa']);
      sheet.getRange('A1:E1').setFontWeight('bold');
    }
  }
  return sheet;
}
