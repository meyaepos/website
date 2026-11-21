/**
 * 模組 1：管理員專區核心中樞
 * 負責：共用狀態、無時限關閉即登出驗證、原圖資料夾自動比對、API 封裝與分頁協調
 */
window.CORE_PRODUCT_KEYS = ['id', 'name', 'price', 'image', '狀態'];

window.AdminState = {
  authPolicy: { mode: 'STANDARD_NO_TIMEOUT', requirePin: true },
  products: [],
  productHeaders: [...window.CORE_PRODUCT_KEYS],
  rawFolderNames: [],
  announcements: [],
  errors: []
};

window.AdminCore = {
  init: async function() {
    this.bindCoreEvents();

    if (window.AdminProducts) window.AdminProducts.init();
    if (window.AdminExcel) window.AdminExcel.init();
    if (window.AdminSite) window.AdminSite.init();

    await this.initAuth();
  },

  bindCoreEvents: function() {
    document.getElementById('login-form').addEventListener('submit', e => {
      e.preventDefault();
      this.executeLogin();
    });

    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        item.classList.add('active');
        document.getElementById(item.getAttribute('data-tab')).classList.add('active');
        document.getElementById('topbar-title').textContent = item.querySelector('span').textContent;
      });
    });

    document.getElementById('btn-reload').addEventListener('click', () => this.loadDashboard());
    document.getElementById('btn-logout').addEventListener('click', () => this.lockAndLogout());
  },

  // ================= 關閉即登出（無時間限制）認證邏輯 =================

  getSessionToken: function() {
    return sessionStorage.getItem('MEYA_SESSION_TOKEN') || '';
  },

  initAuth: async function() {
    if (this.getSessionToken()) {
      const restored = await this.tryRestoreSession();
      if (restored) return;
    }

    const descEl = document.getElementById('login-policy-desc');
    try {
      const res = await fetch(CONFIG.GAS_API_URL + '?action=getAuthPolicy');
      const json = await res.json();
      if (json.status === 'success' && json.policy) {
        AdminState.authPolicy = json.policy;
        if (json.policy.requirePin) {
          descEl.textContent = '標準安全模式（無時間限制，關閉分頁即自動登出）';
        } else {
          descEl.textContent = '開發測試模式（未設定密鑰）：直接點擊下方按鈕即可進入';
          document.getElementById('login-token-input').placeholder = '目前免密鑰，直接按登入即可';
        }
      }
    } catch (err) {
      descEl.textContent = '無法連線至 GAS，請確認部署權限與 js/config.js';
    }
    document.getElementById('login-token-input').focus();
  },

  tryRestoreSession: async function() {
    try {
      const data = await this.apiGet('getAdminDashboard');
      if (data.status === 'success') {
        this.unlockAdminUI(data);
        return true;
      }
    } catch (_) {}
    sessionStorage.removeItem('MEYA_SESSION_TOKEN');
    return false;
  },

  executeLogin: async function() {
    const errBox = document.getElementById('login-error-msg');
    const btn = document.getElementById('btn-login-submit');
    const adminToken = document.getElementById('login-token-input').value.trim();

    errBox.style.display = 'none';
    btn.disabled = true;
    btn.textContent = '⏳ 驗證登入中...';

    try {
      const res = await fetch(CONFIG.GAS_API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'adminLogin',
          adminToken: adminToken
        })
      });
      const loginJson = await res.json();
      if (loginJson.status !== 'success') {
        throw new Error(loginJson.message || '驗證失敗');
      }

      sessionStorage.setItem('MEYA_SESSION_TOKEN', loginJson.data.sessionToken);

      const dashData = await this.apiGet('getAdminDashboard');
      if (dashData.status !== 'success') {
        throw new Error(dashData.message || '讀取後台資料失敗');
      }

      this.unlockAdminUI(dashData);
    } catch (err) {
      errBox.textContent = err.message.replace(/^Unauthorized:\s*/, '');
      errBox.style.display = 'block';
      document.getElementById('login-token-input').select();
    } finally {
      btn.disabled = false;
      btn.textContent = '🔒 登入管理專區';
    }
  },

  unlockAdminUI: function(dashData) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('admin-app').classList.add('unlocked');

    const idBadge = document.getElementById('admin-identity-badge');
    if (dashData.admin) {
      const groupText = dashData.admin.roleGroup ? ' [' + dashData.admin.roleGroup + ']' : '';
      idBadge.textContent = '👤 ' + (dashData.admin.name || '管理員') + groupText;
      idBadge.style.display = 'inline-block';
    }
    this.applyDashboardData(dashData);
  },

  lockAndLogout: function() {
    sessionStorage.removeItem('MEYA_SESSION_TOKEN');
    AdminState.products = [];
    AdminState.rawFolderNames = [];
    AdminState.announcements = [];
    AdminState.errors = [];

    document.getElementById('admin-app').classList.remove('unlocked');
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('login-token-input').value = '';
    document.getElementById('login-error-msg').style.display = 'none';
    document.getElementById('login-token-input').focus();
  },

  // ================= 統一 API 呼叫與資料分發 =================

  apiGet: async function(action, extraParams = {}) {
    if (typeof CONFIG === 'undefined' || !CONFIG.GAS_API_URL) {
      throw new Error('找不到 js/config.js 或 GAS_API_URL 尚未設定');
    }
    const query = new URLSearchParams({
      action: action,
      token: this.getSessionToken(),
      ...extraParams
    });
    const res = await fetch(CONFIG.GAS_API_URL + '?' + query.toString());
    if (!res.ok) throw new Error('HTTP 狀態異常：' + res.status);
    return res.json();
  },

  apiPost: async function(action, payload = {}) {
    if (typeof CONFIG === 'undefined' || !CONFIG.GAS_API_URL) {
      throw new Error('找不到 js/config.js 或 GAS_API_URL 尚未設定');
    }
    const res = await fetch(CONFIG.GAS_API_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: action,
        token: this.getSessionToken(),
        ...payload
      })
    });
    if (!res.ok) throw new Error('HTTP 狀態異常：' + res.status);
    return res.json();
  },

  handleAuthFailure: function(message) {
    if (String(message).includes('Unauthorized')) {
      alert('驗證憑證無效或密鑰已更新，請重新登入。');
      this.lockAndLogout();
      return true;
    }
    return false;
  },

  loadDashboard: async function() {
    const tbody = document.getElementById('product-tbody');
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">同步資料庫與雲端原圖資料夾中...</td></tr>';

    try {
      const data = await this.apiGet('getAdminDashboard');
      if (data.status !== 'success') {
        if (this.handleAuthFailure(data.message)) return;
        throw new Error(data.message);
      }
      this.applyDashboardData(data);
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell" style="color:#e74c3c;">載入失敗：' + this.escapeHtml(err.message) + '</td></tr>';
    }
  },

  applyDashboardData: function(data) {
    AdminState.rawFolderNames = data.rawFolderNames || [];
    AdminState.productHeaders = data.productHeaders || [...window.CORE_PRODUCT_KEYS];
    AdminState.announcements = data.announcements || [];
    AdminState.errors = data.errors || [];

    // 為每筆商品標記「是否缺圖且雲端已有對應原圖資料夾」，供自動置頂與專區使用
    const folderPairs = AdminState.rawFolderNames.map(name => ({
      raw: name,
      lower: String(name).trim().toLowerCase()
    }));

    AdminState.products = (data.products || []).map(p => {
      const prodId = String(p.id || '').trim();
      const prodLower = prodId.toLowerCase();
      const hasImage = Boolean(p.image && String(p.image).trim() !== '');
      let matchedFolder = '';

      if (prodLower && folderPairs.length > 0) {
        const hit = folderPairs.find(f => f.lower === prodLower || f.lower.includes(prodLower));
        if (hit) matchedFolder = hit.raw;
      }

      return {
        ...p,
        _matchedFolder: matchedFolder,
        _readyToMatch: !hasImage && Boolean(matchedFolder)
      };
    });

    this.updateKpis();
    if (window.AdminProducts) window.AdminProducts.renderTable(true);
    if (window.AdminExcel) window.AdminExcel.renderExportOptions(data.sheetNames || ['商品列表']);
    if (window.AdminSite) window.AdminSite.renderAll(data.config || {});
  },

  updateKpis: function() {
    const total = AdminState.products.length;
    const active = AdminState.products.filter(p => p['狀態'] === '上架').length;
    const pending = AdminState.products.filter(p => !p.image || String(p.image).trim() === '').length;
    const readyList = AdminState.products.filter(p => p._readyToMatch);

    document.getElementById('kpi-ready').textContent = readyList.length;
    document.getElementById('kpi-total').textContent = total;
    document.getElementById('kpi-active').textContent = active;
    document.getElementById('kpi-pending').textContent = pending;

    // 左側導覽列「有原圖待對標」綠色即時徽章
    const readyBadge = document.getElementById('nav-ready-badge');
    readyBadge.textContent = readyList.length;
    readyBadge.style.display = readyList.length > 0 ? 'inline-block' : 'none';

    // 頂部專屬提示橫幅
    const priorityBar = document.getElementById('ready-priority-bar');
    if (readyList.length > 0) {
      const previewIds = readyList.slice(0, 6).map(x => x.id).join('、');
      document.getElementById('ready-priority-text').innerHTML =
        `<strong>⚡ 系統自動偵測到 ${readyList.length} 筆商品已有原圖資料夾待對標</strong>（已自動置頂排序）：${this.escapeHtml(previewIds)}${readyList.length > 6 ? ' 等...' : ''}`;
      priorityBar.style.display = 'flex';
    } else {
      priorityBar.style.display = 'none';
    }

    // 異常紅點
    const openErrors = AdminState.errors.filter(e => e['狀態'] === '未處理').length;
    const errBadge = document.getElementById('nav-error-badge');
    errBadge.textContent = openErrors;
    errBadge.style.display = openErrors > 0 ? 'inline-block' : 'none';
  },

  escapeHtml: function(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
};

document.addEventListener('DOMContentLoaded', () => window.AdminCore.init());
