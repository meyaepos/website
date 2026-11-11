document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

// 初始化應用程式
async function initApp() {
    try {
        // 假設這是一個測試用的假資料 URL，開發時可先用這個測試版面
        // 實際佈署時，將改用 fetch(CONFIG.GAS_API_URL)
        const mockData = await mockGasResponse(); 
        
        // 渲染畫面
        renderConfig(mockData.config);
        renderNavigation(mockData.navigation);
        renderProducts(mockData.products);

    } catch (error) {
        console.error("資料載入失敗:", error);
        document.getElementById('product-grid').innerHTML = '<p>資料載入異常，請稍後再試。</p>';
    }
}

// 根據設定渲染全域狀態
function renderConfig(config) {
    // 1. 處理購物車開關狀態
    if (config.cart_enabled === false) {
        document.body.classList.add('cart-disabled');
    }

    // 2. 處理免運文字替換
    if (config.free_shipping) {
        const shippingText = document.getElementById('free-shipping-text');
        shippingText.textContent = config.free_shipping;
    }
}

// 渲染導覽列
function renderNavigation(navItems) {
    const navContainer = document.getElementById('main-nav');
    navContainer.innerHTML = ''; // 清空預設內容

    navItems.forEach(item => {
        const link = document.createElement('a');
        link.href = item.url;
        link.textContent = item.title;
        navContainer.appendChild(link);
    });
}

// 渲染商品列表
function renderProducts(products) {
    const gridContainer = document.getElementById('product-grid');
    gridContainer.innerHTML = ''; // 移除原本的載入中骨架屏 (loading-state)

    products.forEach(product => {
        // 建立商品卡片容器
        const card = document.createElement('div');
        card.className = 'product-card';

        // 插入商品圖片與資訊
        card.innerHTML = `
            <img src="${product.image}" alt="${product.name}" class="product-image">
            <div class="product-info">
                <h3>${product.name}</h3>
                <p>NT$ ${product.price}</p>
                <button class="btn-add-to-cart">加入購物車</button>
            </div>
        `;
        gridContainer.appendChild(card);
    });
}

// --- 模擬 GAS 回傳資料的函式 (方便你在還沒寫好 GAS 前，就能預覽畫面) ---
function mockGasResponse() {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve({
                config: {
                    cart_enabled: true, // 試著改成 false 看看購物車會不會消失
                    free_shipping: "全館滿 NT$2,000 享免運"
                },
                navigation: [
                    { title: "首頁", url: "#" },
                    { title: "所有商品", url: "#" },
                    { title: "品牌故事", url: "#" }
                ],
                products: [
                    { id: 1, name: "極簡奶茶色短版上衣", price: "890", image: "https://via.placeholder.com/250x250/D9D2C5/333333?text=Item+1" },
                    { id: 2, name: "質感垂墜寬褲", price: "1280", image: "https://via.placeholder.com/250x250/D9D2C5/333333?text=Item+2" },
                    { id: 3, name: "法式優雅百褶裙", price: "1050", image: "https://via.placeholder.com/250x250/D9D2C5/333333?text=Item+3" },
                    { id: 4, name: "簡約皮革肩背包", price: "1580", image: "https://via.placeholder.com/250x250/D9D2C5/333333?text=Item+4" }
                ]
            });
        }, 1500); // 延遲 1.5 秒，讓你看到 skeleton loading 的效果
    });
}
