let allPublishedProducts = [];
let activeCategory = 'ALL';
let detectedCategoryKey = null;
let userHasInteracted = false;

let currentModalGallery = [];
let currentModalImgIndex = 0;

// 依據展示情境自動附加 Google CDN 動態縮放參數（列表 =w800 秒開，詳情彈窗 =w1600 高清）
function formatCdnImageUrl(rawUrl, widthPx) {
  const url = String(rawUrl || '').trim();
  if (!url) return '';
  if (url.indexOf('[googleusercontent.com/](https://googleusercontent.com/)') !== -1 && !/=w\d+|=s\d+/i.test(url)) {
    return url + '=w' + widthPx;
  }
  return url;
}

// JS 動態跑馬燈控制器（全裝置統一從最右側進場、等速向左捲動）
const MarqueeRunner = {
  rafId: null,
  x: 0,
  lastTime: 0,
  paused: false,
  speedPxPerSec: 72,

  start: function(text) {
    const mainEl = document.getElementById('marquee-content');
    const cloneEl = document.getElementById('marquee-content-clone');
    if (!mainEl) return;

    const container = mainEl.parentElement;
    if (cloneEl) cloneEl.style.display = 'none';

    container.style.display = 'block';
    container.style.width = '100%';
    container.style.overflow = 'hidden';

    mainEl.style.display = 'inline-block';
    mainEl.style.whiteSpace = 'nowrap';
    mainEl.style.animation = 'none';
    mainEl.textContent = text;

    if (this.rafId) cancelAnimationFrame(this.rafId);

    this.x = container.clientWidth || window.innerWidth;
    this.lastTime = 0;
    mainEl.style.transform = `translate3d(${this.x}px, 0, 0)`;

    const step = (now) => {
      if (!this.lastTime) this.lastTime = now;
      const dt = Math.min((now - this.lastTime) / 1000, 0.05);
      this.lastTime = now;

      if (!this.paused) {
        this.x -= this.speedPxPerSec * dt;
        const textWidth = mainEl.offsetWidth || 200;
        const containerWidth = container.clientWidth || window.innerWidth;

        if (this.x < -textWidth) {
          this.x = containerWidth;
        }
        mainEl.style.transform = `translate3d(${this.x}px, 0, 0)`;
      }

      this.rafId = requestAnimationFrame(step);
    };

    this.rafId = requestAnimationFrame(step);
  },

  bindHover: function() {
    const bar = document.querySelector('.announcement-bar');
    if (!bar) return;
    bar.addEventListener('mouseenter', () => { this.paused = true; });
    bar.addEventListener('mouseleave', () => { this.paused = false; });
  }
};

function forceScrollTop() {
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

['touchstart', 'wheel', 'mousedown'].forEach(evt => {
  window.addEventListener(evt, () => {
    userHasInteracted = true;
  }, { passive: true, once: true });
});

window.addEventListener('pageshow', () => {
  if (!userHasInteracted) forceScrollTop();
});

window.addEventListener('load', () => {
  if (!userHasInteracted) forceScrollTop();
});

document.addEventListener('DOMContentLoaded', () => {
  forceScrollTop();
  MarqueeRunner.bindHover();
  initWebsite();
  bindWebsiteEvents();
});

async function initWebsite() {
  try {
    if (typeof CONFIG === 'undefined' || !CONFIG.GAS_API_URL) {
      throw new Error('找不到 js/config.js 或 GAS_API_URL 尚未設定');
    }

    const response = await fetch(CONFIG.GAS_API_URL + '?action=getWebsiteInitData');
    if (!response.ok) throw new Error('伺服器回應狀態碼：' + response.status);

    const data = await response.json();
    if (data.status !== 'success') throw new Error(data.message || '資料庫回傳異常');

    renderConfig(data.config || {});
    renderAnnouncements(data.announcements || []);
    allPublishedProducts = data.products || [];

    detectAndRenderCategories(allPublishedProducts);
    applyFiltersAndRender();
  } catch (error) {
    console.error('[is Meya] 資料庫連線診斷：', error);
    renderAnnouncements(['is Meya 韓國精品服飾・純銀飾品']);
    document.getElementById('catalog-count').textContent = '目前尚未連線至商品資料庫，請確認 GAS 部署權限設為「所有人」與 js/config.js 網址';
    document.getElementById('product-grid').innerHTML =
      '<p style="grid-column: 1 / -1; text-align: center; color: #888; padding: 48px 0; font-size: 14px;">商品型錄準備中，歡迎直接聯繫官方門市洽詢。</p>';
  } finally {
    if (!userHasInteracted) forceScrollTop();
  }
}

function renderConfig(config) {
  if (config.cart_enabled === true) {
    document.body.classList.remove('cart-disabled');
  } else {
    document.body.classList.add('cart-disabled');
  }

  if (config.free_shipping) {
    const el = document.getElementById('free-shipping-text');
    if (el) el.textContent = config.free_shipping;
  }
}

function renderAnnouncements(newsList) {
  const text = newsList.length > 0
    ? newsList.join('　　✦　　')
    : '歡迎蒞臨 is Meya 官方形象網站';

  MarqueeRunner.start(text);
}

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
    bar.style.cssText = 'display:flex; justify-content:center; flex-wrap:wrap; gap:10px; margin-bottom:36px;';
    const grid = document.getElementById('product-grid');
    grid.parentNode.insertBefore(bar, grid);
  }

  bar.innerHTML = '';
  ['ALL', ...categories].forEach(cat => {
    const btn = document.createElement('button');
    btn.textContent = cat === 'ALL' ? '全部商品' : cat;
    btn.dataset.cat = cat;
    btn.style.cssText = 'padding:6px 18px; border-radius:20px; font-size:13px; letter-spacing:1px; border:1px solid #D9D2C5; transition:0.25s;';
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
    return Object.keys(p)
      .filter(k => k !== 'image' && k !== 'images')
      .some(k => String(p[k] || '').toLowerCase().includes(keyword));
  });

  renderProducts(filtered);
}

function getProductGalleryUrls(product) {
  const list = String(product.images || '')
    .split(',')
    .map(u => u.trim())
    .filter(Boolean);

  const cover = String(product.image || '').trim();
  if (cover && !list.includes(cover)) {
    list.unshift(cover);
  }
  return list;
}

function renderProducts(list) {
  const grid = document.getElementById('product-grid');
  const countEl = document.getElementById('catalog-count');
  grid.innerHTML = '';

  if (!list || list.length === 0) {
    countEl.textContent = '目前尚無上架商品';
    grid.innerHTML = '<p style="grid-column: 1 / -1; text-align: center; color: #888; padding: 44px 0; font-size: 14px;">全新商品陸續上架中，敬請期待。</p>';
    return;
  }

  countEl.textContent = '共 ' + list.length + ' 件商品';

  list.forEach(product => {
    const card = document.createElement('div');
    card.className = 'product-item';
    card.addEventListener('click', () => openProductModal(product));

    const imgWrap = document.createElement('div');
    imgWrap.className = 'product-img-wrap';

    const img = document.createElement('img');
    img.src = formatCdnImageUrl(product.image, 800);
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
  currentModalGallery = getProductGalleryUrls(product);
  currentModalImgIndex = 0;

  document.getElementById('modal-sku').textContent = '商品編號 ' + (product.id || '');
  document.getElementById('modal-name').textContent = product.name || '';
  document.getElementById('modal-price').textContent = 'NT$ ' + Number(product.price || 0).toLocaleString();

  renderModalGallery();

  const specBox = document.getElementById('modal-dynamic-specs');
  const hiddenKeys = new Set(['id', 'name', 'price', 'image', 'images', '狀態']);
  specBox.innerHTML = '';

  Object.keys(product).forEach(k => {
    if (hiddenKeys.has(k)) return;
    const val = String(product[k] || '').trim();
    if (!val) return;
    const line = document.createElement('div');
    line.innerHTML = `<strong style="color:#333;">${escapeText(k)}：</strong>${escapeText(val)}`;
    specBox.appendChild(line);
  });

  document.getElementById('product-modal-backdrop').classList.add('open');
}

function renderModalGallery() {
  const imgBox = document.querySelector('.modal-img-box');
  imgBox.style.position = 'relative';

  const mainImg = document.getElementById('modal-img');
  mainImg.src = formatCdnImageUrl(currentModalGallery[currentModalImgIndex] || '', 1600);

  imgBox.querySelectorAll('.gallery-nav-btn, .gallery-thumbs-bar').forEach(el => el.remove());

  if (currentModalGallery.length <= 1) return;

  const makeNavBtn = (text, side, delta) => {
    const btn = document.createElement('button');
    btn.className = 'gallery-nav-btn';
    btn.textContent = text;
    btn.style.cssText = `position:absolute; top:45%; ${side}:10px; transform:translateY(-50%); width:32px; height:32px; border-radius:50%; background:rgba(255,255,255,0.88); color:#333; font-size:18px; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 6px rgba(0,0,0,0.16); z-index:4;`;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      currentModalImgIndex = (currentModalImgIndex + delta + currentModalGallery.length) % currentModalGallery.length;
      renderModalGallery();
    });
    return btn;
  };

  imgBox.appendChild(makeNavBtn('‹', 'left', -1));
  imgBox.appendChild(makeNavBtn('›', 'right', 1));

  const strip = document.createElement('div');
  strip.className = 'gallery-thumbs-bar';
  strip.style.cssText = 'position:absolute; left:0; right:0; bottom:10px; display:flex; justify-content:center; gap:6px; padding:0 10px; overflow-x:auto; z-index:4;';

  currentModalGallery.forEach((url, idx) => {
    const t = document.createElement('img');
    t.src = formatCdnImageUrl(url, 200);
    t.style.cssText = `width:42px; height:52px; object-fit:cover; border-radius:3px; cursor:pointer; background:#fff; border:2px solid ${idx === currentModalImgIndex ? '#333333' : 'rgba(255,255,255,0.85)'}; box-shadow:0 1px 4px rgba(0,0,0,0.22);`;
    t.addEventListener('click', e => {
      e.stopPropagation();
      currentModalImgIndex = idx;
      renderModalGallery();
    });
    strip.appendChild(t);
  });

  imgBox.appendChild(strip);
}

function bindWebsiteEvents() {
  const drawer = document.getElementById('search-bar-drawer');
  const searchInput = document.getElementById('search-input');

  document.getElementById('btn-search-toggle').addEventListener('click', () => {
    drawer.classList.toggle('open');
    if (drawer.classList.contains('open')) searchInput.focus();
  });

  document.getElementById('btn-search-close').addEventListener('click', () => {
    searchInput.value = '';
    drawer.classList.remove('open');
    applyFiltersAndRender();
  });

  searchInput.addEventListener('input', applyFiltersAndRender);

  document.querySelectorAll('[data-scroll-target]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      userHasInteracted = true;

      const mode = link.getAttribute('data-nav');
      if (mode) {
        document.getElementById('catalog-heading').textContent = mode === 'new' ? '新品上市' : '所有商品';
        activeCategory = 'ALL';
        applyFiltersAndRender();
      }

      const targetId = link.getAttribute('data-scroll-target');
      if (targetId === 'top') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  document.getElementById('btn-scroll-top').addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  const backdrop = document.getElementById('product-modal-backdrop');
  document.getElementById('modal-close-btn').addEventListener('click', () => backdrop.classList.remove('open'));
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.classList.remove('open');
  });
}

function escapeText(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
