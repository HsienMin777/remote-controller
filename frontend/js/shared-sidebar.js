// ==========================================
// 🌟 共用側邊欄（Sidebar）— 含「面試數據儀表板」二級下拉選單
// 每個獨立頁面只需放一個 <div id="appSidebar" data-active="xxx"></div> 佔位，
// data-active 可填：interview / jd / consultant / dashboard / resume-records / calendar / settings
// 並在其後載入這支腳本，即可注入一致的側邊欄 HTML/CSS 結構。
//
// 導覽邏輯不在這裡重新實作：每個主選單/子選單項目都呼叫該頁面本來就有的
// 全域 switchFeature(featureName)（已存在於 index.html / dashboard.html /
// calendar.html），由它決定「留在本頁只切換高亮」還是「導到其他頁面」。
// 這支腳本只負責注入一致的 HTML，以及子選單展開/收合的互動。
// ==========================================
(function renderAppSidebar() {
    const mount = document.getElementById('appSidebar');
    if (!mount) return;

    const active = mount.dataset.active || '';
    const isDashboardGroupActive = active === 'dashboard' || active === 'resume-records';
    const menuClass = (name) => `menu-item${active === name ? ' active' : ''}`;
    const submenuClass = (name) => `submenu-item${active === name ? ' active' : ''}`;

    mount.outerHTML = `
        <div id="sidebarOverlay" class="sidebar-overlay hidden" onclick="toggleSidebar()"></div>

        <div class="sidebar collapsed">
            <div class="sidebar-title" style="color:var(--text-main); font-size:18px; font-weight:bold; margin-bottom: 20px;">
                AI 面試生態系
            </div>
            <div id="menu-interview" class="${menuClass('interview')}" onclick="switchFeature('interview')">
                模擬面試系統
            </div>
            <div id="menu-jd" class="${menuClass('jd')}" onclick="switchFeature('jd')">
                履歷與職缺診斷
            </div>
            <div id="menu-consultant" class="${menuClass('consultant')}" onclick="switchFeature('consultant')">
                AI 面試諮詢
            </div>
            <div class="menu-item-group${isDashboardGroupActive ? ' open' : ''}">
                <div id="menu-dashboard" class="menu-item menu-item-parent${isDashboardGroupActive ? ' active' : ''}" onclick="toggleSidebarSubmenu(event, this)">
                    <span>面試數據儀表板</span>
                    <span class="submenu-arrow">▾</span>
                </div>
                <div class="submenu">
                    <div id="submenu-dashboard" class="${submenuClass('dashboard')}" onclick="switchFeature('dashboard')">面試紀錄</div>
                    <div id="submenu-resume-records" class="${submenuClass('resume-records')}" onclick="switchFeature('resume-records')">履歷上傳紀錄</div>
                </div>
            </div>
            <div id="menu-calendar" class="${menuClass('calendar')}" onclick="switchFeature('calendar')">
                行事曆
            </div>
            <div id="menu-settings" class="${menuClass('settings')}" onclick="switchFeature('settings')">
                設定
            </div>
            <div id="menu-logout" class="menu-item" onclick="logout()">
                登出
            </div>
        </div>
    `;
})();

// 點擊「面試數據儀表板」父選項時展開/收合子選單（滑鼠移入則交給 CSS :hover 處理，手機/觸控裝置靠這個 click）
function toggleSidebarSubmenu(event, el) {
    event.stopPropagation();
    const group = el.closest('.menu-item-group');
    if (group) group.classList.toggle('open');
}

// ==========================================
// 🔒 訪客封印機制（集中在共用元件處理）
// AI 面試諮詢師 / 行事曆 / 儀表板與歷史紀錄 / 設定 這 4 項功能需要帳號才有意義。
// 🔥 這裡集中判斷登入狀態並套用鎖定樣式，而不是讓每個頁面各自實作——
// 之前只在 overview.html 處理過，訪客導到 interview.html／interview_arena.html
// （這兩頁現在開放訪客直接試用）時側邊欄卻沒同步套用鎖定，看起來像「變回登入狀態」。
// 統一由這支共用腳本處理，才能確保訪客在任何一頁看到的側邊欄狀態永遠一致。
// ==========================================
const LOCKED_MENU_IDS = ['menu-consultant', 'menu-calendar', 'menu-dashboard', 'menu-settings', 'submenu-dashboard', 'submenu-resume-records'];

function ensureGuestLockStyles() {
    if (document.getElementById('guestLockStyles')) return;
    const style = document.createElement('style');
    style.id = 'guestLockStyles';
    style.textContent = `
        .locked-feature { opacity: 0.5; cursor: not-allowed; }
        .locked-feature:hover { background: transparent; color: var(--text-muted); }
        .locked-feature .submenu-arrow { display: none; }
        #guestLockedToast {
            position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%) translateY(20px);
            background: #141414; color: #FAFAFA; padding: 12px 20px; border-radius: var(--radius-md, 12px);
            font-size: 14px; font-weight: 600; box-shadow: 0 20px 50px -12px rgba(0, 0, 0, 0.4);
            opacity: 0; pointer-events: none; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            z-index: 1000; white-space: nowrap;
        }
        #guestLockedToast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
    `;
    document.head.appendChild(style);

    if (!document.getElementById('guestLockedToast')) {
        const toast = document.createElement('div');
        toast.id = 'guestLockedToast';
        document.body.appendChild(toast);
    }
}

let guestToastTimer = null;
function showGuestLockedToast() {
    const toast = document.getElementById('guestLockedToast');
    if (!toast) return;
    toast.innerText = '🔒 請先登入才能使用此功能';
    toast.classList.add('show');
    clearTimeout(guestToastTimer);
    guestToastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

function lockMenuItem(el) {
    if (!el) return;
    el.classList.add('locked-feature');
    // 直接覆蓋 onclick：不論原本是 switchFeature(...) 還是 toggleSidebarSubmenu(...)，
    // 賦值會整個取代掉，訪客點擊就只會觸發提示，不會導頁或展開子選單
    el.onclick = (event) => {
        event.stopPropagation();
        showGuestLockedToast();
    };
}

function applySidebarGuestState() {
    ensureGuestLockStyles();
    LOCKED_MENU_IDS.forEach(id => lockMenuItem(document.getElementById(id)));

    // 訪客（含剛登出）沒有「登出」的必要，側邊欄底部改顯示「登入」，點擊進 index.html 登入
    const logoutEl = document.getElementById('menu-logout');
    if (logoutEl) {
        logoutEl.innerText = '登入';
        logoutEl.onclick = () => { window.location.href = '../index.html'; };
    }
}

// 🔥 用 addEventListener('load', ...) 而不是 window.onload = ...：後者是屬性賦值，
// 若跟某頁面自己的 window.onload（例如 calender.js／interview.js／consultant.js）
// 相衝，後載入的會直接蓋掉先前的，導致該頁初始化邏輯整個失效（先前在行事曆頁就出過
// 這個問題）。addEventListener 是可疊加的監聽器，不會互相覆蓋，多支腳本可以並存。
// 等到 load 事件才判斷登入狀態，是為了確保 auth.js 的 supabaseClient 已經載入完成
// （部分頁面 shared-sidebar.js 在 auth.js 之前載入，此時 supabaseClient 還不存在）。
window.addEventListener('load', async () => {
    if (typeof supabaseClient === 'undefined') return;
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) applySidebarGuestState();
    } catch (error) {
        console.error('側邊欄登入狀態檢查失敗:', error);
    }
});
