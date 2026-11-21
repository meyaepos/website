/**
 * 模組 2：商品管理與圖檔對標引擎
 * 負責：商品搜尋篩選、上下架切換、規則缺圖掃描、Drive 商品編號子資料夾對標與 Canvas 排版降檔 (<2MB)
 */
const AdminProducts = {
  MAX_IMAGE_WIDTH: 1600,
  MAX_BYTES_LIMIT: 2 * 1024 * 1024,

  rawDriveImages: [],
  matchedFolderName: '',
  activeProductId: '',
  loadedSourceImage: null,

  init: function() {
    document.getElementById('prod-search').addEventListener('input', () => this.renderTable());
    document.getElementById('prod-filter').addEventListener('change', () => this.renderTable());
    document.getElementById('btn-suggest-check').addEventListener('click', () => this.runAutoSuggestCheck());

    document.getElementById('btn-close-modal-x').addEventListener('click', () => this.closeModal());
    document.getElementById('btn-cancel-modal').addEventListener('click', () => this.closeModal());
    document.getElementById('raw-img-search').addEventListener('input', () => this.renderRawImageList());
    document.getElementById('crop-ratio-select').addEventListener('change', () => this.redrawCanvasPreview());
    document.getElementById('btn-upload-bind').addEventListener('click', () => this.confirmCompressAndUpload());
  },

  renderTable: function() {
    const tbody = document.getElementById('product-tbody');
    const kw = document.getElementById('prod-search').value.trim().toLowerCase();
    const filter = document.getElementById('prod-filter').value;
    const coreSet = new Set(CORE_PRODUCT_KEYS);
    const esc = AdminCore.escapeHtml;

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
        .map(k => `<span class="pill pill-off" style="margin:2px;">${esc(k)}: ${esc(p[k])}</span>`)
        .join('');

      const statusClass = p['狀態'] === '上架' ? 'pill-ok' : (p['狀態'] === '待對標' ? 'pill-wait' : 'pill-off');
      const nextStatus = p['狀態'] === '上架' ? '下架' : '上架';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${p.image ? `<img class="thumb-mini" src="${esc(p.image)}" alt="">` : '<span class="pill pill-err">缺圖</span>'}</td>
        <td><strong>${esc(p.id)}</strong></td>
        <td>${esc(p.name)}</td>
        <td>NT$ ${Number(p.price || 0).toLocaleString()}</td>
        <td>${extraSummary || '<span style="color:#94a3b8; font-size:12px;">-</span>'}</td>
        <td><span class="pill ${statusClass}">${esc(p['狀態'] || '未設定')}</span></td>
        <td style="white-space:nowrap;">
          <button class="btn btn-primary btn-open-match">對標排版</button>
          <button class="btn btn-outline btn-toggle-status">設為${nextStatus}</button>
        </td>
      `;

      tr.querySelector('.btn-open-match').addEventListener('click', () => this.openMatchModal(p));
      tr.querySelector('.btn-toggle-status').addEventListener('click', () => this.toggleProductStatus(p.id, nextStatus));
      tbody.appendChild(tr);
    });
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

  runAutoSuggestCheck: async function() {
    const banner = document.getElementById('suggest-banner');
    banner.style.display = 'block';
    banner.textContent = '正在比對缺圖商品與原檔資料庫子資料夾...';

    try {
      const json = await AdminCore.apiGet('suggestImageMatches');
      if (json.status !== 'success') {
        if (AdminCore.handleAuthFailure(json.message)) return;
        throw new Error(json.message);
      }

      const d = json.data;
      const matchedPreview = (d.suggestions || []).slice(0, 8).map(x => x.productId).join(', ');
      banner.innerHTML =
        `<strong>規則檢查完成：</strong>缺圖商品共 <strong>${d.totalPendingProducts}</strong> 筆；` +
        `已在原檔資料庫找到同編號資料夾或圖片 <strong>${d.matchedCount}</strong> 筆` +
        (matchedPreview ? `（已就緒編號：${AdminCore.escapeHtml(matchedPreview)}）` : '') +
        `，尚無照片資料夾 <strong>${d.unmatchedCount}</strong> 筆。`;
    } catch (err) {
      banner.textContent = '檢查失敗：' + err.message;
    }
  },

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
      this.closeModal();
      AdminCore.loadDashboard();
    } catch (err) {
      statusEl.textContent = '❌ 轉存失敗：' + err.message;
      btn.disabled = false;
    }
  },

  closeModal: function() {
    document.getElementById('match-modal').classList.remove('open');
  }
};
