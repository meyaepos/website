/**
 * 模組 7：批發知識文章與常見問題 Q&A 後台管理引擎
 * 支援：圖文／純文字文章新增編修、封面圖直傳原檔區（零拷貝）、排序調整、即時上下架與刪除
 * 安全防護：全面使用純 DOM textContent 與 AdminCore.sanitizeImageUrl 防止 XSS
 */
window.AdminContent = {
  MAX_COVER_MB: 10,

  init: function() {
    // 文章管理事件
    const btnNewArt = document.getElementById('btn-create-article');
    if (btnNewArt) btnNewArt.addEventListener('click', () => this.openArticleModal(null));

    const artSearch = document.getElementById('article-search');
    if (artSearch) artSearch.addEventListener('input', () => this.renderArticlesTable());

    document.getElementById('btn-close-article-x').addEventListener('click', () => this.closeArticleModal());
    document.getElementById('btn-cancel-article').addEventListener('click', () => this.closeArticleModal());
    document.getElementById('btn-save-article').addEventListener('click', () => this.saveArticle());

    const btnUploadCover = document.getElementById('btn-upload-article-cover');
    const inpUploadCover = document.getElementById('inp-upload-article-cover');
    if (btnUploadCover && inpUploadCover) {
      btnUploadCover.addEventListener('click', () => inpUploadCover.click());
      inpUploadCover.addEventListener('change', e => {
        if (e.target.files && e.target.files[0]) this.uploadCoverImage(e.target.files[0]);
        e.target.value = '';
      });
    }

    const btnClearCover = document.getElementById('btn-clear-article-cover');
    if (btnClearCover) {
      btnClearCover.addEventListener('click', () => {
        document.getElementById('art-inp-image').value = '';
        this.updateCoverPreview('');
      });
    }

    document.getElementById('art-inp-image').addEventListener('input', e => {
      const val = e.target.value.trim();
      this.updateCoverPreview(/^https:\/\//i.test(val) ? val : '');
    });

    // Q&A 管理事件
    const btnNewFaq = document.getElementById('btn-create-faq');
    if (btnNewFaq) btnNewFaq.addEventListener('click', () => this.openFaqModal(null));

    const faqSearch = document.getElementById('faq-search');
    if (faqSearch) faqSearch.addEventListener('input', () => this.renderFaqsTable());

    document.getElementById('btn-close-faq-x').addEventListener('click', () => this.closeFaqModal());
    document.getElementById('btn-cancel-faq').addEventListener('click', () => this.closeFaqModal());
    document.getElementById('btn-save-faq').addEventListener('click', () => this.saveFaq());
  },

  renderAll: function() {
    this.renderArticlesTable();
    this.renderFaqsTable();
  },

  // ================= 1. 批發知識文章列表與彈窗 =================

  renderArticlesTable: function() {
    const tbody = document.getElementById('articles-admin-tbody');
    if (!tbody) return;

    const kw = (document.getElementById('article-search').value || '').trim().toLowerCase();
    const list = (AdminState.articles || []).filter(a => {
      if (!kw) return true;
      return String(a.title || '').toLowerCase().includes(kw) ||
        String(a.category || '').toLowerCase().includes(kw) ||
        String(a.summary || '').toLowerCase().includes(kw);
    });

    tbody.textContent = '';
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">尚無批發知識文章（點擊右上角「＋ 新增文章」開始建立）</td></tr>';
      return;
    }

    list.forEach(art => {
      const tr = document.createElement('tr');
      const isUp = art.status === '上架';
      const safeThumb = AdminCore.sanitizeImageUrl(art.imageUrl ? art.imageUrl + '=w200' : '');

      // 類型／縮圖欄
      const tdType = document.createElement('td');
      if (safeThumb) {
        const img = document.createElement('img');
        img.className = 'thumb-mini';
        img.src = safeThumb;
        img.alt = '';
        img.style.width = '54px';
        img.style.height = '38px';
        tdType.appendChild(img);
      } else {
        const pill = document.createElement('span');
        pill.className = 'pill pill-off';
        pill.textContent = '純文字';
        tdType.appendChild(pill);
      }

      // 分類與排序
      const tdSort = document.createElement('td');
      const catPill = document.createElement('span');
      catPill.className = 'pill pill-new';
      catPill.textContent = art.category || '批發知識';
      const sortDiv = document.createElement('div');
      sortDiv.style.cssText = 'font-size:11px; color:#64748b; margin-top:4px;';
      sortDiv.textContent = '排序 #' + (art.sortOrder !== undefined ? art.sortOrder : 100);
      tdSort.appendChild(catPill);
      tdSort.appendChild(sortDiv);

      // 標題與摘要
      const tdTitle = document.createElement('td');
      const strong = document.createElement('strong');
      strong.textContent = art.title || '';
      const sumDiv = document.createElement('div');
      sumDiv.style.cssText = 'font-size:12px; color:#64748b; margin-top:3px; max-width:340px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
      sumDiv.textContent = art.summary || '';
      tdTitle.appendChild(strong);
      tdTitle.appendChild(sumDiv);

      // 狀態
      const tdStatus = document.createElement('td');
      const stPill = document.createElement('span');
      stPill.className = 'pill ' + (isUp ? 'pill-ok' : 'pill-off');
      stPill.textContent = art.status || '下架';
      tdStatus.appendChild(stPill);

      // 更新時間
      const tdTime = document.createElement('td');
      tdTime.style.cssText = 'font-size:12px; color:#64748b; white-space:nowrap;';
      tdTime.textContent = art.updatedAt || '-';

      // 操作
      const tdAct = document.createElement('td');
      tdAct.style.whiteSpace = 'nowrap';

      const btnEdit = document.createElement('button');
      btnEdit.className = 'btn btn-info btn-xs';
      btnEdit.textContent = '編輯';
      btnEdit.addEventListener('click', () => this.openArticleModal(art));

      const btnToggle = document.createElement('button');
      btnToggle.className = 'btn btn-outline btn-xs';
      btnToggle.style.marginLeft = '6px';
      btnToggle.textContent = isUp ? '設為下架' : '設為上架';
      btnToggle.addEventListener('click', () => this.toggleArticle(art.id));

      const btnDel = document.createElement('button');
      btnDel.className = 'btn btn-danger btn-xs';
      btnDel.style.marginLeft = '6px';
      btnDel.textContent = '刪除';
      btnDel.addEventListener('click', () => this.deleteArticle(art));

      tdAct.appendChild(btnEdit);
      tdAct.appendChild(btnToggle);
      tdAct.appendChild(btnDel);

      tr.appendChild(tdType);
      tr.appendChild(tdSort);
      tr.appendChild(tdTitle);
      tr.appendChild(tdStatus);
      tr.appendChild(tdTime);
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    });
  },

  openArticleModal: function(art) {
    document.getElementById('article-modal-head-title').textContent = art
      ? `編輯批發知識文章 [${art.id}]`
      : '＋ 新增批發知識文章（可選圖文或純文字）';

    document.getElementById('art-inp-id').value = art ? art.id : '';
    document.getElementById('art-inp-title').value = art ? (art.title || '') : '';
    document.getElementById('art-inp-category').value = art ? (art.category || '') : '批發選品';
    document.getElementById('art-inp-sort').value = art && art.sortOrder !== undefined ? art.sortOrder : 100;
    document.getElementById('art-inp-status').value = art ? (art.status || '上架') : '上架';
    document.getElementById('art-inp-image').value = art ? (art.imageRef || '') : '';
    document.getElementById('art-inp-summary').value = art ? (art.summary || '') : '';
    document.getElementById('art-inp-content').value = art ? (art.content || '') : '';
    document.getElementById('art-upload-status').textContent = '';

    this.updateCoverPreview(art && art.imageUrl ? art.imageUrl + '=w600' : '');
    document.getElementById('article-edit-modal').classList.add('open');
  },

  updateCoverPreview: function(previewUrl) {
    const box = document.getElementById('art-cover-preview-box');
    const img = document.getElementById('art-cover-preview-img');
    const safeUrl = AdminCore.sanitizeImageUrl(previewUrl);
    if (safeUrl) {
      img.src = safeUrl;
      box.style.display = 'flex';
    } else {
      img.src = '';
      box.style.display = 'none';
    }
  },

  uploadCoverImage: async function(file) {
    if (!(file.type || '').startsWith('image/')) {
      return alert('請選擇圖片檔案（JPG / PNG / WebP）');
    }
    if (file.size > this.MAX_COVER_MB * 1024 * 1024) {
      return alert(`圖片大小不可超過 ${this.MAX_COVER_MB} MB`);
    }

    const statusEl = document.getElementById('art-upload-status');
    const btn = document.getElementById('btn-upload-article-cover');
    btn.disabled = true;
    statusEl.textContent = '⏳ 正在將封面圖上傳至原檔區 (_ARTICLES)...';

    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('讀取圖片失敗'));
        reader.readAsDataURL(file);
      });

      const base64Data = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const json = await AdminCore.apiPost('uploadArticleImage', {
        fileName: file.name,
        mimeType: file.type || 'image/jpeg',
        base64Data: base64Data
      });

      if (json.status !== 'success') {
        if (AdminCore.handleAuthFailure(json.message)) return;
        throw new Error(json.message);
      }

      document.getElementById('art-inp-image').value = json.data.fileId;
      this.updateCoverPreview(json.data.previewUrl || dataUrl);
      statusEl.textContent = '✅ 封面圖已上傳並綁定成功（零拷貝直連）';
    } catch (err) {
      statusEl.textContent = '❌ 上傳失敗：' + err.message;
      alert('封面圖上傳失敗：' + err.message);
    } finally {
      btn.disabled = false;
    }
  },

  saveArticle: async function() {
    const payload = {
      id: document.getElementById('art-inp-id').value.trim(),
      title: document.getElementById('art-inp-title').value.trim(),
      category: document.getElementById('art-inp-category').value.trim(),
      sortOrder: document.getElementById('art-inp-sort').value,
      status: document.getElementById('art-inp-status').value,
      imageRef: document.getElementById('art-inp-image').value.trim(),
      summary: document.getElementById('art-inp-summary').value.trim(),
      content: document.getElementById('art-inp-content').value.trim()
    };

    if (!payload.title || !payload.content) {
      return alert('請填寫文章「標題」與「內文」');
    }

    const btn = document.getElementById('btn-save-article');
    btn.disabled = true;
    btn.textContent = '⏳ 儲存中...';

    try {
      const json = await AdminCore.apiPost('saveArticle', payload);
      if (json.status !== 'success') {
        if (AdminCore.handleAuthFailure(json.message)) return;
        throw new Error(json.message);
      }
      alert('✅ ' + (json.message || '文章已儲存！'));
      this.closeArticleModal();
      AdminCore.loadDashboard();
    } catch (err) {
      alert('❌ 儲存文章失敗：' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 儲存文章';
    }
  },

  toggleArticle: async function(id) {
    try {
      const json = await AdminCore.apiPost('toggleArticleStatus', { id });
      if (json.status === 'success') AdminCore.loadDashboard();
      else if (!AdminCore.handleAuthFailure(json.message)) alert('切換狀態失敗：' + json.message);
    } catch (err) {
      alert('操作失敗：' + err.message);
    }
  },

  deleteArticle: async function(art) {
    if (!confirm(`確定要永久刪除文章「${art.title}」嗎？`)) return;
    try {
      const json = await AdminCore.apiPost('deleteArticle', { id: art.id });
      if (json.status === 'success') AdminCore.loadDashboard();
      else if (!AdminCore.handleAuthFailure(json.message)) alert('刪除失敗：' + json.message);
    } catch (err) {
      alert('刪除失敗：' + err.message);
    }
  },

  closeArticleModal: function() {
    document.getElementById('article-edit-modal').classList.remove('open');
  },

  // ================= 2. 常見問題 Q&A 列表與彈窗 =================

  renderFaqsTable: function() {
    const tbody = document.getElementById('faq-admin-tbody');
    if (!tbody) return;

    const kw = (document.getElementById('faq-search').value || '').trim().toLowerCase();
    const list = (AdminState.faqs || []).filter(f => {
      if (!kw) return true;
      return String(f.question || '').toLowerCase().includes(kw) ||
        String(f.answer || '').toLowerCase().includes(kw) ||
        String(f.category || '').toLowerCase().includes(kw);
    });

    tbody.textContent = '';
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">尚無 Q&A 項目（點擊右上角「＋ 新增 Q&A」開始建立）</td></tr>';
      return;
    }

    list.forEach(faq => {
      const tr = document.createElement('tr');
      const isUp = faq.status === '上架';

      const tdSort = document.createElement('td');
      const catPill = document.createElement('span');
      catPill.className = 'pill pill-new';
      catPill.textContent = faq.category || '常見問題';
      const sortDiv = document.createElement('div');
      sortDiv.style.cssText = 'font-size:11px; color:#64748b; margin-top:4px;';
      sortDiv.textContent = '排序 #' + (faq.sortOrder !== undefined ? faq.sortOrder : 100);
      tdSort.appendChild(catPill);
      tdSort.appendChild(sortDiv);

      const tdQa = document.createElement('td');
      const qStrong = document.createElement('strong');
      qStrong.textContent = 'Q：' + (faq.question || '');
      const aDiv = document.createElement('div');
      aDiv.style.cssText = 'font-size:12px; color:#64748b; margin-top:4px; max-width:440px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
      aDiv.textContent = 'A：' + (faq.answer || '');
      tdQa.appendChild(qStrong);
      tdQa.appendChild(aDiv);

      const tdStatus = document.createElement('td');
      const stPill = document.createElement('span');
      stPill.className = 'pill ' + (isUp ? 'pill-ok' : 'pill-off');
      stPill.textContent = faq.status || '下架';
      tdStatus.appendChild(stPill);

      const tdTime = document.createElement('td');
      tdTime.style.cssText = 'font-size:12px; color:#64748b; white-space:nowrap;';
      tdTime.textContent = faq.updatedAt || '-';

      const tdAct = document.createElement('td');
      tdAct.style.whiteSpace = 'nowrap';

      const btnEdit = document.createElement('button');
      btnEdit.className = 'btn btn-info btn-xs';
      btnEdit.textContent = '編輯';
      btnEdit.addEventListener('click', () => this.openFaqModal(faq));

      const btnToggle = document.createElement('button');
      btnToggle.className = 'btn btn-outline btn-xs';
      btnToggle.style.marginLeft = '6px';
      btnToggle.textContent = isUp ? '設為下架' : '設為上架';
      btnToggle.addEventListener('click', () => this.toggleFaq(faq.id));

      const btnDel = document.createElement('button');
      btnDel.className = 'btn btn-danger btn-xs';
      btnDel.style.marginLeft = '6px';
      btnDel.textContent = '刪除';
      btnDel.addEventListener('click', () => this.deleteFaq(faq));

      tdAct.appendChild(btnEdit);
      tdAct.appendChild(btnToggle);
      tdAct.appendChild(btnDel);

      tr.appendChild(tdSort);
      tr.appendChild(tdQa);
      tr.appendChild(tdStatus);
      tr.appendChild(tdTime);
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    });
  },

  openFaqModal: function(faq) {
    document.getElementById('faq-modal-head-title').textContent = faq
      ? `編輯常見問題 [${faq.id}]`
      : '＋ 新增常見問題 Q&A';

    document.getElementById('faq-inp-id').value = faq ? faq.id : '';
    document.getElementById('faq-inp-category').value = faq ? (faq.category || '') : '批發合作';
    document.getElementById('faq-inp-sort').value = faq && faq.sortOrder !== undefined ? faq.sortOrder : 100;
    document.getElementById('faq-inp-status').value = faq ? (faq.status || '上架') : '上架';
    document.getElementById('faq-inp-question').value = faq ? (faq.question || '') : '';
    document.getElementById('faq-inp-answer').value = faq ? (faq.answer || '') : '';

    document.getElementById('faq-edit-modal').classList.add('open');
  },

  saveFaq: async function() {
    const payload = {
      id: document.getElementById('faq-inp-id').value.trim(),
      category: document.getElementById('faq-inp-category').value.trim(),
      sortOrder: document.getElementById('faq-inp-sort').value,
      status: document.getElementById('faq-inp-status').value,
      question: document.getElementById('faq-inp-question').value.trim(),
      answer: document.getElementById('faq-inp-answer').value.trim()
    };

    if (!payload.question || !payload.answer) {
      return alert('請填寫「問題」與「回答」內容');
    }

    const btn = document.getElementById('btn-save-faq');
    btn.disabled = true;
    btn.textContent = '⏳ 儲存中...';

    try {
      const json = await AdminCore.apiPost('saveFaq', payload);
      if (json.status !== 'success') {
        if (AdminCore.handleAuthFailure(json.message)) return;
        throw new Error(json.message);
      }
      alert('✅ ' + (json.message || 'Q&A 已儲存！'));
      this.closeFaqModal();
      AdminCore.loadDashboard();
    } catch (err) {
      alert('❌ 儲存 Q&A 失敗：' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 儲存 Q&A';
    }
  },

  toggleFaq: async function(id) {
    try {
      const json = await AdminCore.apiPost('toggleFaqStatus', { id });
      if (json.status === 'success') AdminCore.loadDashboard();
      else if (!AdminCore.handleAuthFailure(json.message)) alert('切換狀態失敗：' + json.message);
    } catch (err) {
      alert('操作失敗：' + err.message);
    }
  },

  deleteFaq: async function(faq) {
    if (!confirm(`確定要刪除 Q&A「${faq.question}」嗎？`)) return;
    try {
      const json = await AdminCore.apiPost('deleteFaq', { id: faq.id });
      if (json.status === 'success') AdminCore.loadDashboard();
      else if (!AdminCore.handleAuthFailure(json.message)) alert('刪除失敗：' + json.message);
    } catch (err) {
      alert('刪除失敗：' + err.message);
    }
  },

  closeFaqModal: function() {
    document.getElementById('faq-edit-modal').classList.remove('open');
  }
};
