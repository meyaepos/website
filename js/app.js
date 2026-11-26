/**
 * is Meya 形象網站前台主程式（完整版：商品櫥窗 ＋ 批發知識文章 ＋ 常見問題 Q&A）
 * 安全與效能：
 * 1. 全站採用純 DOM textContent 安全渲染，防範 XSS；圖片網址強制驗證 https:// 協定
 * 2. 嚴格遮蔽 NT$ 0（無有效售價改顯示官方 LINE 洽詢）
 * 3. localStorage 秒開快取 ＋ Google CDN 三段分級尺寸 (=w480 / =w1200 / =w2048) ＋ 2K 放大燈箱
 */
const OFFICIAL_LINE_URL = 'https://lin.ee/7gVn9gX';
const PUBLIC_CACHE_KEY = 'MEYA_PUBLIC_WEBSITE_CACHE_V2';

let allPublishedProducts = [];
let allPublishedArticles = [];
let allPublishedFaqs = [];

let activeCategory = 'ALL';
let activeArticleCategory = 'ALL';
let activeFaqCategory = 'ALL';
let detectedCategoryKey = null;
let userHasInteracted = false;

let lastRenderedAnnouncementsKey = '';
let lastRenderedProductsKey = '';
let lastRenderedArticlesKey = '';
let lastRenderedFaqsKey = '';

let currentModalProduct = null;
let currentModalGallery = [];
let currentModalImgIndex = 0;

function parseValidPrice(rawPrice) {
  if (rawPrice === null || rawPrice === undefined) return 0;
  const cleaned = String(rawPrice).replace(/[^0-9.-]/g, '').trim();
  if (!cleaned) return 0;
  const num = Number(cleaned);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function formatCdnImageUrl(rawUrl, widthPx) {
  const url = String(rawUrl || '').trim();
  if (!url || !/^https:\/\//i.test(url)) return '';
  if (url.indexOf('googleusercontent.com/') !== -1 && !/=w\d+|=s\d+/i.test(url)) {
    return url + '=w' + widthPx;
  }
  return url;
}

// 將多行純文字安全渲染為分段 <p>（使用 textContent 防 XSS）
function renderMultilineParagraphs(containerEl, rawText) {
  containerEl.textContent = '';
  const blocks = String(rawText || '').split(/\r?\n/);
  blocks.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const p = document.createElement('p');
    p.textContent = trimmed;
    containerEl.appendChild(p);
  });
}

// 動態跑馬燈控制器
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
        if (this.x < -textWidth) this.x = containerWidth;
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

// 前台 2K 高清全螢幕放大燈箱
const FrontLightbox = {
  zoomMode: 'fit',

  ensureDom: function() {
    if (document.getElementById('front-hd-lightbox')) return;

    const el = document.createElement('div');
    el.id = 'front-hd-lightbox';
    el.className = 'front-lightbox';
    el.innerHTML = `
      <div class="front-lightbox-bar">
        <div id="front-lb-meta" class="front-lightbox-meta"></div>
        <div class="front-lightbox-controls">
          <button type="button" class="front-lb-btn front-lb-zoom active" data-zoom="fit">適應螢幕</button>
          <button type="button" class="front-lb-btn front-lb-zoom" data-zoom="100">100% 細節</button>
          <button type="button" class="front-lb-btn front-lb-zoom" data-zoom="150">150% 微距</button>
          <button type="button" id="front-lb-close" class="front-lb-btn front-lb-close">✕ 關閉</button>
        </div>
      </div>
      <div class="front-lightbox-body">
        <button type="button" id="front-lb-prev" class="front-lb-nav front-lb-prev" aria-label="上一張">‹</button>
        <div id="front-lb-stage" class="front-lightbox-stage">
          <img id="front-lb-img" class="front-lightbox-img" src="" alt="商品高清放大圖">
        </div>
        <button type="button" id="front-lb-next" class="front-lb-nav front-lb-next" aria-label="下一張">›</button>
      </div>
    `;
    document.body.appendChild(el);

    el.querySelectorAll('.front-lb-zoom').forEach(btn => {
      btn.addEventListener('click', () => this.applyZoom(btn.dataset.zoom));
    });

    document.getElementById('front-lb-close').addEventListener('click', () => this.close());
    document.getElementById('front-lb-prev').addEventListener('click', () => this.step(-1));
    document.getElementById('front-lb-next').addEventListener('click', () => this.step(1));

    document.getElementById('front-lb-stage').addEventListener('click', e => {
      if (e.target.id === 'front-lb-stage') this.close();
    });

    const imgEl = document.getElementById('front-lb-img');
    imgEl.addEventListener('click', e => {
      e.stopPropagation();
      this.applyZoom(this.zoomMode === 'fit' ? '100' : 'fit');
    });

    document.addEventListener('keydown', e => {
      const box = document.getElementById('front-hd-lightbox');
      if (!box || !box.classList.contains('open')) return;
      if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowLeft') this.step(-1);
      else if (e.key === 'ArrowRight') this.step(1);
    });
  },

  open: function() {
    if (!currentModalGallery || currentModalGallery.length === 0) return;
    this.ensureDom();
    this.renderCurrentImage();
    document.getElementById('front-hd-lightbox').classList.add('open');
  },

  renderCurrentImage: function() {
    const rawUrl = currentModalGallery[currentModalImgIndex] || '';
    const hdUrl = formatCdnImageUrl(rawUrl, 2048);
    const imgEl = document.getElementById('front-lb-img');
    const metaEl = document.getElementById('front-lb-meta');
    const prevBtn = document.getElementById('front-lb-prev');
    const nextBtn = document.getElementById('front-lb-next');

    const title = currentModalProduct ? (currentModalProduct.name || currentModalProduct.id || '') : '';
    const counter = currentModalGallery.length > 1
      ? `（${currentModalImgIndex + 1} / ${currentModalGallery.length}）`
      : '';
    metaEl.textContent = `${title} ${counter}`;

    const showNav = currentModalGallery.length > 1;
    prevBtn.style.display = showNav ? 'flex' : 'none';
    nextBtn.style.display = showNav ? 'flex' : 'none';

    imgEl.onload = () => {
      if (this.zoomMode !== 'fit') this.applyZoom(this.zoomMode);
    };
    imgEl.src = hdUrl;
    this.applyZoom('fit');
  },

  applyZoom: function(mode) {
    this.zoomMode = mode;
    const imgEl = document.getElementById('front-lb-img');
    const stageEl = document.getElementById('front-lb-stage');

    document.querySelectorAll('.front-lb-zoom').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.zoom === mode);
    });

    if (mode === 'fit') {
      imgEl.classList.remove('zoomed');
      imgEl.style.width = '';
      imgEl.style.height = '';
      stageEl.scrollTo(0, 0);
    } else {
      const natW = imgEl.naturalWidth || 1600;
      const natH = imgEl.naturalHeight || 2133;
      const scale = mode === '150' ? 1.5 : 1;
      imgEl.classList.add('zoomed');
      imgEl.style.width = Math.round(natW * scale) + 'px';
      imgEl.style.height = Math.round(natH * scale) + 'px';

      requestAnimationFrame(() => {
        stageEl.scrollLeft = Math.max(0, (stageEl.scrollWidth - stageEl.clientWidth) / 2);
        stageEl.scrollTop = Math.max(0, (stageEl.scrollHeight - stageEl.clientHeight) / 2);
      });
    }
  },

  step: function(delta) {
    if (currentModalGallery.length <= 1) return;
    currentModalImgIndex = (currentModalImgIndex + delta + currentModalGallery.length) % currentModalGallery.length;
    renderModalGallery();
    this.renderCurrentImage();
  },

  close: function() {
    const box = document.getElementById('front-hd-lightbox');
    if (box) box.classList.remove('open');
  }
};

function forceScrollTop() {
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

['touchstart', 'wheel', 'mousedown'].forEach(evt => {
  window.addEventListener(evt, () => { userHasInteracted = true; }, { passive: true, once: true });
});

window.addEventListener('pageshow', () => { if (!userHasInteracted) forceScrollTop(); });
window.addEventListener('load', () => { if (!userHasInteracted) forceScrollTop(); });

document.addEventListener('DOMContentLoaded', () => {
  forceScrollTop();
  MarqueeRunner.bindHover();
  initWebsite();
  bindWebsiteEvents();
});

function applyWebsitePayload(data) {
  renderConfig(data.config || {});

  const announcements = data.announcements || [];
  const annKey = JSON.stringify(announcements);
  if (annKey !== lastRenderedAnnouncementsKey) {
    lastRenderedAnnouncementsKey = annKey;
    renderAnnouncements(announcements);
  }

  const products = data.products || [];
  const prodKey = JSON.stringify(products);
  if (prodKey !== lastRenderedProductsKey) {
    lastRenderedProductsKey = prodKey;
    allPublishedProducts = products;
    detectAndRenderCategories(allPublishedProducts);
    applyFiltersAndRender();
  }

  const articles = data.articles || [];
  const artKey = JSON.stringify(articles);
  if (artKey !== lastRenderedArticlesKey) {
    lastRenderedArticlesKey = artKey;
    allPublishedArticles = articles;
    renderArticleCategoryBar();
    renderArticlesGrid();
  }

  const faqs = data.faqs || [];
  const faqKey = JSON.stringify(faqs);
  if (faqKey !== lastRenderedFaqsKey) {
    lastRenderedFaqsKey = faqKey;
    allPublishedFaqs = faqs;
    renderFaqCategoryBar();
    renderFaqAccordion();
  }
}

async function initWebsite() {
  let hasLocalCache = false;
  try {
    const cachedRaw = localStorage.getItem(PUBLIC_CACHE_KEY);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      if (cached && Array.isArray(cached.products)) {
        applyWebsitePayload(cached);
        hasLocalCache = true;
      }
    }
  } catch (_) {}

  try {
    if (typeof CONFIG === 'undefined' || !CONFIG.GAS_API_URL) {
      throw new Error('找不到 js/config.js 或 GAS_API_URL 尚未設定');
    }

    const response = await fetch(CONFIG.GAS_API_URL + '?action=getWebsiteInitData');
    if (!response.ok) throw new Error('伺服器回應狀態碼：' + response.status);

    const data = await response.json();
    if (data.status !== 'success') throw new Error(data.message || '資料庫回傳異常');

    try {
      localStorage.setItem(PUBLIC_CACHE_KEY, JSON.stringify({
        config: data.config || {},
        announcements: data.announcements || [],
        products: data.products || [],
        articles: data.articles || [],
        faqs: data.faqs || []
      }));
    } catch (_) {}

    applyWebsitePayload(data);
  } catch (error) {
    console.error('[is Meya] 資料庫連線診斷：', error);
    if (!hasLocalCache) {
      renderAnnouncements(['is Meya 韓國精品服飾・純銀飾品']);
      document.getElementById('catalog-count').textContent = '商品型錄連線準備中，歡迎直接聯繫官方門市洽詢';
      document.getElementById('product-grid').innerHTML =
        '<p style="grid-column: 1 / -1; text-align: center; color: #888; padding: 48px 0; font-size: 14px;">商品型錄準備中，歡迎直接聯繫官方門市洽詢。</p>';
      renderArticlesGrid();
      renderFaqAccordion();
    }
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

// ================= 商品櫥窗區 =================

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
    bar.className = 'pill-filter-bar';
    const grid = document.getElementById('product-grid');
    grid.parentNode.insertBefore(bar, grid);
  }

  bar.textContent = '';
  ['ALL', ...categories].forEach(cat => {
    const btn = document.createElement('button');
    btn.textContent = cat === 'ALL' ? '全部商品' : cat;
    btn.className = 'filter-pill-btn' + (cat === activeCategory ? ' active' : '');
    btn.addEventListener('click', () => {
      activeCategory = cat;
      bar.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyFiltersAndRender();
    });
    bar.appendChild(btn);
  });
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
    .filter(u => /^https:\/\//i.test(u));

  const cover = String(product.image || '').trim();
  if (/^https:\/\//i.test(cover) && !list.includes(cover)) {
    list.unshift(cover);
  }
  return list;
}

function renderProducts(list) {
  const grid = document.getElementById('product-grid');
  const countEl = document.getElementById('catalog-count');
  grid.textContent = '';

  if (!list || list.length === 0) {
    countEl.textContent = '目前尚無上架商品';
    const emptyP = document.createElement('p');
    emptyP.style.cssText = 'grid-column: 1 / -1; text-align: center; color: #888; padding: 44px 0; font-size: 14px;';
    emptyP.textContent = '全新商品陸續上架中，敬請期待。';
    grid.appendChild(emptyP);
    return;
  }

  countEl.textContent = '共 ' + list.length + ' 件商品';

  list.forEach((product, idx) => {
    const card = document.createElement('div');
    card.className = 'product-item';
    card.addEventListener('click', () => openProductModal(product));

    const imgWrap = document.createElement('div');
    imgWrap.className = 'product-img-wrap';

    const img = document.createElement('img');
    img.src = formatCdnImageUrl(product.image, 480);
    img.alt = product.name || '';
    img.decoding = 'async';
    if (idx < 4) img.fetchPriority = 'high';
    else img.loading = 'lazy';
    img.onerror = function() { this.style.opacity = '0.2'; };
    imgWrap.appendChild(img);

    const skuEl = document.createElement('div');
    skuEl.className = 'product-sku';
    skuEl.textContent = product.id || '';

    const nameEl = document.createElement('div');
    nameEl.className = 'product-name';
    nameEl.textContent = product.name || '';

    const priceEl = document.createElement('div');
    const validPrice = parseValidPrice(product.price);
    if (validPrice > 0) {
      priceEl.className = 'product-price';
      priceEl.textContent = 'NT$ ' + validPrice.toLocaleString();
    } else {
      priceEl.className = 'product-price price-inquiry';
      priceEl.textContent = '價格請洽官方 LINE / 門市';
    }

    card.appendChild(imgWrap);
    card.appendChild(skuEl);
    card.appendChild(nameEl);
    card.appendChild(priceEl);
    grid.appendChild(card);
  });
}

function openProductModal(product) {
  currentModalProduct = product;
  currentModalGallery = getProductGalleryUrls(product);
  currentModalImgIndex = 0;

  document.getElementById('modal-sku').textContent = '商品編號 ' + (product.id || '');
  document.getElementById('modal-name').textContent = product.name || '';

  const priceEl = document.getElementById('modal-price');
  const addCartBtn = document.querySelector('.product-modal .btn-add-to-cart');
  const validPrice = parseValidPrice(product.price);

  if (validPrice > 0) {
    priceEl.className = 'price-tag';
    priceEl.textContent = 'NT$ ' + validPrice.toLocaleString();
    if (addCartBtn) addCartBtn.style.display = '';
  } else {
    priceEl.className = 'price-tag price-inquiry';
    priceEl.textContent = '';
    priceEl.appendChild(document.createTextNode('價格請洽 '));
    const lineLink = document.createElement('a');
    lineLink.href = OFFICIAL_LINE_URL;
    lineLink.target = '_blank';
    lineLink.rel = 'noopener noreferrer';
    lineLink.className = 'price-inquiry-link';
    lineLink.textContent = '官方 LINE ↗';
    priceEl.appendChild(lineLink);
    priceEl.appendChild(document.createTextNode(' 或門市洽詢'));
    if (addCartBtn) addCartBtn.style.display = 'none';
  }

  renderModalGallery();

  const specBox = document.getElementById('modal-dynamic-specs');
  const hiddenKeys = new Set(['id', 'name', 'price', 'image', 'images', '狀態']);
  specBox.textContent = '';

  Object.keys(product).forEach(k => {
    if (hiddenKeys.has(k)) return;
    const val = String(product[k] || '').trim();
    if (!val) return;
    const line = document.createElement('div');
    const label = document.createElement('strong');
    label.style.color = '#333';
    label.textContent = k + '：';
    line.appendChild(label);
    line.appendChild(document.createTextNode(val));
    specBox.appendChild(line);
  });

  document.getElementById('product-modal-backdrop').classList.add('open');
}

function renderModalGallery() {
  const imgBox = document.querySelector('.modal-img-box');
  imgBox.style.position = 'relative';

  const mainImg = document.getElementById('modal-img');
  const currentUrl = currentModalGallery[currentModalImgIndex] || '';
  mainImg.src = formatCdnImageUrl(currentUrl, 1200);
  mainImg.decoding = 'async';
  mainImg.title = '點擊放大檢視 2K 高清細節';

  imgBox.querySelectorAll('.gallery-nav-btn, .gallery-thumbs-bar, .modal-zoom-badge').forEach(el => el.remove());

  if (currentUrl) {
    const zoomBadge = document.createElement('button');
    zoomBadge.type = 'button';
    zoomBadge.className = 'modal-zoom-badge';
    zoomBadge.textContent = '🔍 點擊放大細節';
    zoomBadge.addEventListener('click', e => {
      e.stopPropagation();
      FrontLightbox.open();
    });
    imgBox.appendChild(zoomBadge);
  }

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
    t.src = formatCdnImageUrl(url, 160);
    t.decoding = 'async';
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

// ================= 批發知識文章專區（點擊展開閱讀，支援圖文與純文字） =================

function renderArticleCategoryBar() {
  const bar = document.getElementById('articles-category-bar');
  if (!bar) return;

  const categories = Array.from(new Set(
    allPublishedArticles.map(a => String(a.category || '').trim()).filter(Boolean)
  ));

  if (categories.length <= 1) {
    bar.style.display = 'none';
    bar.textContent = '';
    return;
  }

  bar.style.display = 'flex';
  bar.textContent = '';
  ['ALL', ...categories].forEach(cat => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'filter-pill-btn' + (cat === activeArticleCategory ? ' active' : '');
    btn.textContent = cat === 'ALL' ? '全部文章' : cat;
    btn.addEventListener('click', () => {
      activeArticleCategory = cat;
      bar.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderArticlesGrid();
    });
    bar.appendChild(btn);
  });
}

function renderArticlesGrid() {
  const grid = document.getElementById('articles-grid');
  const countEl = document.getElementById('articles-count');
  if (!grid) return;

  const list = allPublishedArticles.filter(a =>
    activeArticleCategory === 'ALL' || String(a.category || '').trim() === activeArticleCategory
  );

  grid.textContent = '';
  if (list.length === 0) {
    if (countEl) countEl.textContent = '專欄文章陸續籌備中';
    const emptyP = document.createElement('p');
    emptyP.style.cssText = 'grid-column: 1 / -1; text-align: center; color: #888; padding: 32px 0; font-size: 14px;';
    emptyP.textContent = '批發選品與飾品知識文章陸續上架中，歡迎先聯繫官方 LINE 索取最新批發須知。';
    grid.appendChild(emptyP);
    return;
  }

  if (countEl) countEl.textContent = `共 ${list.length} 篇專欄・點擊卡片閱讀完整內容`;

  list.forEach(art => {
    const safeCover = formatCdnImageUrl(art.image, 720);
    const hasCover = Boolean(safeCover);

    const card = document.createElement('article');
    card.className = 'article-card' + (hasCover ? '' : ' text-only');
    card.addEventListener('click', () => openArticleModal(art));

    if (hasCover) {
      const coverWrap = document.createElement('div');
      coverWrap.className = 'article-card-cover';
      const img = document.createElement('img');
      img.src = safeCover;
      img.alt = art.title || '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.onerror = function() { coverWrap.style.display = 'none'; card.classList.add('text-only'); };
      coverWrap.appendChild(img);
      card.appendChild(coverWrap);
    }

    const body = document.createElement('div');
    body.className = 'article-card-body';

    const meta = document.createElement('div');
    meta.className = 'article-card-meta';

    const catSpan = document.createElement('span');
    catSpan.className = 'article-cat-pill';
    catSpan.textContent = art.category || '批發知識';
    meta.appendChild(catSpan);

    if (art.updatedAt) {
      const dateSpan = document.createElement('span');
      dateSpan.className = 'article-date';
      dateSpan.textContent = String(art.updatedAt).slice(0, 10);
      meta.appendChild(dateSpan);
    }

    const titleEl = document.createElement('h3');
    titleEl.className = 'article-card-title';
    titleEl.textContent = art.title || '';

    const summaryEl = document.createElement('p');
    summaryEl.className = 'article-card-summary';
    summaryEl.textContent = art.summary || '';

    const moreEl = document.createElement('span');
    moreEl.className = 'article-read-more';
    moreEl.textContent = '閱讀全文 →';

    body.appendChild(meta);
    body.appendChild(titleEl);
    body.appendChild(summaryEl);
    body.appendChild(moreEl);
    card.appendChild(body);
    grid.appendChild(card);
  });
}

function openArticleModal(art) {
  const coverWrap = document.getElementById('article-modal-cover-wrap');
  const coverImg = document.getElementById('article-modal-cover');
  const safeCover = formatCdnImageUrl(art.image, 1200);

  if (safeCover) {
    coverImg.src = safeCover;
    coverImg.alt = art.title || '';
    coverWrap.style.display = 'block';
  } else {
    coverImg.src = '';
    coverWrap.style.display = 'none';
  }

  document.getElementById('article-modal-cat').textContent = art.category || '批發知識';
  document.getElementById('article-modal-date').textContent = art.updatedAt ? String(art.updatedAt).slice(0, 10) : '';
  document.getElementById('article-modal-title').textContent = art.title || '';
  renderMultilineParagraphs(document.getElementById('article-modal-content'), art.content || '');

  const backdrop = document.getElementById('article-modal-backdrop');
  backdrop.classList.add('open');
  const modalBox = backdrop.querySelector('.article-modal');
  if (modalBox) modalBox.scrollTop = 0;
}

// ================= 常見問題 Q&A 手風琴專區 =================

function renderFaqCategoryBar() {
  const bar = document.getElementById('faq-category-bar');
  if (!bar) return;

  const categories = Array.from(new Set(
    allPublishedFaqs.map(f => String(f.category || '').trim()).filter(Boolean)
  ));

  if (categories.length <= 1) {
    bar.style.display = 'none';
    bar.textContent = '';
    return;
  }

  bar.style.display = 'flex';
  bar.textContent = '';
  ['ALL', ...categories].forEach(cat => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'filter-pill-btn' + (cat === activeFaqCategory ? ' active' : '');
    btn.textContent = cat === 'ALL' ? '全部問題' : cat;
    btn.addEventListener('click', () => {
      activeFaqCategory = cat;
      bar.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderFaqAccordion();
    });
    bar.appendChild(btn);
  });
}

function renderFaqAccordion() {
  const container = document.getElementById('faq-accordion');
  if (!container) return;

  const list = allPublishedFaqs.filter(f =>
    activeFaqCategory === 'ALL' || String(f.category || '').trim() === activeFaqCategory
  );

  container.textContent = '';
  if (list.length === 0) {
    const emptyP = document.createElement('p');
    emptyP.style.cssText = 'text-align: center; color: #888; padding: 28px 0; font-size: 14px;';
    emptyP.textContent = '目前尚無常見問題，如有任何疑問歡迎直接聯繫官方 LINE。';
    container.appendChild(emptyP);
    return;
  }

  list.forEach((item, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'faq-item' + (idx === 0 ? ' open' : '');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'faq-question-btn';
    btn.setAttribute('aria-expanded', idx === 0 ? 'true' : 'false');

    const left = document.createElement('div');
    left.className = 'faq-q-left';

    const qMark = document.createElement('span');
    qMark.className = 'faq-q-mark';
    qMark.textContent = 'Q.';
    left.appendChild(qMark);

    if (item.category) {
      const catTag = document.createElement('span');
      catTag.className = 'faq-cat-tag';
      catTag.textContent = item.category;
      left.appendChild(catTag);
    }

    const qText = document.createElement('span');
    qText.textContent = item.question || '';
    left.appendChild(qText);

    const icon = document.createElement('span');
    icon.className = 'faq-toggle-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '+';

    btn.appendChild(left);
    btn.appendChild(icon);

    const panel = document.createElement('div');
    panel.className = 'faq-answer-panel';
    renderMultilineParagraphs(panel, item.answer || '');

    btn.addEventListener('click', () => {
      const isOpen = wrap.classList.toggle('open');
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    wrap.appendChild(btn);
    wrap.appendChild(panel);
    container.appendChild(wrap);
  });
}

// ================= 全站事件綁定 =================

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

  const modalImg = document.getElementById('modal-img');
  if (modalImg) modalImg.addEventListener('click', () => FrontLightbox.open());

  const prodBackdrop = document.getElementById('product-modal-backdrop');
  document.getElementById('modal-close-btn').addEventListener('click', () => {
    FrontLightbox.close();
    prodBackdrop.classList.remove('open');
  });
  prodBackdrop.addEventListener('click', (e) => {
    if (e.target === prodBackdrop) {
      FrontLightbox.close();
      prodBackdrop.classList.remove('open');
    }
  });

  const artBackdrop = document.getElementById('article-modal-backdrop');
  document.getElementById('article-modal-close').addEventListener('click', () => {
    artBackdrop.classList.remove('open');
  });
  artBackdrop.addEventListener('click', (e) => {
    if (e.target === artBackdrop) artBackdrop.classList.remove('open');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      artBackdrop.classList.remove('open');
    }
  });
}
