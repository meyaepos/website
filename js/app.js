let allPublishedProducts = [];

document.addEventListener('DOMContentLoaded', () => {
  initWebsite();
  bindWebsiteEvents();
});

async function initWebsite() {
  try {
    const response = await fetch(CONFIG.GAS_API_URL + '?action=getWebsiteInitData');
    if (!response.ok) throw new Error('伺服器回應異常：' + response.status);

    const data = await response.json();
    if (data.status !== 'success') throw new Error(data.message || '資料載入失敗');

    renderConfig(data.config || {});
    renderAnnouncements(data.announcements || []);
    allPublishedProducts = data.products || [];
    renderProducts(allPublishedProducts);
  } catch (error) {
    console.error('形象網站初始化失敗:', error);
    document.getElementById('marquee-content').textContent = 'MEYA 官方形象網站維護更新中';
    document.getElementById('catalog-count').textContent = '暫時無法連線至商品資料庫';
    document.getElementById('product-grid').innerHTML =
      '<p style="grid-column: 1 / -1; text-align: center; color: #888; padding: 40px 0;">資料載入異常，請稍後重新整理頁面。</p>';
  }
}

function renderConfig(config) {
  // 預留購物車開關（Phase 1 預設為 false 隱藏購物車）
  if (config.cart_enabled === false || config.cart_enabled === undefined) {
    document.body.classList.add('cart-disabled');
  } else {
    document.body.classList.remove('cart-disabled');
  }

  if (config.free_shipping) {
    const el = document.getElementById('free-shipping-text');
    if (el) el.textContent = config.free_shipping;
  }
}

function renderAnnouncements(newsList) {
  const mainEl = document.getElementById('marquee-content');
  const cloneEl = document.getElementById('marquee-content-clone');
  const text = newsList.length > 0 ? newsList.join('　✦　') + '　✦　' : '歡迎蒞臨 MEYA 官方形象網站　✦　';
  mainEl.textContent = text;
  cloneEl.textContent = text;
}

function renderProducts(list) {
  const grid = document.getElementById('product-grid');
  const countEl = document.getElementById('catalog-count');
  grid.innerHTML = '';

  if (!list || list.length === 0) {
    countEl.textContent = '目前尚無符合條件的商品';
    grid.innerHTML = '<p style="grid-column: 1 / -1; text-align: center; color: #888; padding: 40px 0;">敬請期待全新系列上架</p>';
    return;
  }

  countEl.textContent = '共 ' + list.length + ' 件精選商品';

  list.forEach(product => {
    const card = document.createElement('div');
    card.className = 'product-item';
    card.addEventListener('click', () => openProductModal(product));

    const imgWrap = document.createElement('div');
    imgWrap.className = 'product-img-wrap';

    const img = document.createElement('img');
    img.src = product.image || '';
    img.alt = product.name || '';
    img.loading = 'lazy';
    img.onerror = function() {
      this.style.opacity = '0.2';
    };
    imgWrap.appendChild(img);

    const skuEl = document.createElement('div');
    skuEl.className = 'product-sku';
    skuEl.textContent = product.id || '';

    const nameEl = document.createElement('div');
    nameEl.className = 'product-name';
    nameEl.textContent = product.name || '';

    const priceEl = document.createElement('div');
    priceEl.className = 'product-price';
    priceEl.textContent = 'NT$ ' + Number(product.price || 0).toLocaleString();

    card.appendChild(imgWrap);
    card.appendChild(skuEl);
    card.appendChild(nameEl);
    card.appendChild(priceEl);
    grid.appendChild(card);
  });
}

function openProductModal(product) {
  document.getElementById('modal-img').src = product.image || '';
  document.getElementById('modal-sku').textContent = 'ITEM NO. ' + (product.id || '');
  document.getElementById('modal-name').textContent = product.name || '';
  document.getElementById('modal-price').textContent = 'NT$ ' + Number(product.price || 0).toLocaleString();
  document.getElementById('product-modal-backdrop').classList.add('open');
}

function bindWebsiteEvents() {
  // 即時搜尋商品名稱或編號
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', (e) => {
    const keyword = e.target.value.trim().toLowerCase();
    if (!keyword) {
      renderProducts(allPublishedProducts);
      return;
    }
    const filtered = allPublishedProducts.filter(p =>
      String(p.id || '').toLowerCase().includes(keyword) ||
      String(p.name || '').toLowerCase().includes(keyword)
    );
    renderProducts(filtered);
  });

  // 關閉商品細節預覽彈窗
  const backdrop = document.getElementById('product-modal-backdrop');
  document.getElementById('modal-close-btn').addEventListener('click', () => backdrop.classList.remove('open'));
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.classList.remove('open');
  });
}
