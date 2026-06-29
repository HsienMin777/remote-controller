
const supabaseUrl = 'https://fkekdvojbfxacognlhqt.supabase.co'; // 👉 換成你的 URL
const supabaseKey = 'sb_publishable_UjNF38cuN4kKP2O6hhAWjg_KLI0zztB'; // 👉 換成你的 Key

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

        // 成功後跳轉
        window.location.href = 'index.html';

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
window.checkAuthStatus = async function() {
    // 檢查登入狀態：使用 supabaseClient
    const { data: { session } } = await supabaseClient.auth.getSession();
    
    if (!session) {
        window.location.href = 'login.html';
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
        window.location.href = 'login.html';
    } catch (err) {
        console.error("登出失敗:", err);
        alert("登出發生錯誤：" + err.message);
    }
}