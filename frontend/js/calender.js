// ==========================================
// 📅 面試管家核心邏輯 (calender.js)
// ==========================================

const API_BASE_URL = 'https://offerdash.onrender.com/api';
let allSchedules = []; // 全域快取所有行程資料
let currentUserEmail = ''; // 登入使用者信箱，作為提醒信箱預設值

// calender.js
async function initCalendarSystem() {
    // 檢查是否登入 (supabaseClient 由 auth.js 建立)
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        window.location.href = '/frontend/index.html'; // 若沒登入強制導回登入頁
        return;
    }

    // 顯示使用者名稱
    document.getElementById('userEmail').innerText = user.email || '';
    currentUserEmail = user.email || '';

    // 載入該使用者的排程 (確保後端 SQL 都有篩選 user_id)
    loadSchedules(user.id);
}

async function logout() {
    await supabaseClient.auth.signOut();
    window.location.href = '/frontend/index.html';
}

// ---------------------------
// UI 互動：彈出視窗控制 (新增與編輯共用)
// ---------------------------
function openAddScheduleModal(mode = 'add', id = null) {
    const modal = document.getElementById('scheduleModal');
    const modalTitle = document.getElementById('modalTitle');
    const deleteBtn = document.getElementById('deleteScheduleBtn');

    modal.style.display = 'flex';

    if (mode === 'edit' && id !== null) {
        modalTitle.textContent = '編輯';
        deleteBtn.style.display = 'block';

        // 尋找對應的排程資料並反填回 input
        const sched = allSchedules.find(item => item.id === id);
        if (sched) {
            document.getElementById('schedId').value = sched.id;
            document.getElementById('schedCompany').value = sched.company;
            document.getElementById('schedJobTitle').value = sched.job_title;
            document.getElementById('schedDate').value = sched.date;
            document.getElementById('schedTime').value = sched.time;
            document.getElementById('schedNotes').value = sched.notes || '';
            applyReminderFromSchedule(sched);
        }
    } else {
        modalTitle.textContent = '新增';
        deleteBtn.style.display = 'none';
        document.getElementById('schedId').value = '';
        document.getElementById('scheduleForm').reset();
        document.getElementById('schedReminderValue').value = 2;
        document.getElementById('schedReminderUnit').value = 'hours';
    }
}

// ---------------------------
// 提醒時間：數字 + 單位 的換算
// ---------------------------
const REMINDER_UNIT_MS = { minutes: 60000, hours: 3600000, days: 86400000 };

// 依「面試日期時間 - 提醒時間」的差距，反推應該顯示的數字與單位 (優先用能整除的最大單位)
function applyReminderFromSchedule(sched) {
    const valueInput = document.getElementById('schedReminderValue');
    const unitSelect = document.getElementById('schedReminderUnit');

    const interviewDt = sched.date && sched.time ? new Date(`${sched.date}T${sched.time}`) : null;
    const reminderDt = sched.reminder_time ? new Date(sched.reminder_time) : null;
    const diffMs = interviewDt && reminderDt ? (interviewDt - reminderDt) : NaN;

    if (!diffMs || isNaN(diffMs) || diffMs <= 0) {
        valueInput.value = 2;
        unitSelect.value = 'hours';
        return;
    }

    if (diffMs % REMINDER_UNIT_MS.days === 0) {
        valueInput.value = diffMs / REMINDER_UNIT_MS.days;
        unitSelect.value = 'days';
    } else if (diffMs % REMINDER_UNIT_MS.hours === 0) {
        valueInput.value = diffMs / REMINDER_UNIT_MS.hours;
        unitSelect.value = 'hours';
    } else {
        valueInput.value = Math.round(diffMs / REMINDER_UNIT_MS.minutes);
        unitSelect.value = 'minutes';
    }
}

// 將本地時間的 Date 物件格式化成後端使用的 "YYYY-MM-DDTHH:MM"
function formatDatetimeLocal(dateObj) {
    const pad = n => String(n).padStart(2, '0');
    // 🔥 getFullYear() 不會補零 (例如西元 115 年會回傳 "115" 而非 "0115")，
    //    導致後端 strptime("%Y-%m-%dT%H:%M") 解析失敗，這裡統一補到 4 位數。
    const year = String(dateObj.getFullYear()).padStart(4, '0');
    return `${year}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}T${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;
}

// 依「數字 + 單位」設定，算出真正要送給後端的提醒時間 (YYYY-MM-DDTHH:MM)
function computeReminderTime() {
    const value = parseFloat(document.getElementById('schedReminderValue').value);
    const unit = document.getElementById('schedReminderUnit').value;
    const date = document.getElementById('schedDate').value;
    const time = document.getElementById('schedTime').value;
    if (!date || !time || !value || value <= 0) return '';

    const interviewDt = new Date(`${date}T${time}`);
    const reminderDt = new Date(interviewDt.getTime() - value * REMINDER_UNIT_MS[unit]);
    return formatDatetimeLocal(reminderDt);
}

function closeAddScheduleModal() {
    document.getElementById('scheduleModal').style.display = 'none';
    document.getElementById('scheduleForm').reset();
}

// ---------------------------
// API 串接：讀取與堆疊渲染
// ---------------------------
async function loadSchedules() {
    try {
        const response = await fetch(`${API_BASE_URL}/events`, {
            method: 'GET',
            headers: await getAuthHeaders()
        });
        
        if (!response.ok) throw new Error("API 請求失敗");
        
        allSchedules = await response.json();
        renderSchedules(allSchedules);
    } catch (error) {
        console.error("無法載入排程:", error);
    }
}

// 動態產生面試卡片列表
function renderSchedules(schedules) {
    const container = document.getElementById('scheduleListContainer');
    
    if (schedules.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">目前沒有即將到來的面試，隨時準備迎接新挑戰！</p>';
        return;
    }

    // 將資料陣列轉換成 HTML 堆疊卡片
    container.innerHTML = schedules.map(sched => `
        <div style="background: var(--bg-input); padding: 18px; border-radius: var(--radius-md); border: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;"
             onclick="openAddScheduleModal('edit', ${sched.id})"
             onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow=document.documentElement.classList.contains('dark') ? '0 8px 20px rgba(0,0,0,0.4)' : '0 8px 20px rgba(15,23,42,0.1)';"
             onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none';">

            <div style="flex: 1;">
                <h4 style="margin: 0 0 8px 0; color: var(--text-main); font-size: 16px;">
                    ${escapeHtml(sched.company)} <span style="color: var(--text-muted); font-weight: normal; font-size: 14px;">| ${escapeHtml(sched.job_title)}</span>
                </h4>
                <p style="margin: 0; font-size: 14px; color: var(--accent); font-weight: 500;">
                    ${sched.date} &nbsp;•&nbsp; ${sched.time}
                </p>
            </div>

            <div style="display: flex; gap: 10px; align-items: center;">
                <!-- 這裡綁定了 prepareForBattle 進入備戰狀態 -->
                <button onclick="prepareForBattle(event, ${sched.id})" style="background: var(--accent); border: none; color: white; padding: 8px 16px; border-radius: var(--radius-sm); font-weight: bold; cursor: pointer;">
                    進入備戰
                </button>
            </div>
        </div>
    `).join('');
}

// ---------------------------
// 戰鬥準備：傳遞資料給主系統
// ---------------------------
function prepareForBattle(event, id) {
    // 阻止事件冒泡 (避免點擊按鈕時，又觸發了背景卡片的編輯彈窗)
    if (event) event.stopPropagation();

    const sched = allSchedules.find(item => item.id === id);
    if (sched) {
        // 將這場面的 JD 與資訊存入瀏覽器快取 (localStorage)
        const prepData = {
            company: sched.company,
            job_title: sched.job_title,
            jd_text: sched.jd_text
        };
        localStorage.setItem('currentInterviewPrep', JSON.stringify(prepData));

        // 使用絕對路徑跳回主首頁，並直接切換到 AI 面試模擬模式
        const rootPath = window.location.origin;
        window.location.href = `${rootPath}/frontend/pages/interview.html?feature=interview`;
    }
}

// ---------------------------
// API 串接：新增與更新排程
// ---------------------------
async function submitScheduleForm(event) {
    event.preventDefault();

    const reminderTime = computeReminderTime();
    if (!reminderTime) {
        alert("請輸入有效的提醒時間數字。");
        return;
    }

    const id = document.getElementById('schedId').value;
    const btn = document.getElementById('submitScheduleBtn');
    btn.textContent = '處理中...';
    btn.disabled = true;

    const payload = {
        company: document.getElementById('schedCompany').value,
        job_title: document.getElementById('schedJobTitle').value,
        date: document.getElementById('schedDate').value,
        time: document.getElementById('schedTime').value,
        candidate_email: currentUserEmail,
        reminder_time: reminderTime,
        notes: document.getElementById('schedNotes').value
    };

    // 判斷是 PUT (修改) 還是 POST (新增)
    const isEdit = id !== '';
    const url = isEdit ? `${API_BASE_URL}/events/${id}` : `${API_BASE_URL}/events`;
    const method = isEdit ? 'PUT' : 'POST';

    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            closeAddScheduleModal();
            await loadSchedules(); // 重新向後端抓取最新資料並重繪
        } else {
            alert("儲存失敗，請檢查輸入內容。");
        }
    } catch (error) {
        console.error("儲存排程失敗:", error);
    } finally {
        btn.textContent = '確認儲存';
        btn.disabled = false;
    }
}

// ---------------------------
// API 串接：刪除排程
// ---------------------------
async function deleteSchedule() {
    const id = document.getElementById('schedId').value;
    if (!id) return;

    if (!confirm("確定要刪除這場個別面試排程嗎？此動作無法復原。")) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/events/${id}`, {
            method: 'DELETE',
            headers: await getAuthHeaders()
        });

        if (response.ok) {
            closeAddScheduleModal();
            await loadSchedules(); // 重新向後端抓取最新資料並重繪
        } else {
            alert("刪除失敗。");
        }
    } catch (error) {
        console.error("刪除排程失敗:", error);
    }
}

// ---------------------------
// 戰前 24 小時智慧管家邏輯
// ---------------------------
function checkUpcomingInterviews(schedules) {
    const notificationZone = document.getElementById('calendarNotificationZone');
    const suggestionText = document.getElementById('optimalTimeSuggestion');

    if (schedules.length > 0) {
        const nextInterview = schedules[0]; // 已被後端依時間排序
        notificationZone.style.display = 'block';
        suggestionText.innerHTML = `教練提醒：您與 <strong>${escapeHtml(nextInterview.company)}</strong> 的面試即將到來。請確保睡眠充足，建議您現在可以點擊右側按鈕進行放鬆！`;
    } else {
        notificationZone.style.display = 'none';
    }
}

function startStressReliefDrill() {
    alert("減壓微練習啟動：\n\n1. 請深呼吸三次。\n2. 告訴自己：你已經準備得很好了。\n3. 想想你最自豪的一個專案。");
}