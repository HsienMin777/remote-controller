// ==========================================
// 🌟 共用頂部 Header（OfferDash 標題列）
// 每個獨立頁面 (index.html / dashboard.html / calendar.html) 只需放一個
// <div id="appHeader"></div> 佔位，並載入這支腳本，就會自動注入一致的 header。
// 漢堡選單按鈕呼叫的 toggleSidebar() 由各頁面自行定義（因為每頁的 sidebar 結構相同但實例不同）。
// 🔥 Logo 點擊：全站任何頁面點擊左上角「OfferDash」都會跳回登入後總覽主頁
// （與登入成功後的預設導向頁一致，見 auth.js 的 handleAuth()）。
// 🌟 Edge-to-Edge 版面：header 固定在整個視窗頂端（position:fixed + left:0 + width:100%），
// 不受側邊欄／內容欄寬度影響，毛玻璃背景讓底下頁面內容捲動時透出來。
// 每個頁面自己的 <style> 裡的 header{} 規則負責統一高度（72px），並在 .main-content
// 加上對應的 padding-top: 96px，把被拿出文件流的 header 空間補回去，避免內容被蓋住。
// ==========================================
(function renderAppHeader() {
    const mount = document.getElementById('appHeader');
    if (!mount) return;

    mount.outerHTML = `
        <header style="position: fixed; top: 0; left: 0; width: 100%; z-index: 50; background: var(--glass-bg); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-bottom: 1px solid var(--glass-border); display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 16px;">
                <button id="sidebarToggle" onclick="toggleSidebar()"
                    style="background: transparent; border: none; color: var(--text-main); font-size: 24px; cursor: pointer; padding: 4px 8px; border-radius: 4px; transition: background 0.2s;">
                    ☰
                </button>
                <div class="logo" style="margin: 0; cursor: pointer;" onclick="window.location.href='/frontend/pages/overview.html'">
                    <div class="logo-icon">O</div>
                    OfferDash
                </div>
            </div>
        </header>
    `;
})();
