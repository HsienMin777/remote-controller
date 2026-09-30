# phone_assistance — 手機遠端遙控電腦

用手機瀏覽器遠端遙控電腦的 Flask 小工具。

## 專案簡介

這個 repo 有兩個獨立的實作，功能範圍不同：

- **`Socket_mouse.py`**：只做觸控滑鼠，透過 WebSocket（Flask-SocketIO）即時傳送滑鼠移動/點擊，延遲較低，是目前主要在使用的版本。
- **`app.py`**：功能更完整的遠端控制台，除了滑鼠（HTTP 輪詢版）之外，還有遠端關機、開啟 Google、透過 LINE Bot 推播新聞、詢問 ChatGPT 等按鈕。

## 專案結構

```
.
├── Socket_mouse.py    # 手機觸控板 → WebSocket → 電腦滑鼠（目前主要在跑的版本）
├── app.py             # 完整版遠端控制台：關機／開網頁／LINE 推播新聞／滑鼠／詢問 ChatGPT
├── .env.example       # LINE 機密資訊範本，複製為 .env 並填入實際值
└── .gitignore         # 排除 __pycache__ 與 .env，避免機密外流
```

## 環境需求

```bash
# Socket_mouse.py 所需
pip install flask flask-socketio pyautogui eventlet

# app.py 額外需要
pip install line-bot-sdk beautifulsoup4 requests pygetwindow selenium python-dotenv
```

> Selenium 目前只有 import、並未實際被 `app.py` 使用（見下方「詢問 ChatGPT」說明），若要清掉這個相依套件也不影響現有功能。

### 設定 LINE 機密資訊（僅 app.py 需要）

`app.py` 會用 LINE Bot 推播訊息，Channel Access Token 與使用者 ID 透過環境變數讀取，不寫死在程式碼裡：

```bash
cp .env.example .env
# 編輯 .env，填入實際的 LINE_CHANNEL_ACCESS_TOKEN、LINE_USER_ID
```

`.env` 已加進 `.gitignore`，不會被提交進版控。

## 使用方式

### 1. 手機遠端滑鼠（Socket_mouse.py）

```bash
python Socket_mouse.py
```

伺服器啟動於 `0.0.0.0:5000`，手機與電腦需在同一區網下，用手機瀏覽器開啟電腦的區網 IP 即可在觸控板區域滑動控制滑鼠、點擊。

> 效能修正：`pyautogui` 預設每次呼叫後會 `sleep(PAUSE=0.1)`，而手機 `touchmove` 觸發頻率遠高於此，會造成事件不斷堆積、越滑越卡。目前已將 `pyautogui.PAUSE` 設為 `0`、關閉 `FAILSAFE`，並在前端以 `requestAnimationFrame` 合併同一畫面內的多次 `touchmove` 再送出，大幅改善延遲問題。

### 2. 完整版遠端控制台（app.py）

```bash
python app.py
```

伺服器啟動後會將控制台網址透過 LINE Bot 推播給你，手機與電腦需在同一區網下。網頁上的按鈕功能：

- **Turn off**：呼叫 `close_all_windows()` 逐一關閉視窗（Alt+F4），保留標題含 `Server_IP` 的視窗。
- **Open Google**：用系統預設瀏覽器開啟 Google。
- **NEWS**：爬取中央社即時新聞，透過 LINE Bot 推播給你。
- **Mouse**：另一套滑鼠控制頁面，用 HTTP 輪詢（`fetch`）而非 WebSocket，延遲比 `Socket_mouse.py` 高。
- **Ask ChatGPT**：**不是**用 Selenium 操作（雖然檔案有 import selenium，但實際上沒被呼叫到），而是用 `pyautogui` 模擬鍵盤操作——複製目前選取的內容、以系統預設瀏覽器開啟 `chat.openai.com`、等待 5 秒後貼上並按 Enter。這代表：(1) 必須先在電腦上手動選取/複製好問題文字，按鈕本身不會讓你輸入文字；(2) 5 秒的等待時間若網路慢、頁面還沒載入完成或聊天框未取得焦點，貼上與送出就會失敗——這很可能是這個按鈕點了沒反應的原因。

## 目前狀態 / 待辦

- `Socket_mouse.py` 的延遲問題已排查並修正，若之後又出現卡頓，優先確認是否為區網/Wi-Fi 延遲。
- `app.py` 內 import 了 `selenium`、LINE Webhook 相關類別（`WebhookHandler`、`InvalidSignatureError`、`MessageEvent`、`TextMessage`）但實際上都沒被使用，屬未使用的死碼；`ask_gpt()` 目前是用 `pyautogui` 模擬鍵盤操作而非真正的瀏覽器自動化，不夠穩定，之後可考慮改用 Selenium 真正操作網頁元素，或整個功能重新設計。
- `Socket_mouse.py`（WebSocket 版）與 `app.py` 裡的滑鼠控制（HTTP 輪詢版）是兩套獨立實作，尚未整合成一套。
- 尚無自動化測試與 CI。
- 早期 commit（`1b65f90`）中曾有一份 `send_IP.py` 寫死 LINE Token，該檔案已從版控移除，但金鑰仍留存在較舊的 git 歷史中；對應的 Token 應視為已外流，請至 LINE Developers Console 重新發行。
