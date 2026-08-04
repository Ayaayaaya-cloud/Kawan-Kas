/* =========================================================
   KAWAN KAS - app.js (v2)
   Backend: Google Apps Script + Google Sheet (real database)
   Auth: Google Sign-In (whitelist email di tab "Users")
   Multi-device, near real-time (polling)
   ========================================================= */

const CONFIG = window.KAWANKAS_CONFIG || {};
const API_URL = CONFIG.API_URL;

const SESSION_TOKEN_KEY = 'kawankas_session_token';
const SESSION_USER_KEY = 'kawankas_session_user';
const SESSION_REPORT_URL_KEY = 'kawankas_report_url';
const CACHE_TX_KEY = 'kawankas_cache_transactions'; // fallback tampilan cepat / offline-read

const POLL_INTERVAL_MS = 20000; // refresh data tiap 20 detik saat app aktif

let state = {
  currentScreen: 'dashboard',
  manualType: 'masuk',
  scanType: 'keluar',
  filter: 'semua',
  currentUser: null, // { email, name, role }
};

let pollTimer = null;

/* ---------- Auto-kategori berdasarkan nama toko ---------- */
const AUTO_CATEGORY_RULES = [
  { keywords: ['indomaret', 'alfamart', 'alfamidi', 'alfa midi'], category: 'Operasional' },
  { keywords: ['pertamina', 'shell', 'spbu', 'pom bensin'], category: 'Transportasi' },
  { keywords: ['grab', 'gojek', 'gocar', 'grabcar', 'maxim'], category: 'Transportasi' },
  { keywords: ['gramedia', 'toko buku', 'atk', 'stationery'], category: 'Peralatan' },
  { keywords: ['kfc', 'mcd', 'mcdonald', 'restoran', 'warung', 'cafe', 'kopi', 'coffee', 'resto'], category: 'Konsumsi' },
  { keywords: ['ace hardware', 'informa', 'depo bangunan'], category: 'Peralatan' },
];

function guessCategory(text) {
  const lower = (text || '').toLowerCase();
  for (const rule of AUTO_CATEGORY_RULES) {
    if (rule.keywords.some((k) => lower.includes(k))) return rule.category;
  }
  return 'Lainnya';
}

/* ================= API HELPER ================= */
// Pakai Content-Type: text/plain agar tidak memicu CORS preflight (batasan Apps Script Web App)
function apiCall(action, data) {
  if (!API_URL || API_URL.indexOf('GANTI_DENGAN') === 0) {
    return Promise.resolve({ success: false, error: 'API_URL belum dikonfigurasi di index.html (KAWANKAS_CONFIG)' });
  }
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  const payload = Object.assign({ action, token }, data || {});
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  })
    .then((res) => res.json())
    .catch((err) => ({ success: false, error: 'Gagal terhubung ke server: ' + err.message }));
}

/* ================= CACHE HELPERS (fallback tampilan cepat) ================= */
function getCachedTransactions() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_TX_KEY)) || [];
  } catch (e) {
    return [];
  }
}
function setCachedTransactions(list) {
  localStorage.setItem(CACHE_TX_KEY, JSON.stringify(list));
}

/* ================= FORMAT HELPERS ================= */
function formatRupiah(n) {
  const num = Number(n) || 0;
  return 'Rp ' + num.toLocaleString('id-ID');
}
function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function nowTimeHM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function formatDateDisplay(iso) {
  if (!iso) return '-';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

/* ================= AUTH FLOW ================= */
function initApp() {
  const savedToken = localStorage.getItem(SESSION_TOKEN_KEY);
  const savedUser = localStorage.getItem(SESSION_USER_KEY);

  if (savedToken && savedUser) {
    // Tampilkan app dari cache dulu (biar cepat), lalu verifikasi sesi di background
    state.currentUser = JSON.parse(savedUser);
    showAppScreen();
    apiCall('verifySession', {}).then((res) => {
      if (!res.success) {
        // sesi kadaluarsa / dicabut -> paksa login ulang
        clearSession();
        showLoginScreen();
      } else {
        if (res.reportUrl) localStorage.setItem(SESSION_REPORT_URL_KEY, res.reportUrl);
        refreshTransactions();
        startPolling();
      }
    });
  } else {
    showLoginScreen();
  }
}

function handleLoginSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  hideLoginError();
  showLoginSpinner(true);

  apiCall('login', { email, password }).then((res) => {
    showLoginSpinner(false);
    if (!res.success) {
      showLoginError(res.error || 'Login gagal');
      return;
    }
    localStorage.setItem(SESSION_TOKEN_KEY, res.token);
    localStorage.setItem(SESSION_USER_KEY, JSON.stringify({ email: res.email, name: res.name, role: res.role }));
    if (res.reportUrl) localStorage.setItem(SESSION_REPORT_URL_KEY, res.reportUrl);
    state.currentUser = { email: res.email, name: res.name, role: res.role };
    document.getElementById('loginPassword').value = '';
    showAppScreen();
    refreshTransactions();
    startPolling();
  });
}

function logoutUser() {
  if (!confirm('Yakin ingin keluar dari akun ini?')) return;
  apiCall('logout', {}).finally(() => {
    clearSession();
    stopPolling();
    location.reload();
  });
}

function clearSession() {
  localStorage.removeItem(SESSION_TOKEN_KEY);
  localStorage.removeItem(SESSION_USER_KEY);
  localStorage.removeItem(SESSION_REPORT_URL_KEY);
  state.currentUser = null;
}

function showLoginScreen() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}
function showAppScreen() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  renderCurrentUserInfo();
  goToScreen('dashboard');
}
function showLoginSpinner(show) {
  document.getElementById('loginSpinner').style.display = show ? 'flex' : 'none';
}
function showLoginError(msg) {
  const el = document.getElementById('loginError');
  el.textContent = msg;
  el.style.display = 'block';
}
function hideLoginError() {
  document.getElementById('loginError').style.display = 'none';
}
function renderCurrentUserInfo() {
  const el = document.getElementById('currentUserInfo');
  if (el && state.currentUser) {
    el.textContent = state.currentUser.name + ' (' + state.currentUser.email + ')';
  }
}

/* ================= POLLING (near real-time sync) ================= */
function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (state.currentScreen === 'dashboard' || state.currentScreen === 'riwayat' || state.currentScreen === 'laporan') {
      refreshTransactions(true);
    }
  }, POLL_INTERVAL_MS);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

/* ================= NAVIGATION ================= */
function goToScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  const navBtn = document.querySelector('.nav-btn[data-nav="' + name + '"]');
  if (navBtn) navBtn.classList.add('active');

  const topbar = document.getElementById('topbar');
  topbar.style.display = name === 'dashboard' ? 'block' : 'none';

  state.currentScreen = name;

  if (name === 'dashboard') renderDashboard();
  if (name === 'riwayat') renderRiwayat();
  if (name === 'laporan') renderLaporan();
  if (name === 'input') {
    document.getElementById('inputTanggal').value = todayISO();
    document.getElementById('inputWaktu').value = nowTimeHM();
  }
  if (name === 'settings') {
    renderCurrentUserInfo();
  }
}

/* ================= TOAST ================= */
function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = (type === 'success' ? '✅ ' : '⚠️ ') + message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

/* ================= SYNC DATA DARI SPREADSHEET ================= */
function refreshTransactions(silent) {
  return apiCall('getTransactions', {}).then((res) => {
    if (res.success) {
      setCachedTransactions(res.transactions);
      if (state.currentScreen === 'dashboard') renderDashboard();
      if (state.currentScreen === 'riwayat') renderRiwayat();
      if (state.currentScreen === 'laporan') renderLaporan();
    } else if (!silent) {
      showToast(res.error || 'Gagal memuat data terbaru, menampilkan cache lokal', 'error');
    }
    return res;
  });
}

function manualRefresh() {
  showToast('Menyegarkan data...');
  refreshTransactions();
}

function openReportSpreadsheet() {
  const url = localStorage.getItem(SESSION_REPORT_URL_KEY);
  if (!url) {
    showToast('Link laporan belum tersedia, coba refresh halaman / login ulang', 'error');
    return;
  }
  window.open(url, '_blank');
}

/* ================= LAPORAN (in-app) ================= */
let laporanPeriod = 'bulan';

function setLaporanPeriod(p) {
  laporanPeriod = p;
  document.querySelectorAll('#screen-laporan .filter-chip').forEach((c) => c.classList.toggle('active', c.dataset.period === p));
  renderLaporan();
}

function renderLaporan() {
  let list = getCachedTransactions();

  if (laporanPeriod === 'bulan') {
    const ym = todayISO().slice(0, 7); // yyyy-mm
    list = list.filter((tx) => (tx.date || '').startsWith(ym));
  }

  const totalIn = list.filter((t) => t.type === 'masuk').reduce((a, t) => a + Number(t.amount), 0);
  const totalOut = list.filter((t) => t.type === 'keluar').reduce((a, t) => a + Number(t.amount), 0);

  document.getElementById('laporanTotalIn').textContent = formatRupiah(totalIn);
  document.getElementById('laporanTotalOut').textContent = formatRupiah(totalOut);
  document.getElementById('laporanSaldo').textContent = formatRupiah(totalIn - totalOut);

  renderKategoriBreakdown(list.filter((t) => t.type === 'keluar'), totalOut, 'laporanKategoriKeluar', 'out');
  renderKategoriBreakdown(list.filter((t) => t.type === 'masuk'), totalIn, 'laporanKategoriMasuk', 'in');
}

function renderKategoriBreakdown(list, total, containerId, cls) {
  const container = document.getElementById(containerId);
  if (!list.length) {
    container.innerHTML = emptyState('Belum ada data pada periode ini.');
    return;
  }
  const map = {};
  list.forEach((tx) => {
    const cat = tx.category || 'Lainnya';
    map[cat] = (map[cat] || 0) + Number(tx.amount);
  });
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);

  container.innerHTML = entries.map(([cat, amt]) => {
    const pct = total > 0 ? Math.round((amt / total) * 100) : 0;
    return `
      <div class="report-cat-item">
        <div class="report-cat-top">
          <span class="name">${escapeHtml(cat)}</span>
          <span class="amount">${formatRupiah(amt)}</span>
        </div>
        <div class="report-cat-bar-track"><div class="report-cat-bar-fill ${cls}" style="width:${pct}%;"></div></div>
        <div class="report-cat-percent">${pct}% dari total</div>
      </div>`;
  }).join('');
}

/* ================= DASHBOARD ================= */
function renderDashboard() {
  const list = getCachedTransactions();
  let totalIn = 0, totalOut = 0;
  list.forEach((tx) => {
    if (tx.type === 'masuk') totalIn += Number(tx.amount);
    else totalOut += Number(tx.amount);
  });
  const balance = totalIn - totalOut;

  document.getElementById('balanceValue').textContent = formatRupiah(balance);
  document.getElementById('totalIn').textContent = formatRupiah(totalIn);
  document.getElementById('totalOut').textContent = formatRupiah(totalOut);
  document.getElementById('todayDate').textContent = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

  const recent = list.slice(0, 6);
  const container = document.getElementById('recentTxList');
  container.innerHTML = recent.length ? recent.map(renderTxItem).join('') : emptyState('Belum ada transaksi. Tap "Scan Struk" atau "Tambah Transaksi" untuk mulai mencatat.');
}

function emptyState(msg) {
  return `<div class="empty-state">${msg}</div>`;
}

function renderTxItem(tx) {
  const isIn = tx.type === 'masuk';
  const receiptLink = tx.receiptLink
    ? `<a class="tx-receipt-link" href="${tx.receiptLink}" target="_blank" rel="noopener">📎 Lihat struk</a>`
    : '';
  const createdBy = tx.createdBy ? `<span class="tx-receipt-link">👤 ${escapeHtml(tx.createdBy)}</span>` : '';
  return `
    <div class="tx-item">
      <div class="tx-icon ${isIn ? 'in' : 'out'}">${isIn ? '↓' : '↑'}</div>
      <div class="tx-info">
        <div class="tx-desc">${escapeHtml(tx.description || tx.category)}</div>
        <div class="tx-meta">${formatDateDisplay(tx.date)}${tx.time ? ' • ' + escapeHtml(tx.time) : ''} • ${escapeHtml(tx.category)}</div>
        ${receiptLink} ${createdBy}
      </div>
      <div class="tx-amount ${isIn ? 'in' : 'out'}">${isIn ? '+' : '-'}${formatRupiah(tx.amount)}</div>
    </div>`;
}

/* ================= RIWAYAT ================= */
function setFilter(f) {
  state.filter = f;
  document.querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c.dataset.filter === f));
  renderRiwayat();
}

function renderRiwayat() {
  const all = getCachedTransactions();
  let list = all;
  if (state.filter !== 'semua') list = all.filter((tx) => tx.type === state.filter);

  const totalIn = all.filter((t) => t.type === 'masuk').reduce((a, t) => a + Number(t.amount), 0);
  const totalOut = all.filter((t) => t.type === 'keluar').reduce((a, t) => a + Number(t.amount), 0);
  document.getElementById('riwayatTotalIn').textContent = formatRupiah(totalIn);
  document.getElementById('riwayatTotalOut').textContent = formatRupiah(totalOut);

  const container = document.getElementById('fullTxList');
  container.innerHTML = list.length ? list.map(renderTxItem).join('') : emptyState('Tidak ada transaksi pada filter ini.');
}

/* ================= INPUT MANUAL ================= */
function setTxType(type) {
  state.manualType = type;
  document.getElementById('typeInBtn').classList.toggle('active', type === 'masuk');
  document.getElementById('typeOutBtn').classList.toggle('active', type === 'keluar');
}

function submitManualTransaction() {
  const tanggal = document.getElementById('inputTanggal').value;
  const nominal = document.getElementById('inputNominal').value;
  const kategori = document.getElementById('inputKategori').value;
  const deskripsi = document.getElementById('inputDeskripsi').value.trim();

  if (!tanggal || !nominal || Number(nominal) <= 0) {
    showToast('Tanggal dan nominal wajib diisi dengan benar', 'error');
    return;
  }

  const tx = {
    date: tanggal,
    time: document.getElementById('inputWaktu').value || nowTimeHM(),
    type: state.manualType,
    amount: Number(nominal),
    category: kategori,
    description: deskripsi || kategori,
    receiptLink: document.getElementById('inputDriveLink').value || '',
  };

  showToast('Menyimpan transaksi...');
  apiCall('addTransaction', { data: tx }).then((res) => {
    if (!res.success) {
      showToast(res.error || 'Gagal menyimpan transaksi', 'error');
      return;
    }
    showToast('Transaksi berhasil disimpan ke spreadsheet');
    document.getElementById('inputNominal').value = '';
    document.getElementById('inputDeskripsi').value = '';
    document.getElementById('inputDriveLink').value = '';
    document.getElementById('manualReceiptPreviewWrap').innerHTML = '';
    refreshTransactions();
    goToScreen('dashboard');
  });
}

/* ================= SCAN STRUK + OCR ================= */
let currentReceiptDataUrl = null;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('inputTanggal').value = todayISO();
  document.getElementById('receiptCameraInput').addEventListener('change', handleReceiptFile);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch((err) => {
      console.warn('Service worker gagal didaftarkan:', err);
    });
  }

  initApp();
});

function setScanTxType(type) {
  state.scanType = type;
  document.getElementById('scanTypeInBtn').classList.toggle('active', type === 'masuk');
  document.getElementById('scanTypeOutBtn').classList.toggle('active', type === 'keluar');
}

function resetScanScreen() {
  document.getElementById('scanBoxInitial').style.display = 'block';
  document.getElementById('scanResultArea').style.display = 'none';
  document.getElementById('receiptCameraInput').value = '';
  currentReceiptDataUrl = null;
}

function handleReceiptFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (ev) => {
    currentReceiptDataUrl = ev.target.result;

    document.getElementById('scanBoxInitial').style.display = 'none';
    document.getElementById('scanResultArea').style.display = 'block';
    document.getElementById('receiptPreviewImg').src = currentReceiptDataUrl;
    document.getElementById('scanTanggal').value = todayISO();
    document.getElementById('scanWaktu').value = nowTimeHM();
    document.getElementById('scanNominal').value = '';
    document.getElementById('scanDeskripsi').value = '';
    document.getElementById('scanRawText').value = '';
    document.getElementById('scanDriveLink').value = '';

    const ocrStatus = document.getElementById('ocrStatus');
    ocrStatus.style.display = 'flex';
    document.getElementById('ocrStatusText').textContent = 'Membaca struk dengan OCR...';

    try {
      const result = await Tesseract.recognize(currentReceiptDataUrl, 'ind+eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            document.getElementById('ocrStatusText').textContent =
              'Membaca struk... ' + Math.round(m.progress * 100) + '%';
          }
        },
      });

      const text = result.data.text || '';
      document.getElementById('scanRawText').value = text;
      applyOcrParsing(text);
      ocrStatus.style.display = 'none';
      showToast('Struk berhasil dipindai! Silakan cek hasilnya');
    } catch (err) {
      console.error(err);
      ocrStatus.style.display = 'none';
      showToast('OCR gagal membaca struk, silakan isi manual', 'error');
    }

    // Upload ke Google Drive lewat backend (berjalan di background, tidak menghalangi input)
    uploadReceiptToDrive(currentReceiptDataUrl, file.name);
  };
  reader.readAsDataURL(file);
}

/* ---------- Parsing hasil OCR ---------- */
function applyOcrParsing(rawText) {
  const nominal = extractNominal(rawText);
  const tanggal = extractDate(rawText);
  const namaToko = extractStoreName(rawText);

  if (nominal) document.getElementById('scanNominal').value = nominal;
  if (tanggal) document.getElementById('scanTanggal').value = tanggal;
  document.getElementById('scanDeskripsi').value = namaToko || 'Struk belanja';

  const kategori = guessCategory((namaToko || '') + ' ' + rawText);
  document.getElementById('scanKategori').value = kategori;
}

function extractNominal(text) {
  const lines = text.split('\n');
  const totalKeywords = ['total', 'jumlah', 'grand total', 'total bayar', 'total belanja'];
  let candidates = [];

  lines.forEach((line) => {
    const lowerLine = line.toLowerCase();
    const numMatches = line.match(/[\d.,]{4,}/g);
    if (!numMatches) return;
    numMatches.forEach((raw) => {
      const cleaned = cleanNumberString(raw);
      if (cleaned && cleaned >= 500) {
        const isTotalLine = totalKeywords.some((k) => lowerLine.includes(k));
        candidates.push({ value: cleaned, isTotal: isTotalLine });
      }
    });
  });

  if (!candidates.length) return null;
  const totalCandidates = candidates.filter((c) => c.isTotal);
  const pool = totalCandidates.length ? totalCandidates : candidates;
  pool.sort((a, b) => b.value - a.value);
  return pool[0].value;
}

function cleanNumberString(raw) {
  let s = raw.trim();
  s = s.replace(/[^\d.,]/g, '');
  const digitsOnly = s.replace(/[.,]/g, '');
  if (!digitsOnly) return null;
  const num = parseInt(digitsOnly, 10);
  if (isNaN(num)) return null;
  return num;
}

function extractDate(text) {
  const patterns = [/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      let [, d, mo, y] = m;
      if (y.length === 2) y = '20' + y;
      d = d.padStart(2, '0');
      mo = mo.padStart(2, '0');
      const monthNum = parseInt(mo, 10);
      const dayNum = parseInt(d, 10);
      if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
        return `${y}-${mo}-${d}`;
      }
    }
  }
  return null;
}

function extractStoreName(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 5)) {
    if (line.length >= 3 && !/^[\d.,\-\/\s]+$/.test(line)) {
      return line.slice(0, 60);
    }
  }
  return null;
}

/* ---------- Submit hasil scan ---------- */
function submitScanTransaction() {
  const tanggal = document.getElementById('scanTanggal').value;
  const nominal = document.getElementById('scanNominal').value;
  const kategori = document.getElementById('scanKategori').value;
  const deskripsi = document.getElementById('scanDeskripsi').value.trim();

  if (!tanggal || !nominal || Number(nominal) <= 0) {
    showToast('Tanggal dan nominal wajib diisi dengan benar', 'error');
    return;
  }

  const tx = {
    date: tanggal,
    time: document.getElementById('scanWaktu').value || nowTimeHM(),
    type: state.scanType,
    amount: Number(nominal),
    category: kategori,
    description: deskripsi || kategori,
    receiptLink: document.getElementById('scanDriveLink').value || '',
  };

  showToast('Menyimpan transaksi...');
  apiCall('addTransaction', { data: tx }).then((res) => {
    if (!res.success) {
      showToast(res.error || 'Gagal menyimpan transaksi', 'error');
      return;
    }
    showToast('Transaksi dari struk berhasil disimpan ke spreadsheet');
    resetScanScreen();
    refreshTransactions();
    goToScreen('dashboard');
  });
}

/* ================= UPLOAD KE GOOGLE DRIVE (lewat backend) ================= */
function uploadReceiptToDrive(dataUrl, filename) {
  const base64 = dataUrl.split(',')[1];
  apiCall('uploadReceipt', {
    filename: filename || ('struk_' + Date.now() + '.jpg'),
    mimeType: 'image/jpeg',
    base64data: base64,
  }).then((res) => {
    if (res.success && res.url) {
      document.getElementById('scanDriveLink').value = res.url;
      document.getElementById('inputDriveLink').value = res.url;
      showToast('Struk berhasil diunggah ke Google Drive');
    } else if (!res.success) {
      console.warn('Upload ke Google Drive gagal:', res.error);
    }
  });
}
