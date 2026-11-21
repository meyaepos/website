/**
 * 模組 4：網站前台控制與系統異常報錯中心
 */
const AdminSite = {
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
    const esc = AdminCore.escapeHtml;

    if (AdminState.announcements.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">尚無公告</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    AdminState.announcements.forEach(n => {
      const isUp = n['狀態'] === '上架';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${esc(n.id)}</td>
        <td>${esc(n['內容'])}</td>
        <td><span class="pill ${isUp ? 'pill-ok' : 'pill-off'}">${esc(n['狀態'])}</span></td>
        <td style="white-space:nowrap;">
          <button class="btn btn-outline btn-toggle-news">${isUp ? '下架' : '上架'}</button>
          <button class="btn btn-danger btn-del-news">刪除</button>
        </td>
      `;
      tr.querySelector('.btn-toggle-news').addEventListener('click', () => this.manageAnnouncement('toggle', n.id));
      tr.querySelector('.btn-del-news').addEventListener('click', () => {
        if (confirm('確定要刪除此則跑馬燈公告嗎？')) this.manageAnnouncement('delete', n.id);
      });
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

  renderErrors: function() {
    const tbody = document.getElementById('error-tbody');
    const esc = AdminCore.escapeHtml;

    if (AdminState.errors.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">目前沒有任何異常紀錄。</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    AdminState.errors.forEach(e => {
      const levelClass = e['層級'] === 'ERROR' ? 'pill-err' : 'pill-wait';
      const statusClass = e['狀態'] === '已處理' ? 'pill-ok' : 'pill-err';
      tbody.innerHTML += `
        <tr>
          <td>${esc(e['時間'])}</td>
          <td>${esc(e['模組'])}</td>
          <td><span class="pill ${levelClass}">${esc(e['層級'])}</span></td>
          <td>${esc(e['關聯編號'])}</td>
          <td>${esc(e['異常訊息'])}</td>
          <td>${esc(e['建議處理方式'])}</td>
          <td><span class="pill ${statusClass}">${esc(e['狀態'])}</span></td>
        </tr>
      `;
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
