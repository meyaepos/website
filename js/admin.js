/**
 * MEYA 管理員專區核心腳本
 * 包含：登入密鑰驗證鎖、儀表板同步、Excel 動態建庫、標準匯出、圖檔排版壓縮 (<2MB)、跑馬燈與異常監控
 */

// ================= 全域參數與狀態 =================
const MAX_IMAGE_WIDTH = 1600;
const MAX_BYTES_LIMIT = 2 * 1024 * 1024;
const IMPORT_CHUNK_SIZE = 500;
const CORE_PRODUCT_KEYS = ['id', 'name', 'price', 'image', '狀態'];

const CORE_SYNONYMS = {
  id: ['id', 'sku', '貨號', '品號', '商品編號', '編號', '產品代碼', '款號'],
  name: ['name', 'title', '品名', '商品名稱', '產品名稱', '名稱'],
  price: ['price', '售價', '定價', '單價', '價格', '門市價'],
  image: ['image', 'img', '圖片', '圖片網址', '照片', '主圖'],
  '狀態': ['狀態', 'status', '上下架', '上架狀態']
};

const AdminState = {
  products: [],
  productHeaders: [...CORE_PRODUCT_KEYS],
  announcements: [],
  errors: [],
  rawDriveImages: [],

  workbook: null,
  fileName: '',
  rawMatrix: [],
  columnMappings: [],
  importMode: 'MERGE_PRODUCTS',

  activeProductId: '',
  loadedSourceImage: null
};

// ================= 初始化與事件綁定 =================
document.addEventListener('DOMContentLoaded', () => {
  bindStaticEvents();

  // 若本次瀏覽器工作階段已存有密鑰，直接嘗試自動驗證解鎖；否則停留在鎖定畫面
  const savedToken = sessionStorage.getItem('MEYA_ADMIN_TOKEN');
  if (savedToken !== null) {
    document.getElementById('login-token-input').value = savedToken;
    verifyAndUnlock(savedToken);
  } else {
    document.getElementById('login-token-input').focus();
  }
});

function bindStaticEvents() {
  // 登入驗證表單
  document.getElementById('login-form').addEventListener('submit', e => {
    e.preventDefault();
    const token = document.getElementById('login-token-input').value.trim();
    verifyAndUnlock(token);
  });

  // 側邊欄分頁切換
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      item.classList.add('active');
      document.getElementById(item.getAttribute('data-tab')).classList.add('active');
      document.getElementById('topbar-title').textContent = item.querySelector('span').textContent;
    });
  });

  // 頂部工具列
  document.getElementById('btn-reload').addEventListener('click', loadDashboard);
  document.getElementById('btn-logout').addEventListener('click', lockAndLogout);

  // 分頁 1：商品與對標
  document.getElementById('prod-search').addEventListener('input', renderProductTable);
  document.getElementById('prod-filter').addEventListener('change', renderProductTable);
  document.getElementById('btn-suggest-check').addEventListener('click', runAutoSuggestCheck);

  // 分頁 2：Excel 智慧建庫與匯出
  bindFileDropzone();
  document.getElementById('excel-sheet-select').addEventListener('change', onWorksheetChange);
  document.getElementById('mode-card-merge').addEventListener('click', () => selectImportMode('MERGE_PRODUCTS'));
  document.getElementById('mode-card-new').addEventListener('click', () => selectImportMode('CREATE_NEW_TABLE'));
  document.getElementById('new-table-name-input').addEventListener('click', e => e.stopPropagation());
  document.getElementById('btn-reset-excel').addEventListener('click', resetExcelPanel);
  document.getElementById('btn-execute-build').addEventListener('click', executeDynamicBuild);
  document.getElementById('btn-export-csv').addEventListener('click', () => exportSelectedSheet('csv'));
  document.getElementById('btn-export-json').addEventListener('click', () => exportSelectedSheet('json'));

  // 分頁 3：跑馬燈與網站設定
  document.getElementById('btn-add-news').addEventListener('click', addAnnouncement);
  document.getElementById('btn-save-config').addEventListener('click', saveGlobalConfig);

  // 分頁 4：異常報錯中心
  document.getElementById('btn-resolve-errors').addEventListener('click', resolveAllErrors);

  // 圖檔對標彈窗
  document.getElementById('btn-close-modal-x').addEventListener('click', closeMatchModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeMatchModal);
  document.getElementById('raw-img-search').addEventListener('input', renderRawImageList);
  document.getElementById('crop-ratio-select').addEventListener('change', redrawCanvasPreview);
  document.getElementById('btn-upload-bind').addEventListener('click', confirmCompressAndUpload);
}

// ================= 權限驗證鎖與 API 封裝 =================
function getAdminToken() {
  return sessionStorage.getItem('MEYA_ADMIN_TOKEN') || '';
}

async function verifyAndUnlock(tokenInput) {
  const errBox = document.getElementById('login-error-msg');
  const btn = document.getElementById('btn-login-submit');
  errBox.style.display = 'none';
  btn.disabled = true;
  btn.textContent = '⏳ 正在向 GAS 伺服器驗證密鑰...';

  try {
    sessionStorage.setItem('MEYA_ADMIN_TOKEN', tokenInput);
    const data = await apiGet('getAdminDashboard');

    if (data.status !== 'success') {
      sessionStorage.removeItem('MEYA_ADMIN_TOKEN');
      throw new Error(data.message || '驗證失敗');
    }

    // 驗證通過：解除鎖定並渲染後台
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('admin-app').classList.add('unlocked');
    applyDashboardData(data);
  } catch (err) {
    errBox.textContent = String(err.message).includes('Unauthorized')
      ? '管理密鑰錯誤，請重新輸入。'
      : '連線驗證失敗：' + err.message;
    errBox.style.display = 'block';
    document.getElementById('login-token-input').select();
  } finally {
    btn.disabled = false;
    btn.textContent = '🔒 驗證並進入系統';
  }
}

function lockAndLogout() {
  sessionStorage.removeItem('MEYA_ADMIN_TOKEN');
  AdminState.products = [];
  AdminState.announcements = [];
  AdminState.errors = [];
  AdminState.rawDriveImages = [];

  document.getElementById('admin-app').classList.remove('unlocked');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('login-token-input').value = '';
  document.getElementById('login-error-msg').style.display = 'none';
  document.getElementById('login-token-input').focus();
}

async function apiGet(action, extraParams = {}) {
  if (typeof CONFIG === 'undefined' || !CONFIG.GAS_API_URL) {
    throw new Error('找不到 js/config.js 或 GAS_API_URL 尚未設定');
  }
  const query = new URLSearchParams({
    action: action,
    token: getAdminToken(),
    ...extraParams
  });
  const res = await fetch(CONFIG.GAS_API_URL + '?' + query.toString());
  if (!res.ok) throw new Error('HTTP 狀態異常：' + res.status);
  return res.json();
}

async function apiPost(action, payload = {}) {
  if (typeof CONFIG === 'undefined' || !CONFIG.GAS_API_URL) {
    throw new Error('找不到 js/config.js 或 GAS_API_URL 尚未設定');
  }
  const res = await fetch(CONFIG.GAS_API_URL, {
    method: 'POST',
    body: JSON.stringify({
      action: action,
      token: getAdminToken(),
      ...payload
    })
  });
  if (!res.ok) throw new Error('HTTP 狀態異常：' + res.status);
  return res.json();
}

// ================= 1. 載入管理儀表板 =================
async function loadDashboard() {
  const tbody = document.getElementById('product-tbody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">同步資料庫中...</td></tr>';

  try {
    const data = await apiGet('getAdminDashboard');
    if (data.status !== 'success') {
      if (String(data.message).includes('Unauthorized')) {
        alert('管理密鑰已失效或變更，請重新登入。');
        lockAndLogout();
        return;
      }
      throw new Error(data.message);
    }
    applyDashboardData(data);
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell" style="color:#e74c3c;">載入失敗：' + escapeHtml(err.message) + '</td></tr>';
  }
}

function applyDashboardData(data) {
  AdminState.products = data.products || [];
  AdminState.productHeaders = data.productHeaders || [...CORE_PRODUCT_KEYS];
  AdminState.announcements = data.announcements || [];
  AdminState.errors = data.errors || [];

  updateKpis();
  renderProductTable();
  renderExportSheetOptions(data.sheetNames || ['商品列表']);
  renderAnnouncementsTable();
  renderGlobalConfigForm(data.config || {});
  renderErrorTable();
}

function updateKpis() {
  document.getElementById('kpi-total').textContent = AdminState.products.length;
  document.getElementById('kpi-active').textContent = AdminState.products.filter(p => p['狀態'] === '上架').length;
  document.getElementById('kpi-pending').textContent = AdminState.products.filter(p => !p.image || String(p.image).trim() === '').length;
  document.getElementById('kpi-cols').textContent = AdminState.productHeaders.length;

  const openErrors = AdminState.errors.filter(e => e['狀態'] === '未處理').length;
  const badge = document.getElementById('nav-error-badge');
  badge.textContent = openErrors;
  badge.style.display = openErrors > 0 ? 'inline-block' : 'none';
}

function renderProductTable() {
  const tbody = document.getElementById('product-tbody');
  const kw = document.getElementById('prod-search').value.trim().toLowerCase();
  const filter = document.getElementById('prod-filter').value;
  const coreSet = new Set(CORE_PRODUCT_KEYS);

  const list = AdminState.products.filter(p => {
    const allText = Object.values(p).join(' ').toLowerCase();
    if (kw && !allText.includes(kw)) return false;
    if (filter === 'NO_IMAGE') return !p.image || String(p.image).trim() === '';
    if (filter !== 'ALL') return p['狀態'] === filter;
    return true;
  });

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">沒有符合條件的商品資料</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  list.forEach(p => {
    const extraSummary = Object.keys(p)
      .filter(k => !coreSet.has(k) && p[k] !== '' && p[k] !== undefined)
      .slice(0, 3)
      .map(k => `<span class="pill pill-off" style="margin:2px;">${escapeHtml(k)}: ${escapeHtml(p[k])}</span>`)
      .join('');

    const statusClass = p['狀態'] === '上架' ? 'pill-ok' : (p['狀態'] === '待對標' ? 'pill-wait' : 'pill-off');
    const nextStatus = p['狀態'] === '上架' ? '下架' : '上架';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.image ? `<img class="thumb-mini" src="${escapeHtml(p.image)}" alt="">` : '<span class="pill pill-err">缺圖</span>'}</td>
      <td><strong>${escapeHtml(p.id)}</strong></td>
      <td>${escapeHtml(p.name)}</td>
      <td>NT$ ${Number(p.price || 0).toLocaleString()}</td>
      <td>${extraSummary || '<span style="color:#94a3b8; font-size:12px;">-</span>'}</td>
      <td><span class="pill ${statusClass}">${escapeHtml(p['狀態'] || '未設定')}</span></td>
      <td style="white-space:nowrap;">
        <button class="btn btn-primary btn-open-match">對標排版</button>
        <button class="btn btn-outline btn-toggle-status">設為${nextStatus}</button>
      </td>
    `;

    tr.querySelector('.btn-open-match').addEventListener('click', () => openMatchModal(p));
    tr.querySelector('.btn-toggle-status').addEventListener('click', () => toggleProductStatus(p.id, nextStatus));
    tbody.appendChild(tr);
  });
}

async function toggleProductStatus(productId, newStatus) {
  try {
    const json = await apiPost('updateProductStatus', { productId, newStatus });
    if (json.status === 'success') loadDashboard();
    else alert('狀態更新失敗：' + json.message);
  } catch (err) {
    alert('狀態更新異常：' + err.message);
  }
}

// ================= 2. Excel 拖曳自動辨識與動態建庫 =================
function bindFileDropzone() {
  const dz = document.getElementById('file-dropzone');
  const input = document.getElementById('local-sheet-input');

  dz.addEventListener('click', () => input.click());
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('dragover'); }));

  dz.addEventListener('drop', e => {
    if (e.dataTransfer.files.length > 0) loadLocalExcelFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', e => {
    if (e.target.files.length > 0) loadLocalExcelFile(e.target.files[0]);
    e.target.value = '';
  });
}

function loadLocalExcelFile(file) {
  AdminState.fileName = file.name;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      AdminState.workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const select = document.getElementById('excel-sheet-select');
      select.innerHTML = '';
      AdminState.workbook.SheetNames.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
      });

      document.getElementById('excel-file-title').textContent = '已載入檔案：' + file.name;
      document.getElementById('excel-analyze-panel').style.display = 'block';
      onWorksheetChange();
    } catch (err) {
      alert('讀取 Excel/CSV 失敗：' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function onWorksheetChange() {
  const sheetName = document.getElementById('excel-sheet-select').value;
  const ws = AdminState.workbook.Sheets[sheetName];
  const rawMatrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  AdminState.rawMatrix = rawMatrix.filter(row => Array.isArray(row) && row.some(cell => String(cell).trim() !== ''));
  if (AdminState.rawMatrix.length < 2) {
    alert('此工作表內容不足（需至少包含 1 列標題與 1 列資料）。');
    return;
  }

  const rawHeaders = AdminState.rawMatrix[0];
  const firstDataRow = AdminState.rawMatrix[1] || [];
  const usedCoreKeys = new Set();

  AdminState.columnMappings = [];
  rawHeaders.forEach((rawH, colIdx) => {
    const cleanRaw = String(rawH || '').trim();
    const sampleVal = firstDataRow[colIdx] !== undefined ? String(firstDataRow[colIdx]).trim() : '';
    if (!cleanRaw && !sampleVal) return;

    const displayRaw = cleanRaw || ('未命名欄位_' + (colIdx + 1));
    let autoTarget = displayRaw;
    let autoCoreName = null;

    const lower = displayRaw.toLowerCase();
    for (const coreKey of Object.keys(CORE_SYNONYMS)) {
      if (usedCoreKeys.has(coreKey)) continue;
      const hit = CORE_SYNONYMS[coreKey].some(syn => lower === syn.toLowerCase() || lower.includes(syn.toLowerCase()));
      if (hit) {
        autoTarget = coreKey;
        autoCoreName = coreKey;
        usedCoreKeys.add(coreKey);
        break;
      }
    }

    AdminState.columnMappings.push({
      colIdx: colIdx,
      include: true,
      rawName: displayRaw,
      targetName: AdminState.importMode === 'MERGE_PRODUCTS' ? autoTarget : displayRaw,
      autoCoreName: autoCoreName,
      sampleVal: sampleVal
    });
  });

  document.getElementById('excel-row-count').textContent =
    '共偵測到 ' + (AdminState.rawMatrix.length - 1) + ' 筆資料、' + AdminState.columnMappings.length + ' 個欄位';
  document.getElementById('new-table-name-input').value =
    sheetName === 'Sheet1' ? AdminState.fileName.replace(/\.[^.]+$/, '') : sheetName;

  renderHeaderMappingTable();
  renderExcelPreviewTable();
}

function selectImportMode(mode) {
  AdminState.importMode = mode;
  document.getElementById('mode-card-merge').classList.toggle('selected', mode === 'MERGE_PRODUCTS');
  document.getElementById('mode-card-new').classList.toggle('selected', mode === 'CREATE_NEW_TABLE');

  AdminState.columnMappings.forEach(m => {
    m.targetName = (mode === 'MERGE_PRODUCTS' && m.autoCoreName) ? m.autoCoreName : m.rawName;
  });
  renderHeaderMappingTable();
  renderExcelPreviewTable();
}

function getColumnStatusTagHtml(targetName) {
  if (AdminState.importMode !== 'MERGE_PRODUCTS') {
    return '<span class="pill pill-new">新資料表欄位</span>';
  }
  if (CORE_PRODUCT_KEYS.includes(targetName)) {
    return '<span class="pill pill-ok">核心商品欄位</span>';
  }
  if (AdminState.productHeaders.includes(targetName)) {
    return '<span class="pill pill-off">對齊既有欄位</span>';
  }
  return '<span class="pill pill-new">✨ 將自動新增欄位</span>';
}

function renderHeaderMappingTable() {
  const tbody = document.getElementById('header-mapping-tbody');
  tbody.innerHTML = '';

  AdminState.columnMappings.forEach((m, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" ${m.include ? 'checked' : ''} class="chk-col"></td>
      <td>${escapeHtml(m.rawName)}</td>
      <td><input type="text" class="input-ctrl inp-target" style="width:160px;" value="${escapeHtml(m.targetName)}"></td>
      <td class="col-status-cell">${getColumnStatusTagHtml(m.targetName)}</td>
      <td style="color:#64748b; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(m.sampleVal)}</td>
    `;

    tr.querySelector('.chk-col').addEventListener('change', e => {
      AdminState.columnMappings[idx].include = e.target.checked;
      renderExcelPreviewTable();
    });
    tr.querySelector('.inp-target').addEventListener('input', e => {
      const val = e.target.value.trim();
      AdminState.columnMappings[idx].targetName = val;
      tr.querySelector('.col-status-cell').innerHTML = getColumnStatusTagHtml(val);
      renderExcelPreviewTable();
    });

    tbody.appendChild(tr);
  });
}

function renderExcelPreviewTable() {
  const table = document.getElementById('excel-preview-table');
  const activeCols = AdminState.columnMappings.filter(m => m.include && m.targetName);
  if (activeCols.length === 0) {
    table.innerHTML = '<tr><td class="empty-cell">請至少勾選一個要匯入的欄位</td></tr>';
    return;
  }

  let html = '<thead><tr>' + activeCols.map(c => `<th>${escapeHtml(c.targetName)}</th>`).join('') + '</tr></thead><tbody>';
  AdminState.rawMatrix.slice(1, 11).forEach(row => {
    html += '<tr>' + activeCols.map(c => `<td>${escapeHtml(row[c.colIdx] !== undefined ? row[c.colIdx] : '')}</td>`).join('') + '</tr>';
  });
  html += '</tbody>';
  table.innerHTML = html;
}

async function executeDynamicBuild() {
  const activeCols = AdminState.columnMappings.filter(m => m.include && m.targetName);
  if (activeCols.length === 0) return alert('請至少勾選一個有效欄位！');

  const targetHeaders = activeCols.map(c => c.targetName);
  if (AdminState.importMode === 'MERGE_PRODUCTS') {
    if (!targetHeaders.includes('id') || !targetHeaders.includes('name')) {
      return alert('整合至「商品列表」時，必須包含對應到「id」與「name」的欄位！\n請在上方表格將商品編號與商品名稱欄位改名為 id 與 name。');
    }
  }

  const targetSheetName = AdminState.importMode === 'MERGE_PRODUCTS'
    ? '商品列表'
    : document.getElementById('new-table-name-input').value.trim();

  if (!targetSheetName) return alert('請輸入要建立的新資料表名稱！');

  const records = AdminState.rawMatrix.slice(1).map(rawRow => {
    const obj = {};
    activeCols.forEach(c => {
      let val = rawRow[c.colIdx] !== undefined ? rawRow[c.colIdx] : '';
      if (c.targetName === 'price') {
        val = Number(String(val).replace(/[^0-9.-]/g, '')) || 0;
      } else {
        val = String(val).trim();
      }
      obj[c.targetName] = val;
    });
    return obj;
  });

  const btn = document.getElementById('btn-execute-build');
  btn.disabled = true;
  btn.textContent = '⏳ 正在自動建置與寫入資料庫...';

  try {
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    const allAddedCols = new Set();

    for (let i = 0; i < records.length; i += IMPORT_CHUNK_SIZE) {
      const chunk = records.slice(i, i + IMPORT_CHUNK_SIZE);
      const json = await apiPost('importDynamicDataset', {
        mode: AdminState.importMode,
        sheetName: targetSheetName,
        headers: targetHeaders,
        rows: chunk,
        sourceName: AdminState.fileName
      });
      if (json.status !== 'success') throw new Error(json.message);

      totalInserted += json.data.insertedCount;
      totalUpdated += json.data.updatedCount;
      totalSkipped += json.data.skippedCount;
      (json.data.addedColumns || []).forEach(col => allAddedCols.add(col));
    }

    const addedMsg = allAddedCols.size > 0 ? '\n自動新增欄位：' + Array.from(allAddedCols).join(', ') : '';
    alert(`✅ 資料庫建置完成！\n目標分頁：《${targetSheetName}》\n新增 ${totalInserted} 筆｜更新 ${totalUpdated} 筆｜略過 ${totalSkipped} 筆${addedMsg}`);
    resetExcelPanel();
    loadDashboard();
  } catch (err) {
    alert('❌ 建庫過程發生錯誤：' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 確認欄位結構，開始自動建置資料庫';
  }
}

function resetExcelPanel() {
  AdminState.workbook = null;
  AdminState.rawMatrix = [];
  AdminState.columnMappings = [];
  document.getElementById('excel-analyze-panel').style.display = 'none';
}

// ================= 3. 標準資料匯出 =================
function renderExportSheetOptions(sheetNames) {
  const sel = document.getElementById('export-sheet-select');
  sel.innerHTML = '';
  sheetNames.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = '資料表：' + name;
    sel.appendChild(opt);
  });
}

async function exportSelectedSheet(format) {
  const sheetName = document.getElementById('export-sheet-select').value || '商品列表';
  try {
    const json = await apiGet('exportData', { sheetName, format });
    if (json.status !== 'success') throw new Error(json.message);

    const d = json.data;
    const content = format === 'json' ? JSON.stringify(d.records, null, 2) : d.csvContent;
    const mime = format === 'json' ? 'application/json;charset=utf-8;' : 'text/csv;charset=utf-8;';
    const blob = new Blob([content], { type: mime });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = d.fileName;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (err) {
    alert('匯出失敗：' + err.message);
  }
}

// ================= 4. 圖檔一對一對標、排版與 <2MB 降檔 =================
async function runAutoSuggestCheck() {
  const banner = document.getElementById('suggest-banner');
  banner.style.display = 'block';
  banner.textContent = '正在比對缺圖商品與雲端原始資料夾...';

  try {
    const json = await apiGet('suggestImageMatches');
    if (json.status !== 'success') throw new Error(json.message);

    const d = json.data;
    const sampleMissing = (d.unmatchedProducts || []).slice(0, 10).map(x => x.id).join(', ');
    banner.innerHTML =
      `<strong>規則檢查完成：</strong>缺圖商品共 <strong>${d.totalPendingProducts}</strong> 筆；` +
      `已在雲端找到同編號原圖 <strong>${d.matchedCount}</strong> 筆（點進「對標排版」會以黃色高亮排在最上方），` +
      `尚無對應照片 <strong>${d.unmatchedCount}</strong> 筆` +
      (sampleMissing ? `（如：${escapeHtml(sampleMissing)}）` : '。');
  } catch (err) {
    banner.textContent = '檢查失敗：' + err.message;
  }
}

async function openMatchModal(product) {
  AdminState.activeProductId = String(product.id);
  AdminState.loadedSourceImage = null;

  document.getElementById('match-modal-title').textContent = `對標與排版：[${product.id}] ${product.name}`;
  document.getElementById('match-status-text').textContent = '請從左側選擇對應的原始照片。';
  document.getElementById('btn-upload-bind').disabled = true;
  document.getElementById('raw-img-search').value = '';

  const canvas = document.getElementById('preview-canvas');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  document.getElementById('match-modal').classList.add('open');

  const listEl = document.getElementById('drive-raw-list');
  listEl.innerHTML = '讀取雲端原始圖片資料夾中...';

  try {
    const data = await apiGet('getRawImages');
    if (data.status !== 'success') throw new Error(data.message);
    AdminState.rawDriveImages = data.images || [];
    renderRawImageList();
  } catch (err) {
    listEl.innerHTML = '<p style="color:#e74c3c; padding:12px;">讀取失敗：' + escapeHtml(err.message) + '</p>';
  }
}

function renderRawImageList() {
  const listEl = document.getElementById('drive-raw-list');
  const kw = document.getElementById('raw-img-search').value.trim().toLowerCase();
  const targetLower = AdminState.activeProductId.toLowerCase();

  const filtered = AdminState.rawDriveImages
    .filter(img => !kw || String(img.name).toLowerCase().includes(kw))
    .sort((a, b) => {
      const aHit = String(a.name).toLowerCase().includes(targetLower) ? 1 : 0;
      const bHit = String(b.name).toLowerCase().includes(targetLower) ? 1 : 0;
      return bHit - aHit;
    });

  if (filtered.length === 0) {
    listEl.innerHTML = '<p style="padding:12px; color:#64748b;">資料夾中沒有符合的圖片</p>';
    return;
  }

  listEl.innerHTML = '';
  filtered.forEach(img => {
    const isHit = String(img.name).toLowerCase().includes(targetLower);
    const item = document.createElement('div');
    item.className = 'drive-item' + (isHit ? ' recommended' : '');
    item.innerHTML = `
      <img src="${escapeHtml(img.thumbnail)}" alt="">
      <div>
        <div>${escapeHtml(img.name)}</div>
        ${isHit ? '<span style="font-size:11px; color:#a16207;">⭐ 吻合商品編號</span>' : ''}
      </div>
    `;
    item.addEventListener('click', () => {
      document.querySelectorAll('.drive-item').forEach(x => x.classList.remove('selected'));
      item.classList.add('selected');
      loadRawImageToCanvas(img.id, img.name);
    });
    listEl.appendChild(item);
  });
}

async function loadRawImageToCanvas(fileId, fileName) {
  const statusEl = document.getElementById('match-status-text');
  const btn = document.getElementById('btn-upload-bind');
  statusEl.textContent = '⏳ 載入高畫質原圖「' + fileName + '」中...';
  btn.disabled = true;

  try {
    const data = await apiGet('getImageBase64', { fileId });
    if (data.status !== 'success') throw new Error(data.message);

    const img = new Image();
    img.onload = () => {
      AdminState.loadedSourceImage = img;
      redrawCanvasPreview();
      btn.disabled = false;
    };
    img.src = 'data:' + data.base64;
  } catch (err) {
    statusEl.textContent = '❌ 讀取原圖失敗：' + err.message;
  }
}

function redrawCanvasPreview() {
  const img = AdminState.loadedSourceImage;
  if (!img) return;

  const canvas = document.getElementById('preview-canvas');
  const ratioMode = document.getElementById('crop-ratio-select').value;
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;

  let sx = 0, sy = 0, sw = srcW, sh = srcH;
  if (ratioMode !== 'original') {
    const targetRatio = ratioMode === '1:1' ? 1 : (3 / 4);
    const srcRatio = srcW / srcH;
    if (srcRatio > targetRatio) {
      sw = Math.round(srcH * targetRatio);
      sx = Math.round((srcW - sw) / 2);
    } else {
      sh = Math.round(srcW / targetRatio);
      sy = Math.round((srcH - sh) / 2);
    }
  }

  let outW = sw, outH = sh;
  if (outW > MAX_IMAGE_WIDTH) {
    outH = Math.round(outH * (MAX_IMAGE_WIDTH / outW));
    outW = MAX_IMAGE_WIDTH;
  }

  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

  const info = compressCanvasUnder2MB(canvas);
  document.getElementById('match-status-text').textContent =
    `✅ 排版就緒（${outW}×${outH}px）｜預估壓縮後：${info.sizeKb} KB（品質 ${Math.round(info.quality * 100)}%）｜自動檔名：${AdminState.activeProductId}_cover.jpg`;
}

function compressCanvasUnder2MB(canvas) {
  let quality = 0.88;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  let estBytes = Math.round((dataUrl.length * 3) / 4);

  while (estBytes > MAX_BYTES_LIMIT && quality > 0.3) {
    quality = Number((quality - 0.08).toFixed(2));
    dataUrl = canvas.toDataURL('image/jpeg', quality);
    estBytes = Math.round((dataUrl.length * 3) / 4);
  }

  return { dataUrl, quality, sizeKb: Math.round(estBytes / 1024) };
}

async function confirmCompressAndUpload() {
  if (!AdminState.loadedSourceImage || !AdminState.activeProductId) return;

  const btn = document.getElementById('btn-upload-bind');
  const statusEl = document.getElementById('match-status-text');
  btn.disabled = true;
  statusEl.textContent = '🚀 正在降檔轉存、自動歸檔至商品編號資料夾並寫入資料庫...';

  try {
    const compressed = compressCanvasUnder2MB(document.getElementById('preview-canvas'));
    const result = await apiPost('uploadAndBindImage', {
      productId: AdminState.activeProductId,
      fileName: AdminState.activeProductId + '_cover.jpg',
      mimeType: 'image/jpeg',
      base64Data: compressed.dataUrl.split(',')[1],
      autoPublish: document.getElementById('chk-auto-publish').checked
    });

    if (result.status !== 'success') throw new Error(result.message);

    alert('✅ ' + result.message);
    closeMatchModal();
    loadDashboard();
  } catch (err) {
    statusEl.textContent = '❌ 轉存失敗：' + err.message;
    btn.disabled = false;
  }
}

function closeMatchModal() {
  document.getElementById('match-modal').classList.remove('open');
}

// ================= 5. 跑馬燈與網站設定管理 =================
function renderAnnouncementsTable() {
  const tbody = document.getElementById('news-tbody');
  if (AdminState.announcements.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">尚無公告</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  AdminState.announcements.forEach(n => {
    const isUp = n['狀態'] === '上架';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(n.id)}</td>
      <td>${escapeHtml(n['內容'])}</td>
      <td><span class="pill ${isUp ? 'pill-ok' : 'pill-off'}">${escapeHtml(n['狀態'])}</span></td>
      <td style="white-space:nowrap;">
        <button class="btn btn-outline btn-toggle-news">${isUp ? '下架' : '上架'}</button>
        <button class="btn btn-danger btn-del-news">刪除</button>
      </td>
    `;
    tr.querySelector('.btn-toggle-news').addEventListener('click', () => manageAnnouncement('toggle', n.id));
    tr.querySelector('.btn-del-news').addEventListener('click', () => {
      if (confirm('確定要刪除此則跑馬燈公告嗎？')) manageAnnouncement('delete', n.id);
    });
    tbody.appendChild(tr);
  });
}

async function addAnnouncement() {
  const input = document.getElementById('new-news-input');
  const content = input.value.trim();
  if (!content) return alert('請先輸入公告內容');
  await manageAnnouncement('add', '', content);
  input.value = '';
}

async function manageAnnouncement(operation, id, content = '') {
  try {
    const json = await apiPost('saveAnnouncement', { operation, id, content });
    if (json.status === 'success') loadDashboard();
    else alert('操作失敗：' + json.message);
  } catch (err) {
    alert('公告操作異常：' + err.message);
  }
}

function renderGlobalConfigForm(cfg) {
  document.getElementById('cfg-free-shipping').value = cfg.free_shipping || '';
  document.getElementById('cfg-cart-enabled').checked = cfg.cart_enabled === true;
}

async function saveGlobalConfig() {
  try {
    const json = await apiPost('saveWebsiteConfig', {
      config: {
        free_shipping: document.getElementById('cfg-free-shipping').value.trim(),
        cart_enabled: document.getElementById('cfg-cart-enabled').checked
      }
    });
    if (json.status === 'success') alert('✅ 形象網站全域設定已儲存！');
    else alert('儲存失敗：' + json.message);
  } catch (err) {
    alert('儲存異常：' + err.message);
  }
}

// ================= 6. 異常報錯中心 =================
function renderErrorTable() {
  const tbody = document.getElementById('error-tbody');
  if (AdminState.errors.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">目前沒有任何異常紀錄。</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  AdminState.errors.forEach(e => {
    const levelClass = e['層級'] === 'ERROR' ? 'pill-err' : 'pill-wait';
    const statusClass = e['狀態'] === '已處理' ? 'pill-ok' : 'pill-err';
    tbody.innerHTML += `
      <tr>
        <td>${escapeHtml(e['時間'])}</td>
        <td>${escapeHtml(e['模組'])}</td>
        <td><span class="pill ${levelClass}">${escapeHtml(e['層級'])}</span></td>
        <td>${escapeHtml(e['關聯編號'])}</td>
        <td>${escapeHtml(e['異常訊息'])}</td>
        <td>${escapeHtml(e['建議處理方式'])}</td>
        <td><span class="pill ${statusClass}">${escapeHtml(e['狀態'])}</span></td>
      </tr>
    `;
  });
}

async function resolveAllErrors() {
  try {
    const json = await apiPost('resolveAllErrors');
    if (json.status === 'success') {
      alert('已將 ' + json.data.resolvedCount + ' 筆紀錄標記為已處理。');
      loadDashboard();
    }
  } catch (err) {
    alert('更新異常紀錄失敗：' + err.message);
  }
}

// ================= 工具函式 =================
function escapeHtml(str) {
  return String(str === null || str === undefined ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
