// ==========================================
// 系統初始化與 API 對接
// ==========================================
const GAS_API_URL = "YOUR_GAS_WEB_APP_URL_HERE"; // 請貼上您的 Web App 網址

document.addEventListener("DOMContentLoaded", () => {
    fetchStoreData();
});

async function fetchStoreData() {
    try {
        const response = await fetch(GAS_API_URL);
        const data = await response.json();
        
        // 資料載入成功，解除骨架屏，顯示主內容
        document.getElementById('loader').style.display = 'none';
        document.getElementById('app-content').style.display = 'block';
        document.body.classList.remove('loading-state');

        // 第一道防線：執行全域設定 (判斷是否顯示購物車)
        applyConfig(data.config);
        
        // 第二道防線：渲染商品資料
        renderProducts(data.products);

    } catch (error) {
        console.error("系統讀取失敗：", error);
        document.getElementById('loader').innerHTML = "<p>資料讀取異常，請稍後再試。</p>";
    }
}

// 根據後端傳來的布林值，一鍵操控整站版面狀態
function applyConfig(config) {
    if (config.cart_enabled === false) {
        // 為 body 加上 class，CSS 會自動把所有結帳相關按鈕與 Icon 隱藏
        document.body.classList.add('cart-disabled');
    }
    
    if (config.free_shipping) {
        document.getElementById('free-shipping-text').textContent = 
            `全館滿 NT$${config.free_shipping} 享免運服務。`;
    }
}

// 動態組裝 HTML (安全渲染)
function renderProducts(products) {
    const grid = document.getElementById('product-grid');
    grid.innerHTML = ''; // 清空預設內容

    products.forEach(p => {
        // 利用 Template Literals 組裝組件
        const cardHTML = `
            <div class="product-card">
                <img src="${p['主圖網址']}" alt="${p['商品名稱']}" class="product-image">
                <span class="product-tag">${p['狀態標籤']}</span>
                <h3 class="product-title">${p['商品名稱']}</h3>
                <div class="product-price">NT$ ${p['售價']}</div>
                <button class="btn-add-to-cart">加入購物車</button>
            </div>
        `;
        grid.innerHTML += cardHTML;
    });
}
