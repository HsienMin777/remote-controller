// ==========================================
// 🌗 全站主題初始化 (Dark Mode Bootstrap)
// 必須放在每個頁面 <head> 最前面同步載入（不可加 defer/async），
// 這樣才能在瀏覽器畫出任何內容之前，就把 .dark class 加到 <html> 上，避免 FOUC 閃爍。
// ==========================================
(function () {
    const STORAGE_KEY = 'userSettings';

    function getStoredTheme() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return 'light';
            const settings = JSON.parse(raw);
            return (settings && settings.theme) || 'light';
        } catch (error) {
            return 'light';
        }
    }

    function systemPrefersDark() {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    // theme 可為 'light' / 'dark' / 'system'
    function applyTheme(theme) {
        const isDark = theme === 'dark' || (theme === 'system' && systemPrefersDark());
        document.documentElement.classList.toggle('dark', isDark);
    }

    // 供 settings.js 等頁面呼叫，立即切換主題（所見即所得，不需重新整理頁面）
    window.__applyTheme = applyTheme;
    window.__getStoredTheme = getStoredTheme;

    // 頁面載入當下立即套用一次，避免先閃一次亮色再變暗色
    applyTheme(getStoredTheme());

    // 若使用者選的是「跟隨系統」，作業系統深淺色切換時網站也要即時跟著變
    if (window.matchMedia) {
        const mql = window.matchMedia('(prefers-color-scheme: dark)');
        const handleSystemChange = function () {
            if (getStoredTheme() === 'system') applyTheme('system');
        };
        if (mql.addEventListener) {
            mql.addEventListener('change', handleSystemChange);
        } else if (mql.addListener) {
            mql.addListener(handleSystemChange); // 舊版 Safari 相容
        }
    }
})();
