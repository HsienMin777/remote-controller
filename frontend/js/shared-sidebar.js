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
            <div class="menu-item" onclick="logout()">
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
