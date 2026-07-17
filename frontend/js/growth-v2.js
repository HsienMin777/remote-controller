// ==========================================
// 🚀 面試復盤 UX 實驗室：遊戲化復仇局 (PLG 迴圈)
// ==========================================

const RedemptionState = {
    originalScore: 0,
    jobTitle: "",
    opportunities: [], // 待挑戰的弱點題目
    clearedCount: 0,
    recordId: null // 若這場面試已存進資料庫，記錄其 id，讓完成任務時可以即時回存
};

// 字串防禦：防止 XSS 攻擊
function escapeHtml(value = "") {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// 🎯 入口：只給「剛面試完、正在看即時報告」的頁面呼叫，會即時呼叫 AI 生成翻盤任務。
//    ⚠️ 歷史檢視 (dashboard.html 點進去的過去紀錄) 絕對不要呼叫這個函式，
//    請改用下面的 renderSavedRedemption()，只讀資料庫、不會再打 AI。
async function triggerGrowthZoneHook(record) {
    const zone = document.getElementById('growthZone');
    if (!zone) {
        console.error("找不到 ID 為 growthZone 的 HTML 元素！");
        return;
    }

    // 確保區塊顯示並設定滾動條，避免內容被切掉
    zone.style.display = 'block';
    zone.style.maxHeight = '80vh';
    zone.style.overflowY = 'auto';
    zone.style.padding = '16px';
    zone.style.paddingRight = '24px';
    zone.style.boxSizing = 'border-box';

    const jobTitle = record.job_title || "目標職位";
    const originalScore = record.total_score || 0;
    // 即時報告當下這筆面試紀錄還沒存進資料庫，沒有 id 可回存
    RedemptionState.recordId = null;

    if (record.transcript && record.transcript.length > 0) {
        zone.innerHTML = `
            <div style="padding: 40px; text-align: center; color: var(--accent);">
                <h2>正在分析你的表現...</h2>
                <p style="color: var(--text-muted);">正在為你萃取 3 個可以快速翻盤的機會，請稍候</p>
            </div>
        `;

        try {
            const formData = new FormData();
            formData.append("job_title", jobTitle);
            formData.append("transcript_str", JSON.stringify(record.transcript));

            const response = await fetch(`${API_BASE}/growth/generate-redemption`, {
                method: "POST",
                body: formData
            });

            const data = await response.json();
            if (data.error) throw new Error(data.error);

            RedemptionState.originalScore = originalScore;
            RedemptionState.jobTitle = jobTitle;
            RedemptionState.opportunities = data.opportunities;
            RedemptionState.clearedCount = 0;

            renderRedemptionDashboard();

        } catch (error) {
            console.error(error);
            zone.innerHTML = `
                <div style="padding: 24px; border: 1px solid var(--danger); border-radius: 8px; color: var(--danger);">
                    無法生成復盤任務：${error.message}
                </div>
            `;
        }
        return;
    }

    // 沒有對話紀錄，無法分析
    zone.innerHTML = `
        <div style="padding: 24px; text-align: center; border: 1px dashed var(--border-light); border-radius: 12px;">
            <h3 style="color: var(--text-muted);">無法分析</h3>
            <p style="color: var(--text-muted); font-size: 14px;">這場面試沒有保留對話內容，教練無法給予建議。</p>
        </div>
    `;
}

// 📚 入口：dashboard.html 從歷史紀錄點進來時呼叫，只讀資料庫既有結果，絕對不會呼叫 AI。
//    record 需帶 id（來自 /api/interview/history），以及 opportunities（若曾經生成過）。
function renderSavedRedemption(record) {
    const zone = document.getElementById('growthZone');
    if (!zone) {
        console.error("找不到 ID 為 growthZone 的 HTML 元素！");
        return;
    }

    zone.style.display = 'block';
    zone.style.maxHeight = '80vh';
    zone.style.overflowY = 'auto';
    zone.style.padding = '16px';
    zone.style.paddingRight = '24px';
    zone.style.boxSizing = 'border-box';

    // 「有做過練習」的定義是至少有一題已回答完成 (cleared)，
    // 只生成過任務但完全沒作答，視同「沒有」，同樣顯示空狀態
    const answeredOpportunities = (record.opportunities || []).filter(o => o.cleared);

    if (answeredOpportunities.length === 0) {
        renderRedemptionEmptyState(zone);
        return;
    }

    RedemptionState.originalScore = record.totalScore || record.total_score || 0;
    RedemptionState.jobTitle = record.role || record.job_title || "目標職位";
    RedemptionState.opportunities = answeredOpportunities;
    RedemptionState.clearedCount = answeredOpportunities.length;
    RedemptionState.recordId = record.id;

    renderRedemptionHistoryReadOnly();
}

// 🈳 統一的空狀態視覺：維持暗黑面板風格，只是內容改成「無」
function renderRedemptionEmptyState(zone) {
    zone.innerHTML = `
        <h3 style="margin: 0 0 8px 0; color: var(--accent);">面試復盤：能力升級區</h3>
        <p style="color: var(--text-muted); font-size: 14px; margin: 0;">無</p>
    `;
}

// 將目前的翻盤任務進度（含 cleared 狀態）回存到資料庫，只有這場面試「已經存檔」(有 recordId) 才會呼叫
async function persistRedemptionProgress() {
    if (!RedemptionState.recordId) return; // 還沒存檔的即時報告：完成狀態會在使用者按下「儲存並前往資料庫」時一併存入
    try {
        await fetch(`${API_BASE}/interview/${RedemptionState.recordId}/opportunities`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
            body: JSON.stringify({ opportunities: RedemptionState.opportunities })
        });
    } catch (error) {
        console.error("回存翻盤任務進度失敗:", error);
    }
}

// 📊 渲染：復仇儀表板 (任務列表)
function renderRedemptionDashboard() {
    const zone = document.getElementById('growthZone');
    
    const cardsHtml = RedemptionState.opportunities.map((opp, index) => {
        if (opp.cleared) {
            return `
                <div style="padding: 16px; background: rgba(16, 185, 129, 0.1); border: 1px solid #10b981; border-radius: 12px; margin-bottom: 16px; opacity: 0.7;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: #10b981; font-weight: bold;">已成功翻盤：+${opp.xp_reward} XP</span>
                        <span style="text-decoration: line-through; color: var(--text-muted);">${escapeHtml(opp.question)}</span>
                    </div>
                </div>
            `;
        }

        return `
            <div style="padding: 20px; background: var(--bg-input); border: 1px solid var(--border-light); border-radius: 12px; margin-bottom: 16px; transition: transform 0.2s;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                    <span style="background: ${opp.tagColor}22; color: ${opp.tagColor}; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: bold;">
                        ${opp.tag}
                    </span>
                    <span style="color: #10b981; font-weight: bold; font-size: 14px;">+${opp.xp_reward} XP</span>
                </div>
                <h4 style="margin: 0 0 8px 0; color: var(--text-main); font-size: 16px;">${escapeHtml(opp.question)}</h4>
                <p style="margin: 0 0 16px 0; font-size: 14px; color: var(--danger); line-height: 1.5;">盲點：${escapeHtml(opp.flaw)}</p>
                <button onclick="openRedemptionArena('${opp.id}')" style="width: 100%; padding: 12px; background: ${opp.tagColor}; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer;">
                    啟動復仇局
                </button>
            </div>
        `;
    }).join("");

    zone.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 24px;">
            <div>
                <h2 style="margin: 0 0 8px 0; color: var(--accent);">面試復盤：能力升級區</h2>
                <p style="margin: 0; color: var(--text-muted); font-size: 14px;">我們抓出了 ${RedemptionState.opportunities.length} 個可以快速提分的盲點，挑一個來翻盤吧！</p>
            </div>
            <div style="text-align: right;">
                <div style="font-size: 12px; color: var(--text-muted);">歷史得分保持</div>
                <div style="font-size: 28px; font-weight: 900; color: var(--text-main);">${RedemptionState.originalScore}</div>
            </div>
        </div>
        ${cardsHtml}
    `;
}

// 📖 渲染：歷史檢視專用的唯讀復盤結果 (dashboard.html 點進來的過去紀錄)
//    只列出「已回答」的題目，用純文字呈現題目與使用者當時的回答，不含任何可互動元件
function renderRedemptionHistoryReadOnly() {
    const zone = document.getElementById('growthZone');

    const cardsHtml = RedemptionState.opportunities.map(opp => `
        <div style="padding: 20px; background: var(--bg-input); border: 1px solid var(--border-light); border-radius: 12px; margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                <span style="background: ${opp.tagColor}22; color: ${opp.tagColor}; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: bold;">
                    ${opp.tag}
                </span>
                <span style="color: #10b981; font-weight: bold; font-size: 14px;">已翻盤：+${opp.xp_reward} XP</span>
            </div>
            <h4 style="margin: 0 0 16px 0; color: var(--text-main); font-size: 16px;">Q: ${escapeHtml(opp.question)}</h4>
            <div style="padding: 16px; background: rgba(16, 185, 129, 0.05); border-left: 4px solid #10b981; border-radius: 8px;">
                <div style="font-size: 12px; color: #10b981; font-weight: bold; margin-bottom: 8px;">你當時的回答</div>
                <p style="margin: 0; color: var(--text-main); font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${opp.userAnswer ? escapeHtml(opp.userAnswer) : '（未保留回答內容）'}</p>
            </div>
        </div>
    `).join("");

    zone.innerHTML = `
        <div style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 8px 0; color: var(--accent);">面試復盤：能力升級區</h3>
            <p style="margin: 0; color: var(--text-muted); font-size: 14px;">這場面試你完成了 ${RedemptionState.opportunities.length} 個翻盤任務（唯讀檢視）</p>
        </div>
        ${cardsHtml}
    `;
}

// ⚔️ 互動：進入特定題目的「復仇競技場」
function openRedemptionArena(id) {
    const opp = RedemptionState.opportunities.find(o => o.id === id);
    if (!opp) return;

    const zone = document.getElementById('growthZone');
    const strategyHtml = escapeHtml(opp.strategy).replace(/\n/g, '<br>');

    zone.innerHTML = `
        <button onclick="renderRedemptionDashboard()" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; margin-bottom: 16px;">← 返回任務列表</button>
        
        <div style="padding: 24px; background: rgba(30, 58, 138, 0.05); border: 2px solid var(--accent); border-radius: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h3 style="margin: 0; color: var(--accent);">復仇任務：重新回答</h3>
                <span style="color: #10b981; font-weight: bold;">潛在獎勵: +${opp.xp_reward} XP</span>
            </div>

            <p style="font-size: 18px; font-weight: bold; margin-bottom: 16px; color: var(--text-main);">Q: ${escapeHtml(opp.question)}</p>

            <div style="padding: 16px; background: var(--bg-input); border-left: 4px solid #f59e0b; border-radius: 8px; margin-bottom: 20px;">
                <div style="font-size: 12px; color: #f59e0b; font-weight: bold; margin-bottom: 8px;">教練提示 (Coach Hint)</div>
                <div style="color: var(--text-main); font-size: 14px; line-height: 1.6;">${strategyHtml}</div>
            </div>

            <textarea id="redemptionAnswer" rows="6" placeholder="參考上方的教練提示，用你自己的話重新回答一次..."
                style="width: 100%; padding: 16px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-input); color: var(--text-main); margin-bottom: 16px; box-sizing: border-box; font-family: inherit; resize: vertical; font-size: 15px;"></textarea>
            
            <button onclick="submitRedemption('${opp.id}')" id="submitRedemptionBtn" style="width: 100%; padding: 14px; background: var(--accent); color: white; border: none; border-radius: 8px; font-weight: bold; font-size: 16px; cursor: pointer; transition: all 0.2s;">
                提交完美回答
            </button>
        </div>
    `;
}

// 🎁 結算：提交新回答並觸發動畫
async function submitRedemption(id) {
    const answer = document.getElementById('redemptionAnswer').value.trim();
    if (!answer) return alert("請輸入你的新回答！");

    const btn = document.getElementById('submitRedemptionBtn');
    btn.innerText = "AI 正在驗證你的成長...";
    btn.disabled = true;
    btn.style.opacity = "0.7";

    // 這裡目前模擬網路延遲 1.5 秒，直接給予正向回饋
    // 未來若你想嚴格一點，可以再發一個 POST 到後端驗證，但強烈建議維持「必過」的 UX
    setTimeout(() => {
        const opp = RedemptionState.opportunities.find(o => o.id === id);
        opp.cleared = true;
        opp.userAnswer = answer; // 保留回答內容，供歷史檢視唯讀顯示
        RedemptionState.clearedCount++;

        // 如果這場面試已經存進資料庫（從歷史紀錄點進來），完成的當下就直接回存；
        // 若還在「即時報告」階段（尚未存檔），會在使用者按下「儲存並前往資料庫」時一併存入
        persistRedemptionProgress();

        playRewardAnimation(opp.xp_reward);
    }, 1500);
}

// 🎉 動畫：播放經驗值提升特效
function playRewardAnimation(xp) {
    const zone = document.getElementById('growthZone');
    
    zone.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 300px; text-align: center; animation: fadeIn 0.5s;">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 16px; animation: popBounce 0.5s ease-out;"><circle cx="12" cy="12" r="10"></circle><path d="M8 12l3 3 5-6"></path></svg>
            <h2 style="color: #10b981; margin: 0 0 8px 0;">翻盤成功！</h2>
            <p style="color: var(--text-main); font-size: 18px; margin-bottom: 24px;">你成功補齊了這個知識盲區</p>
            <div style="font-size: 24px; font-weight: 900; color: #f59e0b; background: rgba(245, 158, 11, 0.1); padding: 12px 24px; border-radius: 100px;">
                + ${xp} 經驗值 (XP)
            </div>
            
            <button onclick="renderRedemptionDashboard()" style="margin-top: 32px; padding: 10px 24px; background: transparent; border: 1px solid var(--text-muted); color: var(--text-muted); border-radius: 8px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.color='var(--accent)'; this.style.borderColor='var(--accent)'" onmouseout="this.style.color='var(--text-muted)'; this.style.borderColor='var(--text-muted)'">
                返回任務列表
            </button>
        </div>
        <style>
            @keyframes popBounce {
                0% { transform: scale(0); }
                70% { transform: scale(1.3); }
                100% { transform: scale(1); }
            }
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
        </style>
    `;
}

// ==========================================
// 📋 逐題覆盤卡片 (Review Cards) + 復仇局彈窗
// ------------------------------------------
// 這是獨立於上面「翻盤任務 (opportunities)」系統之外的新模組，對應後端未來會回傳的
// 逐題判定 JSON：{ status, tag, xp_awarded, feedback, needs_revenge, revenge_hint }。
// 目前後端還沒有對應的 API（backend/main.py 尚未有這個欄位結構），所以這裡只提供
// 「餵資料進來就能動態渲染」的 renderReviewCards(reportData)，尚未接上任何真實頁面的
// 呼叫點——請在確定要顯示的位置放一個 <div id="reviewCardsGrid"></div>，
// 再呼叫 renderReviewCards(reportData) 即可（見檔案最下方的呼叫範例）。
//
// 顏色沿用全站既有的 CSS 變數（var(--bg-card)/var(--success)/var(--danger)...），
// 而不是寫死 bg-slate-800 這類深色專屬色碼，這樣才能跟著使用者在「系統設定」
// 選的 Light / Dark / System 主題自動切換，不會在淺色模式下卡片還是死板的深色。
// ==========================================

// 快取最近一次渲染的資料，讓「啟動復仇局」按鈕點擊時能反查回對應題目的 revenge_hint，
// 不需要把整包提示文字塞進 inline onclick 字串（避免特殊字元跳脫、XSS 風險，也更好維護）
let lastReviewCardsData = [];
let currentRevengeQuestionId = null;

function renderReviewCards(reportData) {
    ensureReviewCardsStylesInjected();
    ensureRevengeModalExists();

    const container = document.getElementById('reviewCardsGrid');
    if (!container) {
        console.error('[growth-v2.js] renderReviewCards: 找不到 #reviewCardsGrid，請先在頁面上放置容器元素');
        return;
    }

    lastReviewCardsData = Array.isArray(reportData) ? reportData : [];

    if (lastReviewCardsData.length === 0) {
        container.innerHTML = `<p style="color: var(--text-muted); font-size: 14px; margin: 0;">目前沒有可顯示的覆盤卡片。</p>`;
        return;
    }

    container.innerHTML = lastReviewCardsData.map(buildReviewCardHtml).join('');
    bindReviewCardsClickDelegation(container);
}

function buildReviewCardHtml(item, index) {
    const questionId = item.id ?? index;
    const isPerfect = !item.needs_revenge;
    const xp = Number.isFinite(item.xp_awarded) ? item.xp_awarded : 0;
    const tag = item.tag || (isPerfect ? '最佳實踐' : '待加強');
    const feedback = item.feedback || '';

    const stateClass = isPerfect ? 'review-card--perfect' : 'review-card--revenge';
    const tagClass = isPerfect ? 'review-card__tag--perfect' : 'review-card__tag--revenge';
    const xpClass = isPerfect ? 'review-card__xp--perfect' : 'review-card__xp--revenge';

    const revengeButtonHtml = item.needs_revenge
        ? `<button type="button" class="revenge-btn" data-revenge-question-id="${escapeHtml(String(questionId))}">啟動復仇局</button>`
        : '';

    return `
        <div class="review-card ${stateClass}" data-question-id="${escapeHtml(String(questionId))}">
            <div class="review-card__header">
                <span class="review-card__tag ${tagClass}">${escapeHtml(tag)}</span>
                <span class="review-card__xp ${xpClass}">${xp > 0 ? '+' : ''}${xp} XP</span>
            </div>
            <p class="review-card__feedback">${escapeHtml(feedback)}</p>
            ${revengeButtonHtml}
        </div>
    `;
}

// 事件委派：整個卡片容器只綁一次 click，不用每張卡各自掛 onclick，
// 也不用把 revenge_hint 這種可能含特殊字元的文字塞進 inline onclick 字串
function bindReviewCardsClickDelegation(container) {
    if (container.dataset.revengeEventsBound === 'true') return;
    container.dataset.revengeEventsBound = 'true';

    container.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-revenge-question-id]');
        if (!btn) return;
        openRevengeModal(btn.dataset.revengeQuestionId);
    });
}

// ---------------------------
// 復仇局彈窗
// ---------------------------
function openRevengeModal(questionId) {
    const item = lastReviewCardsData.find((entry, index) => String(entry.id ?? index) === String(questionId));
    if (!item) {
        console.error('[growth-v2.js] openRevengeModal: 找不到對應的覆盤卡片資料，questionId:', questionId);
        return;
    }

    currentRevengeQuestionId = questionId;

    const hintEl = document.getElementById('revengeModalHint');
    if (hintEl) hintEl.textContent = item.revenge_hint || '（教練尚未提供提示）';

    const textarea = document.getElementById('revengeModalAnswer');
    if (textarea) textarea.value = '';

    const overlay = document.getElementById('revengeModalOverlay');
    if (overlay) overlay.style.display = 'flex';
    if (textarea) textarea.focus();
}

function closeRevengeModal() {
    const overlay = document.getElementById('revengeModalOverlay');
    if (overlay) overlay.style.display = 'none';
    currentRevengeQuestionId = null;
}

function submitRevengeAnswer() {
    const textarea = document.getElementById('revengeModalAnswer');
    const answer = textarea ? textarea.value.trim() : '';
    if (!answer) {
        alert('請輸入你的新回答再送出。');
        return;
    }

    // 🔧 TODO：目前後端還沒有「重新提交答案給 AI 複判」的對應 API，
    // 這裡先示範關閉彈窗與基本資料流。等後端端點確定後，把下面 console.log
    // 換成真正的 fetch(`${API_BASE}/growth/revenge-answer`, ...) 即可。
    console.log('[growth-v2.js] 提交復仇局回答:', {
        questionId: currentRevengeQuestionId,
        answer: answer
    });

    closeRevengeModal();
}

// ---------------------------
// 動態注入樣式 + 彈窗 HTML（只注入一次，冪等）
// ---------------------------
function ensureReviewCardsStylesInjected() {
    if (document.getElementById('review-cards-styles')) return;

    const style = document.createElement('style');
    style.id = 'review-cards-styles';
    style.textContent = `
        .review-cards-grid {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .review-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-left: 4px solid var(--border);
            border-radius: var(--radius-md, 12px);
            padding: 20px;
            box-sizing: border-box;
        }

        .review-card--perfect {
            border-left-color: var(--success);
        }

        .review-card--revenge {
            border-left-color: var(--danger);
        }

        .review-card__header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            margin-bottom: 12px;
        }

        .review-card__tag {
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.02em;
        }

        .review-card__tag--perfect { color: var(--success); }
        .review-card__tag--revenge { color: var(--danger); }

        .review-card__xp {
            font-size: 14px;
            font-weight: 700;
            font-family: monospace;
            white-space: nowrap;
        }

        .review-card__xp--perfect { color: var(--success); }
        .review-card__xp--revenge { color: var(--text-muted); }

        .review-card__feedback {
            margin: 0;
            font-size: 14px;
            line-height: 1.6;
            color: var(--text-main);
        }

        /* 復仇局按鈕：刻意用低彩度中性色，不用實心亮色，維持沉穩的 B2B 質感 */
        .revenge-btn {
            width: 100%;
            margin-top: 16px;
            padding: 10px 16px;
            border-radius: var(--radius-sm, 8px);
            border: 1px solid var(--border);
            background: var(--bg-input);
            color: var(--text-main);
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: background-color 0.15s ease;
        }

        .revenge-btn:hover {
            background: var(--hover-tint, var(--bg-input));
        }

        /* 復仇局彈窗 */
        .revenge-modal-overlay {
            display: none;
            position: fixed;
            inset: 0;
            background: var(--overlay-bg, rgba(15, 23, 42, 0.4));
            backdrop-filter: blur(6px);
            align-items: center;
            justify-content: center;
            z-index: 9999;
        }

        .revenge-modal-content {
            background: var(--bg-card);
            border-radius: var(--radius-lg, 16px);
            box-shadow: var(--card-shadow, 0 20px 50px -12px rgba(15, 23, 42, 0.25));
            width: 90%;
            max-width: 560px;
            padding: 28px;
            box-sizing: border-box;
        }

        .revenge-modal-content h3 {
            margin: 0 0 8px 0;
            font-size: 18px;
            font-weight: 700;
            color: var(--text-main);
        }

        .revenge-modal-hint {
            font-size: 13px;
            line-height: 1.6;
            color: var(--text-muted);
            margin: 0 0 16px 0;
        }

        .revenge-modal-textarea {
            width: 100%;
            min-height: 140px;
            padding: 14px;
            border-radius: var(--radius-md, 10px);
            border: 1px solid var(--border);
            background: var(--bg-input);
            color: var(--text-main);
            font-family: inherit;
            font-size: 14px;
            line-height: 1.6;
            resize: vertical;
            box-sizing: border-box;
        }

        .revenge-modal-textarea:focus {
            outline: none;
            border-color: var(--accent);
            box-shadow: 0 0 0 3px var(--accent-glow, rgba(30, 58, 138, 0.14));
        }

        .revenge-modal-actions {
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            margin-top: 20px;
        }

        .revenge-modal-btn-cancel {
            padding: 10px 20px;
            border-radius: var(--radius-sm, 8px);
            border: 1px solid var(--border);
            background: transparent;
            color: var(--text-muted);
            font-weight: 600;
            cursor: pointer;
        }

        .revenge-modal-btn-submit {
            padding: 10px 24px;
            border-radius: var(--radius-sm, 8px);
            border: none;
            background: var(--accent);
            color: white;
            font-weight: 700;
            cursor: pointer;
            transition: background-color 0.15s ease;
        }

        .revenge-modal-btn-submit:hover {
            background: var(--accent-hover, var(--accent));
        }
    `;
    document.head.appendChild(style);
}

function ensureRevengeModalExists() {
    if (document.getElementById('revengeModalOverlay')) return;

    document.body.insertAdjacentHTML('beforeend', `
        <div id="revengeModalOverlay" class="revenge-modal-overlay">
            <div class="revenge-modal-content">
                <h3>啟動復仇局</h3>
                <p id="revengeModalHint" class="revenge-modal-hint"></p>
                <textarea id="revengeModalAnswer" class="revenge-modal-textarea" placeholder="參考上方提示，重新回答這一題..."></textarea>
                <div class="revenge-modal-actions">
                    <button type="button" class="revenge-modal-btn-cancel" onclick="closeRevengeModal()">取消</button>
                    <button type="button" class="revenge-modal-btn-submit" onclick="submitRevengeAnswer()">送出</button>
                </div>
            </div>
        </div>
    `);
}