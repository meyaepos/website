/**
 * is Meya 獨立「所有商品」目錄引擎
 * 功能：左側自動多層分類樹（支援 / 分隔主次分類）、三段排序、每頁 48 件（4×12）圓形分頁、0 元遮蔽與 2K 放大燈箱
 * 安全：全程純 DOM textContent 安全渲染防 XSS，圖片強制驗證 https:// 協定白名單，零前端機密
 */
const OFFICIAL_LINE_URL = 'https://lin.ee/7gVn9gX';
const PUBLIC_CACHE_KEY = 'MEYA_PUBLIC_WEBSITE_CACHE_V2';
const PAGE_SIZE = 48; // 桌機 4 欄 × 12 列 ｜ 平板 3 欄 × 16 列 ｜ 手機 2 欄 × 24 列

let allPublishedProducts = [];
let detectedCategoryKey = null;
let activeParentCat = 'ALL'; // 'ALL' 或主分類名稱
let activeChildCat = '';     // 空字串代表整組主分類，或指定子分類名稱
let activeSort = 'default';  // 'default' | 'price-asc' | 'price-desc'
let currentPage = 1;
const expandedParentSet = new Set();

let lastRenderedAnnouncementsKey = '';
let lastRenderedProductsKey = '';

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

function parseCategoryParts(rawVal) {
  const str = String(rawVal || '').trim();
  if (!str) return { parent: '', child: '' };
  const parts = str.split(/[\/／>]/).map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { parent: parts[0], child: parts.slice(1).join(' / ') };
  }
  return { parent: parts[0] || '', child: '' };
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

document.addEventListener('DOMContentLoaded', () => {
  MarqueeRunner.bindHover();
  setupHeaderScrollEffect();
  applyInitialUrlParams();
  bindEvents();
  initProductsPage();
});

function setupHeaderScrollEffect() {
  const header = document.getElementById('site-header');
  if (!header) return;
  window.addEventListener('scroll', () => {
    header.classList.toggle('scrolled', (window.scrollY || 0) > 18);
  }, { passive: true });
}

function applyInitialUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const q = (params.get('q') || '').trim();
  if (q) {
    const searchInput = document.getElementById('search-input');
    const drawer = document.getElementById('search-bar-drawer');
    if (searchInput) searchInput.value = q;
    if (drawer) drawer.classList.add('open');
  }
}

function applyWebsitePayload(data) {
  renderConfig(data.config || {});

  const announcements = data.announcements || [];
  const annKey = JSON.stringify(announcements);
  if (annKey !== lastRenderedAnnouncementsKey) {
    lastRenderedAnnouncementsKey = annKey;
    const text = announcements.length > 0
      ? announcements.join('　　✦　　')
      : '歡迎蒞臨 is Meya 官方形象網站';
    MarqueeRunner.start(text);
  }

  const products = data.products || [];
  const prodKey = JSON.stringify(products);
  if (prodKey !== lastRenderedProductsKey) {
    lastRenderedProductsKey = prodKey;
    allPublishedProducts = products.map((p, idx) => ({ ...p, _origIdx: idx }));
    detectCategoryKey();
    renderCategoryTree();
    renderFilteredProducts(true);
  }
}

async function initProductsPage() {
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
    console.error('[is Meya] 所有商品頁連線診斷：', error);
    if (!hasLocalCache) {
      MarqueeRunner.start('is Meya 韓國精品服飾・純銀飾品');
      document.getElementById('shop-result-summary').textContent = '目前尚未連線至商品資料庫，歡迎聯繫官方門市洽詢';
      document.getElementById('shop-product-grid').innerHTML =
        '<p style="grid-column: 1 / -1; text-align: center; color: #888; padding: 52px 0; font-size: 14px;">商品型錄準備中，歡迎直接聯繫官方門市洽詢。</p>';
    }
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

// ================= 左側多層分類樹（支援「飾品/耳環」自動分層展開） =================

function detectCategoryKey() {
  detectedCategoryKey = null;
  for (let i = 0; i < allPublishedProducts.length; i++) {
    const keys = Object.keys(allPublishedProducts[i]);
    const hit = keys.find(k => ['分類', '類別', '系列', 'category', 'type'].includes(k.toLowerCase()));
    if (hit) {
      detectedCategoryKey = hit;
      break;
    }
  }
}

function buildCategoryTreeData() {
  const map = new Map(); // parent -> { count, children: Map(child -> count) }

  allPublishedProducts.forEach(p => {
    const raw = detectedCategoryKey ? p[detectedCategoryKey] : '';
    const { parent, child } = parseCategoryParts(raw);
    if (!parent) return;

    if (!map.has(parent)) {
      map.set(parent, { count: 0, children: new Map() });
    }
    const group = map.get(parent);
    group.count++;
    if (child) {
      group.children.set(child, (group.children.get(child) || 0) + 1);
      // 首次載入預設展開有子分類的群組
      if (expandedParentSet.size === 0) expandedParentSet.add(parent);
    }
  });

  return map;
}

function renderCategoryTree() {
  const container = document.getElementById('shop-category-tree');
  if (!container) return;

  const treeMap = buildCategoryTreeData();
  container.textContent = '';

  // 1. 全部商品頂部項目
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'cat-parent-btn' + (activeParentCat === 'ALL' ? ' active' : '');
  const allLeft = document.createElement('span');
  allLeft.textContent = `› 全部商品 (${allPublishedProducts.length})`;
  allBtn.appendChild(allLeft);
  allBtn.addEventListener('click', () => {
    activeParentCat = 'ALL';
    activeChildCat = '';
    onCategorySelected();
  });
  container.appendChild(allBtn);

  // 2. 各主分類與可收合子分類
  treeMap.forEach((group, parentName) => {
    const hasChildren = group.children.size > 0;
    const isExpanded = expandedParentSet.has(parentName);
    const isParentActive = activeParentCat === parentName && !activeChildCat;

    const groupEl = document.createElement('div');
    groupEl.className = 'cat-group' + (isExpanded ? ' expanded' : '');

    const row = document.createElement('div');
    row.className = 'cat-parent-row';

    const parentBtn = document.createElement('button');
    parentBtn.type = 'button';
    parentBtn.className = 'cat-parent-btn' + (isParentActive ? ' active' : '');
    parentBtn.textContent = `› ${parentName} (${group.count})`;
    parentBtn.addEventListener('click', () => {
      activeParentCat = parentName;
      activeChildCat = '';
      if (hasChildren) expandedParentSet.add(parentName);
      onCategorySelected();
    });
    row.appendChild(parentBtn);

    if (hasChildren) {
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'cat-expand-btn';
      toggleBtn.setAttribute('aria-label', isExpanded ? '收合子分類' : '展開子分類');
      toggleBtn.textContent = isExpanded ? '⌃' : '⌄';
      toggleBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (expandedParentSet.has(parentName)) expandedParentSet.delete(parentName);
        else expandedParentSet.add(parentName);
        renderCategoryTree();
      });
      row.appendChild(toggleBtn);
    }

    groupEl.appendChild(row);

    if (hasChildren) {
      const childWrap = document.createElement('div');
      childWrap.className = 'cat-children';
      group.children.forEach((childCount, childName) => {
        const isChildActive = activeParentCat === parentName && activeChildCat === childName;
        const cBtn = document.createElement('button');
        cBtn.type = 'button';
        cBtn.className = 'cat-child-btn' + (isChildActive ? ' active' : '');
        cBtn.textContent = `› ${childName} (${childCount})`;
        cBtn.addEventListener('click', () => {
          activeParentCat = parentName;
          activeChildCat = childName;
          expandedParentSet.add(parentName);
          onCategorySelected();
        });
        childWrap.appendChild(cBtn);
      });
      groupEl.appendChild(childWrap);
    }

    container.appendChild(groupEl);
  });
}

function onCategorySelected() {
  renderCategoryTree();
  renderFilteredProducts(true);

  // 更新麵包屑與手機分類按鈕標題
  const displayLabel = activeParentCat === 'ALL'
    ? '商品'
    : (activeChildCat ? `${activeParentCat} / ${activeChildCat}` : activeParentCat);

  const pageTitle = document.getElementById('shop-page-title');
  const bcCurrent = document.getElementById('shop-breadcrumb-current');
  const mobileLabel = document.getElementById('mobile-cat-current');
  if (pageTitle) pageTitle.textContent = activeParentCat === 'ALL' ? '商品' : (activeChildCat || activeParentCat);
  if (bcCurrent) bcCurrent.textContent = displayLabel;
  if (mobileLabel) mobileLabel.textContent = activeParentCat === 'ALL' ? '全部商品' : (activeChildCat || activeParentCat);

  // 手機選完分類後自動收合抽屜
  const sidebar = document.getElementById('shop-sidebar');
  const toggleBtn = document.getElementById('btn-mobile-cat-toggle');
  if (sidebar && sidebar.classList.contains('mobile-open')) {
    sidebar.classList.remove('mobile-open');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
  }
}

// ================= 篩選、排序與 48 件分頁渲染 =================

function getFilteredAndSortedProducts() {
  const keyword = (document.getElementById('search-input').value || '').trim().toLowerCase();

  const filtered = allPublishedProducts.filter(p => {
    if (activeParentCat !== 'ALL') {
      const rawCat = detectedCategoryKey ? p[detectedCategoryKey] : '';
      const { parent, child } = parseCategoryParts(rawCat);
      if (parent !== activeParentCat) return false;
      if (activeChildCat && child !== activeChildCat) return false;
    }

    if (!keyword) return true;
    return Object.keys(p)
      .filter(k => k !== 'image' && k !== 'images' && k !== '_origIdx')
      .some(k => String(p[k] || '').toLowerCase().includes(keyword));
  });

  const sorted = filtered.slice();
  if (activeSort === 'price-asc' || activeSort === 'price-desc') {
    sorted.sort((a, b) => {
      const pa = parseValidPrice(a.price);
      const pb = parseValidPrice(b.price);
      // 無售價（0 元洽詢）固定排在最後，絕不混進最低價或最高價
      if (pa <= 0 && pb <= 0) return a._origIdx - b._origIdx;
      if (pa <= 0) return 1;
      if (pb <= 0) return -1;
      return activeSort === 'price-asc' ? (pa - pb) : (pb - pa);
    });
  } else {
    sorted.sort((a, b) => a._origIdx - b._origIdx);
  }

  return sorted;
}

function renderFilteredProducts(resetPage = false) {
  if (resetPage) currentPage = 1;

  const fullList = getFilteredAndSortedProducts();
  const totalItems = fullList.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const pageItems = fullList.slice(startIdx, startIdx + PAGE_SIZE);

  const summaryEl = document.getElementById('shop-result-summary');
  if (summaryEl) {
    if (totalItems === 0) {
      summaryEl.textContent = '共 0 件商品';
    } else {
      const endNo = Math.min(totalItems, startIdx + PAGE_SIZE);
      summaryEl.textContent = `顯示第 ${startIdx + 1}–${endNo} 件，共 ${totalItems} 件商品`;
    }
  }

  const grid = document.getElementById('shop-product-grid');
  grid.textContent = '';

  if (pageItems.length === 0) {
    const emptyP = document.createElement('p');
    emptyP.style.cssText = 'grid-column: 1 / -1; text-align: center; color: #888; padding: 56px 0; font-size: 14px;';
    emptyP.textContent = '目前此分類或關鍵字尚無符合商品，歡迎切換分類或聯繫官方 LINE 洽詢。';
    grid.appendChild(emptyP);
    renderPagination(0, 1);
    return;
  }

  pageItems.forEach((product, idx) => {
    const card = document.createElement('div');
    card.className = 'product-item';
    card.addEventListener('click', () => openProductModal(product));

    const imgWrap = document.createElement('div');
    imgWrap.className = 'product-img-wrap';

    const img = document.createElement('img');
    img.src = formatCdnImageUrl(product.image, 480);
    img.alt = product.name || '';
    img.decoding = 'async';
    if (idx < 8) img.fetchPriority = 'high';
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

  renderPagination(totalItems, totalPages);
}

function renderPagination(totalItems, totalPages) {
  const nav = document.getElementById('shop-pagination');
  if (!nav) return;
  nav.textContent = '';

  if (totalItems === 0 || totalPages <= 1) return;

  const goToPage = page => {
    if (page < 1 || page > totalPages || page === currentPage) return;
    currentPage = page;
    renderFilteredProducts(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const makeBtn = (label, targetPage, isActive, isDisabled, ariaLabel) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'page-btn' + (isActive ? ' active' : '');
    btn.textContent = label;
    if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
    btn.disabled = isDisabled;
    if (!isDisabled) btn.addEventListener('click', () => goToPage(targetPage));
    return btn;
  };

  nav.appendChild(makeBtn('«', currentPage - 1, false, currentPage <= 1, '上一頁'));

  // 智慧頁碼視窗（頁數過多時自動以 … 收合）
  const pages = [];
  if (totalPages <= 9) {
    for (let p = 1; p <= totalPages; p++) pages.push(p);
  } else {
    pages.push(1);
    const start = Math.max(2, currentPage - 2);
    const end = Math.min(totalPages - 1, currentPage + 2);
    if (start > 2) pages.push('...');
    for (let p = start; p <= end; p++) pages.push(p);
    if (end < totalPages - 1) pages.push('...');
    pages.push(totalPages);
  }

  pages.forEach(p => {
    if (p === '...') {
      const span = document.createElement('span');
      span.className = 'page-ellipsis';
      span.textContent = '…';
      nav.appendChild(span);
    } else {
      nav.appendChild(makeBtn(String(p), p, p === currentPage, false, `第 ${p} 頁`));
    }
  });

  nav.appendChild(makeBtn('»', currentPage + 1, false, currentPage >= totalPages, '下一頁'));
}

// ================= 商品詳情彈窗與圖庫 =================

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
  const hiddenKeys = new Set(['id', 'name', 'price', 'image', 'images', '狀態', '_origIdx']);
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

// ================= 事件綁定 =================

function bindEvents() {
  const drawer = document.getElementById('search-bar-drawer');
  const searchInput = document.getElementById('search-input');

  document.getElementById('btn-search-toggle').addEventListener('click', () => {
    drawer.classList.toggle('open');
    if (drawer.classList.contains('open')) searchInput.focus();
  });

  document.getElementById('btn-search-close').addEventListener('click', () => {
    searchInput.value = '';
    drawer.classList.remove('open');
    renderFilteredProducts(true);
  });

  searchInput.addEventListener('input', () => renderFilteredProducts(true));

  // 排序按鈕
  document.querySelectorAll('#shop-sort-bar .shop-sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeSort = btn.dataset.sort || 'default';
      document.querySelectorAll('#shop-sort-bar .shop-sort-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderFilteredProducts(true);
    });
  });

  // 手機分類抽屜開關
  const mobileCatBtn = document.getElementById('btn-mobile-cat-toggle');
  const sidebar = document.getElementById('shop-sidebar');
  if (mobileCatBtn && sidebar) {
    mobileCatBtn.addEventListener('click', () => {
      const open = sidebar.classList.toggle('mobile-open');
      mobileCatBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // 本頁聯絡我們平滑捲動
  document.querySelectorAll('[data-scroll-target]').forEach(link => {
    link.addEventListener('click', e => {
      const targetId = link.getAttribute('data-scroll-target');
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        e.preventDefault();
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
  prodBackdrop.addEventListener('click', e => {
    if (e.target === prodBackdrop) {
      FrontLightbox.close();
      prodBackdrop.classList.remove('open');
    }
  });
}
