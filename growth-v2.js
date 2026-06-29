// 1. 題庫定義：根據弱點類型動態撈取對應訓練內容
const GROWTH_QUIZZES_V2 = {
    LACK_OF_DATA: {
        title: "回答缺少量化證據",
        question: "如果要讓這段回答更像高分答案，你第一刀會補什麼？",
        options: {
            A: "補上明確數字，例如規模、成長率、節省時間或轉換率",
            B: "把語氣改得更有自信，但內容不變",
            C: "多描述團隊氣氛與合作感受",
            D: "把答案縮短成一句話"
        },
        drillLabel: "專案經驗數據化"
    },
    LOGIC_UNCLEAR: {
        title: "結構鬆散，重點不夠清楚",
        question: "這類回答最該先補強哪個結構？",
        options: {
            A: "先講情境，再講任務、行動、結果",
            B: "多加入專有名詞讓答案聽起來專業",
            C: "把所有細節一次講完",
            D: "避免提到失敗或取捨"
        },
        drillLabel: "STAR 結構重組"
    },
    OFF_TOPIC: {
        title: "回答沒有扣回題目",
        question: "面試官問了特定問題時，最重要的第一步是什麼？",
        options: {
            A: "先用一句話直接回答問題，再補例子",
            B: "先介紹完整背景，之後自然會講到答案",
            C: "把熟悉的專案全部講一遍",
            D: "反問面試官想聽哪一段"
        },
        drillLabel: "問題對焦"
    }
};

// 字串防禦：將 HTML 標籤轉義，防止 XSS 攻擊
function escapeHtml(value = "") {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

//正規化對話格式：統一將 role 轉換為 ai/user 方便內部運算
function normalizeTranscript(transcript = []) {
    return transcript.map(msg => ({
        role: msg.role === "assistant" ? "ai" : msg.role,
        content: msg.content || msg.text || ""
    })).filter(msg => msg.content.trim());
}

//弱點分類機制：根據後端回傳的反饋文字，自動判斷需要修煉的類別
function pickWeaknessCode(record) {
    const text = [
        record.short_feedback,
        record.shortFeedback,
        ...(record.improvements || [])
    ].join(" ").toLowerCase();

    if (/數據|量化|成效|指標|data|metric|impact|kpi/.test(text)) return "LACK_OF_DATA";
    if (/邏輯|結構|star|順序|重點|架構|logic|structure/.test(text)) return "LOGIC_UNCLEAR";
    if (/文不對題|離題|聚焦|題目|回答問題|off.?topic|focus/.test(text)) return "OFF_TOPIC";
    return "LACK_OF_DATA";
}

//自動抓取痛點：找出對話中最短、最籠統的一句 user 回答作為靶子
function findFocusAnswer(transcript = []) {
    const normalized = normalizeTranscript(transcript);
    const userTurns = normalized
        .map((msg, index) => ({ ...msg, index }))
        .filter(msg => msg.role === "user");

    if (!userTurns.length) {
        return { question: "", answer: "尚未取得可分析的使用者回答。" };
    }

    const shortestUseful = userTurns
        .filter(msg => msg.content.length >= 8)
        .sort((a, b) => a.content.length - b.content.length)[0] || userTurns[0];
    const priorQuestion = [...normalized]
        .slice(0, shortestUseful.index)
        .reverse()
        .find(msg => msg.role === "ai" || msg.role === "assistant");

    return {
        question: priorQuestion?.content || "請針對剛才的面試問題改善回答。",
        answer: shortestUseful.content
    };
}

// 渲染資源矩陣：提供不同深度的後續學習建議
function renderResourceMatrix(data = {}) {
    const resources = data.resources || {
        immediate: data.immediate_tool || "用 STAR + 數字模板重寫一次：情境、任務、行動、量化結果。",
        course: "建議練習：行為面試 STAR 回答、專案成果量化、職缺關鍵字對齊。",
        extension: "延伸任務：整理 3 個專案，各補上規模、技術選型、可驗證成果。"
    };

    return `
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; margin-top:16px;">
            <div style="padding:16px; background:rgba(14,165,233,0.08); border:1px solid var(--border); border-radius:8px;">
                <div style="font-weight:bold; color:var(--accent); margin-bottom:8px;">立即練習</div>
                <div style="color:var(--text-main); line-height:1.6;">${escapeHtml(resources.immediate)}</div>
            </div>
            <div style="padding:16px; background:rgba(255,255,255,0.04); border:1px solid var(--border-light); border-radius:8px;">
                <div style="font-weight:bold; color:var(--text-main); margin-bottom:8px;">課程</div>
                <div style="color:var(--text-muted); line-height:1.6;">${escapeHtml(resources.course)}</div>
            </div>
            <div style="padding:16px; background:rgba(255,255,255,0.04); border:1px solid var(--border-light); border-radius:8px;">
                <div style="font-weight:bold; color:var(--text-main); margin-bottom:8px;">延伸</div>
                <div style="color:var(--text-muted); line-height:1.6;">${escapeHtml(resources.extension)}</div>
            </div>
        </div>
    `;
}

// 啟動修煉區 Hook：由 dashboard.html 呼叫，初始化修煉狀態
function triggerGrowthZoneHook(record) {
    const transcript = normalizeTranscript(record.transcript || []);
    const weaknessCode = record.weakness_code || pickWeaknessCode(record);
    const focus = findFocusAnswer(transcript);
    const jobTitle = record.job_title || record.role || "目標職位";
    const originalScore = record.total_score || record.totalScore || 0;

    Object.assign(GrowthState, {
        jobTitle,
        weaknessCode,
        worstAnswer: focus.answer,
        focusQuestion: focus.question,
        originalScore,
        transcript,
        drillChatHistory: [],
        roundCount: 0
    });

    initGrowthZone(jobTitle, weaknessCode);
}

// UI 初始化：顯示選擇題卡片，強迫使用者進行認知反思
function initGrowthZone(jobTitle, weaknessCode) {
    const quiz = GROWTH_QUIZZES_V2[weaknessCode] || GROWTH_QUIZZES_V2.LACK_OF_DATA;
    const zone = document.getElementById('growthZone');
    if (!zone) return;

    zone.style.display = 'block';
    zone.innerHTML = `
        <h3 style="color:var(--accent); margin:0 0 12px;">深度點評</h3>
        <div style="padding:18px; background:rgba(255,255,255,0.04); border:1px solid var(--border-light); border-radius:8px;">
            <div style="color:#f59e0b; font-weight:bold; margin-bottom:10px;">${escapeHtml(quiz.title)}</div>
            <p style="margin:0 0 14px; color:var(--text-main); line-height:1.6;">${escapeHtml(quiz.question)}</p>
            <div style="display:flex; flex-direction:column; gap:10px;">
                ${Object.entries(quiz.options).map(([key, text]) => `
                    <button onclick="submitQuizChoice('${key}')" style="padding:12px 14px; text-align:left; border-radius:8px; border:1px solid var(--border); background:rgba(14,165,233,0.06); color:var(--text-main); cursor:pointer;">
                        <strong>${key}.</strong> ${escapeHtml(text)}
                    </button>
                `).join('')}
            </div>
        </div>
    `;
}

// 提交選擇：將使用者的自我反思傳送給後端，AI 生成高分對照組
async function submitQuizChoice(choice) {
    const zone = document.getElementById('growthZone');
    if (!zone) return;
    zone.innerHTML = `<div style="padding:32px; color:var(--text-muted); text-align:center;">正在生成你的回答 VS 高分範例...</div>`;

    const formData = new FormData();
    formData.append("job_title", GrowthState.jobTitle);
    formData.append("weakness_code", GrowthState.weaknessCode);
    formData.append("user_choice", choice);
    formData.append("worst_user_answer", GrowthState.worstAnswer);
    formData.append("focus_question", GrowthState.focusQuestion || "");
    formData.append("interview_transcript", JSON.stringify(GrowthState.transcript || []));

    try {
        const res = await fetch(`${API_BASE}/growth/generate_showcase`, { method: "POST", body: formData });
        if (!res.ok) throw new Error("generate_showcase failed");
        const data = await res.json();
        const differences = data.difference_analysis || data.bullet_points || [];

        zone.innerHTML = `
            <h3 style="color:var(--accent); margin:0 0 16px;">你的回答 VS 高分範例</h3>
            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:14px;">
                <div style="padding:16px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.35); border-radius:8px;">
                    <div style="font-size:12px; color:#f87171; font-weight:bold; margin-bottom:8px;">你的回答</div>
                    <div style="line-height:1.7;">${escapeHtml(data.user_version || GrowthState.worstAnswer)}</div>
                </div>
                <div style="padding:16px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.35); border-radius:8px;">
                    <div style="font-size:12px; color:#10b981; font-weight:bold; margin-bottom:8px;">高分範例</div>
                    <div style="line-height:1.7;">${escapeHtml(data.high_score_version || "")}</div>
                </div>
            </div>
            <div style="margin-top:16px; padding:16px; background:rgba(255,255,255,0.04); border:1px solid var(--border-light); border-radius:8px;">
                <div style="font-weight:bold; margin-bottom:10px;">差異分析</div>
                <ul style="margin:0; padding-left:20px; color:var(--text-muted); line-height:1.7;">
                    ${differences.map(item => `<li>${escapeHtml(item)}</li>`).join("")}
                </ul>
            </div>
            ${renderResourceMatrix(data)}
            <div style="text-align:center; margin-top:20px;">
                <button onclick="startDrill()" style="background:var(--accent); color:white; border:none; padding:12px 22px; border-radius:8px; font-weight:bold; cursor:pointer;">
                    開始 3 分鐘快閃實戰：${escapeHtml((GROWTH_QUIZZES_V2[GrowthState.weaknessCode] || GROWTH_QUIZZES_V2.LACK_OF_DATA).drillLabel)}
                </button>
            </div>
        `;
    } catch (error) {
        zone.innerHTML = `<div style="padding:24px; color:#f87171;">深度點評生成失敗，請稍後再試。</div>`;
    }
}

// 啟動實戰：初始化 3 分鐘快閃實戰的 System Prompt 與 UI
async function startDrill() {
    const zone = document.getElementById('growthZone');
    if (!zone) return;
    zone.innerHTML = `<div style="padding:32px; color:var(--text-muted); text-align:center;">正在建立快閃實戰...</div>`;

    const formData = new FormData();
    formData.append("job_title", GrowthState.jobTitle);
    formData.append("weakness_code", GrowthState.weaknessCode);
    formData.append("focus_question", GrowthState.focusQuestion || "");
    formData.append("worst_user_answer", GrowthState.worstAnswer || "");

    try {
        const res = await fetch(`${API_BASE}/growth/start_quick_drill`, { method: "POST", body: formData });
        if (!res.ok) throw new Error("start_quick_drill failed");
        const data = await res.json();
        GrowthState.drillChatHistory = [{ role: "assistant", content: data.ai_first_message }];
        GrowthState.roundCount = 0;

        zone.innerHTML = `
            <h3 style="color:var(--accent); margin:0 0 12px;">3 分鐘快閃實戰</h3>
            <div style="background:#111827; color:white; padding:18px; border-radius:8px; border:1px solid var(--border-light);">
                <div id="miniChatBox" style="height:220px; overflow-y:auto; margin-bottom:14px; padding-right:4px;">
                    <div style="margin-bottom:12px;"><strong>教練：</strong>${escapeHtml(data.ai_first_message)}</div>
                </div>
                <div style="display:flex; gap:10px;">
                    <input id="drillInput" type="text" placeholder="用具體數字回答..." style="flex:1; padding:10px 12px; border-radius:6px; border:1px solid #334155; color:#111827;">
                    <button onclick="sendDrillMsg()" style="background:#10b981; color:white; border:none; padding:0 18px; border-radius:6px; cursor:pointer;">送出</button>
                </div>
            </div>
        `;
        document.getElementById('drillInput')?.focus();
    } catch (error) {
        zone.innerHTML = `<div style="padding:24px; color:#f87171;">快閃實戰建立失敗，請稍後再試。</div>`;
    }
}

// 實戰對話處理：處理 user 回答，控制輪數，達到門檻後觸發評分
async function sendDrillMsg() {
    const input = document.getElementById('drillInput');
    const chatBox = document.getElementById('miniChatBox');
    const msg = input?.value.trim();
    if (!input || !chatBox || !msg) return;

    input.value = "";
    input.disabled = true;
    chatBox.innerHTML += `<div style="margin-bottom:12px; color:#7dd3fc; text-align:right;"><strong>你：</strong>${escapeHtml(msg)}</div>`;
    chatBox.scrollTop = chatBox.scrollHeight;
    GrowthState.drillChatHistory.push({ role: "user", content: msg });
    GrowthState.roundCount += 1;

    if (GrowthState.roundCount >= 2) {
        chatBox.innerHTML += `<div style="margin:12px 0; color:#f59e0b; text-align:center;">正在用原始評分標準重新評分...</div>`;
        await finishAndEvaluateDrill();
        return;
    }

    const formData = new FormData();
    formData.append("job_title", GrowthState.jobTitle);
    formData.append("weakness_code", GrowthState.weaknessCode);
    formData.append("drill_chat_history", JSON.stringify(GrowthState.drillChatHistory));

    try {
        const res = await fetch(`${API_BASE}/growth/drill_next`, { method: "POST", body: formData });
        if (!res.ok) throw new Error("drill_next failed");
        const data = await res.json();
        const reply = data.ai_message || "請再補一個可驗證的數字，讓面試官知道你的貢獻有多大。";
        GrowthState.drillChatHistory.push({ role: "assistant", content: reply });
        chatBox.innerHTML += `<div style="margin-bottom:12px;"><strong>教練：</strong>${escapeHtml(reply)}</div>`;
    } catch (error) {
        const fallback = "停一下，這輪只練具體化。請補上規模、百分比、節省時間或前後對比其中一項。";
        GrowthState.drillChatHistory.push({ role: "assistant", content: fallback });
        chatBox.innerHTML += `<div style="margin-bottom:12px;"><strong>教練：</strong>${escapeHtml(fallback)}</div>`;
    } finally {
        chatBox.scrollTop = chatBox.scrollHeight;
        input.disabled = false;
        input.focus();
    }
}

// 最終評分與結算：將實戰結果送回後端與原始分數對比，計算加分幅度
async function finishAndEvaluateDrill() {
    const zone = document.getElementById('growthZone');
    if (!zone) return;

    const formData = new FormData();
    formData.append("original_score", GrowthState.originalScore);
    formData.append("weakness_code", GrowthState.weaknessCode);
    formData.append("job_title", GrowthState.jobTitle);
    formData.append("drill_chat_history", JSON.stringify(GrowthState.drillChatHistory));
    formData.append("focus_question", GrowthState.focusQuestion || "");
    formData.append("worst_user_answer", GrowthState.worstAnswer || "");

    try {
        const res = await fetch(`${API_BASE}/growth/evaluate_drill`, { method: "POST", body: formData });
        if (!res.ok) throw new Error("evaluate_drill failed");
        const data = await res.json();
        const delta = Number(data.delta || 0);
        const newScore = Number(data.new_score || GrowthState.originalScore);
        const deltaColor = delta > 0 ? "#10b981" : "#f59e0b";

        zone.innerHTML = `
            <h3 style="color:var(--accent); margin:0 0 16px;">二次評分結果</h3>
            <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:28px; background:rgba(255,255,255,0.04); padding:24px; border-radius:8px; border:1px solid var(--border-light);">
                <div style="text-align:center;">
                    <div style="font-size:13px; color:var(--text-muted); margin-bottom:6px;">原始分數</div>
                    <div style="font-size:32px; font-weight:bold;">${GrowthState.originalScore}</div>
                </div>
                <div style="text-align:center; color:${deltaColor};">
                    <div style="font-size:24px;">→</div>
                    <div style="font-weight:bold;">${delta > 0 ? "+" : ""}${delta} 分</div>
                </div>
                <div style="text-align:center;">
                    <div style="font-size:13px; color:var(--accent); margin-bottom:6px;">實戰後分數</div>
                    <div style="font-size:44px; font-weight:900; color:white;">${newScore}</div>
                </div>
            </div>
            <div style="margin-top:16px; padding:16px; background:rgba(255,255,255,0.04); border-left:4px solid var(--accent); border-radius:8px;">
                <div style="font-weight:bold; margin-bottom:8px;">教練真話</div>
                <div style="line-height:1.7; color:var(--text-main);">${escapeHtml(data.coach_comment || "")}</div>
            </div>
        `;
    } catch (error) {
        zone.innerHTML = `<div style="padding:24px; color:#f87171;">二次評分失敗，請稍後再試。</div>`;
    }
}
