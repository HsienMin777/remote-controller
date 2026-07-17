// ==========================================
// 💬 AI 面試諮詢室核心邏輯 (consultant.js)
// ==========================================

const CONSULTANT_API_BASE = 'http://127.0.0.1:8000/api';
const CONSULTANT_MAX_CHARS = 500;

// 空狀態引導：無限循環跑馬燈展示的 15 個萬用問題
const QUICK_QUESTIONS = [
    '一分鐘自我介紹', '如何突顯個人優勢？', '沒經驗怎麼爭取？', '怎麼解釋履歷空窗？',
    '最大缺點怎麼答？', '為什麼想應徵這裡？', '離職原因怎麼說？', '挫折經驗怎麼回答？',
    '意見不合怎麼處理？', '遇到不會的題怎辦？', '面試太緊張怎麼辦？', '如何展現抗壓性？',
    '期望薪資怎麼談？', '最後一題該問什麼？', '面試感謝信怎麼寫？'
];

let consultantRemainingQuota = 0;

const chatLog = document.getElementById('consultantChatLog');
const inputEl = document.getElementById('consultantInput');
const sendBtn = document.getElementById('sendConsultantBtn');
const quotaText = document.getElementById('consultantQuotaText');
const charCount = document.getElementById('consultantCharCount');

window.onload = async () => {
    const user = await checkAuthStatus();
    if (!user) return;

    renderTicker();

    inputEl.addEventListener('input', updateCharCount);
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendConsultantMessage();
    });

    await refreshQuota();
};

// 渲染跑馬燈：把 15 題陣列複製一份接在後面，達成無縫循環（動畫跑到 -50% 時視覺上正好接回開頭）
function renderTicker() {
    const track = document.getElementById('tickerTrack');
    if (!track) return;
    const items = [...QUICK_QUESTIONS, ...QUICK_QUESTIONS];
    track.innerHTML = items.map(q => `<div class="quick-chip" onclick="useQuickChip(this)">${escapeHtml(q)}</div>`).join('');
}

async function refreshQuota() {
    try {
        const response = await fetch(`${CONSULTANT_API_BASE}/consultant/quota`, {
            headers: await getAuthHeaders()
        });
        if (!response.ok) throw new Error('讀取額度失敗');
        const data = await response.json();
        applyQuota(data.remaining_quota, data.daily_limit);
    } catch (error) {
        console.error('讀取諮詢額度失敗:', error);
        quotaText.innerText = '- / 5';
    }
}

function applyQuota(remaining, dailyLimit) {
    consultantRemainingQuota = remaining;
    quotaText.innerText = `${remaining} / ${dailyLimit}`;
    quotaText.classList.toggle('exhausted', remaining <= 0);

    if (remaining <= 0) {
        inputEl.disabled = true;
        sendBtn.disabled = true;
        inputEl.placeholder = '今日諮詢次數已用完，明天再來吧！';
    } else {
        inputEl.disabled = false;
        updateCharCount();
    }
}

function updateCharCount() {
    const len = inputEl.value.length;
    charCount.innerText = `${len} / ${CONSULTANT_MAX_CHARS}`;
    charCount.classList.toggle('over-limit', len > CONSULTANT_MAX_CHARS);
    sendBtn.disabled = consultantRemainingQuota <= 0 || len === 0 || len > CONSULTANT_MAX_CHARS;
}

// 快速提問標籤：填入問題並直接送出
function useQuickChip(el) {
    if (consultantRemainingQuota <= 0) return;
    inputEl.value = el.innerText;
    sendConsultantMessage();
}

function appendMessage(role, text) {
    const isAI = role === 'ai';
    chatLog.insertAdjacentHTML('beforeend', `
        <div class="msg-block ${isAI ? 'ai' : 'user'}">
            <div class="msg-sender">${isAI ? 'AI 諮詢師' : 'YOU'}</div>
            <div class="${isAI ? 'ai-text' : 'user-text'}">${escapeHtml(text)}</div>
        </div>
    `);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function appendSystemNote(text, isError = false) {
    chatLog.insertAdjacentHTML('beforeend', `<div class="system-text${isError ? ' error' : ''}">${escapeHtml(text)}</div>`);
    chatLog.scrollTop = chatLog.scrollHeight;
}

async function sendConsultantMessage() {
    const message = inputEl.value.trim();
    if (!message) return;
    if (message.length > CONSULTANT_MAX_CHARS) {
        appendSystemNote(`訊息長度不可超過 ${CONSULTANT_MAX_CHARS} 字，請縮短後再送出。`, true);
        return;
    }
    if (consultantRemainingQuota <= 0) return;

    inputEl.disabled = true;
    sendBtn.disabled = true;

    appendMessage('user', message);
    inputEl.value = '';
    updateCharCount();
    appendSystemNote('AI 諮詢師思考中...');

    try {
        const response = await fetch(`${CONSULTANT_API_BASE}/consultant/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
            body: JSON.stringify({ message })
        });

        // 移除剛剛的「思考中...」提示
        chatLog.lastElementChild?.remove();

        if (response.status === 429) {
            const errData = await response.json().catch(() => ({}));
            appendSystemNote(errData.detail || '今日諮詢次數已達上限，請明天再來！', true);
            applyQuota(0, 5);
            return;
        }
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            appendSystemNote(errData.detail || '諮詢失敗，請稍後再試。', true);
            inputEl.disabled = consultantRemainingQuota <= 0;
            sendBtn.disabled = consultantRemainingQuota <= 0;
            return;
        }

        const data = await response.json();
        appendMessage('ai', data.reply);
        applyQuota(data.remaining_quota, data.daily_limit);
    } catch (error) {
        console.error('傳送諮詢訊息失敗:', error);
        chatLog.lastElementChild?.remove();
        appendSystemNote('連線失敗，請稍後再試一次。', true);
        inputEl.disabled = consultantRemainingQuota <= 0;
        sendBtn.disabled = consultantRemainingQuota <= 0;
    }
}
