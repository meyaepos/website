/**
 * 模組 2：商品管理、有原圖置頂專區、全欄位編修與多圖排序對標引擎
 * 畫質策略：2K (寬度上限 2048px) ＋ 起始 95% 高品質 ＋ 單張上限 1MB
 */
window.AdminProducts = {
  MAX_IMAGE_WIDTH: 2048,
  MAX_BYTES_LIMIT: 1 * 1024 * 1024, // 單張上限 1MB
  INIT_QUALITY: 0.95,
  PAGE_SIZE: 50,

  currentPage: 1,
  rawDriveImages: [],
  selectedQueue: [],      // 已勾選且排序好的照片清單（index 0 固定為主圖）
  base64Cache: {},        // 暫存已下載的原圖 Base64，避免切換預覽時重複向 GAS 抓取
  matchedFolderName: '',
  activeProductId: '',
  previewingFileId: '',
  loadedSourceImage: null,

  editMode: 'EDIT',
  editingProductId: '',

  init: function() {
    document.getElementById('prod-search').addEventListener('input', () => this.renderTable(true));
    document.getElementById('prod-filter').addEventListener('change', () => this.renderTable(true));

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

    // 多圖對標彈窗
    document.getElementById('btn-close-modal-x').addEventListener('click', () => this.closeMatchModal());
    document.getElementById('btn-cancel-modal').addEventListener('click', () => this.closeMatchModal());
    document.getElementById('raw-img-search').addEventListener('input', () => this.renderRawImageList());
    document.getElementById('btn-select-all-raw').addEventListener('click', () => this.selectAllRawImages());
    document.getElementById('btn-clear-all-raw').addEventListener('click', () => this.clearAllRawImages());
    document.getElementById('crop-ratio-select').addEventListener('change', () => this.redrawCanvasPreview());
    document.getElementById('btn-upload-bind').addEventListener('click', () => this.confirmBatchCompressAndUpload());
  },

  // ================= 1. 商品列表（自動置頂「有原圖待對標」＋ 高速分頁） =================

  renderTable: function(resetPage = false) {
    if (resetPage) this.currentPage = 1;

    const tbody = document.getElementById('product-tbody');
    const kw = document.getElementById('prod-search').value.trim().toLowerCase();
    const filter = document.getElementById('prod-filter').value;
    const skipSummarySet = new Set([...window.CORE_PRODUCT_KEYS, 'images']);
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
      const galleryUrls = String(p.images || '').split(',').map(s => s.trim()).filter(Boolean);
      const photoCountBadge = galleryUrls.length > 1
        ? `<span class="pill pill-new" style="margin:2px;">🖼️ 共 ${galleryUrls.length} 張圖</span>`
        : '';

      const extraSummary = photoCountBadge + Object.keys(p)
        .filter(k => !k.startsWith('_') && !skipSummarySet.has(k) && p[k] !== '' && p[k] !== undefined)
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

    const allHeaders = Array.from(new Set([...window.CORE_PRODUCT_KEYS, ...AdminState.productHeaders]));

    allHeaders.forEach(colName => {
      const val = product && product[colName] !== undefined ? String(product[colName]) : '';
      const wrap = document.createElement('div');
      wrap.className = 'edit-field-item' + (colName === 'image' || colName === 'images' || colName === 'name' ? ' full-span' : '');

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

  // ================= 3. 多圖挑選、排序、主圖設定與 2K (<=1MB) 轉存 =================

  openMatchModal: async function(product) {
    this.activeProductId = String(product.id);
    this.selectedQueue = [];
    this.base64Cache = {};
    this.previewingFileId = '';
    this.loadedSourceImage = null;
    this.matchedFolderName = '';

    document.getElementById('match-modal-title').textContent = `多圖挑選與排版：[${product.id}] ${product.name}`;
    document.getElementById('match-status-text').textContent = '正在讀取對應編號的雲端原圖資料夾...';
    document.getElementById('raw-img-search').value = '';

    const canvas = document.getElementById('preview-canvas');
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    this.renderSelectedQueue();
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
        ? `✅ 已定位資料夾《${this.matchedFolderName}》（共 ${this.rawDriveImages.length} 張原圖）。請勾選要採用的照片，並於下方排定順序與主圖。`
        : `找不到名為「${this.activeProductId}」的子資料夾，請確認雲端原檔資料庫是否已建立對應編號資料夾。`;
    } catch (err) {
      listEl.innerHTML = '<p style="color:#e74c3c; padding:12px;">讀取失敗：' + AdminCore.escapeHtml(err.message) + '</p>';
    }
  },

  selectAllRawImages: function() {
    const matched = this.rawDriveImages.filter(img => img.isMatchedFolder);
    const pool = matched.length > 0 ? matched : this.rawDriveImages;
    pool.forEach(img => {
      if (!this.selectedQueue.some(q => q.id === img.id)) {
        this.selectedQueue.push(img);
      }
    });
    this.renderRawImageList();
    this.renderSelectedQueue();
    if (this.selectedQueue.length > 0 && !this.previewingFileId) {
      this.loadRawImageToCanvas(this.selectedQueue[0].id, this.selectedQueue[0].name);
    }
  },

  clearAllRawImages: function() {
    this.selectedQueue = [];
    this.renderRawImageList();
    this.renderSelectedQueue();
  },

  toggleImageSelection: function(img) {
    const idx = this.selectedQueue.findIndex(q => q.id === img.id);
    if (idx === -1) {
      this.selectedQueue.push(img);
      this.loadRawImageToCanvas(img.id, img.name);
    } else {
      this.selectedQueue.splice(idx, 1);
    }
    this.renderRawImageList();
    this.renderSelectedQueue();
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
      const queueIdx = this.selectedQueue.findIndex(q => q.id === img.id);
      const isChecked = queueIdx !== -1;
      const isPreviewing = this.previewingFileId === img.id;
      const sizeText = img.sizeKb >= 1024 ? (img.sizeKb / 1024).toFixed(1) + ' MB' : img.sizeKb + ' KB';

      const thumbHtml = img.thumbnail
        ? `<img src="${esc(img.thumbnail)}" alt="">`
        : '<div style="width:44px;height:44px;border-radius:4px;background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">🖼️</div>';

      const orderTag = isChecked
        ? (queueIdx === 0 ? '<span class="pill pill-cover" style="margin-left:6px;">★ 主圖</span>' : `<span class="pill pill-new" style="margin-left:6px;">#${queueIdx + 1}</span>`)
        : '';

      const item = document.createElement('div');
      item.className = 'drive-item' +
        (img.isMatchedFolder ? ' recommended' : '') +
        (isChecked ? ' checked-item' : '') +
        (isPreviewing ? ' previewing' : '');

      item.innerHTML = `
        <input type="checkbox" class="drive-item-check" ${isChecked ? 'checked' : ''} title="勾選採用此張照片">
        ${thumbHtml}
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; flex-wrap:wrap;">
            <strong>${esc(img.name)}</strong>${orderTag}
          </div>
          <span style="font-size:11px; color:${img.isMatchedFolder ? '#a16207' : '#64748b'};">
            ${img.isMatchedFolder ? '📁 ' + esc(img.folderName) + ' ｜ ' : ''}${sizeText}
          </span>
        </div>
      `;

      const checkbox = item.querySelector('.drive-item-check');
      checkbox.addEventListener('click', e => {
        e.stopPropagation();
        this.toggleImageSelection(img);
      });

      item.addEventListener('click', () => {
        this.loadRawImageToCanvas(img.id, img.name);
      });

      listEl.appendChild(item);
    });
  },

  renderSelectedQueue: function() {
    const listEl = document.getElementById('selected-queue-list');
    const countEl = document.getElementById('selected-queue-count');
    const uploadBtn = document.getElementById('btn-upload-bind');
    const esc = AdminCore.escapeHtml;

    const total = this.selectedQueue.length;
    countEl.textContent = `已選 ${total} 張`;
    uploadBtn.disabled = total === 0;
    uploadBtn.textContent = total > 0
      ? `✅ 確認轉存全部 ${total} 張（第 1 張為主圖）`
      : '✅ 確認轉存所選照片並對標';

    if (total === 0) {
      listEl.innerHTML = '<div class="queue-empty">尚未勾選任何照片（請於左側打勾，第 1 張自動成為商品主圖）</div>';
      return;
    }

    listEl.innerHTML = '';
    this.selectedQueue.forEach((img, idx) => {
      const isCover = idx === 0;
      const thumbHtml = img.thumbnail
        ? `<img src="${esc(img.thumbnail)}" alt="">`
        : '<div style="width:36px;height:36px;border-radius:4px;background:#e2e8f0;display:flex;align-items:center;justify-content:center;">🖼️</div>';

      const targetFileName = isCover
        ? `${this.activeProductId}_01_cover.jpg`
        : `${this.activeProductId}_${String(idx + 1).padStart(2, '0')}.jpg`;

      const row = document.createElement('div');
      row.className = 'queue-item' + (isCover ? ' is-cover' : '');
      row.innerHTML = `
        <span class="pill ${isCover ? 'pill-cover' : 'pill-off'}">${isCover ? '★ 主圖' : '#' + (idx + 1)}</span>
        ${thumbHtml}
        <div class="queue-item-info">
          <div class="queue-item-name">${esc(img.name)}</div>
          <div style="font-size:11px; color:#64748b;">轉存檔名：${esc(targetFileName)}</div>
        </div>
        <div class="queue-item-actions">
          ${!isCover ? '<button type="button" class="btn btn-warning btn-xs btn-set-cover" title="設為主圖並移到第1張">設為主圖</button>' : ''}
          <button type="button" class="btn btn-outline btn-xs btn-move-up" ${idx === 0 ? 'disabled' : ''} title="往前移">↑</button>
          <button type="button" class="btn btn-outline btn-xs btn-move-down" ${idx === total - 1 ? 'disabled' : ''} title="往後移">↓</button>
          <button type="button" class="btn btn-danger btn-xs btn-remove-q" title="取消採用">✕</button>
        </div>
      `;

      row.addEventListener('click', () => this.loadRawImageToCanvas(img.id, img.name));

      const coverBtn = row.querySelector('.btn-set-cover');
      if (coverBtn) {
        coverBtn.addEventListener('click', e => {
          e.stopPropagation();
          this.setAsCover(idx);
        });
      }
      row.querySelector('.btn-move-up').addEventListener('click', e => {
        e.stopPropagation();
        this.moveQueueItem(idx, -1);
      });
      row.querySelector('.btn-move-down').addEventListener('click', e => {
        e.stopPropagation();
        this.moveQueueItem(idx, 1);
      });
      row.querySelector('.btn-remove-q').addEventListener('click', e => {
        e.stopPropagation();
        this.selectedQueue.splice(idx, 1);
        this.renderRawImageList();
        this.renderSelectedQueue();
      });

      listEl.appendChild(row);
    });
  },

  setAsCover: function(idx) {
    if (idx <= 0 || idx >= this.selectedQueue.length) return;
    const [picked] = this.selectedQueue.splice(idx, 1);
    this.selectedQueue.unshift(picked);
    this.renderRawImageList();
    this.renderSelectedQueue();
    this.loadRawImageToCanvas(picked.id, picked.name);
  },

  moveQueueItem: function(idx, delta) {
    const target = idx + delta;
    if (target < 0 || target >= this.selectedQueue.length) return;
    const temp = this.selectedQueue[idx];
    this.selectedQueue[idx] = this.selectedQueue[target];
    this.selectedQueue[target] = temp;
    this.renderRawImageList();
    this.renderSelectedQueue();
  },

  fetchBase64Cached: async function(fileId) {
    if (this.base64Cache[fileId]) return this.base64Cache[fileId];
    const data = await AdminCore.apiGet('getImageBase64', { fileId });
    if (data.status !== 'success') {
      if (AdminCore.handleAuthFailure(data.message)) return null;
      throw new Error(data.message);
    }
    this.base64Cache[fileId] = data.base64;
    return data.base64;
  },

  loadImageElementFromBase64: function(base64Str) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('圖片解碼失敗'));
      img.src = 'data:' + base64Str;
    });
  },

  loadRawImageToCanvas: async function(fileId, fileName) {
    this.previewingFileId = fileId;
    this.renderRawImageList();

    const statusEl = document.getElementById('match-status-text');
    statusEl.textContent = '⏳ 載入原圖「' + fileName + '」進行 2K 高清預覽...';

    try {
      const base64 = await this.fetchBase64Cached(fileId);
      if (!base64) return;
      this.loadedSourceImage = await this.loadImageElementFromBase64(base64);
      this.redrawCanvasPreview();
    } catch (err) {
      statusEl.textContent = '❌ 讀取原圖失敗：' + err.message;
    }
  },

  renderImageToCanvas: function(canvas, imgElement, ratioMode) {
    const srcW = imgElement.naturalWidth;
    const srcH = imgElement.naturalHeight;

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
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(imgElement, sx, sy, sw, sh, 0, 0, outW, outH);
    return { outW, outH };
  },

  redrawCanvasPreview: function() {
    if (!this.loadedSourceImage) return;
    const canvas = document.getElementById('preview-canvas');
    const ratioMode = document.getElementById('crop-ratio-select').value;
    const { outW, outH } = this.renderImageToCanvas(canvas, this.loadedSourceImage, ratioMode);
    const info = this.compressCanvasUnder1MB(canvas);

    document.getElementById('match-status-text').textContent =
      `✅ 2K 預覽就緒（${outW}×${outH}px）｜預估壓縮後：${info.sizeKb} KB（品質 ${Math.round(info.quality * 100)}%，上限 1MB）`;
  },

  compressCanvasUnder1MB: function(canvas) {
    let quality = this.INIT_QUALITY;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    let estBytes = Math.round((dataUrl.length * 3) / 4);

    while (estBytes > this.MAX_BYTES_LIMIT && quality > 0.55) {
      quality = Number((quality - 0.04).toFixed(2));
      dataUrl = canvas.toDataURL('image/jpeg', quality);
      estBytes = Math.round((dataUrl.length * 3) / 4);
    }

    return { dataUrl, quality, sizeKb: Math.round(estBytes / 1024) };
  },

  /**
   * 依序逐張處理已選照片：2K 排版壓縮 (<=1MB) -> 逐張存入 Drive -> 寫回主圖與多圖排序欄位
   */
  confirmBatchCompressAndUpload: async function() {
    if (this.selectedQueue.length === 0 || !this.activeProductId) return;

    const btn = document.getElementById('btn-upload-bind');
    const statusEl = document.getElementById('match-status-text');
    const ratioMode = document.getElementById('crop-ratio-select').value;
    const autoPublish = document.getElementById('chk-auto-publish').checked;
    const workCanvas = document.getElementById('preview-canvas');

    btn.disabled = true;
    const uploadedUrls = [];

    try {
      for (let i = 0; i < this.selectedQueue.length; i++) {
        const item = this.selectedQueue[i];
        const isCover = i === 0;
        const targetFileName = isCover
          ? `${this.activeProductId}_01_cover.jpg`
          : `${this.activeProductId}_${String(i + 1).padStart(2, '0')}.jpg`;

        statusEl.textContent = `⏳ 正在處理並轉存第 ${i + 1} / ${this.selectedQueue.length} 張（${isCover ? '主圖：' : ''}${item.name}）...`;

        const base64 = await this.fetchBase64Cached(item.id);
        if (!base64) return;

        const imgEl = await this.loadImageElementFromBase64(base64);
        this.renderImageToCanvas(workCanvas, imgEl, ratioMode);
        const compressed = this.compressCanvasUnder1MB(workCanvas);

        const upRes = await AdminCore.apiPost('uploadSingleProductImage', {
          productId: this.activeProductId,
          fileName: targetFileName,
          mimeType: 'image/jpeg',
          base64Data: compressed.dataUrl.split(',')[1],
          clearFolder: isCover // 上傳第 1 張主圖時清理該商品舊的優化檔
        });

        if (upRes.status !== 'success') {
          if (AdminCore.handleAuthFailure(upRes.message)) return;
          throw new Error(`第 ${i + 1} 張（${item.name}）上傳失敗：` + upRes.message);
        }

        uploadedUrls.push(upRes.data.imageUrl);
      }

      statusEl.textContent = '💾 全部圖片轉存完成，正在寫入主圖與排序清單至資料庫...';

      const finalRes = await AdminCore.apiPost('finalizeProductImages', {
        productId: this.activeProductId,
        coverUrl: uploadedUrls[0],
        imageUrls: uploadedUrls,
        autoPublish: autoPublish
      });

      if (finalRes.status !== 'success') {
        if (AdminCore.handleAuthFailure(finalRes.message)) return;
        throw new Error(finalRes.message);
      }

      alert('✅ ' + finalRes.message);
      this.closeMatchModal();
      AdminCore.loadDashboard();
    } catch (err) {
      statusEl.textContent = '❌ 轉存中斷：' + err.message;
      btn.disabled = false;
    }
  },

  closeMatchModal: function() {
    document.getElementById('match-modal').classList.remove('open');
  }
};
