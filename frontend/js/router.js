// ==========================================
// 🌍 全域智慧導航 (Smart Global Router) - 統一主控台版
// ==========================================

/**
 * [上線設定] 網站根目錄路徑
 * - 如果直接部署在網域根目錄 (例如 https://yourdomain.com/) -> 保持空字串 '' 即可。
 * - 如果部署在子資料夾 (例如 https://yourdomain.com/my-app/) -> 請設定為 '/my-app'。
 */
const BASE_PATH = '';

// 這些功能是「獨立實體頁面」，沒有對應的 view-xxx 區塊，必須真正跳轉網址
// 其餘功能 (interview / jd / report) 一律視為首頁內部分頁，交給 switchFeature() 切換
const EXTERNAL_PAGES = {
    dashboard: 'frontend/pages/dashboard.html',
    calendar: 'frontend/pages/calendar.html',
};

// 判斷路徑是否為首頁 (相容有無帶 index.html 的狀況)
function isHomePath(path) {
    const p = path.toLowerCase();
    return p.endsWith('/') || p.endsWith('/index.html') || p === BASE_PATH.toLowerCase() || p === `${BASE_PATH}/`.toLowerCase();
}

function navigateTo(feature) {
    // 轉換為小寫防呆
    const targetFeature = feature.toLowerCase();
    const path = window.location.pathname;

    // ==========================================
    // 情況 A：目標是獨立實體頁面 (例如 dashboard)
    // ==========================================
    const externalPage = EXTERNAL_PAGES[targetFeature];
    if (externalPage) {
        const alreadyOnTargetPage = path.toLowerCase().endsWith(externalPage.toLowerCase());
        if (alreadyOnTargetPage) {
            // 已經在目標頁面上了，交給該頁自己的 switchFeature 處理高亮，不需要重新整理
            if (typeof switchFeature === 'function') switchFeature(targetFeature);
        } else {
            window.location.href = `${BASE_PATH}/${externalPage}`;
        }
        return;
    }

    // ==========================================
    // 情況 B：目標是首頁內部分頁 (interview / jd / calendar / report)
    // ==========================================
    const isAlreadyAtHome = isHomePath(path);
    if (isAlreadyAtHome) {
        // 人已經在首頁了，直接觸發前端無縫切換
        if (typeof switchFeature === 'function') {
            switchFeature(targetFeature);
        } else {
            // 防呆：如果首頁尚未初始化完成，直接改網址重新整理
            executeRedirect(targetFeature);
        }
    } else {
        // 人在登入頁或其他獨立子網頁，精準跳回首頁並帶上功能參數
        executeRedirect(targetFeature);
    }
}

/**
 * 輔助跳轉函式：處理網址參數
 */
function executeRedirect(targetFeature) {
    if (targetFeature === 'interview') {
        // 回首頁且預設就是面試，不需要帶任何參數，保持網址最乾淨
        window.location.href = `${BASE_PATH}/frontend/pages/index.html`;
    } else {
        // 其他功能（calendar, jd, dashboard）精準帶上參數
        window.location.href = `${BASE_PATH}/frontend/pages/index.html?feature=${targetFeature}`;
    }
}

// ==========================================
// 🏠 首頁載入自動解析 Feature 機制
// ==========================================
// 🔥 關鍵修正：這個函式「不」再自己掛 DOMContentLoaded 監聽器自動執行。
//
// 原本這裡跟 app.js 各自獨立監聽 DOMContentLoaded，兩邊誰先跑完全依賴瀏覽器對
// document/window 事件派發順序的隱性假設——理論上 app.js（掛在 document）會先跑、
// 中途 await 讓出控制權後 router.js（掛在 window）才接著跑，但這是「假設瀏覽器行為」，
// 不是「保證的執行順序」，換瀏覽器/換版本都可能不成立，非常脆弱難以除錯。
//
// 面試戰場結束後會帶著 ?feature=interview 導回首頁，同時把復盤報告存進 sessionStorage
// 交給 app.js 的 restorePendingInterviewReportIfAny() 顯示。如果這裡照常執行
// switchFeature('interview')，會搶著把畫面切回「進行模擬面試」並強制隱藏 reportCard。
//
// 現在改成：app.js 的 DOMContentLoaded handler 依序執行完
// restorePendingInterviewReportIfAny()（並知道自己有沒有真的還原了報告）之後，
// 「明確地」呼叫這個函式、並告知是否已還原報告——順序由單一地方決定，不再是兩支
// 各自猜測時序的獨立監聽器。
function autoResolveHomeFeatureFromURL(options = {}) {
    const { reportAlreadyRestored = false } = options;

    if (!isHomePath(window.location.pathname)) return;
    if (reportAlreadyRestored) return; // app.js 已經還原並顯示報告了，這裡絕對不能再搶著切畫面

    const params = new URLSearchParams(window.location.search);
    const feature = (params.get('feature') || 'interview').toLowerCase(); // 預設顯示 interview

    // 萬一網址帶的是獨立頁面的 feature (例如 ?feature=dashboard)，首頁沒有對應區塊可切換，直接導過去
    const externalPage = EXTERNAL_PAGES[feature];
    if (externalPage) {
        window.location.replace(`${BASE_PATH}/${externalPage}`);
        return;
    }

    if (typeof switchFeature === 'function') {
        switchFeature(feature, { updateHistory: false });
    }
}