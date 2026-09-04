
const supabaseUrl = 'https://fkekdvojbfxacognlhqt.supabase.co';
const supabaseKey = 'sb_publishable_UjNF38cuN4kKP2O6hhAWjg_KLI0zztB';

// 🔥 關鍵修正：改用 supabaseClient，避免跟官方套件撞名！
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

// ==========================================
// 🔒 訪客瀏覽模式旗標（將「登出/訪客」與「登入」兩套體驗完全隔開）
// 問題：Supabase 的 session 只要沒過期就會一直存在瀏覽器裡，若各頁面只單純檢查
// 「有沒有 session」，使用者從強制訪客版的首頁 (?guest=1) 點進其他頁面時，
// 背景那個還沒過期的 session 就會讓那些頁面誤判成「已登入」，UI 忽登忽出。
// 用 sessionStorage 存一個「目前是訪客瀏覽模式」的旗標，讓這個狀態能跨頁面延續，
// 不再單靠 session 是否存在來決定 UI——只有真正透過登入表單/Google 登入成功，
// 才會清除這個旗標，兩套體驗才會確實切換。
// sessionStorage（而非 localStorage）是刻意選擇：只在同一個分頁的瀏覽期間有效，
// 分頁關掉或開新分頁都會重新從「未設定」開始，不會永久卡住。
// ==========================================
const GUEST_MODE_KEY = 'offerdash_guest_mode';

window.enterGuestMode = function () {
    try { sessionStorage.setItem(GUEST_MODE_KEY, '1'); } catch (error) { /* 私密瀏覽模式等情境可能無法存取，忽略即可 */ }
};

window.exitGuestMode = function () {
    try { sessionStorage.removeItem(GUEST_MODE_KEY); } catch (error) { /* 同上 */ }
};

window.isGuestMode = function () {
    try { return sessionStorage.getItem(GUEST_MODE_KEY) === '1'; } catch (error) { return false; }
};

// 保險機制：只處理 SIGNED_OUT，不處理 SIGNED_IN。
// 🔥 原本想連 SIGNED_IN 也一併處理（涵蓋 Google OAuth 沒有專屬成功 callback 的情況），
// 但實測發現：只要背景還有沒過期的 session，「每一次」頁面載入（包括單純點側邊欄
// 導覽到別頁）都會觸發 SIGNED_IN，而不是只有「真的剛登入」才觸發——結果變成每換一頁
// 就把訪客旗標清掉一次，訪客模式完全無法持續。Google OAuth 登入完成的情況已經由
// auth-guard.js 在登入頁偵測到 session 時處理，不需要靠這裡的 SIGNED_IN 事件。
// SIGNED_OUT 則沒有這個問題（不會被「單純還有 session」誤觸發），繼續保留當作保險。
supabaseClient.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') enterGuestMode();
});

let isLoginMode = true;

function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    const title = document.getElementById('formTitle');
    const subtitle = document.getElementById('formSubtitle');
    const btn = document.getElementById('submitBtn');
    const toggle = document.getElementById('toggleMode');
    const errorBox = document.getElementById('authError');

    if (errorBox) errorBox.style.display = 'none';

    if (isLoginMode) {
        title.innerText = '登入系統';
        subtitle.innerText = '存取您的 AI 面試分析資料庫';
        btn.innerText = '登入';
        toggle.innerText = '還沒有帳號？點此註冊';
    } else {
        title.innerText = '註冊新帳號';
        subtitle.innerText = '建立專屬面試檔案';
        btn.innerText = '註冊';
        toggle.innerText = '已有帳號？點此登入';
    }
}

async function handleAuth(event) {
    event.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const btn = document.getElementById('submitBtn');
    const errorBox = document.getElementById('authError');

    btn.disabled = true;
    btn.innerText = '處理中...';
    errorBox.style.display = 'none';

    try {
        let error = null;
        let data = null;

        if (isLoginMode) {
            // 登入：使用 supabaseClient
            const response = await supabaseClient.auth.signInWithPassword({
                email: email,
                password: password,
            });
            error = response.error;
            data = response.data;
        } else {
            // 註冊：使用 supabaseClient
            const response = await supabaseClient.auth.signUp({
                email: email,
                password: password,
            });
            error = response.error;
            data = response.data;
            
            if (!error && data.user && data.user.identities && data.user.identities.length === 0) {
                 alert("這個信箱已經被註冊過囉！");
                 resetBtn();
                 return;
            }
        }

        if (error) throw error;

        // 真正完成登入：解除訪客瀏覽模式，之後各頁面才會照實際 session 顯示登入後內容
        exitGuestMode();

        // 成功後跳轉：優先導回使用者原本想去的受保護頁面 (?redirect=xxx.html，
        // 由 auth-guard.js 的 buildLoginRedirectUrl() 帶過來)，沒有就回登入後總覽主頁
        // 🔥 用相對路徑：這支函式只會在 frontend/index.html (登入頁，深度 0) 上執行，
        //    才能同時在 Render (/frontend/...) 與 Vercel (直接掛在網域根目錄) 上正確導向
        const redirectTarget = new URLSearchParams(window.location.search).get('redirect');
        window.location.href = redirectTarget ? `./pages/${redirectTarget}` : './pages/overview.html';

    } catch (err) {
        console.error('Auth Error:', err);
        errorBox.innerText = err.message || '發生錯誤，請檢查帳號密碼。';
        errorBox.style.display = 'block';
    } finally {
        resetBtn();
    }
}

function resetBtn() {
    const btn = document.getElementById('submitBtn');
    btn.disabled = false;
    btn.innerText = isLoginMode ? '登入' : '註冊';
}

// 權限檢查 (Auth Guard)
// 🔥 用相對路徑 (../index.html)：checkAuthStatus/logout 只會被 frontend/pages/*.html
//    (深度 1) 呼叫，同一層級的相對路徑才能在 Render (/frontend/pages/...) 與
//    Vercel (/pages/...，網站根目錄直接對應 frontend/) 兩種掛載方式下都正確導回登入頁
window.checkAuthStatus = async function() {
    // 檢查登入狀態：使用 supabaseClient
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (!session) {
        window.location.href = '../index.html';
        return null;
    }
    return session.user;
}

// 🔥 不強制導頁的版本：模擬面試 (interview.html) 與面試戰場 (interview_arena.html)
//    這兩項功能對應的後端路由本來就不需要登入即可呼叫，開放訪客也能直接試用；
//    只有「儲存紀錄」這類明確需要帳號的動作，才會在各自呼叫處另外處理沒有 session 的情況。
window.checkAuthStatusSoft = async function() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return session?.user || null;
}

// 登出功能
// 🔥 登出後導向 overview.html（而非登入頁）：該頁現在是訪客也能瀏覽的頁面殼，
//    未登入時會自動鎖定需要帳號的功能（見 auth-guard.js 的 window.applyGuestLockUI()）。
//    同時進入訪客瀏覽模式，確保之後導覽到其他頁面也持續顯示訪客版，不會被背景可能
//    還沒失效的 session 誤判成已登入。
window.logout = async function() {
    try {
        console.log("正在執行登出...");
        // 登出：使用 supabaseClient
        await supabaseClient.auth.signOut();
        enterGuestMode();
        window.location.href = 'overview.html';
    } catch (err) {
        console.error("登出失敗:", err);
        alert("登出發生錯誤：" + err.message);
    }
}

// 共用：取得帶有登入 Token 的請求標頭，供各頁面呼叫後端受保護的 API 使用
window.getAuthHeaders = async function() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return { 'Authorization': `Bearer ${session?.access_token}` };
}

document.addEventListener('DOMContentLoaded', () => {
    const googleLoginBtn = document.getElementById('googleLoginBtn');
    
    // 確保當前頁面有 Google 登入按鈕（避免在非登入頁面報錯）
    if (googleLoginBtn) {
        googleLoginBtn.addEventListener('click', async () => {
            try {
                // 使用我們建立好的 supabaseClient 實例
                const { data, error } = await supabaseClient.auth.signInWithOAuth({
                    provider: 'google',
                });
                
                if (error) {
                    console.error("Google 登入失敗：", error.message);
                    alert("登入失敗：" + error.message);
                }
            } catch (err) {
                console.error("執行 Google 登入時發生錯誤：", err);
                alert("系統發生未預期的錯誤，請稍後再試。");
            }
        });
    }
});