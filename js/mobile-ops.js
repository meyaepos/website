/**
 * 手機現場作業專區主控腳本（第一階段基礎資安加固版）
 * 防護：
 * 1. 全面改用 POST 傳遞 Token，並呼叫最小權限 getMobileOpsProducts（絕不下發成本/批價）
 * 2. 內建 LINE LIFF getIDToken() 驗證對接流程（絕不傳送未驗證的 userId）
 * 3. 登出主動呼叫後端撤銷憑證，並強化 XSS 跳脫與網址協定檢查
 */
window.MobileOps = {
  activeMode: 'picking',
  products: [],
  operator: { name: '未登入', roleGroup: '' },

  pickingOrderId: '',
  pickingItems: [],
  posCart: [],

  init: async function() {
    this.bindEvents();
    ScannerEngine.init((code, source) => this.handleIncomingScan(code, source));
    await this.initAuth();
  },

  bindEvents: function() {
    document.getElementById('m-login-form').addEventListener('submit', e => {
      e.preventDefault();
      this.executeLogin();
    });
    document.getElementById('m-btn-logout').addEventListener('click', () => this.lockAndLogout());
    document.getElementById('m-btn-sync').addEventListener('click', () => this.syncProducts());

    document.getElementById('m-btn-toggle-cam').addEventListener('click', () => this.toggleCamera());
    document.getElementById('m-manual-scan-form').addEventListener('submit', e => {
      e.preventDefault();
      const input = document.getElementById('m-manual-input');
      ScannerEngine.submitManualCode(input.value);
      input.value = '';
    });

    document.querySelectorAll('.m-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchMode(btn.dataset.mode));
    });

    document.getElementById('m-btn-demo-order').addEventListener('click', () => this.loadSamplePickingOrder());
    document.getElementById('m-btn-add-pick-sku').addEventListener('click', () => this.promptAddPickingItem());
    document.getElementById('m-btn-finish-pick').addEventListener('click', () => this.finishPickingOrder());

    document.getElementById('m-btn-clear-cart').addEventListener('click', () => {
      this.posCart = [];
      this.renderPosCart();
    });
    document.getElementById('m-btn-pos-checkout').addEventListener('click', () => {
      alert('POS 收銀架構已就緒！待第二階段接上 DB_POS 寫入路由即可正式結帳並自動扣庫存。');
    });
  },

  // ================= 1. 認證邏輯（含 LINE LIFF ID Token 後端驗簽插槽） =================

  getSessionToken: function() {
    return sessionStorage.getItem('MEYA_SESSION_TOKEN') || '';
  },

  /**
   * 當 js/config.js 設定公開 LIFF_ID 且頁面載入 LINE LIFF SDK 時，自動以官方 id_token 向後端驗簽登入
   */
  tryLineLiffLogin: async function() {
    if (typeof liff === 'undefined' || typeof CONFIG === 'undefined' || !CONFIG.MOBILE_LIFF_ID) {
      return false;
    }
    try {
      await liff.init({ liffId: CONFIG.MOBILE_LIFF_ID });
      if (!liff.isLoggedIn()) return false;
      const idToken = liff.getIDToken();
      if (!idToken) return false;

      const res = await fetch(CONFIG.GAS_API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'lineLiffLogin',
          idToken: idToken,
          module: 'inventory'
        })
      });
      const json = await res.json();
      if (json.status === 'success' && json.data && json.data.sessionToken) {
        sessionStorage.setItem('MEYA_SESSION_TOKEN', json.data.sessionToken);
        if (json.data.admin) this.operator = json.data.admin;
        return await this.syncProducts(true);
      }
    } catch (_) {}
    return false;
  },

  initAuth: async function() {
    if (this.getSessionToken()) {
      const ok = await this.syncProducts(true);
      if (ok) return;
    }

    const liffOk = await this.tryLineLiffLogin();
    if (liffOk) return;

    const descEl = document.getElementById('m-login-desc');
    try {
      const res = await fetch(CONFIG.GAS_API_URL + '?action=getAuthPolicy');
      const json = await res.json();
      if (json.status === 'success' && json.policy) {
        descEl.textContent = '嚴格安全驗證模式：輸入管理密鑰即可開啟現場掃碼作業';
      }
    } catch (_) {
      descEl.textContent = '無法連線至 GAS，請確認網路與設定';
    }
  },

  executeLogin: async function() {
    const errEl = document.getElementById('m-login-error');
    const btn = document.getElementById('m-login-btn');
    const adminToken = document.getElementById('m-token-input').value.trim();

    if (!adminToken) {
      errEl.textContent = '請輸入管理密鑰';
      errEl.style.display = 'block';
      return;
    }

    errEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = '⏳ 驗證中...';

    try {
      const res = await fetch(CONFIG.GAS_API_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'adminLogin', adminToken })
      });
      const json = await res.json();
      if (json.status !== 'success') throw new Error(json.message || '驗證失敗');

      sessionStorage.setItem('MEYA_SESSION_TOKEN', json.data.sessionToken);
      if (json.data.admin) this.operator = json.data.admin;

      await this.syncProducts(true);
    } catch (err) {
      errEl.textContent = err.message.replace(/^Unauthorized:\s*/, '');
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = '🔒 進入手機作業區';
    }
  },

  lockAndLogout: async function() {
    await ScannerEngine.stopCamera('m-scan-status');
    document.getElementById('m-camera-wrap').style.display = 'none';
    this._updateCamBtn(false);

    const token = this.getSessionToken();
    if (token && typeof CONFIG !== 'undefined' && CONFIG.GAS_API_URL) {
      try {
        await fetch(CONFIG.GAS_API_URL, {
          method: 'POST',
          body: JSON.stringify({ action: 'adminLogout', token })
        });
      } catch (_) {}
    }

    sessionStorage.removeItem('MEYA_SESSION_TOKEN');
    this.products = [];
    document.getElementById('m-app').classList.remove('unlocked');
    document.getElementById('m-login-screen').classList.remove('hidden');
    document.getElementById('m-token-input').value = '';
  },

  /**
   * 【最小權限讀取】改走 POST 呼叫 getMobileOpsProducts，不於 URL 暴露 Token 且不回傳成本進價
   */
  syncProducts: async function(unlockOnSuccess = false) {
    try {
      const res = await fetch(CONFIG.GAS_API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'getMobileOpsProducts',
          token: this.getSessionToken()
        })
      });
      const data = await res.json();

      if (data.status !== 'success') {
        if (String(data.message).includes('Unauthorized') || String(data.message).includes('Forbidden')) {
          sessionStorage.removeItem('MEYA_SESSION_TOKEN');
          return false;
        }
        throw new Error(data.message);
      }

      this.products = data.products || [];
      if (data.admin) this.operator = data.admin;

      document.getElementById('m-operator-label').textContent =
        `操作人員：${this.operator.name} [${this.operator.roleGroup || '現場模式'}]`;
      document.getElementById('m-db-count-pill').textContent = `已同步 ${this.products.length} 件商品`;

      if (unlockOnSuccess) {
        document.getElementById('m-login-screen').classList.add('hidden');
        document.getElementById('m-app').classList.add('unlocked');
      }
      return true;
    } catch (err) {
      this.showToast('資料同步失敗：' + err.message, 'err');
      return false;
    }
  },

  // ================= 2. 掃碼分流與鏡頭控制 =================

  toggleCamera: async function() {
    const wrap = document.getElementById('m-camera-wrap');
    if (ScannerEngine.isCameraRunning) {
      await ScannerEngine.stopCamera('m-scan-status');
      wrap.style.display = 'none';
      this._updateCamBtn(false);
    } else {
      wrap.style.display = 'block';
      const started = await ScannerEngine.startCamera('m-qr-reader', 'm-scan-status');
      if (!started) wrap.style.display = 'none';
      this._updateCamBtn(started);
    }
  },

  _updateCamBtn: function(running) {
    const btn = document.getElementById('m-btn-toggle-cam');
    btn.classList.toggle('active', running);
    btn.textContent = running ? '⏹ 關閉鏡頭' : '📷 開啟鏡頭';
  },

  switchMode: function(mode) {
    this.activeMode = mode;
    document.querySelectorAll('.m-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    document.querySelectorAll('.m-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('m-panel-' + mode).classList.add('active');
  },

  findProductByCode: function(rawCode) {
    const target = String(rawCode || '').trim().toLowerCase();
    return this.products.find(p =>
      String(p.id || '').trim().toLowerCase() === target ||
      String(p['條碼'] || '').trim().toLowerCase() === target ||
      String(p['國際條碼'] || '').trim().toLowerCase() === target
    ) || null;
  },

  handleIncomingScan: function(code) {
    if (this.activeMode === 'picking') this.processPickingScan(code);
    else if (this.activeMode === 'lookup') this.processLookupScan(code);
    else if (this.activeMode === 'pos') this.processPosScan(code);
  },

  showToast: function(msg, type = 'info') {
    const el = document.getElementById('m-scan-toast');
    el.textContent = msg;
    el.className = 'm-scan-toast toast-' + type;
    el.style.display = 'block';
  },

  // ================= 3. 模式一：出貨掃碼核對撿貨 =================

  loadSamplePickingOrder: function() {
    if (this.products.length === 0) return alert('尚無商品資料，請先點擊上方「同步」。');
    const samples = this.products.slice(0, 3);
    this.pickingOrderId = 'DEMO-' + String(Date.now()).slice(-6);
    document.getElementById('m-order-id-input').value = this.pickingOrderId;

    this.pickingItems = samples.map((p, idx) => ({
      id: String(p.id),
      barcode: String(p['條碼'] || p.id),
      name: String(p.name || ''),
      required: idx === 0 ? 2 : 1,
      picked: 0
    }));

    this.renderPickingList();
    this.showToast(`已載入實品測試單 ${this.pickingOrderId}，請掃描或輸入清單內商品條碼測試防呆`, 'info');
  },

  promptAddPickingItem: function() {
    const code = prompt('請輸入要加入撿貨單的商品編號：');
    if (!code) return;
    const prod = this.findProductByCode(code);
    const id = prod ? String(prod.id) : code.trim();
    const existing = this.pickingItems.find(i => i.id.toLowerCase() === id.toLowerCase());
    if (existing) {
      existing.required++;
    } else {
      this.pickingItems.push({
        id: id,
        barcode: prod ? String(prod['條碼'] || prod.id) : id,
        name: prod ? String(prod.name) : '自訂條碼品項',
        required: 1,
        picked: 0
      });
    }
    this.renderPickingList();
  },

  processPickingScan: function(code) {
    if (this.pickingItems.length === 0) {
      ScannerEngine.feedback('error');
      this.showToast('請先載入出貨單，再開始掃碼核對！', 'err');
      return;
    }

    const lower = code.toLowerCase();
    const hit = this.pickingItems.find(i =>
      i.id.toLowerCase() === lower || i.barcode.toLowerCase() === lower
    );

    if (!hit) {
      ScannerEngine.feedback('error');
      this.showToast(`🚨 拿錯商品！條碼 [${code}] 不在此張出貨單內！`, 'err');
      return;
    }

    if (hit.picked >= hit.required) {
      ScannerEngine.feedback('error');
      this.showToast(`⚠️ 超量重複刷碼！[${hit.id}] 已撿足 ${hit.required} 件！`, 'err');
      return;
    }

    hit.picked++;
    const allDone = this.pickingItems.every(i => i.picked === i.required);
    ScannerEngine.feedback(allDone ? 'complete' : 'ok');
    this.showToast(
      allDone
        ? `🎉 全部核對完成！最後一件 [${hit.id}] 確認無誤`
        : `✅ 核對正確：[${hit.id}] ${hit.name}（${hit.picked}/${hit.required}）`,
      'ok'
    );
    this.renderPickingList();
  },

  renderPickingList: function() {
    const listEl = document.getElementById('m-pick-list');
    const progEl = document.getElementById('m-pick-progress');
    const finishBtn = document.getElementById('m-btn-finish-pick');

    if (this.pickingItems.length === 0) {
      listEl.textContent = '';
      progEl.textContent = '尚未載入出貨單';
      finishBtn.disabled = true;
      return;
    }

    const totalReq = this.pickingItems.reduce((s, i) => s + i.required, 0);
    const totalPicked = this.pickingItems.reduce((s, i) => s + i.picked, 0);
    const allDone = totalReq > 0 && totalPicked === totalReq;

    progEl.textContent = `撿貨進度：${totalPicked} / ${totalReq} 件${allDone ? ' — ✅ 全部核對完畢' : ''}`;
    finishBtn.disabled = !allDone;

    listEl.textContent = '';
    this.pickingItems.forEach(item => {
      const isDone = item.picked === item.required;
      const div = document.createElement('div');
      div.className = 'm-pick-item' + (isDone ? ' done' : '');
      div.innerHTML = `
        <div class="m-pick-meta">
          <div class="m-pick-sku">${this.escapeHtml(item.id)}</div>
          <div class="m-pick-name">${this.escapeHtml(item.name)}</div>
        </div>
        <span class="m-pick-badge">${isDone ? '✔ ' : ''}${item.picked} / ${item.required}</span>
      `;
      listEl.appendChild(div);
    });
  },

  finishPickingOrder: function() {
    const orderId = document.getElementById('m-order-id-input').value.trim() || this.pickingOrderId || '未命名訂單';
    alert(
      `✅ 出貨核對完成紀錄（架構預覽）\n` +
      `訂單編號：${orderId}\n` +
      `操作人員：${this.operator.name}\n` +
      `總計件數：${this.pickingItems.reduce((s, i) => s + i.picked, 0)} 件`
    );
    this.pickingItems = [];
    this.renderPickingList();
  },

  // ================= 4. 模式二：掃碼即時查貨與盤點 =================

  processLookupScan: function(code) {
    const box = document.getElementById('m-lookup-result');
    const prod = this.findProductByCode(code);

    if (!prod) {
      ScannerEngine.feedback('error');
      this.showToast(`查無條碼：${code}`, 'err');
      box.textContent = '';
      const errDiv = document.createElement('div');
      errDiv.style.color = '#b91c1c';
      errDiv.textContent = `找不到編號或條碼為「${code}」的商品`;
      box.appendChild(errDiv);
      return;
    }

    ScannerEngine.feedback('ok');
    this.showToast(`已查得：[${prod.id}] ${prod.name}`, 'ok');

    const safeImg = /^https:\/\//i.test(String(prod.image || '').trim()) ? prod.image : '';
    const imgHtml = safeImg
      ? `<img class="m-lookup-img" src="${this.escapeHtml(safeImg)}" alt="">`
      : `<div class="m-lookup-img" style="display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;">尚無圖</div>`;

    box.innerHTML = `
      <div class="m-lookup-card">
        ${imgHtml}
        <div style="flex:1; min-width:0;">
          <div style="font-size:12px; color:#64748b;">編號：${this.escapeHtml(prod.id)}</div>
          <div style="font-size:15px; font-weight:700; color:#1e293b; margin:2px 0 6px;">${this.escapeHtml(prod.name)}</div>
          <div style="font-size:16px; font-weight:700; color:#15803d; margin-bottom:6px;">NT$ ${Number(prod.price || 0).toLocaleString()}</div>
          <div style="font-size:12px; color:#475569;">狀態：${this.escapeHtml(prod['狀態'] || '正常')}｜庫存：${this.escapeHtml(prod['庫存數量'] !== '' ? prod['庫存數量'] : '-')}</div>
        </div>
      </div>
    `;
  },

  // ================= 5. 模式三：POS 快速收銀草稿 =================

  processPosScan: function(code) {
    const prod = this.findProductByCode(code);
    if (!prod) {
      ScannerEngine.feedback('error');
      this.showToast(`查無商品條碼：${code}`, 'err');
      return;
    }

    ScannerEngine.feedback('ok');
    const existing = this.posCart.find(i => i.id === prod.id);
    if (existing) {
      existing.qty++;
    } else {
      this.posCart.push({
        id: String(prod.id),
        name: String(prod.name || ''),
        price: Number(prod.price || 0),
        qty: 1
      });
    }
    this.showToast(`＋ 已加入收銀車：[${prod.id}] ${prod.name}`, 'ok');
    this.renderPosCart();
  },

  renderPosCart: function() {
    const listEl = document.getElementById('m-pos-cart-list');
    const totalEl = document.getElementById('m-pos-total-amount');
    const checkoutBtn = document.getElementById('m-btn-pos-checkout');

    if (this.posCart.length === 0) {
      listEl.innerHTML = '<div class="m-empty">購物車目前為空，請掃描商品加入</div>';
      totalEl.textContent = 'NT$ 0';
      checkoutBtn.disabled = true;
      return;
    }

    let sum = 0;
    listEl.textContent = '';
    this.posCart.forEach((item, idx) => {
      const sub = item.price * item.qty;
      sum += sub;
      const div = document.createElement('div');
      div.className = 'm-pick-item';
      div.innerHTML = `
        <div class="m-pick-meta">
          <div class="m-pick-sku">${this.escapeHtml(item.id)} × ${item.qty}</div>
          <div class="m-pick-name">${this.escapeHtml(item.name)}</div>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <strong>NT$ ${sub.toLocaleString()}</strong>
          <button type="button" class="m-btn-sm m-btn-outline btn-rm-pos">✕</button>
        </div>
      `;
      div.querySelector('.btn-rm-pos').addEventListener('click', () => {
        this.posCart.splice(idx, 1);
        this.renderPosCart();
      });
      listEl.appendChild(div);
    });

    totalEl.textContent = 'NT$ ' + sum.toLocaleString();
    checkoutBtn.disabled = false;
  },

  escapeHtml: function(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
};

document.addEventListener('DOMContentLoaded', () => window.MobileOps.init());
