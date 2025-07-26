from flask import Flask, render_template_string
from flask_socketio import SocketIO
import pyautogui

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

        pad.addEventListener('touchstart', e => {
            const t = e.touches[0];
            lastX = t.clientX;
            lastY = t.clientY;
            console.log('touchstart', lastX, lastY);
        });

        pad.addEventListener('touchmove', e => {
            e.preventDefault();
            const t = e.touches[0];
            const dx = t.clientX - lastX;
            const dy = t.clientY - lastY;
            lastX = t.clientX;
            lastY = t.clientY;
            socket.emit('move_mouse', {dx: dx, dy: dy});
            console.log('touchmove', dx, dy);
        });

        pad.addEventListener('touchend', e => {
            if (e.changedTouches.length === 1) {
                socket.emit('click_mouse');
                console.log('touchend click');
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
    print("move_mouse event received:", data)
    dx = float(data.get('dx', 0))
    dy = float(data.get('dy', 0))
    pyautogui.moveRel(dx, dy)

@socketio.on('click_mouse')
def handle_click_mouse():
    print("click_mouse event received")
    pyautogui.click()

if __name__ == '__main__':
    print("Starting server with eventlet...")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, use_reloader=True)
