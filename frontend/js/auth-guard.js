// ==========================================
// 🛡️ 全域路由防護 (Auth Guard)
// 必須放在每個頁面 <head> 裡，緊接在 Supabase CDN + auth.js 之後同步載入
// （不可加 defer/async）——寫法比照 theme-init.js：在瀏覽器畫出任何內容之前
// 就做完登入狀態判斷，避免「受保護頁面」內容閃一下才被導走 (anti-FOUC)。
//
// 這支腳本是既有機制的集中版，不是取代：checkAuthStatus()/checkAuthStatusSoft()
// (auth.js) 與 shared-sidebar.js 的鎖定機制都維持原樣繼續運作，這裡只是把「頁面級」
// 的導頁決策提早、集中處理，並新增登入頁反向導頁、redirect 參數、401 自動登出。
// ==========================================
(function () {
    // 立即隱藏 body，直到這裡判斷完「要不要導頁」才顯示，避免受保護頁面內容閃現
    const hideStyle = document.createElement('style');
    hideStyle.id = 'authGuardHideStyle';
    hideStyle.textContent = 'body { visibility: hidden; }';
    document.head.appendChild(hideStyle);

    function revealBody() {
        const style = document.getElementById('authGuardHideStyle');
        if (style) style.remove();
    }

    // 只用檔名判斷目前在哪一頁：不管是 Render 的 /frontend/pages/xxx.html
    // 還是 Vercel 的 /pages/xxx.html，檔名永遠一致，不需要處理部署路徑差異
    function currentPageName() {
        return window.location.pathname.split('/').pop() || 'index.html';
    }

    // 需要登入才能進入的頁面（未登入會被導回登入頁）；其餘頁面一律視為訪客可瀏覽
    const PROTECTED_PAGES = ['dashboard.html', 'settings.html', 'calendar.html', 'resume_records.html', 'consultant.html'];

    function buildLoginRedirectUrl() {
        const target = `${currentPageName()}${window.location.search}`;
        return `../index.html?redirect=${encodeURIComponent(target)}`;
    }

    async function runGuard() {
        // 這支腳本必須排在 auth.js 之後載入才會有 supabaseClient；萬一順序不對，
        // 寧可讓頁面照常顯示（退回舊有的 checkAuthStatus() 機制），也不要整頁卡死在隱藏狀態
        if (typeof supabaseClient === 'undefined') {
            revealBody();
            return;
        }

        let session = null;
        try {
            const result = await supabaseClient.auth.getSession();
            session = result.data.session;
        } catch (error) {
            console.error('Auth Guard 讀取登入狀態失敗:', error);
        }

        const page = currentPageName();
        // 🔥 訪客瀏覽模式旗標（見 auth.js）優先於「有沒有 session」：只要使用者是從
        // 強制訪客版首頁進站或剛登出，即使背景還留著一個沒過期的 session，也要當作
        // 未登入處理，直到使用者真正透過登入表單/Google 登入成功為止。
        const guestMode = typeof isGuestMode === 'function' && isGuestMode();
        const effectivelyLoggedIn = !!session && !guestMode;

        if (page === 'index.html') {
            // 登入頁：只要偵測到 session 就代表登入真的成功了（不論是帳密表單、Google
            // OAuth 導回這頁、或直接帶著有效 session 訪問這頁），一律清掉訪客旗標並放行，
            // 這裡刻意不看 guestMode——否則 Google OAuth 導回這頁時，
            // 訪客旗標若還沒被非同步的 onAuthStateChange 清掉，就會卡在登入頁出不去。
            if (session) {
                if (typeof exitGuestMode === 'function') exitGuestMode();
                const params = new URLSearchParams(window.location.search);
                const redirect = params.get('redirect');
                window.location.replace(redirect ? `pages/${redirect}` : 'pages/overview.html');
                return;
            }
            revealBody();
            return;
        }

        if (PROTECTED_PAGES.includes(page) && !effectivelyLoggedIn) {
            window.location.replace(buildLoginRedirectUrl());
            return;
        }

        revealBody();
    }

    runGuard();

    // ==========================================
    // 🔥 401 自動登出：共用的 fetch 封裝，取代各頁面手動組 headers + 各自處理錯誤。
    // 收到 401 代表 token 已過期/被撤銷，直接登出並帶著 redirect 導回登入頁，
    // 而不是讓使用者看到一個語意不明的「讀取失敗」。
    // ==========================================
    window.authFetch = async function (url, options = {}) {
        const authHeaders = await getAuthHeaders();
        const response = await fetch(url, {
            ...options,
            headers: { ...(options.headers || {}), ...authHeaders }
        });

        if (response.status === 401) {
            try {
                await supabaseClient.auth.signOut();
            } catch (error) {
                console.error('401 自動登出失敗:', error);
            }
            window.location.href = buildLoginRedirectUrl();
        }

        return response;
    };
})();
