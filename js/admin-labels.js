/**
 * 模組 5：條碼標籤機對標設定與批次向量列印引擎
 * 支援：中線上下切割留白安全區、X/Y 軸毫米級微調校準、Code 128 向量條碼生成、設定直存 Google Sheet 全域設定
 */
window.AdminLabels = {
  // 預設參數（待實際取得貼紙與印表機後可直接於畫面微調並存檔）
  settings: {
    printerType: 'roll',      // 'roll' (捲筒標籤機) | 'a4' (A4 雷射整張預切貼紙)
    widthMm: 50,              // 單張貼紙寬度 (mm)
    heightMm: 25,             // 單張貼紙高度 (mm)
    cutGapMm: 2,              // 正中間上下切割安全留白 (mm)
    cols: 1,                  // 每列張數（捲筒通常 1～2 欄，A4 雷射依版面如 3～5 欄）
    colGapMm: 2,              // 欄間距 (mm)
    rowGapMm: 2,              // 列間距 (mm)
    offsetXMm: 0,             // 左邊界微調偏移 (mm)
    offsetYMm: 0,             // 上邊界微調偏移 (mm)
    topContent: 'barcode',    // 上半區內容：'barcode' | 'name_price' | 'id_only'
    bottomContent: 'name_price', // 下半區內容：'name_price' | 'barcode' | 'id_price'
    fontSizePt: 7             // 文字字體大小 (pt)
  },

  printQueue: [], // [{ id, name, price, qty }]

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

    const saveBtn = document.getElementById('btn-save-label-cfg');
    if (saveBtn) saveBtn.addEventListener('click', () => this.saveCalibrationConfig());

    const addBtn = document.getElementById('btn-add-label-item');
    if (addBtn) addBtn.addEventListener('click', () => this.addSelectedProductToQueue());

    const clearBtn = document.getElementById('btn-clear-label-queue');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.printQueue = [];
        this.renderQueue();
      });
    }

    const printBtn = document.getElementById('btn-print-labels');
    if (printBtn) printBtn.addEventListener('click', () => this.executeVectorPrint());
  },

  /**
   * 從 GAS 全域設定載入已儲存的標籤機校準值，並同步最新商品清單至下拉選單
   */
  syncData: function(configObj) {
    if (configObj && configObj.label_config) {
      try {
        const parsed = typeof configObj.label_config === 'string'
          ? JSON.parse(configObj.label_config)
          : configObj.label_config;
        this.settings = { ...this.settings, ...parsed };
      } catch (_) {}
    }
    this.syncFormFromSettings();
    this.populateProductDropdown();
    this.renderLivePreview();
  },

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
        config: {
          label_config: JSON.stringify(this.settings)
        }
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

  populateProductDropdown: function() {
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

  addSelectedProductToQueue: function() {
    const prodId = document.getElementById('lbl-product-select').value;
    const qty = Math.max(1, parseInt(document.getElementById('lbl-qty-input').value, 10) || 1);
    if (!prodId) return alert('請先選擇一件商品');

    const prod = AdminState.products.find(p => String(p.id) === String(prodId));
    if (!prod) return;

    const existing = this.printQueue.find(item => item.id === prod.id);
    if (existing) {
      existing.qty += qty;
    } else {
      this.printQueue.push({
        id: String(prod.id),
        name: String(prod.name || ''),
        price: Number(prod.price || 0),
        qty: qty
      });
    }
    this.renderQueue();
    this.renderLivePreview(prod);
  },

  renderQueue: function() {
    const tbody = document.getElementById('lbl-queue-tbody');
    const printBtn = document.getElementById('btn-print-labels');
    const esc = AdminCore.escapeHtml;
    if (!tbody) return;

    const totalCount = this.printQueue.reduce((sum, item) => sum + item.qty, 0);
    if (printBtn) {
      printBtn.disabled = totalCount === 0;
      printBtn.textContent = totalCount > 0 ? `🖨️ 列印全部 ${totalCount} 張條碼標籤` : '🖨️ 產生向量條碼並列印';
    }

    if (this.printQueue.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">尚未加入待列印商品（選擇商品與張數後按「加入清單」）</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    this.printQueue.forEach((item, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${esc(item.id)}</strong></td>
        <td>${esc(item.name)}</td>
        <td>NT$ ${item.price.toLocaleString()}</td>
        <td><input type="number" min="1" max="500" class="input-ctrl lbl-qty-edit" style="width:74px;" value="${item.qty}"></td>
        <td><button type="button" class="btn btn-danger btn-xs btn-del-lbl">移除</button></td>
      `;
      tr.querySelector('.lbl-qty-edit').addEventListener('change', e => {
        this.printQueue[idx].qty = Math.max(1, parseInt(e.target.value, 10) || 1);
        this.renderQueue();
      });
      tr.querySelector('.btn-del-lbl').addEventListener('click', () => {
        this.printQueue.splice(idx, 1);
        this.renderQueue();
      });
      tbody.appendChild(tr);
    });
  },

  /**
   * 建構單張貼紙 DOM（共用給預覽框與實際列印頁）
   */
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
    // 預設 name_price
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

  executeVectorPrint: function() {
    if (this.printQueue.length === 0) return;
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

    this.printQueue.forEach(item => {
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
