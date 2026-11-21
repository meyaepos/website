/**
 * 模組 5：條碼標籤機對標設定、關鍵字搜尋勾選入庫、14 天雲端待印資料庫與向量列印引擎
 */
window.AdminLabels = {
  MAX_SEARCH_DISPLAY: 25,

  settings: {
    printerType: 'roll',
    widthMm: 50,
    heightMm: 25,
    cutGapMm: 2,
    cols: 1,
    colGapMm: 2,
    rowGapMm: 2,
    offsetXMm: 0,
    offsetYMm: 0,
    topContent: 'barcode',
    bottomContent: 'name_price',
    fontSizePt: 7
  },

  printQueue: [],             // 來自雲端試算表「標籤待印清單」的持久資料
  dbSourceLabel: '',
  searchCheckedMap: {},       // { productId: qty } 搜尋區已勾選準備批次入庫的項目
  queueCheckedSet: new Set(), // 雲端待印清單已勾選的 productId（供批量刪除或指定列印）

  init: function() {
    this.bindEvents();
    this.syncFormFromSettings();
    this.renderLivePreview();
    this.renderQueue();
  },

  bindEvents: function() {
    const fieldIds = [
      'lbl-printer-type', 'lbl-width', 'lbl-height', 'lbl-cut-gap',
      'lbl-cols', 'lbl-col-gap', 'lbl-row-gap', 'lbl-offset-x', 'lbl-offset-y',
      'lbl-top-content', 'lbl-bottom-content', 'lbl-font-size'
    ];
    fieldIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => this.readSettingsFromForm());
        el.addEventListener('change', () => this.readSettingsFromForm());
      }
    });

    document.getElementById('btn-save-label-cfg').addEventListener('click', () => this.saveCalibrationConfig());

    // 搜尋與勾選入庫區
    document.getElementById('lbl-search-input').addEventListener('input', () => this.renderSearchList());
    document.getElementById('chk-search-all').addEventListener('change', e => this.toggleAllSearchCheckboxes(e.target.checked));
    document.getElementById('btn-batch-add-picked').addEventListener('click', () => this.batchAddCheckedToDb());

    // 備選傳統下拉選單
    document.getElementById('btn-add-label-item').addEventListener('click', () => this.addDropdownProductToDb());

    // 雲端待印資料庫控制鈕
    document.getElementById('btn-refresh-label-db').addEventListener('click', () => this.refreshQueueFromServer());
    document.getElementById('chk-queue-all').addEventListener('change', e => this.toggleAllQueueCheckboxes(e.target.checked));
    document.getElementById('btn-batch-del-queue').addEventListener('click', () => this.deleteCheckedQueueItems());
    document.getElementById('btn-clear-label-queue').addEventListener('click', () => this.clearAllQueueItems());
    document.getElementById('btn-print-selected-labels').addEventListener('click', () => this.executeVectorPrint(true));
    document.getElementById('btn-print-labels').addEventListener('click', () => this.executeVectorPrint(false));
  },

  // ================= 1. 同步設定、商品清單與雲端待印資料庫 =================

  syncData: function(configObj, labelQueueItems, dbSource) {
    if (configObj && configObj.label_config) {
      try {
        const parsed = typeof configObj.label_config === 'string'
          ? JSON.parse(configObj.label_config)
          : configObj.label_config;
        this.settings = { ...this.settings, ...parsed };
      } catch (_) {}
    }

    this.printQueue = Array.isArray(labelQueueItems) ? labelQueueItems : [];
    this.dbSourceLabel = dbSource || '';
    this.queueCheckedSet.clear();

    this.syncFormFromSettings();
    this.populateBackupDropdown();
    this.renderSearchList();
    this.renderQueue();
    this.renderLivePreview();
  },

  applyQueueResponse: function(queueData) {
    this.printQueue = (queueData && Array.isArray(queueData.items)) ? queueData.items : [];
    if (queueData && queueData.dbSource) this.dbSourceLabel = queueData.dbSource;

    // 清除已不存在清單中的勾選狀態
    const validIds = new Set(this.printQueue.map(x => x.id));
    Array.from(this.queueCheckedSet).forEach(id => {
      if (!validIds.has(id)) this.queueCheckedSet.delete(id);
    });

    this.renderSearchList();
    this.renderQueue();
  },

  refreshQueueFromServer: async function() {
    const btn = document.getElementById('btn-refresh-label-db');
    btn.disabled = true;
    btn.textContent = '⏳ 同步中...';
    try {
      const json = await AdminCore.apiGet('getLabelQueue');
      if (json.status !== 'success') {
        if (AdminCore.handleAuthFailure(json.message)) return;
        throw new Error(json.message);
      }
      this.applyQueueResponse(json.data);
      if (json.data && json.data.prunedCount > 0) {
        alert(`已自動清除 ${json.data.prunedCount} 筆超過 14 天的過期標籤紀錄。`);
      }
    } catch (err) {
      alert('同步待印資料庫失敗：' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '🔄 重新整理';
    }
  },

  // ================= 2. 關鍵字／編號即時搜尋與勾選入庫 =================

  getFilteredSearchProducts: function() {
    const kw = (document.getElementById('lbl-search-input').value || '').trim().toLowerCase();
    const list = (AdminState.products || []).filter(p => {
      if (!kw) return true;
      return String(p.id || '').toLowerCase().includes(kw) ||
        String(p.name || '').toLowerCase().includes(kw) ||
        String(p['條碼'] || '').toLowerCase().includes(kw) ||
        String(p['國際條碼'] || '').toLowerCase().includes(kw);
    });
    return { total: list.length, visible: list.slice(0, this.MAX_SEARCH_DISPLAY) };
  },

  renderSearchList: function() {
    const tbody = document.getElementById('lbl-search-tbody');
    const countEl = document.getElementById('lbl-search-count');
    const esc = AdminCore.escapeHtml;
    if (!tbody) return;

    const { total, visible } = this.getFilteredSearchProducts();
    countEl.textContent = total > visible.length
      ? `符合 ${total} 筆（顯示前 ${visible.length} 筆，可輸入關鍵字縮小範圍）`
      : `符合 ${total} 筆`;

    const inDbIds = new Set(this.printQueue.map(q => q.id));

    if (visible.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">找不到符合關鍵字或編號的商品</td></tr>';
      document.getElementById('chk-search-all').checked = false;
      this.updateBatchAddButton();
      return;
    }

    tbody.innerHTML = '';
    let visibleCheckedCount = 0;

    visible.forEach(p => {
      const pid = String(p.id);
      const isChecked = Object.prototype.hasOwnProperty.call(this.searchCheckedMap, pid);
      if (isChecked) visibleCheckedCount++;
      const qtyVal = isChecked ? this.searchCheckedMap[pid] : 1;
      const alreadyInDb = inDbIds.has(pid);

      const tr = document.createElement('tr');
      if (alreadyInDb) tr.className = 'lbl-row-in-db';

      tr.innerHTML = `
        <td><input type="checkbox" class="lbl-checkbox chk-s-row" ${isChecked ? 'checked' : ''}></td>
        <td>
          <strong>${esc(pid)}</strong>
          ${alreadyInDb ? '<span class="pill pill-ok" style="margin-left:4px; font-size:11px;">已在庫中</span>' : ''}
        </td>
        <td>${esc(p.name)}</td>
        <td>NT$ ${Number(p.price || 0).toLocaleString()}</td>
        <td><input type="number" min="1" max="500" class="input-ctrl inp-s-qty" style="width:68px;" value="${qtyVal}"></td>
        <td style="white-space:nowrap;">
          <button type="button" class="btn btn-primary btn-xs btn-direct-add">＋直接入庫</button>
          <button type="button" class="btn btn-outline btn-xs btn-preview-s">預覽</button>
        </td>
      `;

      const chk = tr.querySelector('.chk-s-row');
      const qtyInput = tr.querySelector('.inp-s-qty');

      chk.addEventListener('change', () => {
        if (chk.checked) {
          this.searchCheckedMap[pid] = Math.max(1, parseInt(qtyInput.value, 10) || 1);
        } else {
          delete this.searchCheckedMap[pid];
        }
        this.updateBatchAddButton();
      });

      qtyInput.addEventListener('change', () => {
        const v = Math.max(1, parseInt(qtyInput.value, 10) || 1);
        qtyInput.value = v;
        if (chk.checked) this.searchCheckedMap[pid] = v;
      });

      tr.querySelector('.btn-direct-add').addEventListener('click', () => {
        const qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
        this.pushItemsToCloudDb([{ id: pid, name: String(p.name || ''), price: Number(p.price || 0), qty: qty }]);
      });

      tr.querySelector('.btn-preview-s').addEventListener('click', () => this.renderLivePreview(p));

      tbody.appendChild(tr);
    });

    document.getElementById('chk-search-all').checked = visible.length > 0 && visibleCheckedCount === visible.length;
    this.updateBatchAddButton();
  },

  toggleAllSearchCheckboxes: function(checked) {
    const { visible } = this.getFilteredSearchProducts();
    visible.forEach(p => {
      const pid = String(p.id);
      if (checked) {
        if (!this.searchCheckedMap[pid]) this.searchCheckedMap[pid] = 1;
      } else {
        delete this.searchCheckedMap[pid];
      }
    });
    this.renderSearchList();
  },

  updateBatchAddButton: function() {
    const count = Object.keys(this.searchCheckedMap).length;
    const btn = document.getElementById('btn-batch-add-picked');
    btn.disabled = count === 0;
    btn.textContent = `✅ 將已勾選 (${count}) 筆寫入待印資料庫`;
  },

  batchAddCheckedToDb: async function() {
    const ids = Object.keys(this.searchCheckedMap);
    if (ids.length === 0) return;

    const payloadItems = ids.map(pid => {
      const p = AdminState.products.find(x => String(x.id) === pid);
      return {
        id: pid,
        name: p ? String(p.name || '') : '',
        price: p ? Number(p.price || 0) : 0,
        qty: this.searchCheckedMap[pid] || 1
      };
    });

    const ok = await this.pushItemsToCloudDb(payloadItems);
    if (ok) {
      this.searchCheckedMap = {};
      this.renderSearchList();
    }
  },

  populateBackupDropdown: function() {
    const sel = document.getElementById('lbl-product-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- 請選擇要印標籤的商品 --</option>';
    (AdminState.products || []).slice(0, 800).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `[${p.id}] ${p.name} (NT$${Number(p.price || 0).toLocaleString()})`;
      sel.appendChild(opt);
    });
  },

  addDropdownProductToDb: function() {
    const prodId = document.getElementById('lbl-product-select').value;
    const qty = Math.max(1, parseInt(document.getElementById('lbl-qty-input').value, 10) || 1);
    if (!prodId) return alert('請先選擇一件商品');
    const p = AdminState.products.find(x => String(x.id) === String(prodId));
    if (!p) return;
    this.pushItemsToCloudDb([{ id: String(p.id), name: String(p.name || ''), price: Number(p.price || 0), qty: qty }]);
  },

  pushItemsToCloudDb: async function(items) {
    const batchBtn = document.getElementById('btn-batch-add-picked');
    const prevText = batchBtn.textContent;
    batchBtn.disabled = true;
    batchBtn.textContent = '⏳ 寫入雲端資料庫中...';

    try {
      const json = await AdminCore.apiPost('addLabelQueueItems', { items: items });
      if (json.status !== 'success') {
        if (AdminCore.handleAuthFailure(json.message)) return false;
        throw new Error(json.message);
      }
      this.applyQueueResponse(json.data);
      if (items[0]) this.renderLivePreview(items[0]);
      return true;
    } catch (err) {
      alert('❌ 寫入待印資料庫失敗：' + err.message);
      return false;
    } finally {
      batchBtn.textContent = prevText;
      this.updateBatchAddButton();
    }
  },

  // ================= 3. 雲端待印清單渲染、改張數與批量刪除 =================

  renderQueue: function() {
    const tbody = document.getElementById('lbl-queue-tbody');
    const noteEl = document.getElementById('lbl-db-source-note');
    const navBadge = document.getElementById('nav-label-badge');
    const esc = AdminCore.escapeHtml;
    if (!tbody) return;

    if (noteEl) {
      noteEl.textContent = this.dbSourceLabel
        ? `🗄️ 儲存位置：${this.dbSourceLabel} ➔ 分頁《標籤待印清單》｜滿 14 天自動清除`
        : '🗄️ 雲端試算表永久保存｜滿 14 天自動清除';
    }

    if (navBadge) {
      navBadge.textContent = this.printQueue.length;
      navBadge.style.display = this.printQueue.length > 0 ? 'inline-block' : 'none';
    }

    if (this.printQueue.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">雲端待印資料庫目前為空（請於上方搜尋並點選入庫）</td></tr>';
      document.getElementById('chk-queue-all').checked = false;
      this.updateQueueActionButtons();
      return;
    }

    tbody.innerHTML = '';
    this.printQueue.forEach(item => {
      const isChecked = this.queueCheckedSet.has(item.id);
      const daysClass = item.daysLeft <= 3 ? 'pill-wait' : 'pill-off';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="checkbox" class="lbl-checkbox chk-q-row" ${isChecked ? 'checked' : ''}></td>
        <td><strong>${esc(item.id)}</strong></td>
        <td>${esc(item.name)}</td>
        <td>NT$ ${Number(item.price || 0).toLocaleString()}</td>
        <td><input type="number" min="1" max="500" class="input-ctrl lbl-qty-edit" style="width:74px;" value="${item.qty}"></td>
        <td>
          <span class="pill ${daysClass}">剩 ${item.daysLeft || 14} 天</span>
          <div style="font-size:11px; color:#94a3b8; margin-top:2px;">到期：${esc(item.expireDate || '')}</div>
        </td>
        <td style="white-space:nowrap;">
          <button type="button" class="btn btn-outline btn-xs btn-preview-q">預覽</button>
          <button type="button" class="btn btn-danger btn-xs btn-del-lbl">刪除</button>
        </td>
      `;

      tr.querySelector('.chk-q-row').addEventListener('change', e => {
        if (e.target.checked) this.queueCheckedSet.add(item.id);
        else this.queueCheckedSet.delete(item.id);
        this.updateQueueActionButtons();
      });

      tr.querySelector('.lbl-qty-edit').addEventListener('change', async e => {
        const newQty = Math.max(1, parseInt(e.target.value, 10) || 1);
        e.target.value = newQty;
        await this.updateCloudItemQty(item.id, newQty);
      });

      tr.querySelector('.btn-preview-q').addEventListener('click', () => this.renderLivePreview(item));
      tr.querySelector('.btn-del-lbl').addEventListener('click', () => this.deleteItemsFromCloudDb([item.id], false));

      tbody.appendChild(tr);
    });

    document.getElementById('chk-queue-all').checked =
      this.printQueue.length > 0 && this.queueCheckedSet.size === this.printQueue.length;
    this.updateQueueActionButtons();
  },

  toggleAllQueueCheckboxes: function(checked) {
    this.queueCheckedSet.clear();
    if (checked) {
      this.printQueue.forEach(item => this.queueCheckedSet.add(item.id));
    }
    this.renderQueue();
  },

  updateQueueActionButtons: function() {
    const checkedCount = this.queueCheckedSet.size;
    const checkedTags = this.printQueue
      .filter(it => this.queueCheckedSet.has(it.id))
      .reduce((sum, it) => sum + it.qty, 0);
    const totalTags = this.printQueue.reduce((sum, it) => sum + it.qty, 0);

    const delBtn = document.getElementById('btn-batch-del-queue');
    delBtn.disabled = checkedCount === 0;
    delBtn.textContent = `🗑️ 批量刪除已勾選 (${checkedCount})`;

    const printSelBtn = document.getElementById('btn-print-selected-labels');
    printSelBtn.disabled = checkedCount === 0;
    printSelBtn.textContent = checkedCount > 0 ? `🖨️ 列印已勾選 (${checkedTags}張)` : '🖨️ 列印已勾選';

    const printAllBtn = document.getElementById('btn-print-labels');
    printAllBtn.disabled = totalTags === 0;
    printAllBtn.textContent = totalTags > 0 ? `🖨️ 列印全部 (${totalTags}張)` : '🖨️ 列印全部';
  },

  updateCloudItemQty: async function(productId, newQty) {
    try {
      const json = await AdminCore.apiPost('updateLabelQueueQty', { productId: productId, qty: newQty });
      if (json.status !== 'success') {
        if (AdminCore.handleAuthFailure(json.message)) return;
        throw new Error(json.message);
      }
      this.applyQueueResponse(json.data);
    } catch (err) {
      alert('更新張數失敗：' + err.message);
    }
  },

  deleteCheckedQueueItems: function() {
    const ids = Array.from(this.queueCheckedSet);
    if (ids.length === 0) return;
    if (!confirm(`確定要從雲端待印資料庫批量刪除已勾選的 ${ids.length} 筆商品嗎？`)) return;
    this.deleteItemsFromCloudDb(ids, false);
  },

  clearAllQueueItems: function() {
    if (this.printQueue.length === 0) return;
    if (!confirm(`確定要清空雲端待印資料庫內的全部 ${this.printQueue.length} 筆商品嗎？`)) return;
    this.deleteItemsFromCloudDb([], true);
  },

  deleteItemsFromCloudDb: async function(ids, clearAll) {
    try {
      const json = await AdminCore.apiPost('deleteLabelQueueItems', { ids: ids, clearAll: clearAll });
      if (json.status !== 'success') {
        if (AdminCore.handleAuthFailure(json.message)) return;
        throw new Error(json.message);
      }
      this.applyQueueResponse(json.data);
    } catch (err) {
      alert('刪除失敗：' + err.message);
    }
  },

  // ================= 4. 標籤校準設定、即時模擬與向量列印 =================

  syncFormFromSettings: function() {
    const s = this.settings;
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    setVal('lbl-printer-type', s.printerType);
    setVal('lbl-width', s.widthMm);
    setVal('lbl-height', s.heightMm);
    setVal('lbl-cut-gap', s.cutGapMm);
    setVal('lbl-cols', s.cols);
    setVal('lbl-col-gap', s.colGapMm);
    setVal('lbl-row-gap', s.rowGapMm);
    setVal('lbl-offset-x', s.offsetXMm);
    setVal('lbl-offset-y', s.offsetYMm);
    setVal('lbl-top-content', s.topContent);
    setVal('lbl-bottom-content', s.bottomContent);
    setVal('lbl-font-size', s.fontSizePt);
  },

  readSettingsFromForm: function() {
    const getNum = (id, def) => {
      const el = document.getElementById(id);
      const n = el ? parseFloat(el.value) : NaN;
      return isNaN(n) ? def : n;
    };
    const getStr = (id, def) => {
      const el = document.getElementById(id);
      return el ? el.value : def;
    };

    this.settings = {
      printerType: getStr('lbl-printer-type', 'roll'),
      widthMm: Math.max(15, getNum('lbl-width', 50)),
      heightMm: Math.max(10, getNum('lbl-height', 25)),
      cutGapMm: Math.max(0, getNum('lbl-cut-gap', 2)),
      cols: Math.max(1, Math.round(getNum('lbl-cols', 1))),
      colGapMm: Math.max(0, getNum('lbl-col-gap', 2)),
      rowGapMm: Math.max(0, getNum('lbl-row-gap', 2)),
      offsetXMm: getNum('lbl-offset-x', 0),
      offsetYMm: getNum('lbl-offset-y', 0),
      topContent: getStr('lbl-top-content', 'barcode'),
      bottomContent: getStr('lbl-bottom-content', 'name_price'),
      fontSizePt: Math.max(5, getNum('lbl-font-size', 7))
    };

    this.renderLivePreview();
  },

  saveCalibrationConfig: async function() {
    this.readSettingsFromForm();
    const btn = document.getElementById('btn-save-label-cfg');
    btn.disabled = true;
    btn.textContent = '⏳ 儲存中...';

    try {
      const json = await AdminCore.apiPost('saveWebsiteConfig', {
        config: { label_config: JSON.stringify(this.settings) }
      });
      if (json.status !== 'success') {
        if (AdminCore.handleAuthFailure(json.message)) return;
        throw new Error(json.message);
      }
      alert('✅ 標籤機尺寸與對位偏移參數已儲存至資料庫！');
    } catch (err) {
      alert('❌ 儲存失敗：' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 儲存標籤機校準設定';
    }
  },

  _buildHalfHtml: function(mode, prod, fontSizePt, svgId) {
    const esc = AdminCore.escapeHtml;
    if (mode === 'barcode') {
      return `
        <svg id="${svgId}" class="label-barcode-svg"></svg>
        <div class="label-text-line" style="font-size:${Math.max(5, fontSizePt - 1)}pt; letter-spacing:0.5px;">${esc(prod.id)}</div>
      `;
    }
    if (mode === 'id_price') {
      return `
        <div class="label-text-line" style="font-size:${fontSizePt}pt;">${esc(prod.id)}</div>
        <div class="label-text-line" style="font-size:${fontSizePt}pt;">NT$ ${Number(prod.price || 0).toLocaleString()}</div>
      `;
    }
    if (mode === 'id_only') {
      return `<div class="label-text-line" style="font-size:${fontSizePt + 1}pt;">${esc(prod.id)}</div>`;
    }
    return `
      <div class="label-text-line" style="font-size:${fontSizePt}pt;">${esc(prod.name)}</div>
      <div class="label-text-line" style="font-size:${fontSizePt}pt;">NT$ ${Number(prod.price || 0).toLocaleString()}</div>
    `;
  },

  _renderSvgBarcode: function(svgElement, codeText, halfHeightMm) {
    if (!svgElement || typeof JsBarcode === 'undefined') return;
    const safeCode = String(codeText || 'MEYA001').replace(/[^\x20-\x7E]/g, '') || 'MEYA001';
    const barPxHeight = Math.max(14, Math.round(halfHeightMm * 2.2));
    try {
      JsBarcode(svgElement, safeCode, {
        format: 'CODE128',
        width: 1.15,
        height: barPxHeight,
        displayValue: false,
        margin: 1
      });
    } catch (_) {}
  },

  renderLivePreview: function(sampleProd) {
    const container = document.getElementById('label-live-preview');
    if (!container) return;

    const s = this.settings;
    const prod = sampleProd || this.printQueue[0] || (AdminState.products && AdminState.products[0]) || {
      id: '3822039N1GM',
      name: '莫桑石3mm無限符號項鍊',
      price: 1280
    };

    const halfHeightMm = Math.max(4, (s.heightMm - s.cutGapMm) / 2);

    container.innerHTML = `
      <div class="label-tag-demo" style="width:${s.widthMm}mm; height:${s.heightMm}mm;">
        <div class="label-half">${this._buildHalfHtml(s.topContent, prod, s.fontSizePt, 'demo-svg-top')}</div>
        <div class="label-cut-line" style="height:${s.cutGapMm}mm;"></div>
        <div class="label-half">${this._buildHalfHtml(s.bottomContent, prod, s.fontSizePt, 'demo-svg-bot')}</div>
      </div>
      <div style="font-size:12px; color:#475569;">
        規格預覽：${s.widthMm}×${s.heightMm}mm ｜ 中線留白 ${s.cutGapMm}mm ｜ 每列 ${s.cols} 張 ｜ 偏移 (X:${s.offsetXMm}mm, Y:${s.offsetYMm}mm)
      </div>
    `;

    this._renderSvgBarcode(document.getElementById('demo-svg-top'), prod.id, halfHeightMm);
    this._renderSvgBarcode(document.getElementById('demo-svg-bot'), prod.id, halfHeightMm);
  },

  executeVectorPrint: function(onlyChecked) {
    const targetItems = onlyChecked
      ? this.printQueue.filter(it => this.queueCheckedSet.has(it.id))
      : this.printQueue;

    if (targetItems.length === 0) return;
    this.readSettingsFromForm();

    const sheet = document.getElementById('label-print-sheet');
    if (!sheet) return;

    const s = this.settings;
    const halfHeightMm = Math.max(4, (s.heightMm - s.cutGapMm) / 2);

    sheet.innerHTML = '';
    sheet.style.gridTemplateColumns = `repeat(${s.cols}, ${s.widthMm}mm)`;
    sheet.style.columnGap = `${s.colGapMm}mm`;
    sheet.style.rowGap = `${s.rowGapMm}mm`;
    sheet.style.paddingLeft = `${Math.max(0, s.offsetXMm)}mm`;
    sheet.style.paddingTop = `${Math.max(0, s.offsetYMm)}mm`;

    let seq = 0;
    const renderTasks = [];

    targetItems.forEach(item => {
      for (let i = 0; i < item.qty; i++) {
        seq++;
        const topId = `p-svg-t-${seq}`;
        const botId = `p-svg-b-${seq}`;
        const cell = document.createElement('div');
        cell.className = 'print-tag-cell';
        cell.style.width = `${s.widthMm}mm`;
        cell.style.height = `${s.heightMm}mm`;
        cell.innerHTML = `
          <div class="label-half">${this._buildHalfHtml(s.topContent, item, s.fontSizePt, topId)}</div>
          <div class="print-cut-gap" style="height:${s.cutGapMm}mm;"></div>
          <div class="label-half">${this._buildHalfHtml(s.bottomContent, item, s.fontSizePt, botId)}</div>
        `;
        sheet.appendChild(cell);
        renderTasks.push({ topId, botId, code: item.id });
      }
    });

    renderTasks.forEach(t => {
      this._renderSvgBarcode(document.getElementById(t.topId), t.code, halfHeightMm);
      this._renderSvgBarcode(document.getElementById(t.botId), t.code, halfHeightMm);
    });

    window.print();
  }
};
