// ==========================================
// 📄 履歷上傳紀錄頁面邏輯 (resume_records.js)
// ==========================================

const RESUME_API_BASE = 'http://127.0.0.1:8000/api';
let allResumeRecords = [];

window.onload = async () => {
    const user = await checkAuthStatus();
    if (!user) return;

    await loadResumeRecords();
};

async function loadResumeRecords() {
    const list = document.getElementById('resumeRecordsList');
    try {
        const response = await fetch(`${RESUME_API_BASE}/resume/history`, {
            headers: await getAuthHeaders()
        });
        if (!response.ok) throw new Error('讀取失敗');

        const data = await response.json();
        allResumeRecords = data.records || [];
        renderResumeRecords(allResumeRecords);
    } catch (error) {
        console.error('無法載入履歷診斷紀錄:', error);
        list.innerHTML = `<p style="color: var(--danger); text-align: center; padding: 20px;">載入失敗，請稍後再試。</p>`;
    }
}

function renderResumeRecords(records) {
    const list = document.getElementById('resumeRecordsList');

    if (records.length === 0) {
        list.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 20px;">目前沒有任何履歷診斷紀錄，前往「履歷與職缺診斷」建立第一筆吧！</p>`;
        return;
    }

    list.innerHTML = records.map(record => `
        <div class="record-item" onclick="openResumeDiagnosisModal(${record.id})">
            <div style="flex: 1;">
                <h4 style="margin: 0 0 8px 0; color: var(--text-main); font-size: 16px;">
                    ${escapeHtml(record.jobTitle)} <span style="color: var(--text-muted); font-weight: normal; font-size: 14px;">| ${escapeHtml(record.companyName || '未填公司')}</span>
                </h4>
                <p style="margin: 0; font-size: 13px; color: var(--text-muted);">${record.date}</p>
            </div>
            <div class="record-score-badge">${record.matchScore}%</div>
        </div>
    `).join('');
}

function openResumeDiagnosisModal(id) {
    const record = allResumeRecords.find(r => r.id === id);
    if (!record) return;

    const result = record.diagnosisResult || {};
    document.getElementById('modalJobTitle').innerText = `${record.jobTitle} - ${record.companyName || '未填公司'}`;
    document.getElementById('modalMeta').innerText = `診斷日期：${record.date}　|　ATS 契合度：${record.matchScore}%`;

    const matched = result.matched_skills || [];
    const missing = result.missing_skills || [];
    const tips = result.resume_tips || [];
    const questions = result.predicted_questions || [];

    document.getElementById('modalBody').innerHTML = `
        <div style="background: rgba(30, 58, 138, 0.05); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 20px;">
            <h3 style="margin: 0 0 8px 0; font-size: 15px; color: var(--text-main);">AI 綜合評估</h3>
            <p style="margin: 0; color: var(--text-muted); line-height: 1.6; font-size: 14px;">${escapeHtml(result.summary || result.advice || '無評語')}</p>
        </div>

        <div>
            <h3 style="margin: 0 0 12px 0; font-size: 15px; color: var(--text-main);">關鍵字比對</h3>
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <div>
                    <div style="font-size: 12px; color: #10b981; margin-bottom: 8px; font-weight: bold;">已命中的 JD 關鍵字</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                        ${matched.length > 0 ? matched.map(s => `<span class="skill-pill match">${escapeHtml(s)}</span>`).join('') : '<span style="font-size:13px; color:var(--text-muted);">無</span>'}
                    </div>
                </div>
                <div>
                    <div style="font-size: 12px; color: var(--danger); margin-bottom: 8px; font-weight: bold;">缺失或需強化的關鍵字</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                        ${missing.length > 0 ? missing.map(s => `<span class="skill-pill miss">${escapeHtml(s)}</span>`).join('') : '<span style="font-size:13px; color:var(--text-muted);">無</span>'}
                    </div>
                </div>
            </div>
        </div>

        <div>
            <h3 style="margin: 0 0 12px 0; font-size: 15px; color: #f59e0b;">履歷高分改寫建議</h3>
            <div style="display: flex; flex-direction: column; gap: 12px;">
                ${tips.length > 0 ? tips.map((tip, i) => `
                    <div class="revision-card">
                        <div style="font-size: 12px; color: #f59e0b; font-weight: bold;">建議修改點 #${i + 1}</div>
                        <div class="revision-before">原句：${escapeHtml(tip.before)}</div>
                        <div class="revision-after">建議：${escapeHtml(tip.after)}</div>
                        <div style="margin-top: 6px; font-size: 13px; color: var(--text-muted);"><strong>AI 解析：</strong>${escapeHtml(tip.reason)}</div>
                    </div>
                `).join('') : '<p style="color: var(--text-muted); font-size: 14px;">當時無重大修改建議。</p>'}
            </div>
        </div>

        <div>
            <h3 style="margin: 0 0 12px 0; font-size: 15px; color: #7C3AED;">預測面試必考題與意圖</h3>
            <div style="display: flex; flex-direction: column; gap: 10px;">
                ${questions.length > 0 ? questions.map(q => `
                    <div class="question-card">
                        <div class="q-title">Q: ${escapeHtml(q.q || q)}</div>
                        <div class="q-intent">面試官意圖：${escapeHtml(q.intent || '專業能力測試')}</div>
                    </div>
                `).join('') : '<p style="color: var(--text-muted); font-size: 14px;">無特定預測考題。</p>'}
            </div>
        </div>
    `;

    document.getElementById('resumeDiagnosisModal').style.display = 'flex';
}

function closeResumeDiagnosisModal() {
    document.getElementById('resumeDiagnosisModal').style.display = 'none';
}
