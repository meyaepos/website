/**
 * 模組 3：Excel / CSV 智慧增量建庫（阻擋既有重複編碼 ＋ 自動僅導入新商品）與跨資料庫匯出引擎
 */
window.AdminExcel = {
  IMPORT_CHUNK_SIZE: 500,

  XLSX_CDN_FALLBACKS: [
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
    'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js',
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
  ],

  CORE_SYNONYMS: {
    id: ['id', 'sku', '貨號', '品號', '商品編號', '編號', '產品代碼', '款號'],
    name: ['name', 'title', '品名', '商品名稱', '產品名稱', '名稱'],
    price: ['現在售價', 'price', '售價', '零售價', '門市價', '單價', '價格', '牌價', '定價'],
    '條碼': ['條碼', 'barcode', '國際條碼', 'ean'],
    '庫存數量': ['庫存', '庫存數量', 'stock', 'qty', '數量'],
    '商品狀態': ['商品狀態', '狀態', 'status']
  },

  workbook: null,
  fileName: '',
  rawMatrix: [],
  columnMappings: [],
  importMode: 'MERGE_PRODUCTS',
  scanReport: null,

  init: function() {
    this.updateModeCardCopy();
    this.bindDropzone();
    document.getElementById('excel-sheet-select').addEventListener('change', () => this.onWorksheetChange());
    document.getElementById('mode-card-merge').addEventListener('click', () => this.selectImportMode('MERGE_PRODUCTS'));
    document.getElementById('mode-card-new').addEventListener('click', () => this.selectImportMode('CREATE_NEW_TABLE'));
    document.getElementById('new-table-name-input').addEventListener('click', e => e.stopPropagation());
    document.getElementById('btn-reset-excel').addEventListener('click', () => this.resetPanel());
    document.getElementById('btn-execute-build').addEventListener('click', () => this.executeDynamicBuild());
    document.getElementById('btn-export-csv').addEventListener('click', () => this.exportSelectedSheet('csv'));
    document.getElementById('btn-export-json').addEventListener('click', () => this.exportSelectedSheet('json'));
  },

  updateModeCardCopy: function() {
    const mergeCard = document.getElementById('mode-card-merge');
    if (!mergeCard) return;
    const titleEl = mergeCard.querySelector('strong');
    const descEl = mergeCard.querySelector('span');
    if (titleEl) titleEl.textContent = '模式 A：增量匯入進銷存「商品主檔」（自動略過既有編碼・只導新商品）';
    if (descEl) descEl.textContent = '依商品編號 (id) 極速比對：已存在的商品自動阻擋不覆蓋，尚未建檔的新商品直接一鍵匯入。';
  },

  ensureXlsxLoaded: async function() {
    if (typeof window.XLSX !== 'undefined') return true;

    const loadScript = url => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      const timer = setTimeout(() => {
        s.remove();
        reject(new Error('載入逾時'));
      }, 8000);
      s.onload = () => {
        clearTimeout(timer);
        if (typeof window.XLSX !== 'undefined') resolve(true);
        else reject(new Error('套件未初始化'));
      };
      s.onerror = () => {
        clearTimeout(timer);
        s.remove();
        reject(new Error('連線失敗'));
      };
      document.head.appendChild(s);
    });

    for (const url of this.XLSX_CDN_FALLBACKS) {
      try {
        await loadScript(url);
        if (typeof window.XLSX !== 'undefined') return true;
      } catch (_) {}
    }

    throw new Error('所有 Excel 解析元件線路皆無法連線，請檢查網路環境或稍後重新整理頁面。');
  },

  bindDropzone: function() {
    const dz = document.getElementById('file-dropzone');
    const input = document.getElementById('local-sheet-input');

    dz.addEventListener('click', () => input.click());
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('dragover'); }));

    dz.addEventListener('drop', e => {
      if (e.dataTransfer.files.length > 0) this.loadLocalFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', e => {
      if (e.target.files.length > 0) this.loadLocalFile(e.target.files[0]);
      e.target.value = '';
    });
  },

  loadLocalFile: async function(file) {
    this.fileName = file.name;
    const dzTitle = document.querySelector('#file-dropzone .dropzone-title');
    const originalTitle = dzTitle ? dzTitle.textContent : '';

    try {
      if (typeof window.XLSX === 'undefined') {
        if (dzTitle) dzTitle.textContent = '⏳ 正在自動切換備援線路載入 Excel 解析元件...';
        await this.ensureXlsxLoaded();
      }
    } catch (err) {
      if (dzTitle) dzTitle.textContent = originalTitle;
      alert('讀取 Excel/CSV 失敗：' + err.message);
      return;
    } finally {
      if (dzTitle && originalTitle) dzTitle.textContent = originalTitle;
    }

    const reader = new FileReader();
    reader.onload = e => {
      try {
        this.workbook = window.XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const select = document.getElementById('excel-sheet-select');
        select.innerHTML = '';
        this.workbook.SheetNames.forEach(name => {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          select.appendChild(opt);
        });

        document.getElementById('excel-file-title').textContent = '已載入檔案：' + file.name;
        document.getElementById('excel-analyze-panel').style.display = 'block';
        this.onWorksheetChange();
      } catch (err) {
        alert('讀取 Excel/CSV 失敗：' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  },

  onWorksheetChange: function() {
    const sheetName = document.getElementById('excel-sheet-select').value;
    const ws = this.workbook.Sheets[sheetName];
    const rawMatrix = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    this.rawMatrix = rawMatrix.filter(row => Array.isArray(row) && row.some(cell => String(cell).trim() !== ''));
    if (this.rawMatrix.length < 2) {
      alert('此工作表內容不足（需至少包含 1 列標題與 1 列資料）。');
      return;
    }

    const rawHeaders = this.rawMatrix[0];
    const firstDataRow = this.rawMatrix[1] || [];
    const usedCoreKeys = new Set();

    this.columnMappings = [];
    rawHeaders.forEach((rawH, colIdx) => {
      const cleanRaw = String(rawH || '').trim();
      const sampleVal = firstDataRow[colIdx] !== undefined ? String(firstDataRow[colIdx]).trim() : '';
      if (!cleanRaw && !sampleVal) return;

      const displayRaw = cleanRaw || ('未命名欄位_' + (colIdx + 1));
      let autoTarget = displayRaw;
      let autoCoreName = null;

      const lower = displayRaw.toLowerCase();
      for (const coreKey of Object.keys(this.CORE_SYNONYMS)) {
        if (usedCoreKeys.has(coreKey)) continue;
        const hit = this.CORE_SYNONYMS[coreKey].some(syn => lower === syn.toLowerCase() || lower.includes(syn.toLowerCase()));
        if (hit) {
          autoTarget = coreKey;
          autoCoreName = coreKey;
          usedCoreKeys.add(coreKey);
          break;
        }
      }

      this.columnMappings.push({
        colIdx: colIdx,
        include: true,
        rawName: displayRaw,
        targetName: this.importMode === 'MERGE_PRODUCTS' ? autoTarget : displayRaw,
        autoCoreName: autoCoreName,
        sampleVal: sampleVal
      });
    });

    document.getElementById('excel-row-count').textContent =
      '共偵測到 ' + (this.rawMatrix.length - 1) + ' 筆資料、' + this.columnMappings.length + ' 個欄位';
    document.getElementById('new-table-name-input').value =
      sheetName === 'Sheet1' ? this.fileName.replace(/\.[^.]+$/, '') : sheetName;

    this.renderHeaderMappingTable();
    this.evaluateIncrementalScan();
    this.renderPreviewTable();
  },

  selectImportMode: function(mode) {
    this.importMode = mode;
    document.getElementById('mode-card-merge').classList.toggle('selected', mode === 'MERGE_PRODUCTS');
    document.getElementById('mode-card-new').classList.toggle('selected', mode === 'CREATE_NEW_TABLE');

    this.columnMappings.forEach(m => {
      m.targetName = (mode === 'MERGE_PRODUCTS' && m.autoCoreName) ? m.autoCoreName : m.rawName;
    });
    this.renderHeaderMappingTable();
    this.evaluateIncrementalScan();
    this.renderPreviewTable();
  },

  // ================= 增量編碼極速比對（O(N) 毫秒級分類：新商品 vs 既有阻擋） =================

  analyzeIncrementalRows: function() {
    const dataRows = this.rawMatrix.slice(1);
    const result = {
      isMergeMode: this.importMode === 'MERGE_PRODUCTS',
      totalRows: dataRows.length,
      newRowIndices: [],
      dbDupList: [],
      fileDupList: [],
      emptyIdCount: 0,
      rowStatus: []
    };

    if (this.importMode !== 'MERGE_PRODUCTS' || dataRows.length === 0) {
      dataRows.forEach((_, idx) => {
        result.newRowIndices.push(idx);
        result.rowStatus[idx] = { type: 'NEW', label: '✅ 寫入新表' };
      });
      return result;
    }

    const idMapping = this.columnMappings.find(m => m.include && m.targetName === 'id');
    if (!idMapping) {
      dataRows.forEach((_, idx) => {
        result.rowStatus[idx] = { type: 'EMPTY', label: '⚠️ 未對標 id' };
      });
      return result;
    }

    // 1. 建立現有資料庫編碼雜湊集合（僅掃描編碼，毫秒級完成）
    const existingNormSet = new Set();
    (AdminState.products || []).forEach(p => {
      const norm = String(p.id || '').trim().toUpperCase();
      if (norm) existingNormSet.add(norm);
    });

    // 2. 掃描檔案內每一列：既有 -> 阻擋；檔內重複 -> 阻擋；全新 -> 放入匯入清單
    const seenNewInFile = new Map(); // norm -> firstDataNo

    dataRows.forEach((row, idx) => {
      const rawId = String(row[idMapping.colIdx] !== undefined ? row[idMapping.colIdx] : '').trim();
      const dataNo = idx + 1;

      if (!rawId) {
        result.emptyIdCount++;
        result.rowStatus[idx] = { type: 'EMPTY', label: '略過(無編碼)' };
        return;
      }

      const norm = rawId.toUpperCase();
      if (existingNormSet.has(norm)) {
        result.dbDupList.push({ id: rawId, dataNo: dataNo });
        result.rowStatus[idx] = { type: 'DB_DUP', label: '⛔ 既有阻擋' };
        return;
      }

      if (seenNewInFile.has(norm)) {
        result.fileDupList.push({ id: rawId, dataNo: dataNo, firstDataNo: seenNewInFile.get(norm) });
        result.rowStatus[idx] = { type: 'FILE_DUP', label: '⚠️ 檔內重複阻擋' };
        return;
      }

      seenNewInFile.set(norm, dataNo);
      result.newRowIndices.push(idx);
      result.rowStatus[idx] = { type: 'NEW', label: '✅ 新商品匯入' };
    });

    return result;
  },

  ensureScanBannerEl: function() {
    let banner = document.getElementById('excel-dup-alert-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'excel-dup-alert-banner';
      banner.style.cssText = 'display:none; margin:14px 0; padding:14px 16px; border-radius:8px; font-size:13px; line-height:1.65;';
      const modeGrid = document.querySelector('#excel-analyze-panel .mode-grid');
      if (modeGrid && modeGrid.parentNode) {
        modeGrid.parentNode.insertBefore(banner, modeGrid.nextSibling);
      }
    }
    return banner;
  },

  evaluateIncrementalScan: function() {
    const report = this.analyzeIncrementalRows();
    this.scanReport = report;

    const banner = this.ensureScanBannerEl();
    const buildBtn = document.getElementById('btn-execute-build');
    const esc = AdminCore.escapeHtml;

    if (!report.isMergeMode) {
      banner.style.display = 'none';
      if (buildBtn) {
        buildBtn.disabled = false;
        buildBtn.className = 'btn btn-success';
        buildBtn.textContent = `🚀 建立新資料表並匯入全部 ${report.totalRows} 筆`;
      }
      return report;
    }

    const newCount = report.newRowIndices.length;
    const dbBlockedCount = report.dbDupList.length;
    const fileBlockedCount = report.fileDupList.length;
    const totalBlocked = dbBlockedCount + fileBlockedCount;

    if (newCount === 0 && totalBlocked > 0) {
      // 全部都是既有商品，沒有任何新商品可匯入
      banner.style.background = '#fef2f2';
      banner.style.border = '2px solid #ef4444';
      banner.style.color = '#991b1b';
      const sample = report.dbDupList.slice(0, 12).map(x => `<code>${esc(x.id)}</code>`).join('、');
      banner.innerHTML = `
        <div style="font-weight:700; font-size:14px; margin-bottom:4px;">⛔ 掃描完畢：檔案內全部 ${totalBlocked} 筆皆為已存在或重複編碼，無新商品可匯入</div>
        <div>• 資料庫既有編碼（已阻擋）：${sample}${dbBlockedCount > 12 ? ` 等共 ${dbBlockedCount} 筆` : ''}</div>
        <div style="font-size:12px; margin-top:4px; color:#7f1d1d;">若要修改既有商品資料，請直接於「商品主檔與官網上架 ➔ 編修主檔」進行調整。</div>
      `;
      banner.style.display = 'block';

      if (buildBtn) {
        buildBtn.disabled = true;
        buildBtn.className = 'btn btn-danger';
        buildBtn.textContent = '⛔ 無新商品可匯入（已全數阻擋）';
      }
      return report;
    }

    if (totalBlocked > 0 && newCount > 0) {
      // 混合狀態：自動阻擋既有編碼，放行導入新商品
      banner.style.background = '#fffbeb';
      banner.style.border = '2px solid #f59e0b';
      banner.style.color = '#92400e';

      const parts = [
        `<div style="font-weight:700; font-size:14px; margin-bottom:6px;">⚡ 增量編碼掃描完成：將導入 <span style="color:#15803d;">${newCount} 筆新商品</span>，自動阻擋 <span style="color:#b91c1c;">${totalBlocked} 筆重複編碼</span></div>`
      ];
      if (dbBlockedCount > 0) {
        const sample = report.dbDupList.slice(0, 12).map(x => `<code>${esc(x.id)}</code>`).join('、');
        parts.push(`<div>• <strong>已自動阻擋（資料庫既有 ${dbBlockedCount} 筆，絕不覆蓋）：</strong>${sample}${dbBlockedCount > 12 ? ' 等...' : ''}</div>`);
      }
      if (fileBlockedCount > 0) {
        const sample = report.fileDupList.slice(0, 10).map(x => `<code>${esc(x.id)}</code>(第${x.dataNo}筆)`).join('、');
        parts.push(`<div>• <strong>已自動阻擋（檔案內部重複 ${fileBlockedCount} 筆，僅保留首筆）：</strong>${sample}${fileBlockedCount > 10 ? ' 等...' : ''}</div>`);
      }
      banner.innerHTML = parts.join('');
      banner.style.display = 'block';

      if (buildBtn) {
        buildBtn.disabled = false;
        buildBtn.className = 'btn btn-success';
        buildBtn.textContent = `🚀 僅匯入 ${newCount} 筆新商品（自動略過 ${totalBlocked} 筆重複）`;
      }
      return report;
    }

    // 全部皆為新商品
    banner.style.background = '#f0fdf4';
    banner.style.border = '1px solid #86efac';
    banner.style.color = '#166534';
    banner.innerHTML = `<strong>✅ 編碼掃描通過：</strong>偵測到 <strong>${newCount} 筆全新商品</strong>，無重複編碼衝突，可直接寫入進銷存主檔。`;
    banner.style.display = 'block';

    if (buildBtn) {
      buildBtn.disabled = newCount === 0;
      buildBtn.className = 'btn btn-success';
      buildBtn.textContent = `🚀 確認匯入全部 ${newCount} 筆新商品`;
    }
    return report;
  },

  getColumnStatusTagHtml: function(targetName) {
    if (this.importMode !== 'MERGE_PRODUCTS') {
      return '<span class="pill pill-new">新資料表欄位</span>';
    }
    if (window.CORE_PRODUCT_KEYS.includes(targetName)) {
      return '<span class="pill pill-ok">核心主檔欄位</span>';
    }
    if (AdminState.productHeaders.includes(targetName)) {
      return '<span class="pill pill-off">對齊既有欄位</span>';
    }
    return '<span class="pill pill-new">✨ 將自動新增欄位</span>';
  },

  renderHeaderMappingTable: function() {
    const tbody = document.getElementById('header-mapping-tbody');
    const esc = AdminCore.escapeHtml;
    tbody.innerHTML = '';

    this.columnMappings.forEach((m, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="checkbox" ${m.include ? 'checked' : ''} class="chk-col"></td>
        <td>${esc(m.rawName)}</td>
        <td><input type="text" class="input-ctrl inp-target" style="width:160px;" value="${esc(m.targetName)}"></td>
        <td class="col-status-cell">${this.getColumnStatusTagHtml(m.targetName)}</td>
        <td style="color:#64748b; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(m.sampleVal)}</td>
      `;

      tr.querySelector('.chk-col').addEventListener('change', e => {
        this.columnMappings[idx].include = e.target.checked;
        this.evaluateIncrementalScan();
        this.renderPreviewTable();
      });
      tr.querySelector('.inp-target').addEventListener('input', e => {
        const val = e.target.value.trim();
        this.columnMappings[idx].targetName = val;
        tr.querySelector('.col-status-cell').innerHTML = this.getColumnStatusTagHtml(val);
        this.evaluateIncrementalScan();
        this.renderPreviewTable();
      });

      tbody.appendChild(tr);
    });
  },

  /**
   * 預覽表：增量模式下優先把「即將匯入的新商品」排在最前面檢視，並清楚標記每列判定狀態
   */
  renderPreviewTable: function() {
    const table = document.getElementById('excel-preview-table');
    const esc = AdminCore.escapeHtml;
    const activeCols = this.columnMappings.filter(m => m.include && m.targetName);

    if (activeCols.length === 0) {
      table.innerHTML = '<tr><td class="empty-cell">請至少勾選一個要匯入的欄位</td></tr>';
      return;
    }

    const dataRows = this.rawMatrix.slice(1);
    const report = this.scanReport || this.analyzeIncrementalRows();

    // 優先展示新商品（最多 8 筆）＋ 抽樣展示阻擋項目，避免大檔案裡新商品藏在最後面看不到
    let previewIndices = [];
    if (report.isMergeMode && report.newRowIndices.length > 0) {
      previewIndices = report.newRowIndices.slice(0, 8);
      for (let i = 0; i < dataRows.length && previewIndices.length < 10; i++) {
        if (!previewIndices.includes(i)) previewIndices.push(i);
      }
    } else {
      previewIndices = dataRows.slice(0, 10).map((_, i) => i);
    }

    let html = '<thead><tr><th>匯入判定</th>' + activeCols.map(c => `<th>${esc(c.targetName)}</th>`).join('') + '</tr></thead><tbody>';
    previewIndices.forEach(idx => {
      const row = dataRows[idx];
      const st = report.rowStatus[idx] || { type: 'NEW', label: '✅ 寫入' };
      let rowBg = '';
      let pillClass = 'pill-ok';

      if (st.type === 'DB_DUP') {
        rowBg = ' style="background:#fef2f2; color:#991b1b;"';
        pillClass = 'pill-err';
      } else if (st.type === 'FILE_DUP') {
        rowBg = ' style="background:#fffbeb; color:#92400e;"';
        pillClass = 'pill-wait';
      } else if (st.type === 'EMPTY') {
        rowBg = ' style="background:#f8fafc; color:#64748b;"';
        pillClass = 'pill-off';
      } else {
        rowBg = ' style="background:#f0fdf4;"';
      }

      html += `<tr${rowBg}><td><span class="pill ${pillClass}">${esc(st.label)}</span></td>` +
        activeCols.map(c => `<td>${esc(row[c.colIdx] !== undefined ? row[c.colIdx] : '')}</td>`).join('') +
        '</tr>';
    });
    html += '</tbody>';
    table.innerHTML = html;
  },

  executeDynamicBuild: async function() {
    const activeCols = this.columnMappings.filter(m => m.include && m.targetName);
    if (activeCols.length === 0) return alert('請至少勾選一個有效欄位！');

    const targetHeaders = activeCols.map(c => c.targetName);
    const report = this.evaluateIncrementalScan();

    if (this.importMode === 'MERGE_PRODUCTS') {
      if (!targetHeaders.includes('id') || !targetHeaders.includes('name')) {
        return alert('匯入進銷存「商品主檔」時，必須包含對應到「id」與「name」的欄位！');
      }
      if (report.newRowIndices.length === 0) {
        return alert('⛔ 此檔案沒有任何尚未建檔的新商品（既有編碼皆已自動阻擋），無須執行匯入。');
      }
    }

    const targetSheetName = this.importMode === 'MERGE_PRODUCTS'
      ? '商品主檔'
      : document.getElementById('new-table-name-input').value.trim();

    if (!targetSheetName) return alert('請輸入要建立的新資料表名稱！');

    // 前端已先過濾出「真正要寫入的新商品」，大幅減少網路傳輸與 GAS 運算負擔
    const dataRows = this.rawMatrix.slice(1);
    const targetIndices = this.importMode === 'MERGE_PRODUCTS'
      ? report.newRowIndices
      : dataRows.map((_, i) => i);

    const recordsToSend = targetIndices.map(rowIdx => {
      const rawRow = dataRows[rowIdx];
      const obj = {};
      activeCols.forEach(c => {
        let val = rawRow[c.colIdx] !== undefined ? rawRow[c.colIdx] : '';
        if (c.targetName === 'price') {
          val = Number(String(val).replace(/[^0-9.-]/g, '')) || 0;
        } else {
          val = String(val).trim();
        }
        obj[c.targetName] = val;
      });
      return obj;
    });

    const btn = document.getElementById('btn-execute-build');
    btn.disabled = true;
    btn.textContent = `⏳ 正在寫入 ${recordsToSend.length} 筆新商品至進銷存資料庫...`;

    try {
      let totalInserted = 0;
      let totalSkipped = report.emptyIdCount || 0;
      const backendBlockedDb = [];
      const backendBlockedFile = [];
      const allAddedCols = new Set();

      for (let i = 0; i < recordsToSend.length; i += this.IMPORT_CHUNK_SIZE) {
        const chunk = recordsToSend.slice(i, i + this.IMPORT_CHUNK_SIZE);
        const json = await AdminCore.apiPost('importDynamicDataset', {
          mode: this.importMode,
          dbType: 'INVENTORY',
          sheetName: targetSheetName,
          headers: targetHeaders,
          rows: chunk,
          sourceName: this.fileName
        });
        if (json.status !== 'success') {
          if (AdminCore.handleAuthFailure(json.message)) return;
          throw new Error(json.message);
        }

        totalInserted += json.data.insertedCount || 0;
        totalSkipped += json.data.skippedCount || 0;
        (json.data.blockedDbIds || []).forEach(id => backendBlockedDb.push(id));
        (json.data.blockedFileIds || []).forEach(id => backendBlockedFile.push(id));
        (json.data.addedColumns || []).forEach(col => allAddedCols.add(col));
      }

      const allBlockedDb = [
        ...report.dbDupList.map(x => x.id),
        ...backendBlockedDb
      ];
      const allBlockedFile = [
        ...report.fileDupList.map(x => x.id),
        ...backendBlockedFile
      ];

      const summaryLines = [
        `✅ 進銷存增量匯入完成！（目標分頁：《${targetSheetName}》）`,
        `• 成功導入新商品：${totalInserted} 筆`
      ];
      if (allBlockedDb.length > 0) {
        const sample = allBlockedDb.slice(0, 10).join('、') + (allBlockedDb.length > 10 ? ' 等...' : '');
        summaryLines.push(`• 自動阻擋（既有編碼不覆蓋）：${allBlockedDb.length} 筆（${sample}）`);
      }
      if (allBlockedFile.length > 0) {
        summaryLines.push(`• 自動阻擋（檔內重複列）：${allBlockedFile.length} 筆`);
      }
      if (totalSkipped > 0) {
        summaryLines.push(`• 空白編號略過：${totalSkipped} 筆`);
      }
      if (allAddedCols.size > 0) {
        summaryLines.push(`• 自動擴充新欄位：${Array.from(allAddedCols).join(', ')}`);
      }

      alert(summaryLines.join('\n'));
      this.resetPanel();
      AdminCore.loadDashboard();
    } catch (err) {
      alert('❌ 匯入過程發生錯誤：' + err.message);
    } finally {
      btn.disabled = false;
      this.evaluateIncrementalScan();
    }
  },

  resetPanel: function() {
    this.workbook = null;
    this.rawMatrix = [];
    this.columnMappings = [];
    this.scanReport = null;
    const banner = document.getElementById('excel-dup-alert-banner');
    if (banner) banner.style.display = 'none';
    document.getElementById('excel-analyze-panel').style.display = 'none';
  },

  renderExportOptions: function(exportList) {
    const sel = document.getElementById('export-sheet-select');
    sel.innerHTML = '';
    const list = (Array.isArray(exportList) && exportList.length > 0)
      ? exportList
      : [
          { dbType: 'INVENTORY', sheetName: '商品主檔', label: '[進銷存庫] 商品主檔' },
          { dbType: 'WEBSITE', sheetName: '網站呈現庫', label: '[形象網站庫] 網站呈現庫' }
        ];

    list.forEach(item => {
      const opt = document.createElement('option');
      opt.value = `${item.dbType}::${item.sheetName}`;
      opt.textContent = item.label;
      sel.appendChild(opt);
    });
  },

  exportSelectedSheet: async function(format) {
    const rawVal = document.getElementById('export-sheet-select').value || 'INVENTORY::商品主檔';
    const [dbType, sheetName] = rawVal.split('::');

    try {
      const json = await AdminCore.apiGet('exportData', { dbType, sheetName, format });
      if (json.status !== 'success') {
        if (AdminCore.handleAuthFailure(json.message)) return;
        throw new Error(json.message);
      }

      const d = json.data;
      const content = format === 'json' ? JSON.stringify(d.records, null, 2) : d.csvContent;
      const mime = format === 'json' ? 'application/json;charset=utf-8;' : 'text/csv;charset=utf-8;';
      const blob = new Blob([content], { type: mime });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = d.fileName;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      alert('匯出失敗：' + err.message);
    }
  }
};
