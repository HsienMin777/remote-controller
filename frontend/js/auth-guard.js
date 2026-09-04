// ==========================================
// 🛡️ 全域路由防護 (Auth Guard)
// 必須放在每個頁面 <head> 裡，緊接在 Supabase CDN + auth.js 之後同步載入
// （不可加 defer/async）——寫法比照 theme-init.js：在瀏覽器畫出任何內容之前
// 就做完登入狀態判斷，避免「受保護頁面」內容閃一下才被導走 (anti-FOUC)。
//
// 這支腳本是既有機制的集中版，不是取代：checkAuthStatus()/checkAuthStatusSoft()
// (auth.js) 維持原樣繼續運作。這裡集中處理「頁面級」的導頁決策、redirect 參數、
// 401 自動登出，以及原本散落在 shared-sidebar.js 的訪客功能鎖定機制
// （data-requires-auth="true" 掃描，見下方 window.applyGuestLockUI()），
// 讓公開頁與應用程式內頁都能共用同一套規則。
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
    // 🔥 interview_arena.html：原本刻意開放訪客免登入試用，現在改為業界標準 SaaS
    // 路由守衛規則的一部分，一併納入保護清單
    const PROTECTED_PAGES = ['dashboard.html', 'settings.html', 'calendar.html', 'resume_records.html', 'consultant.html', 'interview_arena.html'];

    function buildLoginRedirectUrl() {
        const target = `${currentPageName()}${window.location.search}`;
        return `../index.html?redirect=${encodeURIComponent(target)}`;
    }

    // Supabase OAuth（Google 登入）導回本頁時，網址會帶 code=（PKCE flow）或
    // #access_token=（implicit flow）這類標記——用來跟「單純訪問登入頁、背景剛好還有
    // 一個沒過期的 session」區分開來，只有真的剛完成 OAuth 才無視訪客模式直接放行。
    function isOAuthCallback() {
        return window.location.hash.includes('access_token=') || new URLSearchParams(window.location.search).has('code');
    }

    async function runGuard() {
        // 🔥 ?guest=1：後端／vercel.json 把裸網址 "/" 轉址到 overview.html?guest=1，
        // 目的是「不管背景有沒有還沒過期的 session，第一次進站一律強制顯示訪客版」。
        // 必須在這裡、算 guestMode/effectivelyLoggedIn 之前就同步設定旗標——如果晚到
        // shared-sidebar.js／overview.html 自己的 load 事件才設定，會晚於下面
        // window.authGuardReady 已經算好並快取的結果，導致這次「強制訪客」的狀態沒生效。
        if (new URLSearchParams(window.location.search).get('guest') === '1' && typeof enterGuestMode === 'function') {
            enterGuestMode();
        }

        // 這支腳本必須排在 auth.js 之後載入才會有 supabaseClient；萬一順序不對，
        // 寧可讓頁面照常顯示（退回舊有的 checkAuthStatus() 機制），也不要整頁卡死在隱藏狀態
        if (typeof supabaseClient === 'undefined') {
            revealBody();
            return { session: null, effectivelyLoggedIn: false };
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
        const state = { session, effectivelyLoggedIn };

        if (page === 'index.html') {
            // 🌟 首頁獨立展示原則：index.html 本身現在也是「首頁」的一部分，不管有沒有
            // 登入，單純造訪它都「不」強制跳轉——UI 動態切換（登入表單 vs 進入控制台）
            // 交給 index.html 自己的 <script> 監聽 window.authGuardReady 處理。
            //
            // 唯一例外：剛完成 Google OAuth 導回這頁（網址帶 code=/#access_token=），
            // 這是使用者「剛剛主動觸發」的登入動作要完成，不是單純造訪，所以繼續自動
            // 導去目的地（redirect 參數或 overview.html），不算違反「不強制跳轉」原則。
            if (session && isOAuthCallback()) {
                if (typeof exitGuestMode === 'function') exitGuestMode();
                const params = new URLSearchParams(window.location.search);
                const redirect = params.get('redirect');
                window.location.replace(redirect ? `pages/${redirect}` : 'pages/overview.html');
                return state;
            }
            revealBody();
            return state;
        }

        if (PROTECTED_PAGES.includes(page) && !effectivelyLoggedIn) {
            window.location.replace(buildLoginRedirectUrl());
            return state;
        }

        revealBody();
        return state;
    }

    // 🌟 window.authGuardReady：共用的登入狀態 Promise，讓各頁面自己的 <script>
    // （例如 index.html 的導覽列動態切換、shared-sidebar.js 的訪客鎖定）不必重新呼叫
    // supabaseClient.auth.getSession()，直接 await 這裡算好的結果即可，狀態判斷邏輯
    // （訪客模式旗標優先於 session 等）只集中寫在這一處。
    window.authGuardReady = runGuard();

    // ==========================================
    // 🔒 訪客功能鎖定 (Graceful Degradation)：任何頁面、任何元素只要標上
    // data-requires-auth="true"，訪客造訪時就會自動變灰＋不可點擊，點擊時跳出提示。
    // 集中放在這裡（而不是個別頁面或 shared-sidebar.js 各自實作），
    // 才能讓公開行銷頁（如首頁）跟應用程式內頁共用同一套規則與樣式。
    // ==========================================
    function ensureGuestLockStyles() {
        if (document.getElementById('guestLockStyles')) return;
        const style = document.createElement('style');
        style.id = 'guestLockStyles';
        style.textContent = `
            .locked-feature { opacity: 0.5; cursor: not-allowed !important; pointer-events: auto; }
            .locked-feature:hover { background: transparent; color: var(--text-muted); }
            .locked-feature .submenu-arrow { display: none; }
            #guestLockedToast {
                position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%) translateY(20px);
                background: #141414; color: #FAFAFA; padding: 12px 20px; border-radius: var(--radius-md, 12px);
                font-size: 14px; font-weight: 600; box-shadow: 0 20px 50px -12px rgba(0, 0, 0, 0.4);
                opacity: 0; pointer-events: none; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                z-index: 1000; white-space: nowrap; max-width: 90vw; text-align: center;
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
        ensureGuestLockStyles();
        const toast = document.getElementById('guestLockedToast');
        if (!toast) return;
        toast.innerText = '🔒 此為專屬客製化功能，請登入後解鎖使用';
        toast.classList.add('show');
        clearTimeout(guestToastTimer);
        guestToastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
    }

    function lockGuestElement(el) {
        if (!el || el.classList.contains('locked-feature')) return;
        el.classList.add('locked-feature');
        // 直接覆蓋 onclick：不論原本綁的是導頁、切換選單還是其他動作，賦值會整個取代掉，
        // 訪客點擊就只會觸發提示，不會執行原本的動作
        el.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            showGuestLockedToast();
        };
    }

    window.applyGuestLockUI = function () {
        ensureGuestLockStyles();
        document.querySelectorAll('[data-requires-auth="true"]').forEach(lockGuestElement);
    };

    window.authGuardReady.then((state) => {
        // 等 DOM（含各頁面自己動態注入的 sidebar／內容）就緒後再掃描鎖定，
        // 跟 shared-sidebar.js 原本的時機一致，避免元素還沒插入就掃描落空
        window.addEventListener('load', () => {
            if (!state.effectivelyLoggedIn) window.applyGuestLockUI();
        });
    });

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
