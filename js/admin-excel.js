/**
 * 模組 3：Excel / CSV 智慧辨識建庫與標準匯出引擎
 */
const AdminExcel = {
  IMPORT_CHUNK_SIZE: 500,

  CORE_SYNONYMS: {
    id: ['id', 'sku', '貨號', '品號', '商品編號', '編號', '產品代碼', '款號'],
    name: ['name', 'title', '品名', '商品名稱', '產品名稱', '名稱'],
    price: ['price', '售價', '定價', '單價', '價格', '門市價', '牌價', '零售價'],
    image: ['image', 'img', '圖片', '圖片網址', '照片', '主圖'],
    '狀態': ['狀態', 'status', '上下架', '上架狀態']
  },

  workbook: null,
  fileName: '',
  rawMatrix: [],
  columnMappings: [],
  importMode: 'MERGE_PRODUCTS',

  init: function() {
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

  loadLocalFile: function(file) {
    this.fileName = file.name;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        this.workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
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
    const rawMatrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

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
    this.renderPreviewTable();
  },

  getColumnStatusTagHtml: function(targetName) {
    if (this.importMode !== 'MERGE_PRODUCTS') {
      return '<span class="pill pill-new">新資料表欄位</span>';
    }
    if (CORE_PRODUCT_KEYS.includes(targetName)) {
      return '<span class="pill pill-ok">核心商品欄位</span>';
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
        this.renderPreviewTable();
      });
      tr.querySelector('.inp-target').addEventListener('input', e => {
        const val = e.target.value.trim();
        this.columnMappings[idx].targetName = val;
        tr.querySelector('.col-status-cell').innerHTML = this.getColumnStatusTagHtml(val);
        this.renderPreviewTable();
      });

      tbody.appendChild(tr);
    });
  },

  renderPreviewTable: function() {
    const table = document.getElementById('excel-preview-table');
    const esc = AdminCore.escapeHtml;
    const activeCols = this.columnMappings.filter(m => m.include && m.targetName);

    if (activeCols.length === 0) {
      table.innerHTML = '<tr><td class="empty-cell">請至少勾選一個要匯入的欄位</td></tr>';
      return;
    }

    let html = '<thead><tr>' + activeCols.map(c => `<th>${esc(c.targetName)}</th>`).join('') + '</tr></thead><tbody>';
    this.rawMatrix.slice(1, 11).forEach(row => {
      html += '<tr>' + activeCols.map(c => `<td>${esc(row[c.colIdx] !== undefined ? row[c.colIdx] : '')}</td>`).join('') + '</tr>';
    });
    html += '</tbody>';
    table.innerHTML = html;
  },

  executeDynamicBuild: async function() {
    const activeCols = this.columnMappings.filter(m => m.include && m.targetName);
    if (activeCols.length === 0) return alert('請至少勾選一個有效欄位！');

    const targetHeaders = activeCols.map(c => c.targetName);
    if (this.importMode === 'MERGE_PRODUCTS') {
      if (!targetHeaders.includes('id') || !targetHeaders.includes('name')) {
        return alert('整合至「商品列表」時，必須包含對應到「id」與「name」的欄位！\n請在上方表格將商品編號與商品名稱欄位改名為 id 與 name。');
      }
    }

    const targetSheetName = this.importMode === 'MERGE_PRODUCTS'
      ? '商品列表'
      : document.getElementById('new-table-name-input').value.trim();

    if (!targetSheetName) return alert('請輸入要建立的新資料表名稱！');

    const records = this.rawMatrix.slice(1).map(rawRow => {
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
    btn.textContent = '⏳ 正在自動建置與寫入資料庫...';

    try {
      let totalInserted = 0;
      let totalUpdated = 0;
      let totalSkipped = 0;
      const allAddedCols = new Set();

      for (let i = 0; i < records.length; i += this.IMPORT_CHUNK_SIZE) {
        const chunk = records.slice(i, i + this.IMPORT_CHUNK_SIZE);
        const json = await AdminCore.apiPost('importDynamicDataset', {
          mode: this.importMode,
          sheetName: targetSheetName,
          headers: targetHeaders,
          rows: chunk,
          sourceName: this.fileName
        });
        if (json.status !== 'success') {
          if (AdminCore.handleAuthFailure(json.message)) return;
          throw new Error(json.message);
        }

        totalInserted += json.data.insertedCount;
        totalUpdated += json.data.updatedCount;
        totalSkipped += json.data.skippedCount;
        (json.data.addedColumns || []).forEach(col => allAddedCols.add(col));
      }

      const addedMsg = allAddedCols.size > 0 ? '\n自動新增欄位：' + Array.from(allAddedCols).join(', ') : '';
      alert(`✅ 資料庫建置完成！\n目標分頁：《${targetSheetName}》\n新增 ${totalInserted} 筆｜更新 ${totalUpdated} 筆｜略過 ${totalSkipped} 筆${addedMsg}`);
      this.resetPanel();
      AdminCore.loadDashboard();
    } catch (err) {
      alert('❌ 建庫過程發生錯誤：' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '🚀 確認欄位結構，開始自動建置資料庫';
    }
  },

  resetPanel: function() {
    this.workbook = null;
    this.rawMatrix = [];
    this.columnMappings = [];
    document.getElementById('excel-analyze-panel').style.display = 'none';
  },

  renderExportOptions: function(sheetNames) {
    const sel = document.getElementById('export-sheet-select');
    sel.innerHTML = '';
    sheetNames.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = '資料表：' + name;
      sel.appendChild(opt);
    });
  },

  exportSelectedSheet: async function(format) {
    const sheetName = document.getElementById('export-sheet-select').value || '商品列表';
    try {
      const json = await AdminCore.apiGet('exportData', { sheetName, format });
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
