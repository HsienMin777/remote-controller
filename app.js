// ==========================================
// 1. 全域變數與 API 基礎設定 (Global Variables)
// ==========================================
const API_BASE = "http://localhost:8000/api";
const backendUrl = `${API_BASE}/interview/next`;
const reportUrl = `${API_BASE}/interview/report`;

// 面試狀態與音訊變數
let mediaRecorder = null;
let audioChunks = [];
let chatHistory = [];
let audioContext = null;
let audioSource = null;
let analyser = null;
let animationId = null;

// 流程控制變數
let isSetupMode = true;
let currentRound = 0;
let MAX_ROUNDS = 2;
let currentReportPayload = null;
let resumeFile = null;
let uploadedResumeUrl = null;
let currentInputMode = 'voice'; 

// ==========================================
// 2. DOM 元素抓取 (DOM Elements)
// ==========================================
const dialogueBox = document.getElementById("dialogueBox");
const startBtn = document.getElementById("mainBtn");
const stopBtn = document.getElementById("stopBtn");
const statusIndicator = document.getElementById("statusIndicator");
const statusLabel = document.getElementById("statusLabel");
const aiPlayer = document.getElementById("aiPlayer");
const visualizerContainer = document.getElementById("visualizerContainer");
const canvas = document.getElementById("visualizer");
const canvasCtx = canvas ? canvas.getContext("2d") : null;
const jobTitleInput = document.getElementById("jobTitle");
const companyNameInput = document.getElementById("companyName");

// ==========================================
// 3. 初始化與權限檢查 (Init & Auth)
// ==========================================
let currentUser = null;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. 檢查登入狀態 (請確保 checkAuthStatus 已經定義)
    if (typeof checkAuthStatus === 'function') {
        currentUser = await checkAuthStatus();
        if (!currentUser) return;
        console.log("使用者已登入:", currentUser.email);
    }

    // 2. 綁定按鈕與輸入框狀態
    if (jobTitleInput && companyNameInput) {
        jobTitleInput.addEventListener("input", checkInputs);
        companyNameInput.addEventListener("input", checkInputs);
        checkInputs();
    }
    if (startBtn) startBtn.onclick = handleMainAction;

    // 3. 初始化上傳區塊
    setupUploadZone('uploadZone', 'resumeUpload', 'uploadText');
    setupUploadZone('interviewUploadZone', 'interviewResumeUpload', 'interviewUploadText');

    // 4. 解析網址參數 (自動切換到 JD 功能)
    const urlParams = new URLSearchParams(window.location.search);
    const initialFeature = urlParams.get('feature') === 'jd' ? 'jd' : 'interview';
    switchFeature(initialFeature, { updateHistory: false });
});

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

// Growth Engine V2 overrides are appended near the end of the file.

// 功能分頁切換
function switchFeature(featureName, options = {}) {
    const { updateHistory = true } = options;

    if (featureName === 'dashboard') {
        window.location.href = 'dashboard.html';
        return;
    }

    document.querySelectorAll('.sidebar .menu-item').forEach(item => item.classList.remove('active'));
    document.querySelectorAll('.view-section').forEach(view => {
        view.classList.remove('active');
        if (view.id === 'reportCard') view.style.display = 'none'; // 確保報告卡片隱藏
    });

    const targetMenu = document.getElementById(`menu-${featureName}`);
    const targetView = document.getElementById(`view-${featureName}`);
    const canvasCard = document.querySelector('.canvas-card');
    
    if (targetMenu) targetMenu.classList.add('active');
    if (targetView) targetView.classList.add('active');
    if (canvasCard) canvasCard.style.display = featureName === 'interview' ? 'flex' : 'none';

    if (updateHistory) {
        const nextUrl = featureName === 'jd' ? 'index.html?feature=jd' : 'index.html';
        history.pushState({ feature: featureName }, '', nextUrl);
    }

    // 手機版自動收合
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar && !sidebar.classList.contains('collapsed')) sidebar.classList.add('collapsed');
    if (overlay && !overlay.classList.contains('hidden')) overlay.classList.add('hidden');
}

// 驗證輸入框解鎖按鈕
window.addEventListener('popstate', () => {
    const urlParams = new URLSearchParams(window.location.search);
    switchFeature(urlParams.get('feature') === 'jd' ? 'jd' : 'interview', { updateHistory: false });
});

function checkInputs() {
    if (!jobTitleInput || !companyNameInput || !startBtn) return;
    startBtn.disabled = !(jobTitleInput.value.trim() && companyNameInput.value.trim());
}


function toggleDropdown() {
    toggleGenericDropdown('typeSelectTrigger', 'typeOptions');
}

function toggleLangDropdown() {
    toggleGenericDropdown('langSelectTrigger', 'langOptions');
}

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

// 面試設定選擇器 (語言、類型、回合數)
function selectLang(value, text) {
    document.getElementById('interviewLanguage').value = value;
    document.getElementById('langSelectText').innerText = text;
    toggleGenericDropdown('langSelectTrigger', 'langOptions');
    updateOptionSelection('langOptions', text);
}

function selectType(value, text) {
    document.getElementById('interviewType').value = value;
    document.getElementById('typeSelectText').innerText = text;
    toggleGenericDropdown('typeSelectTrigger', 'typeOptions');
    updateOptionSelection('typeOptions', text);
}

function selectRounds(value, text) {
    document.getElementById('interviewRounds').value = value;
    document.getElementById('roundsSelectText').innerText = text;
    updateOptionSelection('roundsOptions', text);
}

function updateOptionSelection(containerId, text) {
    document.querySelectorAll(`#${containerId} .custom-option`).forEach(opt => {
        opt.classList.toggle('selected', opt.innerText === text);
    });
}

// ==========================================
// 5. 音訊與視覺化處理 (Audio & Visualizer)
// ==========================================
function getSupportedMimeType() {
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/wav"];
    return types.find(type => MediaRecorder.isTypeSupported(type)) || "";
}

function visualize(stream) {
    if (!canvasCtx) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    audioSource = audioContext.createMediaStreamSource(stream);
    audioSource.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    canvas.width = visualizerContainer.clientWidth;
    canvas.height = visualizerContainer.clientHeight;
    const barWidth = (canvas.width / bufferLength) * 1.2;

    function draw() {
        animationId = requestAnimationFrame(draw);
        let x = 0;
        analyser.getByteFrequencyData(dataArray);
        canvasCtx.fillStyle = 'rgba(5, 5, 10, 0.8)';
        canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
        canvasCtx.fillStyle = '#0ea5e9';
        canvasCtx.shadowBlur = 15;
        canvasCtx.shadowColor = '#0ea5e9';

        for (let i = 0; i < bufferLength; i++) {
            let barHeight = (dataArray[i] / 255) * canvas.height;
            canvasCtx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);
            x += barWidth;
        }
    }
    draw();
}

// ==========================================
// 6. 面試主流程 (Interview Workflow)
// ==========================================
async function handleMainAction() {
    if (isSetupMode) {
        startInterviewView();
        await sendInitialRequestToAI();
    } else {
        await startRecording();
    }
}

function startInterviewView() {
    isSetupMode = false;
    document.getElementById("setupCard").classList.add("hidden");
    const toggle = document.getElementById("inputModeToggle");
    if (toggle) toggle.classList.remove("hidden");

    dialogueBox.innerHTML = `<div class="system-text">sys_init: connecting to AI module...</div>`;
    updateStatus("processing", "Connecting...");
}

async function startRecording() {
    audioChunks = [];
    updateStatus("recording", "Recording Audio...");
    startBtn.style.display = "none";
    stopBtn.style.display = "flex";

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = getSupportedMimeType();
        visualizerContainer.style.display = "flex";
        visualize(stream);

        mediaRecorder = new MediaRecorder(stream, { mimeType: mimeType });
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.onstop = async () => {
            updateStatus("processing", "Transmitting to AI...");
            await sendVoiceToAI(new Blob(audioChunks, { type: mimeType }), mimeType);
        };
        mediaRecorder.start();
    } catch (err) {
        console.error(err);
        updateStatus("error", "Microphone access denied.");
        restoreInputArea();
    }
}

function stopInterviewWorkflow() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
    if (animationId) cancelAnimationFrame(animationId);
    if (audioContext) audioContext.close();
    visualizerContainer.style.display = "none";
}

// ==========================================
// 7. API 通訊 (API Communication)
// ==========================================
function buildBaseFormData() {
    const role = document.getElementById("jobTitle").value || "工程師";
    const company = document.getElementById("companyName").value || "科技公司";
    const type = document.getElementById("interviewType")?.value || "job";
    const language = document.getElementById("interviewLanguage")?.value || "zh";
    
    const formData = new FormData();
    formData.append("job_title", role);
    formData.append("company_name", company);
    formData.append("interview_type", type);
    formData.append("interview_language", language);
    return formData;
}

async function sendInitialRequestToAI() {
    const roundsInput = document.getElementById("interviewRounds");
    MAX_ROUNDS = parseInt(roundsInput?.value, 10) || 5;
    if (MAX_ROUNDS < 1) MAX_ROUNDS = 1;
    if (MAX_ROUNDS > 20) MAX_ROUNDS = 20;

    const formData = buildBaseFormData();
    formData.append("audio_file", new Blob([""], { type: "audio/webm" }), "empty.webm");
    formData.append("chat_history_str", JSON.stringify([]));
    if (resumeFile) formData.append("resume_file", resumeFile);

    try {
        const response = await fetch(backendUrl, { method: "POST", body: formData });
        if (!response.ok) throw new Error("API Error");
        const data = await response.json();
        
        if (data.resume_url) uploadedResumeUrl = data.resume_url;
        chatHistory = data.chat_history;
        
        renderDialogue(null, data.ai_text);
        playAISpeech(data.audio_base64);
    } catch (error) {
        updateStatus("error", "Connection Failed.");
        restoreInputArea();
    }
}

async function sendVoiceToAI(audioBlob, mimeType) {
    const fileExt = mimeType.includes("mp4") ? "m4a" : "webm";
    const isFinalRound = (currentRound + 1 >= MAX_ROUNDS) ? "true" : "false";

    const formData = buildBaseFormData();
    formData.append("audio_file", audioBlob, `user_voice.${fileExt}`);
    formData.append("chat_history_str", JSON.stringify(chatHistory));
    formData.append("is_final_round", isFinalRound);

    try {
        const response = await fetch(backendUrl, { method: "POST", body: formData });
        if (!response.ok) throw new Error("API Error");
        const data = await response.json();
        
        chatHistory = data.chat_history;
        currentRound++;
        renderDialogue(data.user_text, data.ai_text);
        playAISpeech(data.audio_base64);
    } catch (error) {
        updateStatus("error", "Connection Failed.");
        restoreInputArea();
    }
}

async function submitTextAnswer() {
    const inputEl = document.getElementById("userTextInput");
    const typedText = inputEl.value.trim();
    if (!typedText) return;

    inputEl.value = "";
    updateStatus("processing", "Transmitting to AI...");
    document.getElementById("textInputContainer").classList.add("hidden");
    document.getElementById("inputModeToggle").classList.add("hidden");

    const isFinalRound = (currentRound + 1 >= MAX_ROUNDS) ? "true" : "false";
    const formData = buildBaseFormData();
    formData.append("audio_file", new Blob([""], { type: "audio/webm" }), "empty.webm");
    formData.append("chat_history_str", JSON.stringify(chatHistory));
    formData.append("text_answer", typedText);
    formData.append("is_final_round", isFinalRound);

    try {
        const response = await fetch(backendUrl, { method: "POST", body: formData });
        if (!response.ok) throw new Error("API Error");
        const data = await response.json();

        chatHistory = data.chat_history;
        currentRound++;
        renderDialogue(typedText, data.ai_text);
        playAISpeech(data.audio_base64);
    } catch (error) {
        updateStatus("error", "Connection Failed.");
        restoreInputArea();
    }
}

// ==========================================
// 8. UI 控制邏輯 (UI Controls)
// ==========================================
function switchInputMode(mode) {
    currentInputMode = mode;
    document.getElementById("modeVoiceBtn")?.classList.toggle("active", mode === 'voice');
    document.getElementById("modeTextBtn")?.classList.toggle("active", mode === 'text');
    
    if (mode === 'voice') {
        startBtn.style.display = "flex";
        document.getElementById("textInputContainer")?.classList.add("hidden");
    } else {
        startBtn.style.display = "none";
        document.getElementById("textInputContainer")?.classList.remove("hidden");
        visualizerContainer.style.display = "none";
        stopInterviewWorkflow();
    }
}

function restoreInputArea() {
    document.getElementById("inputModeToggle")?.classList.remove("hidden");
    if (currentInputMode === 'voice') {
        startBtn.style.display = "flex";
        stopBtn.style.display = "none";
        startBtn.innerText = "Transmit Audio";
    } else {
        document.getElementById("textInputContainer")?.classList.remove("hidden");
    }
}

function renderDialogue(userTxt, aiTxt) {
    if (userTxt) {
        dialogueBox.innerHTML += `<div class="msg-block user"><div class="msg-sender">USER</div><div class="user-text">${userTxt}</div></div>`;
    }
    if (aiTxt) {
        dialogueBox.innerHTML += `<div class="msg-block ai"><div class="msg-sender">SYSTEM</div><div class="ai-text">${aiTxt}</div></div>`;
    }
    dialogueBox.scrollTop = dialogueBox.scrollHeight;
}

function playAISpeech(base64Audio) {
    updateStatus("processing", "System is speaking...");
    aiPlayer.src = `data:audio/mp3;base64,${base64Audio}`;
    aiPlayer.play();

    aiPlayer.onended = () => {
        if (currentRound >= MAX_ROUNDS) {
            updateStatus("standby", "Interview Completed");
            document.querySelector(".controls").style.display = "none";
            document.getElementById("inputModeToggle")?.classList.add("hidden");
            document.getElementById("textInputContainer")?.classList.add("hidden");
            generateReport();
        } else {
            updateStatus("standby", "Ready for Input");
            restoreInputArea();
        }
    };
}

function updateStatus(state, message) {
    if (!statusIndicator || !statusLabel) return;
    statusLabel.innerText = message;
    statusIndicator.className = "status-dot";
    
    const colors = { recording: '#ef4444', processing: '#3b82f6', standby: '#10b981' };
    statusIndicator.style.background = colors[state] || '#475569';
    statusIndicator.style.boxShadow = colors[state] ? `0 0 10px ${colors[state]}` : 'none';
}

// ==========================================
// 9. 履歷上傳與 ATS 解析 (Resume & JD)
// ==========================================
function setupUploadZone(zoneId, inputId, textId) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    const textElement = document.getElementById(textId);
    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', function () { if (this.files[0]) handleFileUpload(this.files[0], textElement); });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.background = "rgba(14, 165, 233, 0.1)"; });
    zone.addEventListener('dragleave', (e) => { e.preventDefault(); zone.style.background = "rgba(0, 0, 0, 0.2)"; });
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.style.background = "rgba(0, 0, 0, 0.2)";
        if (e.dataTransfer.files[0]) handleFileUpload(e.dataTransfer.files[0], textElement);
    });
}

function handleFileUpload(file, textElement) {
    if (file.type !== "application/pdf") return alert("目前只支援 PDF 格式的履歷喔！");
    resumeFile = file;
    if (textElement) {
        textElement.innerText = `已載入履歷：${file.name}`;
        textElement.style.color = "var(--success)";
    }
}

async function analyzeResumeMatch() {
    if (!resumeFile) return alert("請先上傳 PDF 履歷！");
    const jdText = document.getElementById("jobDescription")?.value.trim();
    if (!jdText) return alert("請貼上職缺描述 (JD)！");

    const btn = document.getElementById("analyzeJdBtn");
    btn.innerText = "⏳ 解析中...";
    btn.disabled = true;

    const formData = new FormData();
    formData.append("resume_file", resumeFile);
    formData.append("job_title", document.getElementById("jdJobTitle")?.value || "工程師");
    formData.append("company_name", document.getElementById("jdCompanyName")?.value || "科技公司");
    formData.append("job_description", jdText);

    try {
        const response = await fetch(`${API_BASE}/interview/analyze-jd`, { method: "POST", body: formData });
        const data = await response.json();
        if (data.error) throw new Error(data.error);

        document.getElementById("jdMatchScore").innerText = `${data.match_score}%`;
        document.getElementById("jdMatchScore").style.color = data.match_score >= 80 ? '#10b981' : (data.match_score >= 60 ? '#f59e0b' : '#ef4444');
        document.getElementById("jdMissingSkills").innerText = data.missing_skills.join("、 ");
        document.getElementById("jdAdvice").innerText = data.advice;
        
        const qsList = document.getElementById("jdPredictedQs");
        qsList.innerHTML = data.predicted_questions.map(q => `<li>${q}</li>`).join("");

        document.getElementById("jdAnalysisResult").classList.remove("hidden");
        btn.style.display = "none";
    } catch (error) {
        alert("分析失敗: " + error.message);
        btn.innerText = "🔍 預先分析履歷契合度與預測考題";
        btn.disabled = false;
    }
}

// ==========================================
// 10. 產生與儲存報告 (Report & DB)
// ==========================================
async function generateReport() {
    updateStatus("processing", "Analyzing Interview Data...");
    if (startBtn) {
        startBtn.innerText = "報告分析中...";
        startBtn.disabled = true;
    }

    if (dialogueBox) {
        dialogueBox.innerHTML += `<div class="system-text">> 面試結束，正在生成分析報告...</div>`;
        dialogueBox.scrollTop = dialogueBox.scrollHeight;
    }

    const formData = buildBaseFormData();
    formData.append("chat_history_str", JSON.stringify(chatHistory));

    try {
        const response = await fetch(reportUrl, { method: "POST", body: formData });
        if (!response.ok) throw new Error("報告生成失敗");
        const data = await response.json();

        currentReportPayload = {
            job_title: formData.get("job_title"),
            company_name: formData.get("company_name"),
            total_score: data.total_score,
            short_feedback: data.short_feedback,
            detailed_scores: data.detailed_scores,
            strengths: data.strengths,
            improvements: data.improvements,
            transcript: chatHistory,
            resumeUrl: uploadedResumeUrl
        };

        // ==========================================
        // 1. 切換 UI：隱藏面試元件，顯示報告卡片
        // ==========================================
        document.getElementById('view-interview')?.classList.remove('active');
        
        if (document.getElementById('setupCard')) document.getElementById('setupCard').style.display = 'none';
        if (document.querySelector('.canvas-card')) document.querySelector('.canvas-card').style.display = 'none';
        if (document.querySelector('.controls')) document.querySelector('.controls').style.display = 'none';
        if (document.getElementById('dialogueBox')) document.getElementById('dialogueBox').style.display = 'none'; 
        if (document.getElementById('inputModeToggle')) document.getElementById('inputModeToggle').style.display = 'none';
        
        const reportCard = document.getElementById('reportCard');
        if (reportCard) {
            reportCard.classList.add('active');
            reportCard.style.display = 'block';
        }

        // 🔥 關鍵 UX 優化：將畫面平滑滾動到最上方，讓使用者第一眼看到自己的分數
        window.scrollTo({ top: 0, behavior: 'smooth' });

        // ==========================================
        // 2. 渲染資料
        // ==========================================
        if (document.getElementById("detailRole")) document.getElementById("detailRole").innerText = `${currentReportPayload.job_title} - ${currentReportPayload.company_name}`;
        if (document.getElementById("detailScore")) document.getElementById("detailScore").innerText = data.total_score;
        if (document.getElementById("detailFeedback")) document.getElementById("detailFeedback").innerText = data.short_feedback;
        if (document.getElementById("strengthsList")) document.getElementById("strengthsList").innerHTML = data.strengths.map(s => `<li>${s}</li>`).join("");
        if (document.getElementById("improvementsList")) document.getElementById("improvementsList").innerHTML = data.improvements.map(i => `<li>${i}</li>`).join("");
        
        const skillsContainer = document.getElementById("skillsContainer");
        if (skillsContainer) {
            skillsContainer.innerHTML = Object.entries(data.detailed_scores).map(([skill, score]) => `
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

        const transcriptBody = document.getElementById("transcriptBody");
        if (transcriptBody) {
            transcriptBody.innerHTML = chatHistory.map(msg => {
                // 🔥 修正：OpenAI 的回覆 role 通常是 'assistant'
                const isAI = msg.role === 'ai' || msg.role === 'assistant';
                return `
                <div class="msg-block ${msg.role}" style="margin-bottom: 16px; padding: 12px; border-radius: 8px; background: ${isAI ? 'rgba(255,255,255,0.05)' : 'rgba(14,165,233,0.1)'};">
                    <div style="font-size:12px; color:var(--text-muted); font-weight:bold; margin-bottom:4px;">${isAI ? 'SYSTEM (AI)' : 'YOU'}</div>
                    <div style="font-size:14px; line-height:1.5;">${msg.content}</div>
                </div>
            `}).join("");
        }

        // ==========================================
        // 3. 注入控制按鈕與修煉區
        // ==========================================
        document.getElementById("reportActions")?.remove();
        document.getElementById('reportCard').insertAdjacentHTML('beforeend', `
            <div id="reportActions" style="margin-top: 40px; display: flex; gap: 16px; justify-content: center; padding-bottom: 40px;">
                <button onclick="discardAndRetry()" style="padding: 12px 24px; border: 1px solid #f87171; color: #f87171; border-radius: 8px; cursor: pointer; background: transparent; font-weight:bold;">🗑️ 捨棄並重新面試</button>
                <button id="saveBtn" onclick="saveReportToDB()" style="padding: 12px 24px; background: var(--accent); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight:bold;">💾 儲存並前往資料庫</button>
            </div>
        `);
        
        // 觸發賽後修煉區
        setTimeout(() => triggerGrowthZoneHook(currentReportPayload), 500);

    } catch (error) {
        updateStatus("error", "Report Failed.");
        if (startBtn) { startBtn.innerText = "重新產生報告"; startBtn.disabled = false; }
    }
}

let globalInterviewRecords = [];

// 撈取歷史紀錄 (你原本可能在網頁載入時有呼叫這個)
async function fetchInterviewHistory() {
    try {
        const response = await fetch(`${API_BASE}/interview/history`);
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
}


// 唯一保留的 saveReportToDB (優化版)
async function saveReportToDB() {
    if (!currentReportPayload) return;
    const saveBtn = document.getElementById("saveBtn");
    if (saveBtn) { saveBtn.innerText = "⏳ 儲存中..."; saveBtn.disabled = true; }

    if (dialogueBox) {
        dialogueBox.innerHTML += `<div class="system-text">> 報告產生完畢，正在儲存至資料庫...</div>`;
        dialogueBox.scrollTop = dialogueBox.scrollHeight;
    }

    try {
        const response = await fetch(`${API_BASE}/interview/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentReportPayload)
        });
        if (!response.ok) throw new Error("儲存失敗");
        window.location.href = "dashboard.html";
    } catch (error) {
        alert("資料庫連線失敗，但報告已產生。");
        window.location.href = "dashboard.html";
    }
}

function discardAndRetry() {
    // 1. 隱藏報告卡片
    const reportCard = document.getElementById('reportCard');
    if (reportCard) {
        reportCard.classList.remove('active');
        reportCard.style.display = 'none';
    }

    // 2. 將面試畫面的零件「顯示」回來
    if (document.getElementById('setupCard')) document.getElementById('setupCard').style.display = 'block'; // 顯示設定卡片
    if (document.querySelector('.canvas-card')) document.querySelector('.canvas-card').style.display = 'flex'; // 顯示視覺化聲波
    if (document.querySelector('.controls')) document.querySelector('.controls').style.display = 'flex'; // 顯示按鈕區
    if (document.getElementById('dialogueBox')) document.getElementById('dialogueBox').style.display = 'block'; // 顯示對話框
    if (document.getElementById('view-interview')) document.getElementById('view-interview').classList.add('active');

    // 3. 重置面試狀態與對話內容
    chatHistory = [];
    currentRound = 0;
    isSetupMode = true;
    currentReportPayload = null;
    
    // 恢復對話框的預設文字
    const dialogueBox = document.getElementById('dialogueBox');
    if (dialogueBox) dialogueBox.innerHTML = '<div class="system-text">> awaiting user parameters...</div>';
    
    // 恢復開始按鈕狀態
    if (startBtn) {
        startBtn.style.display = "flex";
        startBtn.disabled = false;
        startBtn.innerText = "INITIATE SEQUENCE";
    }
    if (stopBtn) stopBtn.style.display = 'none';
    
    // 恢復輸入模式 (語音/文字) 的 UI
    document.getElementById('textInputContainer')?.classList.add('hidden');
    document.getElementById('voiceInputContainer')?.classList.remove('hidden');
    if (document.getElementById('inputModeToggle')) document.getElementById('inputModeToggle').style.display = 'flex';

    updateStatus("standby", "Standby");
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

// 整合儀表板/報告產生後的 Hook
function triggerGrowthZoneHook(record) {
    const jobTitle = record.job_title || "未定職缺";
    const originalScore = record.total_score || 0;
    let worstAnswer = "我在專案中負責優化，效能有變好。"; 
    
    if (record.transcript && record.transcript.length > 0) {
        const userAnswers = record.transcript.filter(msg => msg.role === "user" && !msg.content.includes("未提供") && !msg.content.includes("不清晰"));
        if (userAnswers.length > 0) {
            userAnswers.sort((a, b) => a.content.length - b.content.length);
            worstAnswer = userAnswers[0].content;
        }
    }
    initGrowthZone(jobTitle, "LACK_OF_DATA", worstAnswer, originalScore);
}

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
            <h3 style="color: #0ea5e9; margin-top: 0;">💡 教練點評與示範</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px;">
                <div style="background: rgba(239, 68, 68, 0.1); padding: 16px; border-radius: 12px; border-top: 3px solid #ef4444;">
                    <div style="font-size: 12px; color: #ef4444; margin-bottom: 8px;">你的原本回答</div>
                    <div>${data.user_version}</div>
                </div>
                <div style="background: rgba(16, 185, 129, 0.1); padding: 16px; border-radius: 12px; border-top: 3px solid #10b981;">
                    <div style="font-size: 12px; color: #10b981; font-weight: bold; margin-bottom: 8px;">✨ 教練高分範例</div>
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
        chatBox.innerHTML += `<div style="margin-bottom: 12px; color: #f59e0b; text-align: center;">-- 實戰結束，教練正在結算分數 --</div>`;
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
                <div style="font-weight: bold; margin-bottom: 8px; color: black;">👨‍🏫 教練總結</div>
                <div style="line-height: 1.6; color: #334155;">${data.coach_comment}</div>
            </div>
        `;
    } catch (e) { zone.innerHTML = `<div style="color: red;">結算失敗。</div>`; }
}
