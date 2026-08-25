# OfferDash

AI 驅動的求職教練平台：從履歷 / 職缺 (JD) 契合度診斷、AI 模擬面試、面試復盤報告，到遊戲化的弱點翻盤練習與面試行程管家，一站式協助使用者準備面試、追蹤每一場求職進度。

## 核心功能

### 1. AI 模擬面試 (AI Simulated Interview)
- 使用者設定應徵職位、難度、題數、面試語言（中/英）、面試類型（職場 / 升學）
- 可上傳 PDF 履歷，AI（GPT-4o）會依履歷內容與職缺描述客製化提問與追問
- 支援語音輸入（Web Speech API 麥克風按鈕），Enter 送出、Shift+Enter 換行
- 獨立「面試戰場」頁面 (`interview_arena.html`) 呈現沉浸式對話介面，並在對話結束後自動生成復盤報告

### 2. 履歷與 JD 契合度診斷 (Resume × JD Match Diagnosis)
- 貼上職缺描述 (JD) + 上傳履歷 PDF，AI 產出：
  - ATS 契合度分數與短評
  - 已命中 / 缺失的關鍵字比對
  - **JD 總結與分析**：一段話精準整理 JD 核心內容與潛在挑戰（嚴格基於原文，防幻覺）
  - 預測面試必考題與面試官意圖
  - 求職建議
- 可一鍵預覽剛剛上傳的**原始履歷檔案**（PDF/圖片皆可，透過瀏覽器 Blob URL 直接還原排版與圖片，不經過純文字轉換）
- 診斷結果可存檔，供「履歷上傳紀錄」頁面日後回顧

### 3. 面試復盤報告與遊戲化成長系統
- 面試結束後，AI 分析整場對話生成復盤報告
- **「復仇翻盤任務」**：AI 挑出表現最弱的 3 個回答，依應徵職業別（工程師／教師／其他行業…）給出對應產業術語的盲點分析與教練式重答策略，並設計 XP 獎勵與任務標籤（🔥 致命盲區 / ✨ 最佳翻盤題 / 💡 關鍵字漏接），讓使用者「刷經驗值」把弱點練到及格

### 4. AI 職涯諮詢師 (AI Career Consultant)
- 聊天式互動，自動帶入使用者近期的面試紀錄與履歷診斷作為背景資訊
- 每日對話額度限制，避免濫用
- 嚴格限定回答範圍在面試／履歷／職涯發展，避免功能失焦

### 5. 面試管家 / 行事曆 (Interview Calendar)
- 新增／編輯／刪除面試排程（公司、職位、時間、地點或線上會議連結、備註）
- 自訂提醒時間 + 面試前 2 小時自動寄送「教練加油信」
- Email 為 HTML 格式（含職缺資訊列表與底部激勵語錄），**打氣語錄在建立/修改行程當下就由 AI 預先生成**並存入資料庫，寄信排程只需讀取現成文字，避免寄信當下才呼叫 LLM 造成延遲失敗
- 背景排程器（APScheduler，每分鐘檢查一次）以台灣時區為準，確保提醒準時寄出
- 「一鍵備戰」：從行事曆的排程直接帶入公司/職位/JD，跳轉開始模擬面試

### 6. 儀表板與歷史紀錄
- `dashboard.html`：面試歷程總覽、機會分析（結合復仇翻盤任務）
- `overview.html`：登入後的總覽首頁，含面試紀錄卡片輪播
- `resume_records.html`：履歷診斷歷史紀錄

### 7. 帳號與外觀
- Supabase Auth：Email/密碼註冊登入 + Google OAuth
- 全站深色／淺色主題切換（現代科技黑風格：`#0A0A0A` / `#141414` / `#1A1A1A`，藍色作為互動強調色）
- 全域毛玻璃固定頁首 + 滿版背景的 Edge-to-Edge 版面
- 行動裝置響應式優化（動態視窗高度 `100dvh`、觸控目標尺寸、避免 iOS 自動縮放等）

## 技術架構

**後端**：FastAPI (Python) · SQLAlchemy ORM · PostgreSQL (Supabase) · APScheduler（背景排程/寄信）· OpenAI API (GPT-4o / GPT-4o-mini) · PyPDF2（履歷文字擷取）· smtplib（Gmail SMTP 寄信）

**前端**：純 HTML / CSS / JavaScript（無建置工具、無框架）· Supabase JS SDK（登入狀態管理）· Web Speech API（語音輸入）· CSS 自訂屬性 (Design Token) 驅動的主題系統

**資料庫 / 驗證**：Supabase（Postgres + Auth 一體）

**部署**：
- 後端 API：Render (`offerdash.onrender.com`)
- 前端：同時部署於 Render（FastAPI 掛載 `/frontend` 靜態目錄）與 Vercel（`offerdash-app.vercel.app`，直接以 `frontend/` 為根目錄）— 所有內部導頁一律採用相對路徑，確保兩種掛載方式都能正確運作

## 專案結構

```
interview_AI/
├── backend/
│   ├── main.py                # 主要 API：面試對答、復盤報告、JD診斷、諮詢師、成長系統
│   ├── db_clients.py          # 共用的 DB engine / OpenAI client / Supabase client
│   └── api/
│       └── calender_api.py    # 行事曆 CRUD + 自動提醒寄信排程器
├── frontend/
│   ├── index.html             # 登入 / 註冊頁（入口首頁）
│   ├── js/                    # 共用邏輯：auth、router、app、calendar、consultant、growth-v2、
│   │                           #   shared-header / shared-sidebar / shared-footer 等元件
│   └── pages/
│       ├── interview.html        # 模擬面試設定 + JD 診斷報告頁
│       ├── interview_arena.html  # 面試進行中的對話戰場
│       ├── overview.html         # 登入後總覽首頁
│       ├── dashboard.html        # 面試數據儀表板 / 翻盤任務
│       ├── resume_records.html   # 履歷診斷歷史紀錄
│       ├── calendar.html         # 面試管家 / 行事曆
│       ├── consultant.html       # AI 職涯諮詢師
│       └── settings.html         # 使用者偏好設定
└── Future.txt                 # 未來功能規劃筆記
```

## 環境變數

於專案根目錄建立 `.env`：

```
DATABASE_URL=      # Postgres 連線字串 (Supabase)
OPENAI_API_KEY=    # OpenAI API 金鑰
SUPABASE_URL=
SUPABASE_KEY=
SENDER_EMAIL=      # 寄送提醒信用的 Gmail 帳號
SENDER_PASSWORD=   # Gmail App Password（非登入密碼）
```

## 本機啟動

```bash
# 後端
cd backend
uvicorn main:app --reload

# 前端（純靜態，任一簡易伺服器皆可）
python -m http.server 5500
```

## 未來規劃（節錄自 Future.txt）

- ATS 職缺適配度診斷的更深化版本、命中率預測
- 多模態面試分析：語速/贅詞偵測、眼神接觸與表情分析（WebCam + MediaPipe/Face-api.js）
- 互動式「黃金回答」修正沙盒、STAR 原則故事庫
- 求職進度看板（Kanban）、面試後自動生成客製化跟進信
