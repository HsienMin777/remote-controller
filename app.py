# API連接
from flask import Flask, render_template_string, request
import os


import socket

#LINE Bot
from linebot import LineBotApi, WebhookHandler
from linebot.exceptions import InvalidSignatureError
from linebot.models import MessageEvent, TextMessage, TextSendMessage

# 爬蟲
import json
import requests
from bs4 import BeautifulSoup

from dotenv import load_dotenv
load_dotenv()

LINE_CHANNEL_ACCESS_TOKEN = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN")
LINE_USER_ID = os.environ.get("LINE_USER_ID")

if not LINE_CHANNEL_ACCESS_TOKEN or not LINE_USER_ID:
    raise RuntimeError(
        "請設定環境變數 LINE_CHANNEL_ACCESS_TOKEN 與 LINE_USER_ID"
        "（可在 app/ 底下建立 .env 檔案，參考 .env.example）"
    )

line_bot_api = LineBotApi(LINE_CHANNEL_ACCESS_TOKEN)
user_id = LINE_USER_ID

# 關機
import pygetwindow as gw
import pyautogui
import time

# 滑鼠
from flask import Flask, render_template_string
from flask_socketio import SocketIO

# ChatGPT
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


app = Flask(__name__)
socketio = SocketIO(app)

# HTML 網頁範本（內嵌式）
HTML_PAGE = """
<!DOCTYPE html>
<html>
<head>
    <title>Python 遠端控制介面</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background-color: #363636;}
        button {
            padding: 15px 30px;
            font-size: 18px;
            margin: 10px;
            cursor: pointer;
            border-radius: 8px;
            border: none;
            color: white;
        }
        .shutdown { background-color: #e74c3c; }
        .open_google { background-color: #3498db; }
        .get_news { background-color: #54ACFF; }
        .mouse {background-color: orange;}
        .chatgpt {background-color: #1da484;}

        .result { margin-top: 20px; font-size: 20px; color: white; }
    </style>
</head>
<body>
    <h1 style = "color: white">Python 遠端控制介面</h1>
    <button class="shutdown" onclick="sendCommand('shutdown')">Turn off</button>
    <button class="open_google" onclick="sendCommand('open_google')">Open Google</button>
    <button class="get_news" onclick="sendCommand('send_news')">NEWS</button>
    <button class="mouse" onclick="window.location.href='/mouse_control'">Mouse</button>
    <button class="chatgpt" onclick="sendCommand('ask_gpt')">Ask ChatGPT</button>



    <div id="result" class="result"></div>

    <script>
        function sendCommand(cmd) {
            fetch('/run?cmd=' + cmd)
                .then(response => response.text())
                .then(data => {
                    document.getElementById('result').innerText = data;
                })
                .catch(err => {
                    document.getElementById('result').innerText = '連線錯誤！';
                });
        }
    </script>
</body>
</html>
"""

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip
server_ip = get_local_ip()

def close_all_windows():
     all_windows = gw.getAllWindows()
     return_close_win = []
     for w in all_windows:
        try:
            title = w.title.strip()
            return_close_win.append(title)
            if title:
                print("關閉 ", title)
            if not title:
                 continue

             # 保留有 "Server_ip" 的視窗
            if "Server_IP" in title:
                 print(f"保留視窗: {title}")
                 continue

            if not w.visible:
                 continue
            print(f"關閉視窗: {title}")
            w.activate()                 # 聚焦視窗
            time.sleep(2)
            pyautogui.hotkey('alt', 'f4')  # Alt+F4
            time.sleep(0.5)
            pyautogui.press('enter')
        except Exception as e:
            print(f"無法關閉視窗: {title}, 錯誤: {e}")

def scratch_news():
    url="https://www.cna.com.tw/list/aall.aspx"
    resp=requests.get(url)

    #將網頁資料透過不同的方法，擷取所需的資料，html parser代表以 html 的方式來解析
    soup = BeautifulSoup(resp.text,"html.parser")

    t=''
    l=''

    r=''
    i=0
    j = 0
    print("即時新聞:\n")

    for i, a in enumerate(soup.select('a[data-menutext]'), 1):
        title = a.get('data-menutext', '').strip()
        href = a.get('href', '')
        full_url = f"https://www.cna.com.tw{href}" if href else "(無連結)"

        if len(r) >=4500:
            break
        elif title:
            t = str(i) + " " + title
            l = "連結：" + full_url
            r += t + '\n' + l + '\n\n'
    line_bot_api.push_message(user_id, TextSendMessage(text=r))

def ask_gpt():
    pyautogui.hotkey('ctrl', 'c')

    os.system("start https://chat.openai.com/")
    time.sleep(5)
    pyautogui.hotkey('ctrl', 'v')
    pyautogui.hotkey('enter')


@app.route("/")
def index():
    return render_template_string(HTML_PAGE)

@app.route("/mouse_control")
def mouse_control():
    return '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>滑鼠控制</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { margin: 0; background: #222; color: white; font-family: sans-serif; text-align: center; }
            #touchpad { width: 100vw; height: 80vh; background: #444; touch-action: none; }
            button { margin-top: 20px; padding: 12px 24px; font-size: 18px; }
        </style>
    </head>
    <body>
        <h2>觸控滑鼠控制區</h2>
        <div id="touchpad"></div>
        <button onclick="window.location.href='/'">返回主畫面</button>

        <script>
            const pad = document.getElementById('touchpad');
            let lastX = 0, lastY = 0;

            pad.addEventListener('touchstart', e => {
                const t = e.touches[0];
                lastX = t.clientX;
                lastY = t.clientY;
            });

            // 拖曳
            pad.addEventListener('touchmove', e => {
                e.preventDefault();
                const t = e.touches[0];
                const dx = t.clientX - lastX;
                const dy = t.clientY - lastY;
                lastX = t.clientX;
                lastY = t.clientY;

                fetch(`/mouse_move?dx=${dx}&dy=${dy}`);
            });

            // 點擊
            let touchStartTime = 0;

            pad.addEventListener('touchstart', e => {
                if (e.touches.length === 1) {
                    touchStartTime = Date.now();  // 記錄按下時間
                }
            });

            pad.addEventListener('touchend', e => {
                if (e.changedTouches.length === 1) {
                    const duration = Date.now() - touchStartTime;

                    if (duration <= 100) {  // 持續時間設定
                        fetch('/mouse_click');
                    }
                }
            });

        </script>
    </body>
    </html>

    '''
@app.route('/mouse_move')
def mouse_move():
    dx = float(request.args.get('dx', 0))
    dy = float(request.args.get('dy', 0))

    # 取得目前滑鼠位置
    x, y = pyautogui.position()

    # 計算新的位置
    new_x = x + dx * 7  # 可依需要調整倍率
    new_y = y + dy * 7

    # 限制在螢幕範圍內
    screenWidth, screenHeight = pyautogui.size()
    new_x = max(2, min(screenWidth - 3, new_x))
    new_y = max(2, min(screenHeight - 3, new_y))

    # 移動滑鼠
    pyautogui.moveTo(new_x, new_y)
    return 'OK'


@app.route('/mouse_click')
def mouse_click():
    try:
        pyautogui.click()
        return "已點擊"
    except Exception as e:
        return f"錯誤: {e}"

@app.route("/run")

def run_command():
    cmd = request.args.get("cmd", "")
    if cmd == "shutdown":
        close_all_windows()
        return "Windows 即將關機..."

    elif cmd == "send_news":
        scratch_news()
        return "請至聊天室閱覽新聞。"

    elif cmd == "open_google":
        os.system("start https://www.google.com")
        return "已開啟 Google 網頁。"

    elif cmd == "open_mouse":
        return "已開啟 滑鼠。"

    elif cmd == "ask_gpt":
        ask_gpt()
        return "已詢問ChatGPT。"

    else:
        return f"未知指令：{cmd}"

if __name__ == "__main__":
    p = "http://" + server_ip + ":5000/"
    print(f"位址 : {server_ip}:5000")

    line_bot_api.push_message(user_id, TextSendMessage(p))

    app.run(host="0.0.0.0", port=5000)
