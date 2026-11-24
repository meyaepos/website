/**
 * 模組 2：進銷存商品主檔管理、零拷貝圖庫選圖排序與形象網站上架設定引擎
 */
window.AdminProducts = {
  PAGE_SIZE: 50,

  currentPage: 1,
  rawDriveImages: [],
  selectedQueue: [],      // 已選原圖清單（index 0 固定為主圖，直接存放 Drive File ID）
  matchedFolderName: '',
  activeProductId: '',
  previewingFileId: '',
  lastPreviewInfo: null,  // { fileName, previewUrl, ultraHdUrl }
  lightboxZoomMode: 'fit',

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

    // 主檔編輯與新增彈窗
    document.getElementById('btn-create-product').addEventListener('click', () => this.openEditModal(null));
    document.getElementById('btn-close-edit-x').addEventListener('click', () => this.closeEditModal());
    document.getElementById('btn-cancel-edit').addEventListener('click', () => this.closeEditModal());
    document.getElementById('btn-save-edit').addEventListener('click', () => this.saveProductEdit());

    // 網站圖庫與上架彈窗
    document.getElementById('btn-close-modal-x').addEventListener('click', () => this.closeMatchModal());
    document.getElementById('btn-cancel-modal').addEventListener('click', () => this.closeMatchModal());
    document.getElementById('raw-img-search').addEventListener('input', () => this.renderRawImageList());
    document.getElementById('btn-select-all-raw').addEventListener('click', () => this.selectAllRawImages());
    document.getElementById('btn-clear-all-raw').addEventListener('click', () => this.clearAllRawImages());
    document.getElementById('btn-upload-bind').addEventListener('click', () => this.confirmBindShowcase());

    const previewImg = document.getElementById('preview-cdn-img');
    if (previewImg) {
      previewImg.addEventListener('click', () => this.openHdLightbox());
    }

    this.setupHdLightbox();
  },

  // ================= 0. 2K CDN 高清點擊放大燈箱 =================

  setupHdLightbox: function() {
    const stage = document.querySelector('.canvas-stage');

    if (stage && !document.getElementById('canvas-zoom-hint')) {
      const hint = document.createElement('button');
      hint.type = 'button';
      hint.id = 'canvas-zoom-hint';
      hint.className = 'canvas-zoom-hint';
      hint.textContent = '🔍 點擊放大 2K 細節';
      hint.style.display = 'none';
      hint.addEventListener('click', () => this.openHdLightbox());
      stage.appendChild(hint);
    }

    if (!document.getElementById('hd-zoom-lightbox')) {
      const box = document.createElement('div');
      box.id = 'hd-zoom-lightbox';
      box.className = 'hd-lightbox';
      box.innerHTML = `
        <div class="hd-lightbox-bar">
          <div id="hd-lightbox-meta" class="hd-lightbox-meta"></div>
          <div class="hd-lightbox-controls">
            <button type="button" class="btn btn-outline btn-xs hd-zoom-btn active" data-zoom="fit">適應螢幕</button>
            <button type="button" class="btn btn-outline btn-xs hd-zoom-btn" data-zoom="100">2K 原寸細節</button>
            <button type="button" id="btn-close-hd-lightbox" class="btn btn-danger btn-xs">✕ 關閉</button>
          </div>
        </div>
        <div id="hd-lightbox-stage" class="hd-lightbox-stage">
          <img id="hd-lightbox-img" class="hd-lightbox-img" src="" alt="2K 高清預覽">
        </div>
      `;
      document.body.appendChild(box);

      box.querySelectorAll('.hd-zoom-btn').forEach(btn => {
        btn.addEventListener('click', () => this.applyLightboxZoom(btn.dataset.zoom));
      });
      document.getElementById('btn-close-hd-lightbox').addEventListener('click', () => this.closeHdLightbox());
      document.getElementById('hd-lightbox-stage').addEventListener('click', e => {
        if (e.target.id === 'hd-lightbox-stage') this.closeHdLightbox();
      });
      document.getElementById('hd-lightbox-img').addEventListener('click', e => {
        e.stopPropagation();
        this.applyLightboxZoom(this.lightboxZoomMode === 'fit' ? '100' : 'fit');
      });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape') this.closeHdLightbox();
      });
    }
  },

  openHdLightbox: function() {
    if (!this.lastPreviewInfo || !this.lastPreviewInfo.ultraHdUrl) return;
    const info = this.lastPreviewInfo;
    document.getElementById('hd-lightbox-img').src = info.ultraHdUrl;
    document.getElementById('hd-lightbox-meta').textContent =
      `${info.fileName} ｜ Google CDN 2K 動態高畫質直連 — 點擊圖片可切換原寸細節`;
    this.applyLightboxZoom('fit');
    document.getElementById('hd-zoom-lightbox').classList.add('open');
  },

  applyLightboxZoom: function(mode) {
    this.lightboxZoomMode = mode;
    const imgEl = document.getElementById('hd-lightbox-img');
    const stageEl = document.getElementById('hd-lightbox-stage');

    document.querySelectorAll('.hd-zoom-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.zoom === mode);
    });

    if (mode === 'fit') {
      imgEl.classList.remove('zoomed');
      stageEl.scrollTo(0, 0);
    } else {
      imgEl.classList.add('zoomed');
      requestAnimationFrame(() => {
        stageEl.scrollLeft = Math.max(0, (stageEl.scrollWidth - stageEl.clientWidth) / 2);
        stageEl.scrollTop = Math.max(0, (stageEl.scrollHeight - stageEl.clientHeight) / 2);
      });
    }
  },

  closeHdLightbox: function() {
    const box = document.getElementById('hd-zoom-lightbox');
    if (box) box.classList.remove('open');
  },

  // ================= 1. 商品主檔與官網狀態列表 =================

  renderTable: function(resetPage = false) {
    if (resetPage) this.currentPage = 1;

    const tbody = document.getElementById('product-tbody');
    const kw = document.getElementById('prod-search').value.trim().toLowerCase();
    const filter = document.getElementById('prod-filter').value;
    const esc = AdminCore.escapeHtml;

    const filtered = AdminState.products.filter(p => {
      if (kw) {
        const hitText = Object.keys(p)
          .filter(k => !k.startsWith('_'))
          .some(k => String(p[k] || '').toLowerCase().includes(kw)) ||
          (p._web && (
            String(p._web.title || '').toLowerCase().includes(kw) ||
            String(p._web.category || '').toLowerCase().includes(kw)
          ));
        if (!hitText) return false;
      }
      if (filter === 'READY_MATCH') return p._readyToMatch === true;
      if (filter !== 'ALL') return p['狀態'] === filter;
      return true;
    });

    filtered.sort((a, b) => {
      const rank = item => {
        if (item._readyToMatch) return 0;
        if (item['狀態'] === '上架') return 1;
        if (item['狀態'] === '下架') return 2;
        return 3;
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
      const web = p._web || {};
      const photoCount = Array.isArray(web.galleryIds) ? web.galleryIds.length : 0;
      const webStatus = p['狀態'] || '未上架';

      const statusClass = webStatus === '上架' ? 'pill-ok' : (webStatus === '下架' ? 'pill-wait' : 'pill-off');
      const nextStatus = webStatus === '上架' ? '下架' : '上架';

      const thumbCell = p.image
        ? `<img class="thumb-mini" src="${esc(p.image)}" loading="lazy" alt="">`
        : (p._readyToMatch
            ? `<div><span class="pill pill-ready">📁 有原圖</span></div>`
            : `<span class="pill pill-off">未設圖</span>`);

      const titleHtml = web.title
        ? `<div>${esc(p.name)}</div><div style="font-size:11px; color:#2563eb;">官網：${esc(web.title)}</div>`
        : `<div>${esc(p.name)}</div>`;

      const masterPriceNum = Number(p.price || 0);
      const priceHtml = web.price !== '' && web.price !== undefined
        ? `<div>NT$ ${masterPriceNum.toLocaleString()}</div><div style="font-size:11px; color:#15803d;">官網：NT$ ${Number(web.price).toLocaleString()}</div>`
        : `<div>NT$ ${masterPriceNum.toLocaleString()}</div>`;

      const webTags = [];
      if (photoCount > 0) webTags.push(`<span class="pill pill-new" style="margin:2px;">🖼️ ${photoCount} 張原圖</span>`);
      if (web.category) webTags.push(`<span class="pill pill-off" style="margin:2px;">分類：${esc(web.category)}</span>`);
      if (web.exists) webTags.push(`<span class="pill pill-off" style="margin:2px;">排序 #${web.sortOrder}</span>`);

      const tr = document.createElement('tr');
      if (p._readyToMatch) tr.className = 'row-ready-match';

      tr.innerHTML = `
        <td>${thumbCell}</td>
        <td>
          <strong>${esc(p.id)}</strong>
          ${p._readyToMatch ? `<div style="font-size:11px; color:#15803d;">資料夾：${esc(p._matchedFolder)}</div>` : ''}
        </td>
        <td>${titleHtml}</td>
        <td>${priceHtml}</td>
        <td>${webTags.length > 0 ? webTags.join('') : '<span style="color:#94a3b8; font-size:12px;">尚未設定官網呈現</span>'}</td>
        <td><span class="pill ${statusClass}">${esc(webStatus)}</span></td>
        <td style="white-space:nowrap;">
          <button class="btn ${p._readyToMatch ? 'btn-success' : 'btn-primary'} btn-open-match">圖庫與上架</button>
          <button class="btn btn-info btn-edit-prod">編修主檔</button>
          ${web.exists ? `<button class="btn btn-outline btn-toggle-status">官網${nextStatus}</button>` : ''}
        </td>
      `;

      tr.querySelector('.btn-open-match').addEventListener('click', () => this.openMatchModal(p));
      tr.querySelector('.btn-edit-prod').addEventListener('click', () => this.openEditModal(p));
      const toggleBtn = tr.querySelector('.btn-toggle-status');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => this.toggleWebsiteStatus(p.id, nextStatus));
      }
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

  toggleWebsiteStatus: async function(productId, newStatus) {
    try {
      const json = await AdminCore.apiPost('updateProductStatus', { productId, newStatus });
      if (json.status === 'success') AdminCore.loadDashboard();
      else if (!AdminCore.handleAuthFailure(json.message)) alert('狀態更新失敗：' + json.message);
    } catch (err) {
      alert('狀態更新異常：' + err.message);
    }
  },

  // ================= 2. 進銷存「商品主檔」編輯 / 新增視窗 =================

  openEditModal: function(product) {
    this.editMode = product ? 'EDIT' : 'CREATE';
    this.editingProductId = product ? String(product.id) : '';

    document.getElementById('edit-modal-title').textContent = product
      ? `編修進銷存主檔：[${product.id}] ${product.name}`
      : '＋ 新增商品至進銷存主檔（支援同步上傳原圖並上架官網）';

    const grid = document.getElementById('edit-fields-grid');
    grid.innerHTML = '';

    const allHeaders = Array.from(new Set([...window.CORE_PRODUCT_KEYS, ...AdminState.productHeaders]));

    allHeaders.forEach(colName => {
      const val = product && product[colName] !== undefined ? String(product[colName]) : '';
      const wrap = document.createElement('div');
      wrap.className = 'edit-field-item' + (colName === 'name' ? ' full-span' : '');

      const label = document.createElement('label');
      label.textContent = colName === 'id' ? '商品編號 (id) *' : (colName === 'name' ? '商品名稱 (name) *' : colName);
      wrap.appendChild(label);

      if (colName === '商品狀態') {
        const sel = document.createElement('select');
        sel.className = 'input-ctrl';
        sel.dataset.field = colName;
        ['正常', '停售', '缺貨'].forEach(optVal => {
          const opt = document.createElement('option');
          opt.value = optVal;
          opt.textContent = optVal;
          if ((val || '正常') === optVal) opt.selected = true;
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
          input.title = '商品編號為主檔與圖庫唯一鍵值，不可直接變更';
        }
        if (colName === '更新時間') {
          input.readOnly = true;
          input.placeholder = '儲存時自動更新';
        }
        wrap.appendChild(input);
      }

      grid.appendChild(wrap);
    });

    if (window.AdminMediaUpload) {
      window.AdminMediaUpload.resetForModal(this.editMode, product);
    }

    document.getElementById('edit-product-modal').classList.add('open');
  },

  saveProductEdit: async function() {
    const inputs = document.querySelectorAll('#edit-fields-grid [data-field]');
    const fields = {};
    inputs.forEach(el => {
      if (el.dataset.field !== '更新時間') {
        fields[el.dataset.field] = el.value.trim();
      }
    });

    if (this.editMode === 'CREATE' && (!fields.id || !fields.name)) {
      alert('「商品編號 (id)」與「商品名稱 (name)」為必填欄位！');
      return;
    }

    const btn = document.getElementById('btn-save-edit');
    btn.disabled = true;
    btn.textContent = '⏳ 寫入進銷存主檔中...';

    try {
      const json = this.editMode === 'EDIT'
        ? await AdminCore.apiPost('updateProductRecord', { productId: this.editingProductId, fields })
        : await AdminCore.apiPost('createProductRecord', { fields });

      if (json.status !== 'success') {
        if (AdminCore.handleAuthFailure(json.message)) return;
        throw new Error(json.message);
      }

      if (this.editMode === 'CREATE' && window.AdminMediaUpload && AdminMediaUpload.hasPendingCreatePhotos()) {
        try {
          const mediaRes = await AdminMediaUpload.uploadCreateQueueForProduct(fields.id, msg => {
            btn.textContent = msg;
          });
          if (!mediaRes) return;
          alert(`✅ 新商品 [${fields.id}] 已寫入進銷存主檔，並已完成 ${mediaRes.uploadedCount} 張原圖零拷貝綁定至形象網站！`);
        } catch (uploadErr) {
          alert(`⚠️ 商品 [${fields.id}] 已建入進銷存主檔，但圖片上傳發生中斷：\n${uploadErr.message}`);
        }
      } else {
        alert('✅ ' + (json.message || '儲存成功！'));
      }

      this.closeEditModal();
      AdminCore.loadDashboard();
    } catch (err) {
      alert('❌ 儲存失敗：' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 儲存主檔變更';
    }
  },

  closeEditModal: function() {
    document.getElementById('edit-product-modal').classList.remove('open');
  },

  // ================= 3. 零拷貝圖庫選圖、排序與網站呈現庫寫入 =================

  openMatchModal: async function(product) {
    this.activeProductId = String(product.id);
    this.selectedQueue = [];
    this.previewingFileId = '';
    this.lastPreviewInfo = null;
    this.matchedFolderName = '';

    const web = product._web || {};
    const masterPrice = Number(product.price || 0);

    // 預填該商品既有的形象網站呈現設定，並明確提示主檔實際抓到的售價
    document.getElementById('web-inp-status').value = (web.status === '下架') ? '下架' : '上架';
    document.getElementById('web-inp-sort').value = web.sortOrder !== undefined ? web.sortOrder : 100;
    document.getElementById('web-inp-category').value = web.category || '';

    const priceInp = document.getElementById('web-inp-price');
    priceInp.value = web.price || '';
    priceInp.placeholder = masterPrice > 0
      ? `留空即抓主檔售價（目前主檔：NT$ ${masterPrice.toLocaleString()}）`
      : '留空即抓主檔售價（主檔目前無售價，前台將顯示洽詢）';

    document.getElementById('web-inp-title').value = web.title || '';
    document.getElementById('web-inp-desc').value = web.description || '';

    this._resetPreviewStage('正在讀取雲端原檔資料夾 [' + this.activeProductId + ']...');

    document.getElementById('match-modal-title').textContent = `形象網站圖庫與上架設定：[${product.id}] ${product.name}`;
    document.getElementById('match-status-text').textContent = '正在讀取對應編號的雲端原檔資料夾...';
    document.getElementById('raw-img-search').value = '';
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

      if (Array.isArray(web.galleryIds) && web.galleryIds.length > 0) {
        web.galleryIds.forEach(fid => {
          const hit = this.rawDriveImages.find(img => img.id === fid);
          if (hit) {
            this.selectedQueue.push(hit);
          } else {
            this.selectedQueue.push({
              id: fid,
              name: '已綁定原圖 (' + fid.slice(0, 6) + '...)',
              folderName: this.activeProductId,
              isMatchedFolder: true,
              sizeKb: 0,
              thumbnail: `https://lh3.googleusercontent.com/d/${fid}=w300`,
              previewUrl: `https://lh3.googleusercontent.com/d/${fid}=w1600`,
              ultraHdUrl: `https://lh3.googleusercontent.com/d/${fid}=w2048`
            });
          }
        });
      }

      this.renderRawImageList();
      this.renderSelectedQueue();

      const firstToPreview = this.selectedQueue[0] || this.rawDriveImages[0];
      if (firstToPreview) {
        this.previewImageItem(firstToPreview);
      } else {
        this._resetPreviewStage('尚無原圖，請點上方「📤 上傳新原圖」');
      }

      document.getElementById('match-status-text').textContent = this.matchedFolderName
        ? `✅ 已定位原檔資料夾《${this.matchedFolderName}》（共 ${this.rawDriveImages.length} 張）。勾選並排好主圖與順序後，按右下角即可秒存上架。`
        : `原檔區尚無「${this.activeProductId}」資料夾 — 可直接點「📤 上傳新原圖」自動建立。`;
    } catch (err) {
      listEl.innerHTML = '<p style="color:#e74c3c; padding:12px;">讀取失敗：' + AdminCore.escapeHtml(err.message) + '</p>';
    }
  },

  _resetPreviewStage: function(hintText) {
    const imgEl = document.getElementById('preview-cdn-img');
    const emptyEl = document.getElementById('preview-empty-hint');
    const zoomHint = document.getElementById('canvas-zoom-hint');
    if (imgEl) {
      imgEl.style.display = 'none';
      imgEl.src = '';
    }
    if (emptyEl) {
      emptyEl.style.display = 'inline';
      emptyEl.textContent = hintText || '點選左側照片可即時預覽';
    }
    if (zoomHint) zoomHint.style.display = 'none';
  },

  previewImageItem: function(imgObj) {
    if (!imgObj) return;
    this.previewingFileId = imgObj.id;
    this.renderRawImageList();

    const imgEl = document.getElementById('preview-cdn-img');
    const emptyEl = document.getElementById('preview-empty-hint');
    const zoomHint = document.getElementById('canvas-zoom-hint');

    const previewSrc = imgObj.previewUrl || imgObj.thumbnail || '';
    const ultraSrc = imgObj.ultraHdUrl || previewSrc;

    this.lastPreviewInfo = {
      fileName: imgObj.name,
      previewUrl: previewSrc,
      ultraHdUrl: ultraSrc
    };

    if (emptyEl) emptyEl.style.display = 'none';
    if (imgEl) {
      imgEl.src = previewSrc;
      imgEl.style.display = 'block';
    }
    if (zoomHint) zoomHint.style.display = 'inline-flex';
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
      this.previewImageItem(this.selectedQueue[0]);
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
      this.previewImageItem(img);
    } else {
      this.selectedQueue.splice(idx, 1);
      this.renderRawImageList();
      this.renderSelectedQueue();
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
      listEl.innerHTML = `<p style="padding:16px; color:#64748b; text-align:center;">尚無對應原圖 — 請點上方 <strong>「📤 上傳新原圖」</strong> 直接新增並建立 <strong>${esc(this.activeProductId)}</strong> 資料夾。</p>`;
      return;
    }

    listEl.innerHTML = '';
    filtered.forEach(img => {
      const queueIdx = this.selectedQueue.findIndex(q => q.id === img.id);
      const isChecked = queueIdx !== -1;
      const isPreviewing = this.previewingFileId === img.id;
      const sizeText = img.sizeKb >= 1024 ? (img.sizeKb / 1024).toFixed(1) + ' MB' : (img.sizeKb > 0 ? img.sizeKb + ' KB' : '已綁定');

      const thumbHtml = img.thumbnail
        ? `<img src="${esc(img.thumbnail)}" loading="lazy" alt="">`
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
        <input type="checkbox" class="drive-item-check" ${isChecked ? 'checked' : ''} title="勾選採用此張原圖">
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
      item.addEventListener('click', () => this.previewImageItem(img));
      listEl.appendChild(item);
    });
  },

  renderSelectedQueue: function() {
    const listEl = document.getElementById('selected-queue-list');
    const countEl = document.getElementById('selected-queue-count');
    const saveBtn = document.getElementById('btn-upload-bind');
    const esc = AdminCore.escapeHtml;

    const total = this.selectedQueue.length;
    countEl.textContent = `已選 ${total} 張`;
    saveBtn.disabled = total === 0;
    saveBtn.textContent = total > 0
      ? `✅ 確認寫入形象網站庫（共 ${total} 張・第 1 張為主圖）`
      : '✅ 確認寫入形象網站呈現庫';

    if (total === 0) {
      listEl.innerHTML = '<div class="queue-empty" style="padding:36px 10px;">尚未勾選任何照片（請於左側打勾，第 1 張自動成為網站主圖）</div>';
      return;
    }

    listEl.innerHTML = '';
    this.selectedQueue.forEach((img, idx) => {
      const isCover = idx === 0;
      const thumbHtml = img.thumbnail
        ? `<img src="${esc(img.thumbnail)}" alt="">`
        : '<div style="width:36px;height:36px;border-radius:4px;background:#e2e8f0;display:flex;align-items:center;justify-content:center;">🖼️</div>';

      const row = document.createElement('div');
      row.className = 'queue-item' + (isCover ? ' is-cover' : '');
      row.innerHTML = `
        <span class="pill ${isCover ? 'pill-cover' : 'pill-off'}">${isCover ? '★ 主圖' : '#' + (idx + 1)}</span>
        ${thumbHtml}
        <div class="queue-item-info">
          <div class="queue-item-name">${esc(img.name)}</div>
          <div style="font-size:11px; color:#64748b;">原檔 ID 直連（零複製）</div>
        </div>
        <div class="queue-item-actions">
          ${!isCover ? '<button type="button" class="btn btn-warning btn-xs btn-set-cover">設為主圖</button>' : ''}
          <button type="button" class="btn btn-outline btn-xs btn-move-up" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="btn btn-outline btn-xs btn-move-down" ${idx === total - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="btn btn-danger btn-xs btn-remove-q">✕</button>
        </div>
      `;

      row.addEventListener('click', () => this.previewImageItem(img));
      const coverBtn = row.querySelector('.btn-set-cover');
      if (coverBtn) coverBtn.addEventListener('click', e => { e.stopPropagation(); this.setAsCover(idx); });
      row.querySelector('.btn-move-up').addEventListener('click', e => { e.stopPropagation(); this.moveQueueItem(idx, -1); });
      row.querySelector('.btn-move-down').addEventListener('click', e => { e.stopPropagation(); this.moveQueueItem(idx, 1); });
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
    this.previewImageItem(picked);
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

  confirmBindShowcase: async function() {
    if (this.selectedQueue.length === 0 || !this.activeProductId) return;

    const btn = document.getElementById('btn-upload-bind');
    const statusEl = document.getElementById('match-status-text');
    btn.disabled = true;
    statusEl.textContent = '⚡ 正在將原圖 File ID 與網站呈現設定寫入形象網站庫...';

    try {
      const galleryIds = this.selectedQueue.map(img => img.id);
      const res = await AdminCore.apiPost('bindWebsiteShowcase', {
        productId: this.activeProductId,
        status: document.getElementById('web-inp-status').value,
        sortOrder: document.getElementById('web-inp-sort').value,
        category: document.getElementById('web-inp-category').value.trim(),
        price: document.getElementById('web-inp-price').value.trim(),
        title: document.getElementById('web-inp-title').value.trim(),
        description: document.getElementById('web-inp-desc').value.trim(),
        coverId: galleryIds[0],
        galleryIds: galleryIds
      });

      if (res.status !== 'success') {
        if (AdminCore.handleAuthFailure(res.message)) return;
        throw new Error(res.message);
      }

      alert('✅ ' + res.message);
      this.closeMatchModal();
      AdminCore.loadDashboard();
    } catch (err) {
      statusEl.textContent = '❌ 寫入失敗：' + err.message;
      btn.disabled = false;
    }
  },

  closeMatchModal: function() {
    this.closeHdLightbox();
    document.getElementById('match-modal').classList.remove('open');
  }
};
