/**
 * 模組 4：網站前台控制與系統異常報錯中心（XSS 安全渲染加固版）
 */
window.AdminSite = {
  init: function() {
    document.getElementById('btn-add-news').addEventListener('click', () => this.addAnnouncement());
    document.getElementById('btn-save-config').addEventListener('click', () => this.saveGlobalConfig());
    document.getElementById('btn-resolve-errors').addEventListener('click', () => this.resolveAllErrors());
  },

  renderAll: function(configObj) {
    this.renderAnnouncements();
    this.renderConfigForm(configObj || {});
    this.renderErrors();
  },

  renderAnnouncements: function() {
    const tbody = document.getElementById('news-tbody');
    tbody.textContent = '';

    if (AdminState.announcements.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">尚無公告</td></tr>';
      return;
    }

    AdminState.announcements.forEach(n => {
      const isUp = n['狀態'] === '上架';
      const tr = document.createElement('tr');

      const tdId = document.createElement('td');
      tdId.textContent = n.id || '';

      const tdContent = document.createElement('td');
      tdContent.textContent = n['內容'] || '';

      const tdStatus = document.createElement('td');
      const pill = document.createElement('span');
      pill.className = 'pill ' + (isUp ? 'pill-ok' : 'pill-off');
      pill.textContent = n['狀態'] || '';
      tdStatus.appendChild(pill);

      const tdAct = document.createElement('td');
      tdAct.style.whiteSpace = 'nowrap';

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'btn btn-outline btn-toggle-news';
      toggleBtn.textContent = isUp ? '下架' : '上架';
      toggleBtn.addEventListener('click', () => this.manageAnnouncement('toggle', n.id));

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-danger btn-del-news';
      delBtn.style.marginLeft = '6px';
      delBtn.textContent = '刪除';
      delBtn.addEventListener('click', () => {
        if (confirm('確定要刪除此則跑馬燈公告嗎？')) this.manageAnnouncement('delete', n.id);
      });

      tdAct.appendChild(toggleBtn);
      tdAct.appendChild(delBtn);

      tr.appendChild(tdId);
      tr.appendChild(tdContent);
      tr.appendChild(tdStatus);
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    });
  },

  addAnnouncement: async function() {
    const input = document.getElementById('new-news-input');
    const content = input.value.trim();
    if (!content) return alert('請先輸入公告內容');
    await this.manageAnnouncement('add', '', content);
    input.value = '';
  },

  manageAnnouncement: async function(operation, id, content = '') {
    try {
      const json = await AdminCore.apiPost('saveAnnouncement', { operation, id, content });
      if (json.status === 'success') AdminCore.loadDashboard();
      else if (!AdminCore.handleAuthFailure(json.message)) alert('操作失敗：' + json.message);
    } catch (err) {
      alert('公告操作異常：' + err.message);
    }
  },

  renderConfigForm: function(cfg) {
    document.getElementById('cfg-free-shipping').value = cfg.free_shipping || '';
    document.getElementById('cfg-cart-enabled').checked = cfg.cart_enabled === true;
  },

  saveGlobalConfig: async function() {
    try {
      const json = await AdminCore.apiPost('saveWebsiteConfig', {
        config: {
          free_shipping: document.getElementById('cfg-free-shipping').value.trim(),
          cart_enabled: document.getElementById('cfg-cart-enabled').checked
        }
      });
      if (json.status === 'success') alert('✅ 形象網站全域設定已儲存！');
      else if (!AdminCore.handleAuthFailure(json.message)) alert('儲存失敗：' + json.message);
    } catch (err) {
      alert('儲存異常：' + err.message);
    }
  },

  /**
   * 改採純 DOM + textContent 渲染異常紀錄，徹底杜絕報錯訊息觸發儲存型 XSS
   */
  renderErrors: function() {
    const tbody = document.getElementById('error-tbody');
    tbody.textContent = '';

    if (AdminState.errors.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">目前沒有任何異常紀錄。</td></tr>';
      return;
    }

    AdminState.errors.forEach(e => {
      const tr = document.createElement('tr');
      const levelClass = e['層級'] === 'ERROR' ? 'pill-err' : 'pill-wait';
      const statusClass = e['狀態'] === '已處理' ? 'pill-ok' : 'pill-err';

      const appendTextTd = val => {
        const td = document.createElement('td');
        td.textContent = val === null || val === undefined ? '' : String(val);
        tr.appendChild(td);
      };
      const appendPillTd = (val, cls) => {
        const td = document.createElement('td');
        const span = document.createElement('span');
        span.className = 'pill ' + cls;
        span.textContent = val || '';
        td.appendChild(span);
        tr.appendChild(td);
      };

      appendTextTd(e['時間']);
      appendTextTd(e['模組']);
      appendPillTd(e['層級'], levelClass);
      appendTextTd(e['關聯編號']);
      appendTextTd(e['異常訊息']);
      appendTextTd(e['建議處理方式']);
      appendPillTd(e['狀態'], statusClass);

      tbody.appendChild(tr);
    });
  },

  resolveAllErrors: async function() {
    try {
      const json = await AdminCore.apiPost('resolveAllErrors');
      if (json.status === 'success') {
        alert('已將 ' + json.data.resolvedCount + ' 筆紀錄標記為已處理。');
        AdminCore.loadDashboard();
      } else {
        AdminCore.handleAuthFailure(json.message);
      }
    } catch (err) {
      alert('更新異常紀錄失敗：' + err.message);
    }
  }
};
