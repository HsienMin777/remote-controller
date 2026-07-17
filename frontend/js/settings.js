// ==========================================
// ⚙️ 系統設定頁面邏輯 (settings.js)
// 個人資料／面試偏好目前先存進 localStorage，作為未來與 FastAPI 後端對接的準備。
// 主題（Light/Dark/System）則是「真的」全站生效：靠 theme-init.js 在 <html> 加 .dark class，
// 這裡點擊卡片時立即呼叫 window.__applyTheme() 更新 DOM，並同步寫回 localStorage。
// ==========================================

const SETTINGS_STORAGE_KEY = 'userSettings';

// 主頁 Hero 背景圖片的預設縮圖定義（HERO_IMAGE_PRESET_DEFS/getHeroImageBackgroundCss）
// 來自 frontend/js/hero-image-presets.js，settings.html 需要在載入這支腳本前先載入該檔案。
// overview.html 套用實際 Hero 背景時也是引用同一份定義，確保兩邊視覺一致。

let currentSettings = {
    displayName: '',
    email: '',
    interviewerStyle: 'gentle',
    defaultJobTitle: '',
    defaultCompany: '',
    defaultInterviewType: 'job',
    defaultDifficulty: 'medium',
    defaultRounds: 5,
    defaultLocale: 'zh',
    theme: 'light',
    heroImage: { type: 'preset', value: 'starry' } // type: 'preset' | 'custom'（custom 的 value 是圖片的 base64 data URL）
};

// Tab 3 目前選取中的 Hero 圖片（尚未存檔前的暫存狀態，供預覽用）
let selectedHeroImage = currentSettings.heroImage;

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof checkAuthStatus === 'function') {
        const user = await checkAuthStatus();
        if (!user) return;
        // 只在使用者從未手動填過信箱時，才用登入帳號預帶入
        loadSettingsFromStorage();
        if (!currentSettings.email) currentSettings.email = user.email || '';
    } else {
        loadSettingsFromStorage();
    }

    renderSettingsForm();
});

// ---------------------------
// 讀取 / 寫入 localStorage
// ---------------------------
function loadSettingsFromStorage() {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (raw) {
            currentSettings = { ...currentSettings, ...JSON.parse(raw) };
        }
    } catch (error) {
        console.error('讀取設定失敗:', error);
    }

    // 舊版存過 'zh-TW'，這裡統一成 index.html 面試語系欄位實際吃的 'zh'，維持向後相容
    if (currentSettings.defaultLocale === 'zh-TW') currentSettings.defaultLocale = 'zh';
}

function persistSettings(partial) {
    currentSettings = { ...currentSettings, ...partial };
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(currentSettings));
}

// ---------------------------
// 依目前設定值渲染整個表單
// ---------------------------
function renderSettingsForm() {
    const nameInput = document.getElementById('settingDisplayName');
    const emailInput = document.getElementById('settingEmail');
    const jobTitleInput = document.getElementById('settingDefaultJobTitle');
    const companyInput = document.getElementById('settingDefaultCompany');
    const typeSelect = document.getElementById('settingDefaultInterviewType');
    const difficultySelect = document.getElementById('settingDefaultDifficulty');
    const roundsInput = document.getElementById('settingDefaultRounds');
    const localeSelect = document.getElementById('settingDefaultLocale');

    if (nameInput) nameInput.value = currentSettings.displayName || '';
    if (emailInput) emailInput.value = currentSettings.email || '';
    if (jobTitleInput) jobTitleInput.value = currentSettings.defaultJobTitle || '';
    if (companyInput) companyInput.value = currentSettings.defaultCompany || '';
    if (typeSelect) typeSelect.value = currentSettings.defaultInterviewType || 'job';
    if (difficultySelect) difficultySelect.value = currentSettings.defaultDifficulty || 'medium';
    if (roundsInput) roundsInput.value = currentSettings.defaultRounds || 5;
    if (localeSelect) localeSelect.value = currentSettings.defaultLocale || 'zh';

    selectInterviewerStyle(currentSettings.interviewerStyle || 'gentle', { persist: false });
    selectTheme(currentSettings.theme || 'light', { persist: false });

    renderHeroImageOptionsGrid();
    const savedHeroImage = currentSettings.heroImage;
    if (savedHeroImage && savedHeroImage.type && savedHeroImage.value) {
        selectHeroImage(savedHeroImage.type, savedHeroImage.value, { persist: false });
    } else {
        selectHeroImage('preset', 'starry', { persist: false });
    }
}

// ---------------------------
// 左側垂直導覽選單：Tab 切換
// ---------------------------
function switchSettingsTab(tabName) {
    document.querySelectorAll('.settings-tab-item').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    document.querySelectorAll('.settings-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `panel-${tabName}`);
    });
}

// ---------------------------
// Tab 2：面試官風格卡片單選
// ---------------------------
function selectInterviewerStyle(value, options = {}) {
    const { persist = true } = options;
    document.querySelectorAll('.style-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === value);
    });
    if (persist) persistSettings({ interviewerStyle: value });
}

// ---------------------------
// Tab 3：主題卡片單選（所見即所得：點擊當下就切換全站深淺色，不用等按「儲存設定」）
// ---------------------------
function selectTheme(value, options = {}) {
    const { persist = true } = options;
    document.querySelectorAll('.theme-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === value);
    });

    // 立即更新 <html class="dark">，讓畫面馬上跟著換色
    if (typeof window.__applyTheme === 'function') window.__applyTheme(value);

    if (persist) persistSettings({ theme: value });
}

// ---------------------------
// Tab 3：主頁 Hero 背景圖片（所見即所得：選了就立即更新預覽圖並存檔，跟主題選擇同一套邏輯）
// ---------------------------

// 依 HERO_IMAGE_PRESET_DEFS（frontend/js/hero-image-presets.js）動態產生縮圖選項，
// 之後想加減預設圖只需要改那份定義檔，這裡不用跟著改
function renderHeroImageOptionsGrid() {
    const grid = document.getElementById('heroImageOptionsGrid');
    if (!grid || typeof HERO_IMAGE_PRESET_DEFS === 'undefined') return;

    const presetButtonsHtml = HERO_IMAGE_PRESET_DEFS.map(preset => `
        <button type="button" class="hero-image-option" data-preset="${preset.key}" onclick="selectHeroImage('preset', '${preset.key}')">
            <div class="hero-image-thumb" style="background-image: ${getPresetBackgroundCss(preset.key)}; background-size: cover; background-position: center;"></div>
            <span>${escapeHtml(preset.label)}</span>
        </button>
    `).join('');

    const uploadButtonHtml = `
        <button type="button" id="heroImageUploadOption" class="hero-image-option hero-image-option--upload" onclick="document.getElementById('heroImageUploadInput').click()">
            <div class="hero-image-thumb hero-image-thumb--upload">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            </div>
            <span>上傳自訂圖片</span>
        </button>
    `;

    grid.innerHTML = presetButtonsHtml + uploadButtonHtml;
}

function selectHeroImage(type, value, options = {}) {
    const { persist = true } = options;
    selectedHeroImage = { type, value };
    updateHeroImagePreview();
    if (persist) persistSettings({ heroImage: selectedHeroImage });
}

function updateHeroImagePreview() {
    const preview = document.getElementById('heroImagePreview');
    if (preview && typeof getHeroImageBackgroundCss === 'function') {
        preview.style.backgroundImage = getHeroImageBackgroundCss(selectedHeroImage);
    }

    document.querySelectorAll('.hero-image-option[data-preset]').forEach(btn => {
        const isSelected = selectedHeroImage.type === 'preset' && btn.dataset.preset === selectedHeroImage.value;
        btn.classList.toggle('selected', isSelected);
    });

    const uploadOption = document.getElementById('heroImageUploadOption');
    if (uploadOption) uploadOption.classList.toggle('selected', selectedHeroImage.type === 'custom');
}

// 使用者上傳自訂圖片：轉成 base64 data URL 存進 localStorage（不會真的上傳到伺服器）
function handleHeroImageUpload(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = ''; // 允許使用者重新選同一個檔案也能觸發 change

    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert('請上傳圖片檔案（JPG／PNG／WebP 等）。');
        return;
    }

    const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2MB，避免塞爆 localStorage 的容量上限
    if (file.size > MAX_SIZE_BYTES) {
        alert('圖片大小請控制在 2MB 以內，圖片會以 Base64 形式存在瀏覽器本機。');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        selectHeroImage('custom', e.target.result);
        showSettingsToast('自訂背景圖片已套用並儲存');
    };
    reader.onerror = () => {
        console.error('讀取圖片檔案失敗:', reader.error);
        alert('讀取圖片失敗，請換一張圖片再試一次。');
    };
    reader.readAsDataURL(file);
}

// ---------------------------
// 各分頁的「儲存設定」按鈕
// ---------------------------
function saveProfileSettings() {
    const displayName = document.getElementById('settingDisplayName').value.trim();
    const email = document.getElementById('settingEmail').value.trim();
    persistSettings({ displayName, email });
    showSettingsToast('個人資料已儲存');
}

function saveInterviewPreferences() {
    const defaultJobTitle = document.getElementById('settingDefaultJobTitle').value.trim();
    const defaultCompany = document.getElementById('settingDefaultCompany').value.trim();
    const defaultInterviewType = document.getElementById('settingDefaultInterviewType').value;
    const defaultDifficulty = document.getElementById('settingDefaultDifficulty').value;
    const defaultRounds = parseInt(document.getElementById('settingDefaultRounds').value, 10) || 5;
    const defaultLocale = document.getElementById('settingDefaultLocale').value;
    const selectedStyle = document.querySelector('.style-option.selected');
    persistSettings({
        defaultJobTitle,
        defaultCompany,
        defaultInterviewType,
        defaultDifficulty,
        defaultRounds,
        defaultLocale,
        interviewerStyle: selectedStyle ? selectedStyle.dataset.value : currentSettings.interviewerStyle
    });
    showSettingsToast('面試偏好已儲存');
}

function saveAppearanceSettings() {
    const selectedTheme = document.querySelector('.theme-option.selected');
    persistSettings({
        theme: selectedTheme ? selectedTheme.dataset.value : currentSettings.theme,
        heroImage: selectedHeroImage
    });
    showSettingsToast('外觀設定已儲存');
}

// ---------------------------
// Toast 提示
// ---------------------------
let settingsToastTimer = null;
function showSettingsToast(message) {
    const toast = document.getElementById('settingsToast');
    if (!toast) return;

    toast.innerHTML = `<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg> ${escapeHtml(message)}`;
    toast.classList.add('show');

    clearTimeout(settingsToastTimer);
    settingsToastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}
