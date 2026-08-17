// ==========================================
// ⚔️ 面試戰場核心邏輯 (interview.js)
// 負責：讀取 interview.html（原本叫 index.html）交棒過來的第一題 → 送出使用者回答 →
//       接收下一題 → 結束時呼叫報告 API，並把結果交棒回 interview.html 顯示復盤報告。
// ==========================================

const INTERVIEW_API_BASE = 'https://offerdash.onrender.com/api';
const REPORT_FETCH_TIMEOUT_MS = 60000; // 報告生成允許的最長等待時間，超過就視為逾時，不讓畫面卡死
const NEXT_QUESTION_FETCH_TIMEOUT_MS = 45000; // 一般問答往返的逾時上限

// 帶逾時的 fetch：一般 fetch() 若伺服器完全沒回應（不是回錯誤碼，是真的掛住）會永遠 pending，
// 畫面就會卡在 Loading 狀態動彈不得。這裡用 AbortController 強制在 timeoutMs 後中斷請求。
async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeoutId);
    }
}

let arenaState = null; // { job_title, company_name, interview_type, interview_language, interview_difficulty, job_description, max_rounds, current_round, resume_url, chat_history }

const chatLog = document.getElementById('arenaChatLog');
const answerInput = document.getElementById('answerInput');
const submitBtn = document.getElementById('submitAnswerBtn');
const statusText = document.getElementById('arenaStatusText');
const aiPlayer = document.getElementById('aiPlayer');
const micBtn = document.getElementById('micBtn');

window.onload = async () => {
    const user = await checkAuthStatus();
    if (!user) return;

    const raw = sessionStorage.getItem('interviewArenaState');
    if (!raw) {
        // 沒有面試狀態代表不是正常從首頁點擊「INITIATE SEQUENCE」進來的，導回首頁重新設定
        window.location.href = '/frontend/pages/interview.html';
        return;
    }

    try {
        arenaState = JSON.parse(raw);
    } catch (error) {
        console.error('讀取面試狀態失敗:', error);
        window.location.href = '/frontend/pages/interview.html';
        return;
    }

    document.getElementById('arenaRoleMeta').innerText = `${arenaState.job_title} @ ${arenaState.company_name}`;
    updateProgress();

    // 顯示第一題 (已由首頁呼叫過一次 AI，這裡直接拿結果呈現，不必再打一次 API)
    appendMessage('ai', arenaState.latest_ai_text);
    playAISpeech(arenaState.latest_audio_base64, false);

    // Enter 直接送出回答，Shift+Enter 則是換行（一般聊天輸入框的慣例操作）
    answerInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitAnswer();
        }
    });

    initSpeechRecognition();
};

function updateProgress() {
    const current = Math.min(arenaState.current_round + 1, arenaState.max_rounds);
    document.getElementById('arenaQuestionIndex').innerText = current;
    document.getElementById('arenaQuestionTotal').innerText = arenaState.max_rounds;
    document.getElementById('arenaProgressFill').style.width = `${(current / arenaState.max_rounds) * 100}%`;
}

function appendMessage(role, text) {
    if (!text) return;
    const isAI = role === 'ai' || role === 'assistant';
    chatLog.insertAdjacentHTML('beforeend', `
        <div class="msg-block ${isAI ? 'ai' : 'user'}">
            <div class="msg-sender">${isAI ? 'AI 面試官' : 'YOU'}</div>
            <div class="${isAI ? 'ai-text' : 'user-text'}">${escapeHtml(text)}</div>
        </div>
    `);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function appendSystemNote(text, options = {}) {
    const { isError = false, withRetry = false } = options;
    const retryBtnHtml = withRetry
        ? `<button type="button" class="retry-report-btn" onclick="retryGenerateReport()">重試</button>`
        : '';
    chatLog.insertAdjacentHTML('beforeend',
        `<div class="system-text${isError ? ' error' : ''}">${escapeHtml(text)}${retryBtnHtml}</div>`);
    chatLog.scrollTop = chatLog.scrollHeight;
}

// ---------------------------
// 🔔 Toast 提示：確保 API 失敗時一定有明確、看得到的錯誤訊息，不會讓畫面看起來像死當
// ---------------------------
let arenaToastTimer = null;
function showArenaToast(message, type = 'error') {
    const toast = document.getElementById('arenaToast');
    if (!toast) return;

    const isError = type === 'error';
    const iconPath = isError
        ? '<path d="M12 9v4M12 17h.01"></path><circle cx="12" cy="12" r="10"></circle>'
        : '<path d="M20 6 9 17l-5-5"></path>';

    toast.className = `arena-toast ${isError ? 'toast-error' : ''}`;
    toast.innerHTML = `
        <svg class="toast-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg>
        <span>${escapeHtml(message)}</span>
    `;
    // 強制 reflow 讓 class 變動時 transition 能正確觸發
    void toast.offsetWidth;
    toast.classList.add('show');

    clearTimeout(arenaToastTimer);
    arenaToastTimer = setTimeout(() => toast.classList.remove('show'), isError ? 5000 : 3000);
}

// 依 HTTP 狀態碼給使用者看得懂的錯誤訊息，而不是單純的「發生錯誤」
function describeReportError(status) {
    if (status === 504) return '報告生成超時，請稍後重試';
    if (status === 500) return '伺服器錯誤，請稍後再試';
    if (status === 0 || status === undefined) return '無法連線到伺服器，請檢查網路後重試';
    return `報告生成失敗（錯誤代碼 ${status}），請稍後再試`;
}

function setInputEnabled(enabled) {
    answerInput.disabled = !enabled;
    submitBtn.disabled = !enabled;
    if (micBtn && speechRecognitionSupported) micBtn.disabled = !enabled;
    if (!enabled && isListening) recognition.stop();
    if (enabled) answerInput.focus();
}

// ---------------------------
// 🎙️ 語音輸入 (Speech-to-Text)：用瀏覽器原生 Web Speech API 辨識，音檔不會送到後端
// ---------------------------
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
const speechRecognitionSupported = !!SpeechRecognitionCtor;
let recognition = null;
let isListening = false;
let baseTranscriptBeforeListening = ''; // 開始收音那一刻，輸入框裡原本已經有的文字（避免蓋掉使用者手動打的內容）

function initSpeechRecognition() {
    if (!micBtn) return;

    if (!speechRecognitionSupported) {
        micBtn.disabled = true;
        micBtn.title = '此瀏覽器不支援語音輸入，請改用 Chrome 或 Edge';
        return;
    }

    recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    // 使用者停頓夠久沒說話時，瀏覽器會自動觸發 onend，onend 裡會自行復原按鈕狀態
    recognition.lang = arenaState && arenaState.interview_language === 'en' ? 'en-US' : 'zh-TW';

    recognition.onstart = () => {
        isListening = true;
        baseTranscriptBeforeListening = answerInput.value;
        micBtn.classList.add('listening');
        micBtn.title = '停止錄音';
    };

    recognition.onresult = (event) => {
        let finalChunk = '';
        let interimChunk = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalChunk += transcript;
            } else {
                interimChunk += transcript;
            }
        }
        if (finalChunk) baseTranscriptBeforeListening += finalChunk;
        // 即時把辨識中的暫定文字也顯示出來，讓使用者看到「正在聽」的回饋，說完後會被最終結果取代
        answerInput.value = (baseTranscriptBeforeListening + interimChunk).trim();
    };

    recognition.onerror = (event) => {
        console.error('[interview.js] 語音辨識錯誤:', event.error);
        if (event.error === 'not-allowed' || event.error === 'permission-denied') {
            showArenaToast('麥克風權限被拒絕，請在瀏覽器設定中允許存取麥克風後再試一次', 'error');
        } else if (event.error === 'no-speech') {
            // 沒偵測到聲音不是真正的錯誤（使用者可能只是還在想答案），不用跳錯誤提示
        } else {
            showArenaToast('語音辨識發生錯誤，請改用文字輸入', 'error');
        }
    };

    recognition.onend = () => {
        isListening = false;
        micBtn.classList.remove('listening');
        micBtn.title = '語音輸入';
    };
}

function toggleSpeechRecognition() {
    if (!speechRecognitionSupported || !recognition) {
        showArenaToast('此瀏覽器不支援語音輸入功能，請改用 Chrome 或 Edge', 'error');
        return;
    }
    if (isListening) {
        recognition.stop();
        return;
    }
    try {
        recognition.start();
    } catch (error) {
        console.error('[interview.js] 啟動語音辨識失敗:', error);
        showArenaToast('無法啟動語音輸入，請確認麥克風權限後再試一次', 'error');
    }
}

function buildInterviewFormData() {
    const formData = new FormData();
    formData.append('job_title', arenaState.job_title);
    formData.append('company_name', arenaState.company_name);
    formData.append('interview_type', arenaState.interview_type);
    formData.append('interview_language', arenaState.interview_language);
    formData.append('interview_difficulty', arenaState.interview_difficulty);
    if (arenaState.job_description) formData.append('job_description', arenaState.job_description);
    formData.append('chat_history_str', JSON.stringify(arenaState.chat_history));
    return formData;
}

// 播放 AI 語音；播放結束後才真正開放輸入框，讓使用者聽完問題再作答。
// 🔥 關鍵修正：isFinalMessage 時絕對不能把「生成報告」卡在 aiPlayer.onended 後面 ——
// 瀏覽器的自動播放政策隨時可能擋掉 aiPlayer.play()（尤其手機瀏覽器或使用者沒有互動過），
// 一旦被擋下，onended 永遠不會觸發，使用者就會卡在「按下最後一題送出後畫面沒反應」，
// 報告永遠生不出來。面試結束時，語音只是錦上添花，報告生成不該等它。
function playAISpeech(base64Audio, isFinalMessage) {
    if (isFinalMessage) {
        // 🔥 防呆：清掉上一輪（非最後一題）殘留的 onended/onerror handler。
        // 若不清掉，等下這句「最後一題」的音檔如果晚一點才自然播完，
        // 觸發的會是上一輪綁定的 onAISpeechEnded(false)，錯誤地把答題輸入框重新打開，
        // 跟這裡同時在跑的報告生成互相干擾。
        aiPlayer.onended = null;
        aiPlayer.onerror = null;
        if (base64Audio) {
            aiPlayer.src = `data:audio/mp3;base64,${base64Audio}`;
            aiPlayer.play().catch(() => {}); // 語音能播就播，播不了也不影響報告生成
        }
        finishInterviewAndGenerateReport();
        return;
    }

    if (!base64Audio) {
        onAISpeechEnded(isFinalMessage);
        return;
    }
    statusText.innerText = 'AI 面試官發言中...';
    aiPlayer.src = `data:audio/mp3;base64,${base64Audio}`;
    aiPlayer.play().catch(() => {}); // 瀏覽器可能封鎖自動播放，不影響文字流程
    aiPlayer.onended = () => onAISpeechEnded(isFinalMessage);
    // 保險：萬一 onended 因某些瀏覽器/音檔異常而沒有觸發，也不該讓使用者永遠卡住無法輸入
    aiPlayer.onerror = () => onAISpeechEnded(isFinalMessage);
}

function onAISpeechEnded(isFinalMessage) {
    if (isFinalMessage) {
        finishInterviewAndGenerateReport();
        return;
    }
    statusText.innerText = '請輸入你的回答';
    setInputEnabled(true);
}

// 把 FormData 轉成方便 console.log 檢查的純物件（音檔/履歷等 File 物件只顯示檔名與大小，避免整包印出來）
function formDataToLoggableObject(formData) {
    const obj = {};
    for (const [key, value] of formData.entries()) {
        obj[key] = (value instanceof Blob)
            ? `[Blob/File: ${value.name || '(no name)'}, ${value.size} bytes]`
            : value;
    }
    return obj;
}

async function submitAnswer() {
    const answer = answerInput.value.trim();
    if (!answer) return;

    setInputEnabled(false);
    statusText.innerText = '正在傳送給 AI 面試官...';
    appendMessage('user', answer);
    answerInput.value = '';

    const isFinalRound = (arenaState.current_round + 1 >= arenaState.max_rounds);

    const formData = buildInterviewFormData();
    formData.append('audio_file', new Blob([''], { type: 'audio/webm' }), 'empty.webm');
    formData.append('text_answer', answer);
    formData.append('is_final_round', isFinalRound ? 'true' : 'false');

    console.log('[interview.js] POST /interview/next payload:', formDataToLoggableObject(formData));

    try {
        const response = await fetchWithTimeout(
            `${INTERVIEW_API_BASE}/interview/next`,
            { method: 'POST', body: formData },
            NEXT_QUESTION_FETCH_TIMEOUT_MS
        );
        if (!response.ok) {
            console.error(`[interview.js] /interview/next 回傳非 2xx 狀態碼: ${response.status}`);
            throw new Error(`API Error (${response.status})`);
        }
        const data = await response.json();

        arenaState.chat_history = data.chat_history;
        arenaState.current_round++;
        sessionStorage.setItem('interviewArenaState', JSON.stringify(arenaState));

        updateProgress();
        appendMessage('ai', data.ai_text);
        playAISpeech(data.audio_base64, isFinalRound);
    } catch (error) {
        const isTimeout = error.name === 'AbortError';
        console.error(`傳送回答失敗${isTimeout ? '（逾時）' : ''}:`, error);
        const message = isTimeout ? '回應逾時，請重新輸入後再試一次' : '傳送回答失敗，請重新輸入後再試一次';
        showArenaToast(message, 'error');
        statusText.innerText = message;
        setInputEnabled(true);
    }
}

// 防止「重試」按鈕被連點造成同時打兩個 /interview/report 請求
let isGeneratingReport = false;

async function finishInterviewAndGenerateReport() {
    if (isGeneratingReport) {
        console.warn('[interview.js] 報告生成中，忽略重複觸發');
        return;
    }
    isGeneratingReport = true;

    statusText.innerText = '面試結束，正在生成復盤報告...';
    appendSystemNote('> 面試結束，正在生成分析報告...');
    setInputEnabled(false);

    const formData = buildInterviewFormData();

    // 🔍 除錯用：送出前印出完整 payload（含 job_title/company_name/interview_type/
    //    interview_language/interview_difficulty/job_description/chat_history_str），
    //    以及當下的 arenaState 全貌，方便檢查是否有資料在半路遺失
    console.log('[interview.js] POST /interview/report payload:', formDataToLoggableObject(formData));
    console.log('[interview.js] 目前的 arenaState（面試設定 + 對話紀錄）:', arenaState);

    let response;
    try {
        response = await fetchWithTimeout(
            `${INTERVIEW_API_BASE}/interview/report`,
            { method: 'POST', body: formData },
            REPORT_FETCH_TIMEOUT_MS
        );
    } catch (networkError) {
        // AbortError = 我們自己設的逾時中斷；其餘才是離線/伺服器完全連不上等真正的網路層失敗
        const isTimeout = networkError.name === 'AbortError';
        console.error(`[interview.js] 呼叫 /interview/report 時${isTimeout ? '逾時（超過 ' + REPORT_FETCH_TIMEOUT_MS + 'ms）' : '網路層失敗'}:`, networkError);
        handleReportGenerationFailure(describeReportError(isTimeout ? 504 : 0));
        isGeneratingReport = false;
        return;
    }

    if (!response.ok) {
        console.error(`[interview.js] /interview/report 回傳非 2xx 狀態碼: ${response.status} ${response.statusText}`);
        handleReportGenerationFailure(describeReportError(response.status));
        isGeneratingReport = false;
        return;
    }

    let data;
    try {
        data = await response.json();
    } catch (parseError) {
        console.error('[interview.js] 解析 /interview/report 回傳的 JSON 失敗:', parseError);
        handleReportGenerationFailure('伺服器回傳的資料格式異常，請稍後再試');
        isGeneratingReport = false;
        return;
    }

    console.log('[interview.js] /interview/report 回傳成功:', data);

    // 把「已經 fetch 好」的報告資料與這場面試的基本資訊交棒回首頁顯示
    sessionStorage.setItem('pendingInterviewReport', JSON.stringify({
        data: data,
        meta: {
            job_title: arenaState.job_title,
            company_name: arenaState.company_name,
            transcript: arenaState.chat_history,
            resume_url: arenaState.resume_url
        }
    }));
    sessionStorage.removeItem('interviewArenaState');

    window.location.href = '/frontend/pages/interview.html?feature=interview';
}

// 報告生成失敗時的統一收尾：結束 Loading 狀態、跳出明確錯誤 Toast，並在對話紀錄留下「重試」按鈕，
// 確保使用者不會卡在「畫面沒反應、不知道發生什麼事」的死當狀態
function handleReportGenerationFailure(message) {
    showArenaToast(message, 'error');
    statusText.innerText = message;
    appendSystemNote(`> ${message}`, { isError: true, withRetry: true });
}

// 提供給錯誤訊息裡的「重試」按鈕呼叫，重新嘗試生成報告
function retryGenerateReport() {
    appendSystemNote('> 正在重新嘗試生成報告...');
    finishInterviewAndGenerateReport();
}
