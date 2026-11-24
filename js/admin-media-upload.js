/**
 * 模組 6：本機原圖直傳引擎（零拷貝版：只上傳至原檔區 RAW_FOLDER_ID，並直接綁定 File ID 至形象網站庫）
 */
window.AdminMediaUpload = {
  MAX_RAW_FILE_MB: 15,
  createQueue: [],
  editingProductRef: null,

  init: function() {
    this.bindCreateUploadEvents();
    this.bindMatchModalUploadEvents();
  },

  bindCreateUploadEvents: function() {
    const dz = document.getElementById('create-photo-dropzone');
    const inp = document.getElementById('inp-create-photos');
    if (dz && inp) {
      dz.addEventListener('click', () => inp.click());
      ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => {
        e.preventDefault();
        dz.classList.add('dragover');
      }));
      ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => {
        e.preventDefault();
        dz.classList.remove('dragover');
      }));
      dz.addEventListener('drop', e => {
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          this.addFilesToCreateQueue(e.dataTransfer.files);
        }
      });
      inp.addEventListener('change', e => {
        if (e.target.files && e.target.files.length > 0) {
          this.addFilesToCreateQueue(e.target.files);
        }
        e.target.value = '';
      });
    }

    const jumpBtn = document.getElementById('btn-jump-to-match');
    if (jumpBtn) {
      jumpBtn.addEventListener('click', () => {
        if (!this.editingProductRef) return;
        AdminProducts.closeEditModal();
        AdminProducts.openMatchModal(this.editingProductRef);
      });
    }
  },

  bindMatchModalUploadEvents: function() {
    const btn = document.getElementById('btn-upload-raw-modal');
    const inp = document.getElementById('inp-upload-raw-modal');
    if (!btn || !inp) return;

    btn.addEventListener('click', () => inp.click());
    inp.addEventListener('change', e => {
      if (e.target.files && e.target.files.length > 0) {
        this.uploadNewPhotosIntoMatchModal(e.target.files);
      }
      e.target.value = '';
    });
  },

  resetForModal: function(mode, product) {
    this.createQueue = [];
    this.editingProductRef = product || null;

    const createPanel = document.getElementById('create-photo-panel');
    const editShortcut = document.getElementById('edit-photo-shortcut');
    const statusEl = document.getElementById('create-photo-status');
    if (statusEl) statusEl.textContent = '';

    if (mode === 'CREATE') {
      if (createPanel) createPanel.style.display = 'block';
      if (editShortcut) editShortcut.style.display = 'none';
      this.renderCreateQueue();
    } else {
      if (createPanel) createPanel.style.display = 'none';
      if (editShortcut) editShortcut.style.display = 'flex';
      this.renderEditShortcutInfo(product);
    }
  },

  renderEditShortcutInfo: function(product) {
    const infoEl = document.getElementById('edit-photo-summary');
    if (!infoEl || !product) return;
    const web = product._web || {};
    const count = Array.isArray(web.galleryIds) ? web.galleryIds.length : 0;
    infoEl.innerHTML = count > 0
      ? `形象網站狀態：<strong>${AdminCore.escapeHtml(web.status || '下架')}</strong>（已綁定 <strong>${count}</strong> 張原圖，點右側可隨時增刪或調順序）`
      : '此商品尚未轉存至形象網站呈現庫（點右側按鈕可挑原圖並設定官網上架）';
  },

  hasPendingCreatePhotos: function() {
    return this.createQueue.length > 0;
  },

  readFileAsDataUrl: function(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('檔案讀取失敗：' + file.name));
      reader.readAsDataURL(file);
    });
  },

  addFilesToCreateQueue: async function(fileList) {
    const statusEl = document.getElementById('create-photo-status');
    const files = Array.from(fileList).filter(f => (f.type || '').startsWith('image/'));
    if (files.length === 0) return;

    for (const file of files) {
      const sizeMb = file.size / (1024 * 1024);
      if (sizeMb > this.MAX_RAW_FILE_MB) {
        alert(`「${file.name}」檔案大小為 ${sizeMb.toFixed(1)} MB，超過單檔 ${this.MAX_RAW_FILE_MB} MB 上限已略過。`);
        continue;
      }

      try {
        const dataUrl = await this.readFileAsDataUrl(file);
        const commaIdx = dataUrl.indexOf(',');
        this.createQueue.push({
          localId: 'loc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          name: file.name,
          mimeType: file.type || 'image/jpeg',
          rawBase64: dataUrl.slice(commaIdx + 1),
          dataUrl: dataUrl,
          sizeKb: Math.round(file.size / 1024)
        });
      } catch (err) {
        if (statusEl) statusEl.textContent = '❌ ' + err.message;
      }
    }

    this.renderCreateQueue();
  },

  renderCreateQueue: function() {
    const listEl = document.getElementById('create-photo-queue');
    const countEl = document.getElementById('create-photo-count');
    const esc = AdminCore.escapeHtml;
    if (!listEl) return;

    const total = this.createQueue.length;
    if (countEl) countEl.textContent = `待上傳 ${total} 張`;

    if (total === 0) {
      listEl.innerHTML = '<div class="queue-empty" style="padding:20px 10px;">尚未挑選圖片（可留空先建檔，或直接拖曳／點上方選圖，第 1 張自動成為主圖）</div>';
      return;
    }

    listEl.innerHTML = '';
    this.createQueue.forEach((item, idx) => {
      const isCover = idx === 0;
      const sizeText = item.sizeKb >= 1024 ? (item.sizeKb / 1024).toFixed(1) + ' MB' : item.sizeKb + ' KB';

      const row = document.createElement('div');
      row.className = 'queue-item' + (isCover ? ' is-cover' : '');
      row.innerHTML = `
        <span class="pill ${isCover ? 'pill-cover' : 'pill-off'}">${isCover ? '★ 主圖' : '#' + (idx + 1)}</span>
        <img src="${esc(item.dataUrl)}" alt="">
        <div class="queue-item-info">
          <div class="queue-item-name">${esc(item.name)}</div>
          <div style="font-size:11px; color:#64748b;">原檔 ${sizeText} ➔ 只存原檔區並直連官網</div>
        </div>
        <div class="queue-item-actions">
          ${!isCover ? '<button type="button" class="btn btn-warning btn-xs btn-c-cover">設為主圖</button>' : ''}
          <button type="button" class="btn btn-outline btn-xs btn-c-up" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="btn btn-outline btn-xs btn-c-down" ${idx === total - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="btn btn-danger btn-xs btn-c-del">✕</button>
        </div>
      `;

      const coverBtn = row.querySelector('.btn-c-cover');
      if (coverBtn) {
        coverBtn.addEventListener('click', () => {
          const [picked] = this.createQueue.splice(idx, 1);
          this.createQueue.unshift(picked);
          this.renderCreateQueue();
        });
      }
      row.querySelector('.btn-c-up').addEventListener('click', () => {
        if (idx === 0) return;
        const tmp = this.createQueue[idx];
        this.createQueue[idx] = this.createQueue[idx - 1];
        this.createQueue[idx - 1] = tmp;
        this.renderCreateQueue();
      });
      row.querySelector('.btn-c-down').addEventListener('click', () => {
        if (idx >= total - 1) return;
        const tmp = this.createQueue[idx];
        this.createQueue[idx] = this.createQueue[idx + 1];
        this.createQueue[idx + 1] = tmp;
        this.renderCreateQueue();
      });
      row.querySelector('.btn-c-del').addEventListener('click', () => {
        this.createQueue.splice(idx, 1);
        this.renderCreateQueue();
      });

      listEl.appendChild(row);
    });
  },

  /**
   * 新增商品建檔成功後執行：逐張存入原檔區 -> 直接將 File ID 寫入形象網站呈現庫（零第二資料夾複製）
   */
  uploadCreateQueueForProduct: async function(productId, onProgress) {
    if (this.createQueue.length === 0) return { uploadedCount: 0 };

    const statusEl = document.getElementById('create-photo-status');
    const autoPublish = document.getElementById('create-chk-publish').checked;
    const uploadedIds = [];
    const total = this.createQueue.length;

    const notify = msg => {
      if (statusEl) statusEl.textContent = msg;
      if (typeof onProgress === 'function') onProgress(msg);
    };

    for (let i = 0; i < total; i++) {
      const item = this.createQueue[i];
      notify(`⏳ [${i + 1}/${total}] 上傳原檔至原檔區：${item.name}...`);

      const rawRes = await AdminCore.apiPost('uploadRawProductImage', {
        productId: productId,
        fileName: item.name,
        mimeType: item.mimeType,
        base64Data: item.rawBase64
      });

      if (rawRes.status !== 'success') {
        if (AdminCore.handleAuthFailure(rawRes.message)) return null;
        throw new Error(`第 ${i + 1} 張原檔上傳失敗：` + rawRes.message);
      }

      uploadedIds.push(rawRes.data.id);
    }

    notify('⚡ 正在將原圖 File ID 寫入形象網站呈現庫...');
    const bindRes = await AdminCore.apiPost('bindWebsiteShowcase', {
      productId: productId,
      status: autoPublish ? '上架' : '下架',
      sortOrder: 100,
      coverId: uploadedIds[0],
      galleryIds: uploadedIds
    });

    if (bindRes.status !== 'success') {
      if (AdminCore.handleAuthFailure(bindRes.message)) return null;
      throw new Error(bindRes.message);
    }

    this.createQueue = [];
    return { uploadedCount: uploadedIds.length };
  },

  /**
   * 既有商品隨時補傳新原圖：只上傳至原檔區並加入右側排序佇列
   */
  uploadNewPhotosIntoMatchModal: async function(fileList) {
    const productId = AdminProducts.activeProductId;
    if (!productId) return;

    const files = Array.from(fileList).filter(f => (f.type || '').startsWith('image/'));
    if (files.length === 0) return;

    const btn = document.getElementById('btn-upload-raw-modal');
    const statusEl = document.getElementById('match-status-text');
    btn.disabled = true;
    let lastAdded = null;

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const sizeMb = file.size / (1024 * 1024);
        if (sizeMb > this.MAX_RAW_FILE_MB) {
          alert(`「${file.name}」超過 ${this.MAX_RAW_FILE_MB} MB 上限已略過。`);
          continue;
        }

        statusEl.textContent = `⏳ 正在將新原圖 (${i + 1}/${files.length}) 存入原檔區 [${productId}]：${file.name}...`;
        const dataUrl = await this.readFileAsDataUrl(file);
        const commaIdx = dataUrl.indexOf(',');
        const rawBase64 = dataUrl.slice(commaIdx + 1);
        const mimeType = file.type || 'image/jpeg';

        const res = await AdminCore.apiPost('uploadRawProductImage', {
          productId: productId,
          fileName: file.name,
          mimeType: mimeType,
          base64Data: rawBase64
        });

        if (res.status !== 'success') {
          if (AdminCore.handleAuthFailure(res.message)) return;
          throw new Error(res.message);
        }

        const newImgObj = {
          ...res.data,
          thumbnail: res.data.thumbnail || dataUrl,
          previewUrl: res.data.previewUrl || dataUrl,
          ultraHdUrl: res.data.ultraHdUrl || dataUrl
        };

        AdminProducts.rawDriveImages.push(newImgObj);
        AdminProducts.selectedQueue.push(newImgObj);
        lastAdded = newImgObj;
      }

      AdminProducts.matchedFolderName = AdminProducts.matchedFolderName || productId;
      AdminProducts.renderRawImageList();
      AdminProducts.renderSelectedQueue();

      if (lastAdded) {
        AdminProducts.previewImageItem(lastAdded);
        statusEl.textContent = `✅ 已將新照片存入原檔區並加入排序清單！排好順序與主圖後，按右下角「確認寫入形象網站呈現庫」即可完成。`;
      }
    } catch (err) {
      statusEl.textContent = '❌ 上傳新原檔失敗：' + err.message;
      alert('上傳新原檔失敗：' + err.message);
    } finally {
      btn.disabled = false;
    }
  }
};
