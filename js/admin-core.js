/**
 * 模組 1：管理員專區核心中樞（第一階段基礎資安加固版）
 * 防護：
 * 1. 所有受保護 API 全面改走 POST JSON Body，杜絕 Session Token 暴露於 URL Query String
 * 2. 登出時主動呼叫後端 adminLogout 撤銷憑證
 * 3. 強化 escapeHtml (含單引號) 與圖片 https:// 協定檢查
 */
window.CORE_PRODUCT_KEYS = ['id', 'name', 'price', '條碼', '庫存數量', '商品狀態', '更新時間'];

window.AdminState = {
  authPolicy: { mode: 'STRICT_SESSION', requirePin: true },
  products: [],
  productHeaders: [...window.CORE_PRODUCT_KEYS],
  rawFolderNames: [],
  announcements: [],
  articles: [],
  faqs: [],
  errors: []
};

window.AdminCore = {
  init: async function() {
    this.bindCoreEvents();

    if (window.AdminProducts) window.AdminProducts.init();
    if (window.AdminMediaUpload) window.AdminMediaUpload.init();
    if (window.AdminExcel) window.AdminExcel.init();
    if (window.AdminContent) window.AdminContent.init();
    if (window.AdminLabels) window.AdminLabels.init();
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
        descEl.textContent = '嚴格安全驗證模式（後端強制驗權・關閉分頁即登出）';
      }
    } catch (_) {
      descEl.textContent = '無法連線至驗證伺服器，請確認網路與 GAS 部署設定';
    }
    document.getElementById('login-token-input').focus();
  },

  tryRestoreSession: async function() {
    try {
      const data = await this.apiPost('getAdminDashboard');
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

    if (!adminToken) {
      errBox.textContent = '請輸入管理密鑰';
      errBox.style.display = 'block';
      return;
    }

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

      const dashData = await this.apiPost('getAdminDashboard');
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

  lockAndLogout: async function() {
    const token = this.getSessionToken();
    if (token && typeof CONFIG !== 'undefined' && CONFIG.GAS_API_URL) {
      try {
        await fetch(CONFIG.GAS_API_URL, {
          method: 'POST',
          body: JSON.stringify({ action: 'adminLogout', token: token })
        });
      } catch (_) {}
    }

    sessionStorage.removeItem('MEYA_SESSION_TOKEN');
    AdminState.products = [];
    AdminState.rawFolderNames = [];
    AdminState.announcements = [];
    AdminState.articles = [];
    AdminState.faqs = [];
    AdminState.errors = [];

    document.getElementById('admin-app').classList.remove('unlocked');
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('login-token-input').value = '';
    document.getElementById('login-error-msg').style.display = 'none';
    document.getElementById('login-token-input').focus();
  },

  apiGet: async function(action, extraParams = {}) {
    return this.apiPost(action, extraParams);
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
    if (String(message).includes('Unauthorized') || String(message).includes('Forbidden')) {
      alert('驗證憑證無效、權限不足或已逾時，請重新登入。');
      this.lockAndLogout();
      return true;
    }
    return false;
  },

  loadDashboard: async function() {
    const tbody = document.getElementById('product-tbody');
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">同步進銷存主檔與形象網站庫中...</td></tr>';

    try {
      const data = await this.apiPost('getAdminDashboard');
      if (data.status !== 'success') {
        if (this.handleAuthFailure(data.message)) return;
        throw new Error(data.message);
      }
      this.applyDashboardData(data);
    } catch (err) {
      tbody.innerHTML = '';
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.className = 'empty-cell';
      td.style.color = '#e74c3c';
      td.textContent = '載入失敗：' + err.message;
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  },

  applyDashboardData: function(data) {
    AdminState.rawFolderNames = data.rawFolderNames || [];
    AdminState.productHeaders = data.productHeaders || [...window.CORE_PRODUCT_KEYS];
    AdminState.announcements = data.announcements || [];
    AdminState.articles = data.articles || [];
    AdminState.faqs = data.faqs || [];
    AdminState.errors = data.errors || [];

    const folderPairs = AdminState.rawFolderNames.map(name => ({
      raw: name,
      lower: String(name).trim().toLowerCase()
    }));

    AdminState.products = (data.products || []).map(p => {
      const prodId = String(p.id || '').trim();
      const prodLower = prodId.toLowerCase();
      const isPublishedOnWeb = p['狀態'] === '上架';
      let matchedFolder = '';

      if (prodLower && folderPairs.length > 0) {
        const hit = folderPairs.find(f => f.lower === prodLower || f.lower.includes(prodLower));
        if (hit) matchedFolder = hit.raw;
      }

      return {
        ...p,
        image: this.sanitizeImageUrl(p.image),
        _matchedFolder: matchedFolder,
        _readyToMatch: !isPublishedOnWeb && Boolean(matchedFolder)
      };
    });

    this.updateKpis();
    if (window.AdminProducts) window.AdminProducts.renderTable(true);
    if (window.AdminExcel) window.AdminExcel.renderExportOptions(data.exportSheets || []);
    if (window.AdminContent) window.AdminContent.renderAll();
    if (window.AdminLabels) window.AdminLabels.syncData(data.config || {}, data.labelQueue || [], data.labelDbSource || '');
    if (window.AdminSite) window.AdminSite.renderAll(data.config || {});
  },

  updateKpis: function() {
    const total = AdminState.products.length;
    const active = AdminState.products.filter(p => p['狀態'] === '上架').length;
    const notOnWeb = total - active;
    const readyList = AdminState.products.filter(p => p._readyToMatch);

    document.getElementById('kpi-ready').textContent = readyList.length;
    document.getElementById('kpi-total').textContent = total;
    document.getElementById('kpi-active').textContent = active;
    document.getElementById('kpi-pending').textContent = notOnWeb;

    const readyBadge = document.getElementById('nav-ready-badge');
    readyBadge.textContent = readyList.length;
    readyBadge.style.display = readyList.length > 0 ? 'inline-block' : 'none';

    const priorityBar = document.getElementById('ready-priority-bar');
    if (readyList.length > 0) {
      const previewIds = readyList.slice(0, 6).map(x => x.id).join('、');
      const textEl = document.getElementById('ready-priority-text');
      textEl.textContent = '';
      const strong = document.createElement('strong');
      strong.textContent = `⚡ 系統自動偵測到 ${readyList.length} 筆商品已有原圖資料夾待上架官網`;
      textEl.appendChild(strong);
      textEl.appendChild(document.createTextNode(`（已自動置頂排序）：${previewIds}${readyList.length > 6 ? ' 等...' : ''}`));
      priorityBar.style.display = 'flex';
    } else {
      priorityBar.style.display = 'none';
    }

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
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  sanitizeImageUrl: function(url) {
    const clean = String(url || '').trim();
    if (/^https:\/\//i.test(clean) || /^data:image\/(jpeg|png|webp|gif);base64,/i.test(clean)) {
      return clean;
    }
    return '';
  }
};

document.addEventListener('DOMContentLoaded', () => window.AdminCore.init());
