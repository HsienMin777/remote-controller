// ==========================================
// 🚀 面試復盤 UX 實驗室：遊戲化復仇局 (PLG 迴圈)
// ==========================================

const RedemptionState = {
    originalScore: 0,
    jobTitle: "",
    opportunities: [], // 待挑戰的弱點題目
    clearedCount: 0
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

// 🎯 入口：相容 Dashboard 呼叫與面試剛結束的即時呼叫
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

    // 兼容 Dashboard 傳來的舊命名
    const jobTitle = record.job_title || record.role || "目標職位";
    const originalScore = record.total_score || record.totalScore || 0;

    // 情況 A：如果資料裡面已經有生成好的 opportunities
    if (record.opportunities && record.opportunities.length > 0) {
        RedemptionState.originalScore = originalScore;
        RedemptionState.jobTitle = jobTitle;
        RedemptionState.opportunities = record.opportunities;
        RedemptionState.clearedCount = 0;
        renderRedemptionDashboard();
        return;
    }

    // 情況 B：Dashboard 呼叫，只有對話紀錄，需要即時生成翻盤任務
    if (record.transcript && record.transcript.length > 0) {
        zone.innerHTML = `
            <div style="padding: 40px; text-align: center; color: var(--accent);">
                <h2>正在回顧這場面試...</h2>
                <p style="color: var(--text-muted);">正在分析歷史對話紀錄，為你萃取 3 個翻盤機會，請稍候</p>
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
                <div style="padding: 24px; border: 1px solid #ef4444; border-radius: 8px; color: #ef4444;">
                    無法生成復盤任務：${error.message}
                </div>
            `;
        }
        return;
    }

    // 情況 C：無對話紀錄，無法分析
    zone.innerHTML = `
        <div style="padding: 24px; text-align: center; border: 1px dashed var(--border-light); border-radius: 12px;">
            <h3 style="color: var(--text-muted);">無法分析</h3>
            <p style="color: var(--text-muted); font-size: 14px;">這筆歷史紀錄沒有保留對話內容，教練無法給予建議。</p>
        </div>
    `;
}

// 📊 渲染：復仇儀表板 (任務列表)
function renderRedemptionDashboard() {
    const zone = document.getElementById('growthZone');
    
    const cardsHtml = RedemptionState.opportunities.map((opp, index) => {
        if (opp.cleared) {
            return `
                <div style="padding: 16px; background: rgba(16, 185, 129, 0.1); border: 1px solid #10b981; border-radius: 12px; margin-bottom: 16px; opacity: 0.7;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: #10b981; font-weight: bold;">✅ 已成功翻盤：+${opp.xp_reward} XP</span>
                        <span style="text-decoration: line-through; color: var(--text-muted);">${escapeHtml(opp.question)}</span>
                    </div>
                </div>
            `;
        }

        return `
            <div style="padding: 20px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-light); border-radius: 12px; margin-bottom: 16px; transition: transform 0.2s;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                    <span style="background: ${opp.tagColor}22; color: ${opp.tagColor}; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: bold;">
                        ${opp.tag}
                    </span>
                    <span style="color: #10b981; font-weight: bold; font-size: 14px;">🎁 +${opp.xp_reward} XP</span>
                </div>
                <h4 style="margin: 0 0 8px 0; color: var(--text-main); font-size: 16px;">${escapeHtml(opp.question)}</h4>
                <p style="margin: 0 0 16px 0; font-size: 14px; color: #f87171; line-height: 1.5;">❌ 盲點：${escapeHtml(opp.flaw)}</p>
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
                <div style="font-size: 28px; font-weight: 900; color: white;">${RedemptionState.originalScore}</div>
            </div>
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
        
        <div style="padding: 24px; background: rgba(14, 165, 233, 0.05); border: 2px solid var(--accent); border-radius: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h3 style="margin: 0; color: var(--accent);">復仇任務：重新回答</h3>
                <span style="color: #10b981; font-weight: bold;">潛在獎勵: +${opp.xp_reward} XP</span>
            </div>
            
            <p style="font-size: 18px; font-weight: bold; margin-bottom: 16px; color: white;">Q: ${escapeHtml(opp.question)}</p>
            
            <div style="padding: 16px; background: rgba(255, 255, 255, 0.05); border-left: 4px solid #f59e0b; border-radius: 8px; margin-bottom: 20px;">
                <div style="font-size: 12px; color: #f59e0b; font-weight: bold; margin-bottom: 8px;">教練提示 (Coach Hint)</div>
                <div style="color: var(--text-main); font-size: 14px; line-height: 1.6;">${strategyHtml}</div>
            </div>

            <textarea id="redemptionAnswer" rows="6" placeholder="參考上方的教練提示，用你自己的話重新回答一次..." 
                style="width: 100%; padding: 16px; border-radius: 8px; border: 1px solid var(--border); background: rgba(0,0,0,0.2); color: white; margin-bottom: 16px; box-sizing: border-box; font-family: inherit; resize: vertical; font-size: 15px;"></textarea>
            
            <button onclick="submitRedemption('${opp.id}')" id="submitRedemptionBtn" style="width: 100%; padding: 14px; background: var(--accent); color: white; border: none; border-radius: 8px; font-weight: bold; font-size: 16px; cursor: pointer; transition: all 0.2s;">
                🚀 提交完美回答
            </button>
        </div>
    `;
}

// 🎁 結算：提交新回答並觸發動畫
async function submitRedemption(id) {
    const answer = document.getElementById('redemptionAnswer').value.trim();
    if (!answer) return alert("請輸入你的新回答！");

    const btn = document.getElementById('submitRedemptionBtn');
    btn.innerText = "✨ AI 正在驗證你的成長...";
    btn.disabled = true;
    btn.style.opacity = "0.7";

    // 這裡目前模擬網路延遲 1.5 秒，直接給予正向回饋
    // 未來若你想嚴格一點，可以再發一個 POST 到後端驗證，但強烈建議維持「必過」的 UX
    setTimeout(() => {
        const opp = RedemptionState.opportunities.find(o => o.id === id);
        opp.cleared = true;
        RedemptionState.clearedCount++;

        playRewardAnimation(opp.xp_reward);
    }, 1500);
}

// 🎉 動畫：播放經驗值提升特效
function playRewardAnimation(xp) {
    const zone = document.getElementById('growthZone');
    
    zone.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 300px; text-align: center; animation: fadeIn 0.5s;">
            <div style="font-size: 64px; margin-bottom: 16px; animation: popBounce 0.5s ease-out;">🔥</div>
            <h2 style="color: #10b981; margin: 0 0 8px 0;">翻盤成功！</h2>
            <p style="color: var(--text-main); font-size: 18px; margin-bottom: 24px;">你成功補齊了這個知識盲區</p>
            <div style="font-size: 24px; font-weight: 900; color: #f59e0b; background: rgba(245, 158, 11, 0.1); padding: 12px 24px; border-radius: 100px;">
                + ${xp} 經驗值 (XP)
            </div>
            
            <button onclick="renderRedemptionDashboard()" style="margin-top: 32px; padding: 10px 24px; background: transparent; border: 1px solid var(--text-muted); color: var(--text-muted); border-radius: 8px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.color='white'; this.style.borderColor='white'" onmouseout="this.style.color='var(--text-muted)'; this.style.borderColor='var(--text-muted)'">
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