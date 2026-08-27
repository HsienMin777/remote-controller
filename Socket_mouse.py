from flask import Flask, render_template_string
from flask_socketio import SocketIO
import pyautogui

# pyautogui 預設每次呼叫後會 sleep(PAUSE)，touchmove 觸發頻率遠高於 1/PAUSE，
# 事件會不斷堆積造成越用越卡，這裡關閉延遲並停用角落防呆（遠端操控用不到）。
pyautogui.PAUSE = 0
pyautogui.FAILSAFE = False

app = Flask(__name__)
socketio = SocketIO(app)

HTML = """
<!DOCTYPE html>
<html>
<head>
    <title>滑鼠觸控 WS 版</title>
    <style>
        #touchpad {
            width: 100vw;
            height: 80vh;
            background-color: #444;
            touch-action: none;
        }
    </style>
</head>
<body>
    <h2>滑鼠觸控板 WS 版</h2>
    <div id="touchpad"></div>
    <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
    <script>
        const socket = io();
        const pad = document.getElementById('touchpad');
        let lastX = 0, lastY = 0;
        let pendingDx = 0, pendingDy = 0;
        let frameQueued = false;

        // 用 requestAnimationFrame 把同一畫面內的多次 touchmove 合併成一次送出，
        // 避免觸控事件頻率超過 socket/pyautogui 處理速度而造成堆積延遲。
        function flushMove() {
            frameQueued = false;
            if (pendingDx === 0 && pendingDy === 0) return;
            socket.emit('move_mouse', {dx: pendingDx, dy: pendingDy});
            pendingDx = 0;
            pendingDy = 0;
        }

        pad.addEventListener('touchstart', e => {
            const t = e.touches[0];
            lastX = t.clientX;
            lastY = t.clientY;
        });

        pad.addEventListener('touchmove', e => {
            e.preventDefault();
            const t = e.touches[0];
            pendingDx += t.clientX - lastX;
            pendingDy += t.clientY - lastY;
            lastX = t.clientX;
            lastY = t.clientY;
            if (!frameQueued) {
                frameQueued = true;
                requestAnimationFrame(flushMove);
            }
        });

        pad.addEventListener('touchend', e => {
            if (e.changedTouches.length === 1) {
                socket.emit('click_mouse');
            }
        });
    </script>
</body>
</html>
"""

@app.route('/')
def index():
    return render_template_string(HTML)

@socketio.on('move_mouse')
def handle_move_mouse(data):
    dx = float(data.get('dx', 0))
    dy = float(data.get('dy', 0))
    pyautogui.moveRel(dx, dy)

@socketio.on('click_mouse')
def handle_click_mouse():
    pyautogui.click()

if __name__ == '__main__':
    print("Starting server with eventlet...")
    socketio.run(app, host='0.0.0.0', port=5000, debug=False, use_reloader=False)
