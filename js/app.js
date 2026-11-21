let allPublishedProducts = [];
let activeCategory = 'ALL';
let detectedCategoryKey = null;

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

    detectAndRenderCategories(allPublishedProducts);
    applyFiltersAndRender();
  } catch (error) {
    console.error('形象網站初始化失敗:', error);
    document.getElementById('marquee-content').textContent = 'MEYA 官方形象網站維護更新中';
    document.getElementById('catalog-count').textContent = '暫時無法連線至商品資料庫';
    document.getElementById('product-grid').innerHTML =
      '<p style="grid-column: 1 / -1; text-align: center; color: #888; padding: 40px 0;">資料載入異常，請稍後重新整理頁面。</p>';
  }
}

function renderConfig(config) {
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

// 若資料庫動態長出「分類 / category」欄位，前台自動長出極簡篩選列
function detectAndRenderCategories(products) {
  if (!products || products.length === 0) return;

  const sampleKeys = Object.keys(products[0]);
  detectedCategoryKey = sampleKeys.find(k => ['分類', '類別', '系列', 'category', 'type'].includes(k.toLowerCase())) || null;
  if (!detectedCategoryKey) return;

  const categories = Array.from(new Set(
    products.map(p => String(p[detectedCategoryKey] || '').trim()).filter(Boolean)
  ));
  if (categories.length <= 1) return;

  let bar = document.getElementById('dynamic-category-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'dynamic-category-bar';
    bar.style.cssText = 'display:flex; justify-content:center; flex-wrap:wrap; gap:10px; margin-bottom:32px;';
    const grid = document.getElementById('product-grid');
    grid.parentNode.insertBefore(bar, grid);
  }

  bar.innerHTML = '';
  ['ALL', ...categories].forEach(cat => {
    const btn = document.createElement('button');
    btn.textContent = cat === 'ALL' ? '全部商品' : cat;
    btn.dataset.cat = cat;
    btn.style.cssText = 'padding:7px 18px; border-radius:20px; font-size:13px; letter-spacing:1px; border:1px solid #D9D2C5; transition:0.25s;';
    updateCategoryBtnStyle(btn, cat === activeCategory);

    btn.addEventListener('click', () => {
      activeCategory = cat;
      bar.querySelectorAll('button').forEach(b => updateCategoryBtnStyle(b, b.dataset.cat === activeCategory));
      applyFiltersAndRender();
    });
    bar.appendChild(btn);
  });
}

function updateCategoryBtnStyle(btn, isActive) {
  btn.style.backgroundColor = isActive ? '#333333' : '#FFFFFF';
  btn.style.color = isActive ? '#FFFFFF' : '#333333';
  btn.style.borderColor = isActive ? '#333333' : '#D9D2C5';
}

function applyFiltersAndRender() {
  const keyword = (document.getElementById('search-input').value || '').trim().toLowerCase();

  const filtered = allPublishedProducts.filter(p => {
    if (activeCategory !== 'ALL' && detectedCategoryKey) {
      if (String(p[detectedCategoryKey] || '').trim() !== activeCategory) return false;
    }
    if (!keyword) return true;
    return Object.values(p).some(v => String(v || '').toLowerCase().includes(keyword));
  });

  renderProducts(filtered);
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
    img.onerror = function() { this.style.opacity = '0.2'; };
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

  // 動態呈現從 Excel 擴充出來的公開規格欄位（如分類、材質、尺寸、說明）
  const infoBox = document.querySelector('.modal-info-box');
  let specBox = document.getElementById('modal-dynamic-specs');
  if (!specBox) {
    specBox = document.createElement('div');
    specBox.id = 'modal-dynamic-specs';
    specBox.style.cssText = 'margin-bottom:18px; font-size:13px; color:#555; display:grid; gap:6px;';
    const noteEl = infoBox.querySelector('.modal-note');
    infoBox.insertBefore(specBox, noteEl);
  }

  const coreKeys = new Set(['id', 'name', 'price', 'image', '狀態']);
  specBox.innerHTML = '';
  Object.keys(product).forEach(k => {
    if (coreKeys.has(k)) return;
    const val = String(product[k] || '').trim();
    if (!val) return;
    const line = document.createElement('div');
    line.innerHTML = `<strong style="color:#333;">${escapeText(k)}：</strong>${escapeText(val)}`;
    specBox.appendChild(line);
  });

  document.getElementById('product-modal-backdrop').classList.add('open');
}

function bindWebsiteEvents() {
  document.getElementById('search-input').addEventListener('input', applyFiltersAndRender);

  const backdrop = document.getElementById('product-modal-backdrop');
  document.getElementById('modal-close-btn').addEventListener('click', () => backdrop.classList.remove('open'));
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.classList.remove('open');
  });
}

function escapeText(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
