/**
 * 模組 2：商品管理、有原圖置頂專區、全欄位編修與圖檔對標引擎
 */
window.AdminProducts = {
  MAX_IMAGE_WIDTH: 1600,
  MAX_BYTES_LIMIT: 2 * 1024 * 1024,
  PAGE_SIZE: 50,

  currentPage: 1,
  rawDriveImages: [],
  matchedFolderName: '',
  activeProductId: '',
  loadedSourceImage: null,

  editMode: 'EDIT', // 'EDIT' 或 'CREATE'
  editingProductId: '',

  init: function() {
    document.getElementById('prod-search').addEventListener('input', () => this.renderTable(true));
    document.getElementById('prod-filter').addEventListener('change', () => this.renderTable(true));

    // 點擊 KPI 卡或提示條直接切進「有原圖待對標專區」
    const switchReadyFilter = () => {
      document.getElementById('prod-filter').value = 'READY_MATCH';
      document.getElementById('prod-search').value = '';
      this.renderTable(true);
    };
    document.getElementById('kpi-card-ready').addEventListener('click', switchReadyFilter);
    document.getElementById('btn-filter-ready').addEventListener('click', switchReadyFilter);

    // 新增與編輯商品彈窗
    document.getElementById('btn-create-product').addEventListener('click', () => this.openEditModal(null));
    document.getElementById('btn-close-edit-x').addEventListener('click', () => this.closeEditModal());
    document.getElementById('btn-cancel-edit').addEventListener('click', () => this.closeEditModal());
    document.getElementById('btn-save-edit').addEventListener('click', () => this.saveProductEdit());

    // 圖檔對標彈窗
    document.getElementById('btn-close-modal-x').addEventListener('click', () => this.closeMatchModal());
    document.getElementById('btn-cancel-modal').addEventListener('click', () => this.closeMatchModal());
    document.getElementById('raw-img-search').addEventListener('input', () => this.renderRawImageList());
    document.getElementById('crop-ratio-select').addEventListener('change', () => this.redrawCanvasPreview());
    document.getElementById('btn-upload-bind').addEventListener('click', () => this.confirmCompressAndUpload());
  },

  // ================= 1. 商品列表（自動置頂「有原圖待對標」＋ 高速分頁） =================

  renderTable: function(resetPage = false) {
    if (resetPage) this.currentPage = 1;

    const tbody = document.getElementById('product-tbody');
    const kw = document.getElementById('prod-search').value.trim().toLowerCase();
    const filter = document.getElementById('prod-filter').value;
    const coreSet = new Set(window.CORE_PRODUCT_KEYS);
    const esc = AdminCore.escapeHtml;

    const filtered = AdminState.products.filter(p => {
      if (kw) {
        const hitText = Object.keys(p)
          .filter(k => !k.startsWith('_'))
          .some(k => String(p[k] || '').toLowerCase().includes(kw));
        if (!hitText) return false;
      }
      if (filter === 'READY_MATCH') return p._readyToMatch === true;
      if (filter === 'NO_IMAGE') return !p.image || String(p.image).trim() === '';
      if (filter !== 'ALL') return p['狀態'] === filter;
      return true;
    });

    // 自動排序：1. 有原圖待對標最優先 ➔ 2. 已上架 ➔ 3. 其餘待對標/下架
    filtered.sort((a, b) => {
      const rank = item => {
        if (item._readyToMatch) return 0;
        if (item['狀態'] === '上架') return 1;
        return 2;
      };
      const diff = rank(a) - rank(b);
      if (diff !== 0) return diff;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    const totalItems = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / this.PAGE_SIZE));
    if (this.currentPage > totalPages) this.currentPage = totalPages;

    const startIdx = (this.currentPage - 1) * this.PAGE_SIZE;
    const pageItems = filtered.slice(startIdx, startIdx + this.PAGE_SIZE);

    if (pageItems.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">沒有符合條件的商品資料</td></tr>';
      this.renderPagination(0, 1, 1);
      return;
    }

    tbody.innerHTML = '';
    pageItems.forEach(p => {
      const extraSummary = Object.keys(p)
        .filter(k => !k.startsWith('_') && !coreSet.has(k) && p[k] !== '' && p[k] !== undefined)
        .slice(0, 3)
        .map(k => `<span class="pill pill-off" style="margin:2px;">${esc(k)}: ${esc(p[k])}</span>`)
        .join('');

      const statusClass = p['狀態'] === '上架' ? 'pill-ok' : (p['狀態'] === '待對標' ? 'pill-wait' : 'pill-off');
      const nextStatus = p['狀態'] === '上架' ? '下架' : '上架';

      const thumbCell = p.image
        ? `<img class="thumb-mini" src="${esc(p.image)}" loading="lazy" alt="">`
        : (p._readyToMatch
            ? `<div><span class="pill pill-ready">📁 有原圖</span></div>`
            : `<span class="pill pill-err">缺圖</span>`);

      const tr = document.createElement('tr');
      if (p._readyToMatch) tr.className = 'row-ready-match';

      tr.innerHTML = `
        <td>${thumbCell}</td>
        <td>
          <strong>${esc(p.id)}</strong>
          ${p._readyToMatch ? `<div style="font-size:11px; color:#15803d;">資料夾：${esc(p._matchedFolder)}</div>` : ''}
        </td>
        <td>${esc(p.name)}</td>
        <td>NT$ ${Number(p.price || 0).toLocaleString()}</td>
        <td>${extraSummary || '<span style="color:#94a3b8; font-size:12px;">-</span>'}</td>
        <td><span class="pill ${statusClass}">${esc(p['狀態'] || '未設定')}</span></td>
        <td style="white-space:nowrap;">
          <button class="btn ${p._readyToMatch ? 'btn-success' : 'btn-primary'} btn-open-match">對標排版</button>
          <button class="btn btn-info btn-edit-prod">編輯資料</button>
          <button class="btn btn-outline btn-toggle-status">設為${nextStatus}</button>
        </td>
      `;

      tr.querySelector('.btn-open-match').addEventListener('click', () => this.openMatchModal(p));
      tr.querySelector('.btn-edit-prod').addEventListener('click', () => this.openEditModal(p));
      tr.querySelector('.btn-toggle-status').addEventListener('click', () => this.toggleProductStatus(p.id, nextStatus));
      tbody.appendChild(tr);
    });

    this.renderPagination(totalItems, this.currentPage, totalPages);
  },

  renderPagination: function(totalItems, currentPage, totalPages) {
    const bar = document.getElementById('pagination-bar');
    if (totalItems === 0) {
      bar.innerHTML = '<span>共 0 筆商品</span>';
      return;
    }

    const start = (currentPage - 1) * this.PAGE_SIZE + 1;
    const end = Math.min(totalItems, currentPage * this.PAGE_SIZE);

    bar.innerHTML = `
      <span>顯示第 ${start}～${end} 筆，共 <strong>${totalItems}</strong> 筆（第 ${currentPage} / ${totalPages} 頁）</span>
      <div class="toolbar-group">
        <button class="btn btn-outline" id="btn-page-prev" ${currentPage <= 1 ? 'disabled' : ''}>← 上一頁</button>
        <button class="btn btn-outline" id="btn-page-next" ${currentPage >= totalPages ? 'disabled' : ''}>下一頁 →</button>
      </div>
    `;

    const prevBtn = document.getElementById('btn-page-prev');
    const nextBtn = document.getElementById('btn-page-next');
    if (prevBtn) prevBtn.addEventListener('click', () => { this.currentPage--; this.renderTable(false); });
    if (nextBtn) nextBtn.addEventListener('click', () => { this.currentPage++; this.renderTable(false); });
  },

  toggleProductStatus: async function(productId, newStatus) {
    try {
      const json = await AdminCore.apiPost('updateProductStatus', { productId, newStatus });
      if (json.status === 'success') AdminCore.loadDashboard();
      else if (!AdminCore.handleAuthFailure(json.message)) alert('狀態更新失敗：' + json.message);
    } catch (err) {
      alert('狀態更新異常：' + err.message);
    }
  },

  // ================= 2. 商品全欄位編輯 / 新增視窗 =================

  openEditModal: function(product) {
    this.editMode = product ? 'EDIT' : 'CREATE';
    this.editingProductId = product ? String(product.id) : '';

    document.getElementById('edit-modal-title').textContent = product
      ? `編輯商品數據：[${product.id}] ${product.name}`
      : '＋ 新增商品至資料庫';

    const grid = document.getElementById('edit-fields-grid');
    grid.innerHTML = '';

    // 確保核心 5 欄位排在最前面，其餘動態擴充欄位接續在後
    const allHeaders = Array.from(new Set([...window.CORE_PRODUCT_KEYS, ...AdminState.productHeaders]));

    allHeaders.forEach(colName => {
      const val = product && product[colName] !== undefined ? String(product[colName]) : '';
      const wrap = document.createElement('div');
      wrap.className = 'edit-field-item' + (colName === 'image' || colName === 'name' ? ' full-span' : '');

      const label = document.createElement('label');
      label.textContent = colName === 'id' ? '商品編號 (id) *' : (colName === 'name' ? '商品名稱 (name) *' : colName);
      wrap.appendChild(label);

      if (colName === '狀態') {
        const sel = document.createElement('select');
        sel.className = 'input-ctrl';
        sel.dataset.field = colName;
        ['待對標', '上架', '下架'].forEach(optVal => {
          const opt = document.createElement('option');
          opt.value = optVal;
          opt.textContent = optVal;
          if ((val || '待對標') === optVal) opt.selected = true;
          sel.appendChild(opt);
        });
        wrap.appendChild(sel);
      } else {
        const input = document.createElement('input');
        input.type = colName === 'price' ? 'number' : 'text';
        input.className = 'input-ctrl';
        input.dataset.field = colName;
        input.value = val;
        if (colName === 'id' && this.editMode === 'EDIT') {
          input.readOnly = true;
          input.title = '商品編號為雲端圖庫對標鍵值，不可直接變更';
        }
        wrap.appendChild(input);
      }

      grid.appendChild(wrap);
    });

    document.getElementById('edit-product-modal').classList.add('open');
  },

  saveProductEdit: async function() {
    const inputs = document.querySelectorAll('#edit-fields-grid [data-field]');
    const fields = {};
    inputs.forEach(el => {
      fields[el.dataset.field] = el.value.trim();
    });

    if (this.editMode === 'CREATE' && (!fields.id || !fields.name)) {
      alert('「商品編號 (id)」與「商品名稱 (name)」為必填欄位！');
      return;
    }

    const btn = document.getElementById('btn-save-edit');
    btn.disabled = true;
    btn.textContent = '⏳ 寫入資料庫中...';

    try {
      const json = this.editMode === 'EDIT'
        ? await AdminCore.apiPost('updateProductRecord', { productId: this.editingProductId, fields })
        : await AdminCore.apiPost('createProductRecord', { fields });

      if (json.status !== 'success') {
        if (AdminCore.handleAuthFailure(json.message)) return;
        throw new Error(json.message);
      }

      alert('✅ ' + (json.message || '儲存成功！'));
      this.closeEditModal();
      AdminCore.loadDashboard();
    } catch (err) {
      alert('❌ 儲存失敗：' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 儲存變更';
    }
  },

  closeEditModal: function() {
    document.getElementById('edit-product-modal').classList.remove('open');
  },

  // ================= 3. 圖檔一對一對標與 <2MB 排版壓縮 =================

  openMatchModal: async function(product) {
    this.activeProductId = String(product.id);
    this.loadedSourceImage = null;
    this.matchedFolderName = '';

    document.getElementById('match-modal-title').textContent = `對標與排版：[${product.id}] ${product.name}`;
    document.getElementById('match-status-text').textContent = '正在依商品編號尋找對應的雲端原圖資料夾...';
    document.getElementById('btn-upload-bind').disabled = true;
    document.getElementById('raw-img-search').value = '';

    const canvas = document.getElementById('preview-canvas');
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    document.getElementById('match-modal').classList.add('open');

    const listEl = document.getElementById('drive-raw-list');
    listEl.innerHTML = '讀取雲端資料夾 [' + AdminCore.escapeHtml(this.activeProductId) + '] 中...';

    try {
      const data = await AdminCore.apiGet('getRawImages', { productId: this.activeProductId });
      if (data.status !== 'success') {
        if (AdminCore.handleAuthFailure(data.message)) return;
        throw new Error(data.message);
      }
      this.matchedFolderName = data.matchedFolderName || '';
      this.rawDriveImages = data.images || [];
      this.renderRawImageList();

      document.getElementById('match-status-text').textContent = this.matchedFolderName
        ? `✅ 已自動定位到子資料夾《${this.matchedFolderName}》（共 ${this.rawDriveImages.length} 張原圖），請點選左側照片進行排版預覽。`
        : `找不到名為「${this.activeProductId}」的子資料夾，請確認雲端原檔資料庫是否已建立對應編號資料夾。`;
    } catch (err) {
      listEl.innerHTML = '<p style="color:#e74c3c; padding:12px;">讀取失敗：' + AdminCore.escapeHtml(err.message) + '</p>';
    }
  },

  renderRawImageList: function() {
    const listEl = document.getElementById('drive-raw-list');
    const kw = document.getElementById('raw-img-search').value.trim().toLowerCase();
    const esc = AdminCore.escapeHtml;

    const filtered = this.rawDriveImages.filter(img =>
      !kw || String(img.name).toLowerCase().includes(kw) || String(img.folderName || '').toLowerCase().includes(kw)
    );

    if (filtered.length === 0) {
      listEl.innerHTML = `<p style="padding:12px; color:#64748b;">在原檔資料庫中找不到「${esc(this.activeProductId)}」對應子資料夾或符合的圖片。</p>`;
      return;
    }

    listEl.innerHTML = '';
    filtered.forEach(img => {
      const sizeText = img.sizeKb >= 1024 ? (img.sizeKb / 1024).toFixed(1) + ' MB' : img.sizeKb + ' KB';
      const thumbHtml = img.thumbnail
        ? `<img src="${esc(img.thumbnail)}" alt="">`
        : '<div style="width:44px;height:44px;border-radius:4px;background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">🖼️</div>';

      const item = document.createElement('div');
      item.className = 'drive-item' + (img.isMatchedFolder ? ' recommended' : '');
      item.innerHTML = `
        ${thumbHtml}
        <div>
          <div><strong>${esc(img.name)}</strong></div>
          <span style="font-size:11px; color:${img.isMatchedFolder ? '#a16207' : '#64748b'};">
            ${img.isMatchedFolder ? '📁 ' + esc(img.folderName) + ' ｜ ' : ''}${sizeText}
          </span>
        </div>
      `;
      item.addEventListener('click', () => {
        document.querySelectorAll('.drive-item').forEach(x => x.classList.remove('selected'));
        item.classList.add('selected');
        this.loadRawImageToCanvas(img.id, img.name);
      });
      listEl.appendChild(item);
    });
  },

  loadRawImageToCanvas: async function(fileId, fileName) {
    const statusEl = document.getElementById('match-status-text');
    const btn = document.getElementById('btn-upload-bind');
    statusEl.textContent = '⏳ 載入高畫質原圖「' + fileName + '」中...';
    btn.disabled = true;

    try {
      const data = await AdminCore.apiGet('getImageBase64', { fileId });
      if (data.status !== 'success') {
        if (AdminCore.handleAuthFailure(data.message)) return;
        throw new Error(data.message);
      }

      const img = new Image();
      img.onload = () => {
        this.loadedSourceImage = img;
        this.redrawCanvasPreview();
        btn.disabled = false;
      };
      img.src = 'data:' + data.base64;
    } catch (err) {
      statusEl.textContent = '❌ 讀取原圖失敗：' + err.message;
    }
  },

  redrawCanvasPreview: function() {
    const img = this.loadedSourceImage;
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
    if (outW > this.MAX_IMAGE_WIDTH) {
      outH = Math.round(outH * (this.MAX_IMAGE_WIDTH / outW));
      outW = this.MAX_IMAGE_WIDTH;
    }

    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

    const info = this.compressCanvasUnder2MB(canvas);
    document.getElementById('match-status-text').textContent =
      `✅ 排版就緒（${outW}×${outH}px）｜預估壓縮後：${info.sizeKb} KB（品質 ${Math.round(info.quality * 100)}%）｜自動檔名：${this.activeProductId}_cover.jpg`;
  },

  compressCanvasUnder2MB: function(canvas) {
    let quality = 0.88;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    let estBytes = Math.round((dataUrl.length * 3) / 4);

    while (estBytes > this.MAX_BYTES_LIMIT && quality > 0.3) {
      quality = Number((quality - 0.08).toFixed(2));
      dataUrl = canvas.toDataURL('image/jpeg', quality);
      estBytes = Math.round((dataUrl.length * 3) / 4);
    }

    return { dataUrl, quality, sizeKb: Math.round(estBytes / 1024) };
  },

  confirmCompressAndUpload: async function() {
    if (!this.loadedSourceImage || !this.activeProductId) return;

    const btn = document.getElementById('btn-upload-bind');
    const statusEl = document.getElementById('match-status-text');
    btn.disabled = true;
    statusEl.textContent = '🚀 正在降檔轉存、自動歸檔至商品編號資料夾並寫入資料庫...';

    try {
      const compressed = this.compressCanvasUnder2MB(document.getElementById('preview-canvas'));
      const result = await AdminCore.apiPost('uploadAndBindImage', {
        productId: this.activeProductId,
        fileName: this.activeProductId + '_cover.jpg',
        mimeType: 'image/jpeg',
        base64Data: compressed.dataUrl.split(',')[1],
        autoPublish: document.getElementById('chk-auto-publish').checked
      });

      if (result.status !== 'success') {
        if (AdminCore.handleAuthFailure(result.message)) return;
        throw new Error(result.message);
      }

      alert('✅ ' + result.message);
      this.closeMatchModal();
      AdminCore.loadDashboard();
    } catch (err) {
      statusEl.textContent = '❌ 轉存失敗：' + err.message;
      btn.disabled = false;
    }
  },

  closeMatchModal: function() {
    document.getElementById('match-modal').classList.remove('open');
  }
};
