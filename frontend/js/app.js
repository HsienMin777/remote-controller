// ==========================================
// 1. 全域變數與 API 基礎設定 (Global Variables)
// ==========================================
// 🔥 後端所有路由都掛在 /api 前綴下（見 backend/main.py 的 @app.post("/api/...") ），
// 這裡漏掉 /api 會讓每一個用 API_BASE 組出來的請求都打到不存在的路徑 (404)——
// 「AI 面試官初始化失敗」就是這樣來的：/interview/next 404，不是 GPT API 本身的問題。
const API_BASE = "https://offerdash.onrender.com/api";
const backendUrl = `${API_BASE}/interview/next`;

// 流程控制變數
let currentReportPayload = null;
let currentJdDiagnosisPayload = null; // 履歷與 JD 契合度診斷結果，供「確認儲存紀錄」使用
// 🔥 履歷檔案分成兩份獨立狀態：面試設定（發射台）跟「履歷與 JD 診斷」各自的上傳互不影響，
// 避免使用者在其中一邊上傳履歷後，切去另一個功能時被誤用/被清掉
let jdResumeFile = null;
let interviewResumeFile = null;
let battlePrepJD = ''; // 由「一鍵備戰」帶入的 JD 內容，讓面試更客製化

// ==========================================
// 2. DOM 元素抓取 (DOM Elements)
// ==========================================
const startBtn = document.getElementById("mainBtn");
const jobTitleInput = document.getElementById("jobTitle");
const companyNameInput = document.getElementById("companyName");

// ==========================================
// 3. 初始化與權限檢查 (Init & Auth)
// ==========================================
let currentUser = null;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. 檢查登入狀態
    if (typeof checkAuthStatus === 'function') {
        currentUser = await checkAuthStatus();
        if (!currentUser) return;
        console.log("使用者已登入:", currentUser.email);
    }

    // 2. 帶入「設定」頁面儲存的面試偏好預設值（使用者沒設定過的欄位就維持原本空白/預設值）
    applyInterviewDefaultsFromSettings();

    // 3. 綁定按鈕與輸入框狀態
    if (jobTitleInput && companyNameInput) {
        jobTitleInput.addEventListener("input", checkInputs);
        companyNameInput.addEventListener("input", checkInputs);
        checkInputs();
    }
    if (startBtn) startBtn.onclick = handleMainAction;

    // 4. 初始化上傳區塊
    setupUploadZone('uploadZone', 'resumeUpload', 'uploadText', 'jd');
    setupUploadZone('interviewUploadZone', 'interviewResumeUpload', 'interviewUploadText', 'interview');

    // 5. 承接「面試管家」一鍵備戰帶來的公司/職位/JD 資料（比預設職位更具體，蓋過預設值）
    applyBattlePrepFromStorage();

    // 6. 若剛從面試戰場頁面 (interview_arena.html) 完成面試導回來，還原並顯示復盤報告
    const reportRestored = restorePendingInterviewReportIfAny();

    // 7. 🔥 關鍵修正：明確地、依序地把「網址帶的 ?feature= 該不該生效」交給 router.js 判斷，
    //    並告知它報告是否剛剛已經還原顯示了。不再讓 router.js 自己另外掛一個 DOMContentLoaded
    //    監聽器、依賴「兩支互不相干的監聽器誰先執行完」這種脆弱的隱性時序假設——
    //    現在整個「首頁載入後該顯示哪個畫面」的判斷順序完全由這裡一條線決定。
    if (typeof autoResolveHomeFeatureFromURL === 'function') {
        autoResolveHomeFeatureFromURL({ reportAlreadyRestored: reportRestored });
    }
});

// 從「設定」頁面 (settings.html) 存的 userSettings 讀出面試偏好，自動帶入戰前設定表單的對應欄位。
// 使用者臨時修改過的值一律以當下輸入框/隱藏欄位內容為準（見 buildBaseFormData），這裡只負責「載入時的預設值」。
function applyInterviewDefaultsFromSettings() {
    let settings;
    try {
        const raw = localStorage.getItem('userSettings');
        if (!raw) return;
        settings = JSON.parse(raw);
    } catch (error) {
        console.error('讀取面試偏好設定失敗:', error);
        return;
    }
    if (!settings) return;

    const defaultJobTitle = (settings.defaultJobTitle || '').trim();
    if (jobTitleInput && defaultJobTitle) jobTitleInput.value = defaultJobTitle;

    const defaultCompany = (settings.defaultCompany || '').trim();
    if (companyNameInput && defaultCompany) companyNameInput.value = defaultCompany;

    if (settings.defaultInterviewType) {
        applyOptionSelection('type', settings.defaultInterviewType);
    }
    if (settings.defaultLocale) {
        applyOptionSelection('lang', settings.defaultLocale);
    }
    if (settings.defaultDifficulty) {
        applyOptionSelection('diff', settings.defaultDifficulty);
    }

    const roundsInput = document.getElementById("interviewRounds");
    if (roundsInput && settings.defaultRounds) roundsInput.value = settings.defaultRounds;
}

// 依 value 尋找對應的自訂下拉選單選項（透過 data-value 比對），更新隱藏 input、顯示文字與選中樣式。
// 與使用者手動點擊選項時呼叫的 selectOption() 共用同一組 DOM 結構，但不需要滑鼠事件即可程式化套用。
function applyOptionSelection(category, value) {
    let inputId, textId, optionsId;
    if (category === 'type') { inputId = 'interviewType'; textId = 'typeSelectText'; optionsId = 'typeOptions'; }
    else if (category === 'lang') { inputId = 'interviewLanguage'; textId = 'langSelectText'; optionsId = 'langOptions'; }
    else if (category === 'diff') { inputId = 'interviewDifficulty'; textId = 'diffSelectText'; optionsId = 'diffOptions'; }
    else return;

    const optionsContainer = document.getElementById(optionsId);
    if (!optionsContainer) return;

    const matchedOption = optionsContainer.querySelector(`.custom-option[data-value="${value}"]`);
    if (!matchedOption) return; // 設定值不在目前選項中（例如舊資料），保留原本預設，不強行套用

    document.getElementById(inputId).value = value;
    document.getElementById(textId).innerText = matchedOption.innerText.trim();
    optionsContainer.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
    matchedOption.classList.add('selected');
}

// 從行事曆的「進入備戰」按鈕帶入的資料，自動填入面試設定並記住 JD 供 AI 客製化提問
function applyBattlePrepFromStorage() {
    const raw = localStorage.getItem('currentInterviewPrep');
    if (!raw) return;
    localStorage.removeItem('currentInterviewPrep'); // 只套用一次，避免之後每次進站都被覆蓋

    try {
        const prep = JSON.parse(raw);
        if (jobTitleInput && prep.job_title) jobTitleInput.value = prep.job_title;
        if (companyNameInput && prep.company) companyNameInput.value = prep.company;
        battlePrepJD = prep.jd_text || '';
        checkInputs();
    } catch (error) {
        console.error("讀取備戰資料失敗:", error);
    }
}

// ==========================================
// 4. UI 互動與下拉選單邏輯 (UI & Dropdowns)
// ==========================================

// 側邊欄切換
function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (!sidebar) return;

    sidebar.classList.toggle('collapsed');
    const isOpen = !sidebar.classList.contains('collapsed');
    if (overlay) overlay.classList.toggle('hidden', !isOpen);
}

// 功能分頁切換 (現在只負責最純粹的 UI 區塊顯示/隱藏)
function switchFeature(featureName, options = {}) {
    const { updateHistory = true } = options;

    // 0. 這些功能都是獨立頁面（不是 interview.html 內部的 view-section），直接跳轉過去
    // 🔥 用絕對路徑 (/frontend/pages/xxx.html)：本頁 (interview.html) 也在 frontend/pages/ 底下，
    //    原本沒帶開頭斜線的相對路徑會被瀏覽器誤解成 frontend/pages/frontend/pages/xxx.html
    if (featureName === 'calendar') {
        window.location.href = '/frontend/pages/calendar.html';
        return;
    }
    if (featureName === 'dashboard') {
        window.location.href = '/frontend/pages/dashboard.html';
        return;
    }
    if (featureName === 'resume-records') {
        window.location.href = '/frontend/pages/resume_records.html';
        return;
    }
    if (featureName === 'consultant') {
        window.location.href = '/frontend/pages/consultant.html';
        return;
    }
    if (featureName === 'settings') {
        window.location.href = '/frontend/pages/settings.html';
        return;
    }

    // 1. 清除所有選單與視圖的 active 狀態
    document.querySelectorAll('.sidebar .menu-item').forEach(item => item.classList.remove('active'));
    document.querySelectorAll('.view-section').forEach(view => {
        view.classList.remove('active');
        if (view.id === 'reportCard') view.style.display = 'none'; // 確保報告卡片隱藏
    });

    // 2. 啟動目標選單與視圖
    const targetMenu = document.getElementById(`menu-${featureName}`);
    const targetView = document.getElementById(`view-${featureName}`);

    if (targetMenu) targetMenu.classList.add('active');
    if (targetView) targetView.classList.add('active');

    // 🔥 每次進入「履歷與職缺診斷」都強制重置成完全乾淨的初始狀態——
    // 不管使用者先前是否已經上傳過履歷/貼過 JD/看過診斷結果，一律清空重來，
    // 避免使用者誤以為看到的是新一次診斷，實際上卻是上次殘留的舊資料。
    if (featureName === 'jd') {
        resetJdDiagnosisState();
    }

    // 3. 處理網址與歷史紀錄 (動態支援所有 feature)
    // 🔥 這支頁面本身已經改名成 interview.html（原本叫 index.html），pushState 網址要
    //    跟著改，不然重新整理/分享網址時瀏覽器實際去要的檔案跟目前載入的內容對不上
    if (updateHistory) {
        const nextUrl = featureName === 'interview' ? 'interview.html' : `interview.html?feature=${featureName}`;
        history.pushState({ feature: featureName }, '', nextUrl);
    }

    // 4. 手機版側邊欄自動收合
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar && !sidebar.classList.contains('collapsed')) sidebar.classList.add('collapsed');
    if (overlay && !overlay.classList.contains('hidden')) overlay.classList.add('hidden');
}

// 「履歷與職缺診斷」進入時的重置：把上傳履歷、JD 文字、職缺欄位、分析按鈕狀態、
// 上次診斷結果全部清空/復原成初始值，確保每次從側邊欄點進來都是全新的一次診斷
function resetJdDiagnosisState() {
    jdResumeFile = null;
    currentJdDiagnosisPayload = null;

    const uploadText = document.getElementById('uploadText');
    if (uploadText) {
        uploadText.innerText = '點擊或將履歷拖曳至此 (支援 PDF)';
        uploadText.style.color = 'var(--text-muted)';
    }
    // 清空 input 的檔案選取，允許使用者重新選同一個檔案也能觸發 change 事件
    const resumeUploadInput = document.getElementById('resumeUpload');
    if (resumeUploadInput) resumeUploadInput.value = '';

    const jobDescriptionEl = document.getElementById('jobDescription');
    if (jobDescriptionEl) jobDescriptionEl.value = '';
    const jdJobTitleEl = document.getElementById('jdJobTitle');
    if (jdJobTitleEl) jdJobTitleEl.value = '';
    const jdCompanyNameEl = document.getElementById('jdCompanyName');
    if (jdCompanyNameEl) jdCompanyNameEl.value = '';

    // 分析按鈕復原成初始可點擊狀態，避免上次分析中途失敗時卡在 disabled/loading 文字
    const analyzeBtn = document.getElementById('analyzeJdBtn');
    if (analyzeBtn) {
        analyzeBtn.innerText = '預先分析履歷契合度與預測考題';
        analyzeBtn.disabled = false;
    }
}

function checkInputs() {
    if (!jobTitleInput || !companyNameInput || !startBtn) return;
    startBtn.disabled = !(jobTitleInput.value.trim() && companyNameInput.value.trim());
}

// 1. 通用的下拉選單開關
function toggleDropdown(optionId) {
    // 先關閉所有其他的選單
    document.querySelectorAll('.custom-options').forEach(opt => {
        if (opt.id !== optionId) opt.classList.remove('show');
    });
    // 切換當前選單
    document.getElementById(optionId).classList.toggle('show');
}

// 2. 通用的選項選擇邏輯
function selectOption(category, value, text) {
    let inputId, textId, optionsId;

    if (category === 'type') { inputId = 'interviewType'; textId = 'typeSelectText'; optionsId = 'typeOptions'; }
    else if (category === 'lang') { inputId = 'interviewLanguage'; textId = 'langSelectText'; optionsId = 'langOptions'; }
    else if (category === 'diff') { inputId = 'interviewDifficulty'; textId = 'diffSelectText'; optionsId = 'diffOptions'; }

    // 更新隱藏 input 的值與顯示文字
    document.getElementById(inputId).value = value;
    document.getElementById(textId).innerText = text;

    // 更新 UI 樣式 (選中狀態)
    const optionsContainer = document.getElementById(optionsId);
    optionsContainer.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
    event.target.classList.add('selected');

    // 關閉選單
    optionsContainer.classList.remove('show');
}

// 3. 點擊畫面其他地方自動關閉選單
window.addEventListener('click', function (e) {
    if (!e.target.closest('.custom-select-trigger')) {
        document.querySelectorAll('.custom-options').forEach(opt => opt.classList.remove('show'));
    }
});

// 通用下拉選單觸發器
function toggleGenericDropdown(triggerId, optionsId) {
    const trigger = document.getElementById(triggerId);
    const options = document.getElementById(optionsId);
    if (trigger && options) {
        trigger.classList.toggle('open');
        options.classList.toggle('show');
    }
}

// 點擊空白處自動關閉所有下拉選單 (優化合併版)
document.addEventListener('click', (event) => {
    const dropdowns = [
        { t: 'typeSelectTrigger', o: 'typeOptions' },
        { t: 'langSelectTrigger', o: 'langOptions' }
    ];
    dropdowns.forEach(dd => {
        const trigger = document.getElementById(dd.t);
        const options = document.getElementById(dd.o);
        if (trigger && options && !trigger.contains(event.target) && !options.contains(event.target)) {
            trigger.classList.remove('open');
            options.classList.remove('show');
        }
    });
});


// ==========================================
// 6. 面試主流程 (Interview Workflow)
//    面試對話本身已搬到獨立頁面 frontend/pages/interview_arena.html（見 interview.js），
//    這裡只負責：打包設定表單 → 呼叫 AI 拿到第一題 → 把狀態交棒給面試戰場頁面。
// ==========================================
function buildBaseFormData() {
    const role = document.getElementById("jobTitle").value || "工程師";
    const company = document.getElementById("companyName").value || "科技公司";
    const type = document.getElementById("interviewType")?.value || "job";
    const language = document.getElementById("interviewLanguage")?.value || "zh";
    const difficulty = document.getElementById("interviewDifficulty")?.value || "medium";

    const formData = new FormData();
    formData.append("job_title", role);
    formData.append("company_name", company);
    formData.append("interview_type", type);
    formData.append("interview_language", language);
    formData.append("interview_difficulty", difficulty);

    // 若是從「面試管家」一鍵備戰帶來的，附上 JD 讓 AI 提問更貼合職缺
    if (battlePrepJD) formData.append("job_description", battlePrepJD);

    return formData;
}

async function handleMainAction() {
    if (!startBtn) return;
    startBtn.disabled = true;
    startBtn.innerText = "正在初始化 AI 面試官...";

    const roundsInput = document.getElementById("interviewRounds");
    let maxRounds = parseInt(roundsInput?.value, 10) || 5;
    if (maxRounds < 1) maxRounds = 1;
    if (maxRounds > 20) maxRounds = 20;

    const formData = buildBaseFormData();
    formData.append("audio_file", new Blob([""], { type: "audio/webm" }), "empty.webm");
    formData.append("chat_history_str", JSON.stringify([]));
    if (interviewResumeFile) formData.append("resume_file", interviewResumeFile);

    try {
        const response = await fetch(backendUrl, { method: "POST", body: formData });
        if (!response.ok) throw new Error("API Error");
        const data = await response.json();

        // 打包這場面試的所有設定與第一題，交給獨立的面試戰場頁面接手進行
        const arenaState = {
            job_title: formData.get("job_title"),
            company_name: formData.get("company_name"),
            interview_type: formData.get("interview_type"),
            interview_language: formData.get("interview_language"),
            interview_difficulty: formData.get("interview_difficulty"),
            job_description: formData.get("job_description") || "",
            max_rounds: maxRounds,
            current_round: 0,
            resume_url: data.resume_url || null,
            chat_history: data.chat_history,
            latest_ai_text: data.ai_text,
            latest_audio_base64: data.audio_base64
        };
        sessionStorage.setItem("interviewArenaState", JSON.stringify(arenaState));

        window.location.href = "/frontend/pages/interview_arena.html";
    } catch (error) {
        console.error("初始化面試失敗:", error);
        alert("AI 面試官初始化失敗，請稍後再試。");
        startBtn.disabled = false;
        startBtn.innerText = "INITIATE SEQUENCE";
    }
}

// ==========================================
// 9. 履歷上傳與 ATS 解析 (Resume & JD)
// ==========================================
function setupUploadZone(zoneId, inputId, textId, target) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    const textElement = document.getElementById(textId);
    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', function () { if (this.files[0]) handleFileUpload(this.files[0], textElement, target); });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.background = "rgba(30, 58, 138, 0.06)"; });
    zone.addEventListener('dragleave', (e) => { e.preventDefault(); zone.style.background = "var(--bg-input)"; });
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.style.background = "var(--bg-input)";
        if (e.dataTransfer.files[0]) handleFileUpload(e.dataTransfer.files[0], textElement, target);
    });
}

function handleFileUpload(file, textElement, target) {
    if (file.type !== "application/pdf") return alert("目前只支援 PDF 格式的履歷喔！");
    if (target === 'jd') {
        jdResumeFile = file;
    } else {
        interviewResumeFile = file;
    }
    if (textElement) {
        textElement.innerText = `已載入履歷：${file.name}`;
        textElement.style.color = "var(--success)";
    }
}

function transferToInterview() {
    console.log("正在轉跳面試...");

    // 1. 取得資料
    const role = document.getElementById('jdJobTitle').value;
    const company = document.getElementById('jdCompanyName').value;

    // 2. 自動填入面試設定 (確保 ID 符合你面試區塊的 input ID)
    const roleInput = document.getElementById('jobTitle');
    const compInput = document.getElementById('companyName');

    if (roleInput) roleInput.value = role;
    if (compInput) compInput.value = company;

    // 3. 呼叫你的切換功能 (確保 switchFeature 是全域可用的)
    if (typeof switchFeature === 'function') {
        switchFeature('interview');
    } else {
        console.error("switchFeature 函數未找到");
    }
}

async function analyzeResumeMatch() {
    if (!jdResumeFile) return alert("請先上傳 PDF 履歷！");
    const jdText = document.getElementById("jobDescription")?.value.trim();
    if (!jdText) return alert("請貼上職缺描述 (JD)！");

    const btn = document.getElementById("analyzeJdBtn");
    btn.innerText = "正在前往報告頁面...";
    btn.disabled = true;

    const formData = new FormData();
    formData.append("resume_file", jdResumeFile);
    formData.append("job_title", document.getElementById("jdJobTitle")?.value || "工程師");
    formData.append("company_name", document.getElementById("jdCompanyName")?.value || "科技公司");
    formData.append("job_description", jdText);

    try {
        const response = await fetch(`${API_BASE}/interview/analyze-jd`, { method: "POST", body: formData });
        const data = await response.json();
        if (data.error) throw new Error(data.error);

        // 保留這次診斷的完整結果（含後端一併回傳的履歷文字/JD內容），供「確認儲存紀錄」使用
        currentJdDiagnosisPayload = data;

        renderReport(data);
        showReportView();
        // 🔥 關鍵：將分析結果存入 sessionStorage，供下一頁使用
        sessionStorage.setItem("lastJDReport", JSON.stringify(data));

        // 🔥 跳轉頁面 (假設你有名為 view-report 的區塊)
        switchFeature('report');

    } catch (error) {
        alert("分析失敗: " + error.message);
        btn.innerText = "預先分析履歷契合度與預測考題";
        btn.disabled = false;
    }
}

function renderReport(data) {
    // 1. 渲染分數與標籤
    const score = data.match_score || 0;
    document.getElementById("jdMatchScore").innerText = score;

    const scoreLabel = document.getElementById("jdScoreLabel");
    scoreLabel.innerText = score >= 80 ? "極佳契合" : (score >= 60 ? "具備面試資格" : "建議大幅修改");
    scoreLabel.style.color = score >= 80 ? "#059669" : (score >= 60 ? "#D97706" : "#DC2626");

    // 2. 綜合短評
    document.getElementById("jdSummary").innerText = data.summary || data.advice || "分析完成。";

    // 3. 關鍵字比對 (Skill Pills)
    const matched = data.matched_skills || [];
    const missing = data.missing_skills || [];

    document.getElementById("jdMatchedSkills").innerHTML = matched.length > 0
        ? matched.map(s => `<span class="skill-pill match">${s}</span>`).join('')
        : `<span style="font-size: 13px; color: var(--text-muted);">無明顯命中關鍵字</span>`;

    document.getElementById("jdMissingSkills").innerHTML = missing.length > 0
        ? missing.map(s => `<span class="skill-pill miss">${s}</span>`).join('')
        : `<span style="font-size: 13px; color: var(--text-muted);">無明顯缺失關鍵字</span>`;

    // 4. JD 總結與分析
    document.getElementById("jdAnalysisSummary").innerText = data.jd_analysis_summary || "無 JD 分析內容。";

    // 5. 預測考題
    const questions = data.predicted_questions || [];
    document.getElementById("jdPredictedQs").innerHTML = questions.length > 0
        ? questions.map(q => `
            <div class="question-card">
                <div class="q-title">Q: ${q.q || q}</div>
                <div class="q-intent">面試官意圖：${q.intent || "專業能力測試"}</div>
            </div>`).join('')
        : `<div class="question-card"><div class="q-title">無特定預測考題</div></div>`;

    // 6. 原始檔案預覽 (預設收合)
    const previewWrap = document.getElementById("resumeFilePreview");
    previewWrap.classList.remove("is-open");
    previewWrap.style.display = "none";
    document.getElementById("resumeFilePreviewIframe").style.display = "none";
    document.getElementById("resumeFilePreviewImg").style.display = "none";
    document.getElementById("toggleResumeTextBtn").innerText = "查看原始檔案";
}

let currentResumeObjectUrl = null;
const RESUME_PREVIEW_TRANSITION_MS = 350;

function toggleResumeTextView() {
    const previewWrap = document.getElementById("resumeFilePreview");
    const iframeEl = document.getElementById("resumeFilePreviewIframe");
    const imgEl = document.getElementById("resumeFilePreviewImg");
    const toggleBtn = document.getElementById("toggleResumeTextBtn");

    const isOpen = previewWrap.classList.contains("is-open");

    if (isOpen) {
        // 淡出後再真正隱藏，讓 CSS transition 有時間播放
        previewWrap.classList.remove("is-open");
        toggleBtn.innerText = "📄 查看原始檔案";
        setTimeout(() => { previewWrap.style.display = "none"; }, RESUME_PREVIEW_TRANSITION_MS);
        return;
    }

    const file = jdResumeFile;
    if (!file) {
        alert("找不到剛才上傳的檔案，請重新上傳履歷後再試一次。");
        return;
    }

    if (currentResumeObjectUrl) {
        URL.revokeObjectURL(currentResumeObjectUrl);
    }
    currentResumeObjectUrl = URL.createObjectURL(file);

    iframeEl.style.display = "none";
    imgEl.style.display = "none";

    if (file.type === "application/pdf") {
        iframeEl.src = currentResumeObjectUrl;
        iframeEl.style.display = "block";
    } else if (file.type.startsWith("image/")) {
        imgEl.src = currentResumeObjectUrl;
        imgEl.style.display = "block";
    } else {
        alert("不支援預覽此檔案類型。");
        return;
    }

    // 先設定 display 讓元素進入版面，再於下一幀加上 is-open 觸發淡入 + 下滑動畫
    previewWrap.style.display = "block";
    requestAnimationFrame(() => {
        requestAnimationFrame(() => previewWrap.classList.add("is-open"));
    });
    toggleBtn.innerText = "收起原始檔案";
}

function showReportView() {
    // 1. 移除所有視圖的 active 狀態
    document.querySelectorAll('.view-section').forEach(section => {
        section.classList.remove('active');
    });

    // 2. 為報告頁面加上 active 狀態 (這會顯示它)
    const reportSection = document.getElementById("view-report");
    if (reportSection) {
        reportSection.classList.add("active");
    }

    // 3. 頁面平滑捲動到頂部，讓使用者感覺像進入新頁面
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 「確認儲存紀錄」：把履歷文字、JD 內容、AI 診斷 JSON 打包送到後端存進 Supabase，成功後導向「履歷上傳紀錄」頁
async function saveResumeDiagnosis() {
    if (!currentJdDiagnosisPayload) return;

    const saveBtn = document.getElementById("saveResumeBtn");
    const discardBtn = document.getElementById("discardResumeBtn");
    const statusEl = document.getElementById("resumeSaveStatus");
    if (saveBtn) { saveBtn.innerText = "儲存中..."; saveBtn.disabled = true; }
    if (discardBtn) discardBtn.disabled = true;
    if (statusEl) { statusEl.textContent = ""; statusEl.style.color = ""; }

    // diagnosis_result 只保留 AI 分析結果本身，履歷文字/JD內容/職缺資訊已經是獨立欄位，不必重複存一份
    const { resume_text, jd_text, job_title, company_name, ...diagnosisResult } = currentJdDiagnosisPayload;

    const payload = {
        job_title: job_title || document.getElementById("jdJobTitle")?.value || "工程師",
        company_name: company_name || document.getElementById("jdCompanyName")?.value || "科技公司",
        resume_text: resume_text || "",
        jd_text: jd_text || document.getElementById("jobDescription")?.value || "",
        match_score: currentJdDiagnosisPayload.match_score || 0,
        diagnosis_result: diagnosisResult
    };

    try {
        const response = await fetch(`${API_BASE}/resume/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`HTTP ${response.status}${errText ? ` - ${errText}` : ''}`);
        }
        window.location.href = "/frontend/pages/resume_records.html";
    } catch (error) {
        console.error("儲存履歷診斷紀錄失敗:", error);
        if (statusEl) {
            statusEl.textContent = `儲存失敗，請稍後再試 (${error.message})`;
            statusEl.style.color = "#DC2626";
        }
        if (saveBtn) { saveBtn.innerText = "確認儲存紀錄"; saveBtn.disabled = false; }
        if (discardBtn) discardBtn.disabled = false;
    }
}

// 「捨棄並返回」：不儲存這次診斷結果，直接回到 JD 分析表單重新開始
function discardResumeDiagnosis() {
    currentJdDiagnosisPayload = null;
    switchFeature('jd');
}

// ==========================================
// 10. 產生與儲存報告 (Report & DB)
// ==========================================
// 面試戰場頁面 (interview_arena.html) 面試結束後，會把「已經 fetch 好」的報告資料
// 存進 sessionStorage 並導回這裡，這個函式負責讀出來並還原成 currentReportPayload + 畫面渲染。
// 回傳 true/false 表示「這次載入是否真的還原了一份報告」，讓呼叫端（DOMContentLoaded handler）
// 可以據此判斷還要不要讓 router.js 的 ?feature= 網址判斷邏輯生效。
function restorePendingInterviewReportIfAny() {
    const raw = sessionStorage.getItem('pendingInterviewReport');
    if (!raw) {
        console.log('[app.js] sessionStorage 中沒有待顯示的面試報告（正常首次載入，或報告已還原過一次）');
        return false;
    }
    sessionStorage.removeItem('pendingInterviewReport');

    try {
        const { data, meta } = JSON.parse(raw);
        console.log('[app.js] 還原待顯示的面試報告，data:', data, 'meta:', meta);
        renderInterviewReportCard(data, meta);
        return true;
    } catch (error) {
        console.error('還原面試報告失敗（sessionStorage 內容解析失敗）:', error, '原始內容:', raw);
        return false;
    }
}

// 渲染面試復盤報告卡片。data 是後端 /api/interview/report 回傳的分析結果，
// meta 是這場面試的基本資訊 (job_title/company_name/transcript/resume_url)
//
// 🔥 關鍵修正：/api/interview/report 只保證「回傳合法 JSON」(response_format: json_object)，
// 不保證 AI 一定完全照 prompt 要求的欄位結構回傳（可能漏欄位、型別不對）。
// 之前這裡直接對 data.strengths / data.improvements 呼叫 .map()、對 data.detailed_scores
// 呼叫 Object.entries()，一旦 AI 漏了任何一個欄位就會在渲染途中丟例外——
// 但「切到 reportCard」的動作在最上面已經執行完了，導致使用者看到的是切換過去的
// 空白報告卡片（畫面沒有任何錯誤提示，看起來就像「跳轉了但沒內容」）。
// 現在全面補上防呆預設值，並把渲染主體包進 try/catch，寧可顯示不完整的內容或明確錯誤，
// 也不要讓卡片切換過去之後卻悄悄卡在渲染到一半的狀態。
function renderInterviewReportCard(data, meta) {
    data = data || {};
    meta = meta || {};

    const safeStrengths = Array.isArray(data.strengths) ? data.strengths : [];
    const safeImprovements = Array.isArray(data.improvements) ? data.improvements : [];
    const safeDetailedScores = (data.detailed_scores && typeof data.detailed_scores === 'object') ? data.detailed_scores : {};

    // 1. 建立當次面試的紀錄包 (包含診斷層資料)
    currentReportPayload = {
        job_title: meta.job_title,
        company_name: meta.company_name,
        total_score: data.total_score ?? 0,
        short_feedback: data.short_feedback || '（AI 未提供摘要）',
        detailed_scores: safeDetailedScores,
        strengths: safeStrengths,
        improvements: safeImprovements,
        transcript: meta.transcript || [],
        resumeUrl: meta.resume_url,
        diagnostic: data.diagnostic // 把 AI 產出的診斷書帶進來
    };

    // ==========================================
    // 1. 切換 UI：隱藏設定卡片，顯示報告卡片
    // ==========================================
    document.getElementById('view-interview')?.classList.remove('active');
    if (document.getElementById('setupCard')) document.getElementById('setupCard').style.display = 'none';

    const reportCard = document.getElementById('reportCard');
    if (reportCard) {
        reportCard.classList.add('active');
        reportCard.style.display = 'block';
    }

    // 🔥 關鍵 UX 優化：將畫面平滑滾動到最上方，讓使用者第一眼看到自己的分數
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // ==========================================
    // 2. 渲染資料（包進 try/catch：任何欄位異常都不該讓卡片停在渲染一半的空白狀態）
    // ==========================================
    try {
        if (document.getElementById("detailRole")) document.getElementById("detailRole").innerText = `${currentReportPayload.job_title} - ${currentReportPayload.company_name}`;
        if (document.getElementById("detailScore")) document.getElementById("detailScore").innerText = currentReportPayload.total_score;
        if (document.getElementById("detailFeedback")) document.getElementById("detailFeedback").innerText = currentReportPayload.short_feedback;
        if (document.getElementById("strengthsList")) {
            document.getElementById("strengthsList").innerHTML = safeStrengths.length > 0
                ? safeStrengths.map(s => `<li>${escapeHtml(s)}</li>`).join("")
                : `<li style="color: var(--text-muted);">（無資料）</li>`;
        }
        if (document.getElementById("improvementsList")) {
            document.getElementById("improvementsList").innerHTML = safeImprovements.length > 0
                ? safeImprovements.map(i => `<li>${escapeHtml(i)}</li>`).join("")
                : `<li style="color: var(--text-muted);">（無資料）</li>`;
        }

        const skillsContainer = document.getElementById("skillsContainer");
        if (skillsContainer) {
            const scoreEntries = Object.entries(safeDetailedScores);
            skillsContainer.innerHTML = scoreEntries.length > 0
                ? scoreEntries.map(([skill, score]) => `
                <div class="skill-row" style="margin-bottom: 12px;">
                    <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:4px;">
                        <span>${escapeHtml(skill)}</span><span style="color:var(--accent); font-family:monospace;">${score}%</span>
                    </div>
                    <div style="width:100%; height:8px; background:var(--border); border-radius:4px; overflow:hidden;">
                        <div style="width: ${score}%; height:100%; background:var(--accent); border-radius:4px;"></div>
                    </div>
                </div>
            `).join("")
                : `<p style="color: var(--text-muted); font-size: 14px;">（無評分資料）</p>`;
        }

        const transcriptBody = document.getElementById("transcriptBody");
        if (transcriptBody) {
            transcriptBody.innerHTML = (currentReportPayload.transcript || []).map(msg => {
                // 🔥 修正：OpenAI 的回覆 role 通常是 'assistant'
                const isAI = msg.role === 'ai' || msg.role === 'assistant';
                return `
                <div class="msg-block ${msg.role}" style="margin-bottom: 16px; padding: 12px; border-radius: 8px; background: ${isAI ? 'var(--bg-input)' : 'rgba(30,58,138,0.06)'};">
                    <div style="font-size:12px; color:var(--text-muted); font-weight:bold; margin-bottom:4px;">${isAI ? 'SYSTEM (AI)' : 'YOU'}</div>
                    <div style="font-size:14px; line-height:1.5;">${escapeHtml(msg.content || '')}</div>
                </div>
            `}).join("");
        }
    } catch (error) {
        console.error('渲染面試報告內容時發生例外:', error, '原始 data:', data);
        const feedbackEl = document.getElementById("detailFeedback");
        if (feedbackEl) feedbackEl.innerText = '報告內容解析異常，部分資訊可能無法顯示，請聯繫客服或重新面試。';
    }

    // ==========================================
    // 3. 注入控制按鈕與修煉區
    // ==========================================
    document.getElementById("reportActions")?.remove();
    document.getElementById('reportCard').insertAdjacentHTML('beforeend', `
        <div id="reportActions" style="margin-top: 40px; display: flex; gap: 16px; justify-content: center; padding-bottom: 40px;">
            <button onclick="discardAndRetry()" style="padding: 12px 24px; border: 1px solid var(--danger); color: var(--danger); border-radius: 8px; cursor: pointer; background: transparent; font-weight:bold;">捨棄並重新面試</button>
            <button id="saveBtn" onclick="saveReportToDB()" style="padding: 12px 24px; background: var(--accent); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight:bold;">儲存並前往資料庫</button>
        </div>
    `);

    // 觸發賽後修煉區：只有「剛面試完的即時報告」會走到這裡觸發 AI 生成，
    // 歷史檢視 (dashboard.html) 是另一條路徑，絕對不會呼叫這個函式
    setTimeout(() => triggerGrowthZoneHook(currentReportPayload), 500);
}

let globalInterviewRecords = [];

// 撈取歷史紀錄 (你原本可能在網頁載入時有呼叫這個)
async function fetchInterviewHistory() {
    try {
        const response = await fetch(`${API_BASE}/interview/history`, {
            headers: await getAuthHeaders()
        });
        const data = await response.json();
        globalInterviewRecords = data.records || [];

        // 這裡可以加上你原本渲染左側「面試清單列表」的邏輯
        // 例如：renderHistoryList(globalInterviewRecords);

    } catch (error) {
        console.error("無法撈取歷史紀錄:", error);
    }
}

// 點擊歷史紀錄列表時，顯示詳細報告並啟動修煉區
function showDetail(id) {
    // 1. 從暫存陣列中找出該筆紀錄
    const record = globalInterviewRecords.find(r => r.id === id);
    if (!record) return;

    // 2. 切換 UI：隱藏大廳，顯示報告卡片
    document.getElementById('view-interview')?.classList.remove('active');
    const reportCard = document.getElementById('reportCard');
    if (reportCard) {
        reportCard.classList.add('active');
        reportCard.style.display = 'block';
    }

    // 3. 填入基礎資料
    if (document.getElementById("detailRole")) document.getElementById("detailRole").innerText = record.role;
    if (document.getElementById("detailDate")) document.getElementById("detailDate").innerText = record.date;
    if (document.getElementById("detailScore")) document.getElementById("detailScore").innerText = record.totalScore;
    if (document.getElementById("detailFeedback")) document.getElementById("detailFeedback").innerText = record.shortFeedback;

    // 4. 填入能力雷達/長條圖
    const skillsContainer = document.getElementById("skillsContainer");
    if (skillsContainer && record.detailedScores) {
        skillsContainer.innerHTML = Object.entries(record.detailedScores).map(([skill, score]) => `
            <div class="skill-row" style="margin-bottom: 12px;">
                <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:4px;">
                    <span>${skill}</span><span style="color:var(--accent); font-family:monospace;">${score}%</span>
                </div>
                <div style="width:100%; height:8px; background:rgba(255,255,255,0.1); border-radius:4px; overflow:hidden;">
                    <div style="width: ${score}%; height:100%; background:var(--accent); border-radius:4px;"></div>
                </div>
            </div>
        `).join("");
    }

    // 5. 填入優缺點
    if (document.getElementById("strengthsList")) document.getElementById("strengthsList").innerHTML = (record.strengths || []).map(s => `<li>${s}</li>`).join("");
    if (document.getElementById("improvementsList")) document.getElementById("improvementsList").innerHTML = (record.improvements || []).map(i => `<li>${i}</li>`).join("");

    // 6. 填入逐字稿
    const transcriptBody = document.getElementById("transcriptBody");
    if (transcriptBody && record.transcript) {
        transcriptBody.innerHTML = record.transcript.map(msg => {
            const isAI = msg.role === 'ai' || msg.role === 'assistant';
            return `
            <div class="msg-block ${msg.role}" style="margin-bottom: 16px; padding: 12px; border-radius: 8px; background: ${isAI ? 'rgba(255,255,255,0.05)' : 'rgba(14,165,233,0.1)'};">
                <div style="font-size:12px; color:var(--text-muted); font-weight:bold; margin-bottom: 4px;">${isAI ? 'SYSTEM (AI)' : 'YOU'}</div>
                <div style="font-size:14px; line-height:1.5;">${msg.content}</div>
            </div>
        `}).join("");
    }

    // 7. 隱藏只有在「剛面試完」才需要的按鈕 (儲存/捨棄)
    const reportActions = document.getElementById("reportActions");
    if (reportActions) reportActions.style.display = "none";

    // 8. 🔥 啟動賽後修煉區
    // 將 DB 撈出來的資料結構，轉換成修煉區 Hook 認得的格式
    const payloadForGrowth = {
        job_title: record.role,
        total_score: record.totalScore,
        transcript: record.transcript
    };

    // 呼叫修煉區引擎
    triggerGrowthZoneHook(payloadForGrowth);

    // 9. (可選) 讓畫面平滑往下滾動一點，讓使用者注意到修煉區的出現
    setTimeout(() => {
        const growthZone = document.getElementById('growthZone');
        if (growthZone) {
            growthZone.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, 500);

    const redemptionContainer = document.getElementById('redemptionHistoryContainer');
    const redemptionList = document.getElementById('redemptionHistoryList');

    // 檢查這筆紀錄是否包含復盤資料 (opportunities)
    if (record.opportunities && record.opportunities.length > 0) {
        redemptionContainer.style.display = 'block'; // 顯示區塊

        redemptionList.innerHTML = record.opportunities.map(opp => `
            <div style="padding: 16px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-light); border-radius: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <span style="background: ${opp.tagColor}22; color: ${opp.tagColor}; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">
                        ${opp.tag}
                    </span>
                    <span style="color: ${opp.cleared ? '#10b981' : 'var(--text-muted)'}; font-size: 12px; font-weight: bold;">
                        ${opp.cleared ? '✅ 已翻盤' : '未挑戰'} (+${opp.xp_reward} XP)
                    </span>
                </div>
                <div style="font-weight: bold; color: white; margin-bottom: 8px; font-size: 15px;">
                    Q: ${opp.question}
                </div>
                <div style="font-size: 14px; color: #f87171; margin-bottom: 12px; line-height: 1.5;">
                    ❌ 當時盲點: ${opp.flaw}
                </div>
                <div style="font-size: 14px; color: var(--text-main); background: rgba(255, 255, 255, 0.05); padding: 12px; border-radius: 6px; border-left: 3px solid #f59e0b; line-height: 1.6;">
                    <strong>提示:</strong><br>
                    ${opp.strategy.replace(/\n/g, '<br>')}
                </div>
            </div>
        `).join('');
    } else {
        // 如果這筆紀錄很舊，還沒有生成過復盤任務，就隱藏這個區塊
        redemptionContainer.style.display = 'none';
    }
}


// 唯一保留的 saveReportToDB (優化版)
async function saveReportToDB() {
    if (!currentReportPayload) return;
    const saveBtn = document.getElementById("saveBtn");
    if (saveBtn) { saveBtn.innerText = "儲存中..."; saveBtn.disabled = true; }

    // 把「能力升級區」目前已生成／完成的翻盤任務一併存入這筆面試紀錄
    currentReportPayload.opportunities = (typeof RedemptionState !== 'undefined' && RedemptionState.opportunities && RedemptionState.opportunities.length > 0)
        ? RedemptionState.opportunities
        : null;

    try {
        const response = await fetch(`${API_BASE}/interview/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
            body: JSON.stringify(currentReportPayload)
        });
        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`HTTP ${response.status}${errText ? ` - ${errText}` : ''}`);
        }
        window.location.href = "/frontend/pages/dashboard.html";
    } catch (error) {
        console.error("儲存報告失敗:", error);
        alert(`資料庫連線失敗，但報告已產生。\n(${error.message})`);
        window.location.href = "/frontend/pages/dashboard.html";
    }
}

function discardAndRetry() {
    // 1. 隱藏報告卡片
    const reportCard = document.getElementById('reportCard');
    if (reportCard) {
        reportCard.classList.remove('active');
        reportCard.style.display = 'none';
    }

    // 2. 顯示設定卡片，回到面試設定畫面
    if (document.getElementById('setupCard')) document.getElementById('setupCard').style.display = 'flex';
    if (document.getElementById('view-interview')) document.getElementById('view-interview').classList.add('active');

    // 3. 重置面試狀態
    currentReportPayload = null;

    // 恢復開始按鈕狀態
    if (startBtn) {
        startBtn.disabled = false;
        startBtn.innerText = "INITIATE SEQUENCE";
        checkInputs();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==========================================
// 11. 賽後修煉區 (Growth Engine)
// ==========================================
const GrowthState = { jobTitle: "", weaknessCode: "", worstAnswer: "", originalScore: 0, drillChatHistory: [], roundCount: 0 };
const QUIZ_DATABASE = {
    "LACK_OF_DATA": {
        title: "回答過於籠統，缺乏數據支撐",
        question: "剛剛回答專案經驗時，你覺得最大的問題是？",
        options: { "A": "忘記當時具體數據", "B": "太緊張腦袋空白", "C": "不知道如何量化" }
    }
};

// 🎯 triggerGrowthZoneHook 的唯一定義在 growth-v2.js（負責「即時報告」生成 AI 翻盤任務），
//    這裡不再重複定義，避免兩份邏輯不同步。

function initGrowthZone(jobTitle, weaknessCode, worstAnswer, originalScore) {
    Object.assign(GrowthState, { jobTitle, weaknessCode, worstAnswer, originalScore, drillChatHistory: [], roundCount: 0 });
    const quiz = QUIZ_DATABASE[weaknessCode];
    if (!quiz) return;

    const zone = document.getElementById('growthZone');
    if (!zone) return;

    zone.style.display = 'block';
    zone.innerHTML = `
        <h3 style="color: #0ea5e9; margin-top: 0;">🚀 賽後修煉區</h3>
        <div style="background: var(--bg-card); padding: 20px; border-radius: 12px; border: 1px solid var(--border-light);">
            <div style="color: #f59e0b; font-weight: bold; margin-bottom: 12px;">🚨 偵測弱項：${quiz.title}</div>
            <p style="margin-bottom: 20px;">${quiz.question}</p>
            <div style="display: flex; flex-direction: column; gap: 10px;">
                ${Object.entries(quiz.options).map(([k, v]) => `<button onclick="submitQuizChoice('${k}')" style="padding:12px; text-align:left; border-radius:8px; border:1px solid var(--border); background:rgba(255,255,255,0.05); color:var(--text-main); cursor:pointer;">${k}. ${v}</button>`).join('')}
            </div>
        </div>
    `;
}

async function submitQuizChoice(choice) {
    const zone = document.getElementById('growthZone');
    zone.innerHTML = `<div style="text-align: center; padding: 40px; color: #64748b;">🤖 教練正在為你量身打造高分範例...</div>`;

    const formData = new FormData();
    formData.append("job_title", GrowthState.jobTitle);
    formData.append("weakness_code", GrowthState.weaknessCode);
    formData.append("user_choice", choice);
    formData.append("worst_user_answer", GrowthState.worstAnswer);

    try {
        const res = await fetch(`${API_BASE}/growth/generate_showcase`, { method: 'POST', body: formData });
        const data = await res.json();
        zone.innerHTML = `
            <h3 style="color: #0ea5e9; margin-top: 0;">點評與示範</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px;">
                <div style="background: rgba(239, 68, 68, 0.1); padding: 16px; border-radius: 12px; border-top: 3px solid #ef4444;">
                    <div style="font-size: 12px; color: #ef4444; margin-bottom: 8px;">你的原本回答</div>
                    <div>${data.user_version}</div>
                </div>
                <div style="background: rgba(16, 185, 129, 0.1); padding: 16px; border-radius: 12px; border-top: 3px solid #10b981;">
                    <div style="font-size: 12px; color: #10b981; font-weight: bold; margin-bottom: 8px;">高分範例</div>
                    <div style="margin-bottom: 12px;">${data.high_score_version}</div>
                    <ul style="color: var(--text-muted); font-size: 13px; padding-left: 0; list-style: none;">
                        ${data.bullet_points.map(bp => `<li>${bp}</li>`).join("")}
                    </ul>
                </div>
            </div>
            <div style="background: var(--bg-card); padding: 16px; border-radius: 12px; border: 1px dashed #0ea5e9; text-align: center;">
                <div style="font-weight: bold; margin-bottom: 8px;">🔧 隨身帶走的表達公式</div><div style="color: #0ea5e9;">${data.immediate_tool}</div>
            </div>
            <div style="text-align: center; margin-top: 24px;">
                <button onclick="startDrill()" style="background: #0ea5e9; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; cursor: pointer;">⚡ 使用此公式，來場 3 分鐘快閃實戰</button>
            </div>
        `;
    } catch (e) { zone.innerHTML = `<div style="color: red;">生成失敗，請稍後再試。</div>`; }
}

async function startDrill() {
    const zone = document.getElementById('growthZone');
    zone.innerHTML = `<div style="text-align: center; padding: 40px;">正在安排實戰場地...</div>`;
    const formData = new FormData();
    formData.append("job_title", GrowthState.jobTitle);
    formData.append("weakness_code", GrowthState.weaknessCode);

    try {
        const res = await fetch(`${API_BASE}/growth/start_quick_drill`, { method: 'POST', body: formData });
        const data = await res.json();
        GrowthState.drillChatHistory.push({ role: "assistant", content: data.ai_first_message });

        zone.innerHTML = `
            <h3 style="color: #0ea5e9; margin-top: 0;">⏱️ 3 分鐘快閃實戰</h3>
            <div style="background: #1e293b; color: white; padding: 20px; border-radius: 12px;">
                <div id="miniChatBox" style="height: 200px; overflow-y: auto; margin-bottom: 16px; border-bottom: 1px solid #334155; padding-bottom: 10px;">
                    <div style="margin-bottom: 12px;"><strong>教練：</strong>${data.ai_first_message}</div>
                </div>
                <div style="display: flex; gap: 10px;">
                    <input id="drillInput" type="text" placeholder="試著加入具體數據..." style="flex: 1; padding: 10px; border-radius: 6px; border: none; color: black;">
                    <button onclick="sendDrillMsg()" style="background: #10b981; color: white; border: none; padding: 0 20px; border-radius: 6px; cursor: pointer;">送出</button>
                </div>
            </div>
        `;
    } catch (e) { zone.innerHTML = `<div style="color: red;">啟動失敗。</div>`; }
}

async function sendDrillMsg() {
    const input = document.getElementById('drillInput');
    const msg = input.value.trim();
    if (!msg) return;

    input.value = "";
    input.disabled = true;
    const chatBox = document.getElementById('miniChatBox');
    chatBox.innerHTML += `<div style="margin-bottom: 12px; color: #38bdf8; text-align: right;"><strong>你：</strong>${msg}</div>`;
    chatBox.scrollTop = chatBox.scrollHeight;

    GrowthState.drillChatHistory.push({ role: "user", content: msg });
    GrowthState.roundCount++;

    if (GrowthState.roundCount >= 2) {
        chatBox.innerHTML += `<div style="margin-bottom: 12px; color: #f59e0b; text-align: center;">-- 實戰結束，正在結算分數 --</div>`;
        await finishAndEvaluateDrill();
    } else {
        // 模擬教練追問 (可替換為呼叫 OpenAI)
        setTimeout(() => {
            const mockReply = "你有提到技術工具，但還是沒有具體的 Baseline 數字。請再試一次，當時的成效提升了多少百分比？";
            chatBox.innerHTML += `<div style="margin-bottom: 12px;"><strong>教練：</strong>${mockReply}</div>`;
            chatBox.scrollTop = chatBox.scrollHeight;
            GrowthState.drillChatHistory.push({ role: "assistant", content: mockReply });
            input.disabled = false; input.focus();
        }, 1000);
    }
}

async function finishAndEvaluateDrill() {
    const zone = document.getElementById('growthZone');
    const formData = new FormData();
    formData.append("original_score", GrowthState.originalScore);
    formData.append("weakness_code", GrowthState.weaknessCode);
    formData.append("job_title", GrowthState.jobTitle);
    formData.append("drill_chat_history", JSON.stringify(GrowthState.drillChatHistory));

    try {
        const res = await fetch(`${API_BASE}/growth/evaluate_drill`, { method: 'POST', body: formData });
        const data = await res.json();
        const isPositive = data.delta > 0;
        const color = isPositive ? "#10b981" : "#eab308";

        zone.innerHTML = `
            <h3 style="color: #0ea5e9; margin-top: 0;">🏆 實戰驗收結果</h3>
            <div style="display: flex; align-items: center; justify-content: center; gap: 40px; background: white; padding: 32px; border-radius: 16px; margin-bottom: 24px;">
                <div style="text-align: center;">
                    <div style="font-size: 14px; color: #64748b;">初次表現</div>
                    <div style="font-size: 32px; font-weight: bold; color: #94a3b8;">${GrowthState.originalScore}</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 24px; color: ${color};">➔</div>
                    <div style="font-size: 18px; font-weight: bold; color: ${color}; background: ${isPositive ? '#ecfdf5' : '#fef3c7'}; padding: 4px 12px; border-radius: 20px;">
                        ${isPositive ? '+' : ''}${data.delta} 分
                    </div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 14px; color: #0ea5e9; font-weight: bold;">實戰後表現</div>
                    <div style="font-size: 48px; font-weight: 900; color: #0ea5e9;">${data.new_score}</div>
                </div>
            </div>
            <div style="background: #f0f9ff; padding: 20px; border-radius: 12px; border-left: 4px solid #0ea5e9;">
                <div style="font-weight: bold; margin-bottom: 8px; color: black;">總結</div>
                <div style="line-height: 1.6; color: #334155;">${data.coach_comment}</div>
            </div>
        `;
    } catch (e) { zone.innerHTML = `<div style="color: red;">結算失敗。</div>`; }
}
