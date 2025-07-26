from linebot import LineBotApi, WebhookHandler
from linebot.exceptions import InvalidSignatureError
from linebot.models import MessageEvent, TextMessage, TextSendMessage

from Server_IP import server_ip

p = server_ip + ":5000"

line_bot_api = LineBotApi('CkPHM4CpqDvRm12cUKqziUMyIvhoudv/Oc8Kv9eSydOEamdv6cqvud2qq7UpwXvNcY0TC1Ub7CGOhrjAp7cnvB+MHZr+cxz0Ht5LmKjVrS4sxjtyIHm67oqJS9q3bMqppd/iTIq6oC0RYVIKAK2IQAdB04t89/1O/w1cDnyilFU=')
user_id = 'U2317f7d6f7b91663b4c3ff4ee6ee81c9'

line_bot_api.push_message('U2317f7d6f7b91663b4c3ff4ee6ee81c9', TextSendMessage(p))
