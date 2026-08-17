
const supabaseUrl = 'https://fkekdvojbfxacognlhqt.supabase.co';
const supabaseKey = 'sb_publishable_UjNF38cuN4kKP2O6hhAWjg_KLI0zztB';

// 🔥 關鍵修正：改用 supabaseClient，避免跟官方套件撞名！
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

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

        // 成功後跳轉到登入後總覽主頁
        window.location.href = '/frontend/pages/overview.html';

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
// 🔥 用絕對路徑 (/frontend/index.html)：登入頁已經從 frontend/pages/login.html
//    搬到 frontend/index.html，且這支腳本被各個層級不同的頁面共用載入，
//    用絕對路徑才不會因為呼叫端頁面的相對位置不同而導到錯誤位置
window.checkAuthStatus = async function() {
    // 檢查登入狀態：使用 supabaseClient
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (!session) {
        window.location.href = '/frontend/index.html';
        return null;
    }
    return session.user;
}

// 登出功能
window.logout = async function() {
    try {
        console.log("正在執行登出...");
        // 登出：使用 supabaseClient
        await supabaseClient.auth.signOut();
        window.location.href = '/frontend/index.html';
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