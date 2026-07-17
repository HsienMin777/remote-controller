import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy import Column, Integer, String, Text, Boolean, inspect, text
from sqlalchemy.orm import declarative_base, Session
from apscheduler.schedulers.asyncio import AsyncIOScheduler

# 共用的 DB engine / OpenAI client / Supabase client（見 db_clients.py 的說明）
from db_clients import aclient, supabase_client, engine, SessionLocal, get_db

# ==========================================
# 1. 初始化與資料庫設定
# ==========================================
Base = declarative_base()

# 🌟 更新資料表：加入信箱、提醒時間、狀態標記
class ScheduleModel(Base):
    __tablename__ = "schedules"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True)      # 排程屬於哪位登入使用者
    company = Column(String, index=True)
    job_title = Column(String)
    date = Column(String) # YYYY-MM-DD
    time = Column(String) # HH:MM
    candidate_email = Column(String)          # 考生信箱
    reminder_time = Column(String)            # 自訂提醒時間 YYYY-MM-DDTHH:MM
    jd_text = Column(Text, default="")
    notes = Column(Text, default="")          # 使用者自訂備註
    is_reminder_sent = Column(Boolean, default=False) # 第一封提醒是否已寄
    is_cheer_sent = Column(Boolean, default=False)    # 戰前 2 小時 AI 加油是否已寄

Base.metadata.create_all(bind=engine)

# 🔥 schedules 資料表在加入 notes 前就已存在，create_all 不會幫舊表補欄位，
#    這裡用 ALTER TABLE 補齊，確保既有資料庫升級後不會噴 column does not exist。
def _ensure_notes_column():
    inspector = inspect(engine)
    columns = [col["name"] for col in inspector.get_columns("schedules")]
    if "notes" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE schedules ADD COLUMN notes TEXT"))

_ensure_notes_column()

# 從 Authorization: Bearer <token> 解析出登入中的 Supabase 使用者，確保排程只能被本人存取
async def get_current_user_id(authorization: Optional[str] = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="缺少登入憑證")

    token = authorization.removeprefix("Bearer ").strip()
    try:
        user_response = supabase_client.auth.get_user(token)
    except Exception:
        raise HTTPException(status_code=401, detail="登入憑證無效或已過期")

    user = getattr(user_response, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="登入憑證無效或已過期")

    return user.id

# ==========================================
# 2. Pydantic 模型
# ==========================================
class InterviewEventBase(BaseModel):
    company: str
    job_title: str
    date: str
    time: str
    candidate_email: str
    reminder_time: str
    jd_text: Optional[str] = ""
    notes: Optional[str] = ""

class InterviewEventResponse(InterviewEventBase):
    id: int
    is_reminder_sent: bool
    is_cheer_sent: bool
    class Config:
        from_attributes = True

router = APIRouter()

@router.get("/events", response_model=List[InterviewEventResponse])
async def get_events(db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id)):
    return (
        db.query(ScheduleModel)
        .filter(ScheduleModel.user_id == user_id)
        .order_by(ScheduleModel.date, ScheduleModel.time)
        .all()
    )

@router.post("/events", response_model=InterviewEventResponse)
async def add_event(event: InterviewEventBase, db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id)):
    new_schedule = ScheduleModel(**event.model_dump(), user_id=user_id)
    db.add(new_schedule)
    db.commit()
    db.refresh(new_schedule)
    return new_schedule

@router.put("/events/{event_id}", response_model=InterviewEventResponse)
async def update_event(event_id: int, updated_event: InterviewEventBase, db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id)):
    schedule = db.query(ScheduleModel).filter(ScheduleModel.id == event_id, ScheduleModel.user_id == user_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="找不到")

    for key, value in updated_event.model_dump().items():
        setattr(schedule, key, value)

    # 修改時間後，重置寄信狀態
    schedule.is_reminder_sent = False
    schedule.is_cheer_sent = False

    db.commit()
    db.refresh(schedule)
    return schedule

@router.delete("/events/{event_id}")
async def delete_event(event_id: int, db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id)):
    deleted = db.query(ScheduleModel).filter(ScheduleModel.id == event_id, ScheduleModel.user_id == user_id).delete()
    db.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail="找不到")
    return {"status": "success"}

# ==========================================
# 3. 背景自動寄信排程器 (Cron Job)
# ==========================================
def send_email(to_email: str, subject: str, body: str):
    sender_email = os.getenv("SENDER_EMAIL")
    sender_password = os.getenv("SENDER_PASSWORD")
    if not sender_email or not sender_password:
        print(f"⚠️ 模擬寄信至 {to_email} | 主旨: {subject}")
        return

    msg = MIMEMultipart()
    msg['From'] = sender_email
    msg['To'] = to_email
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'plain', 'utf-8'))

    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(sender_email, sender_password)
        server.send_message(msg)
        server.quit()
        print(f"✅ 信件已成功發送至: {to_email}")
    except Exception as e:
        print(f"❌ 寄信失敗: {str(e)}")

# 安全解析日期時間字串：格式錯誤或缺值時回傳 None，而不是丟例外炸掉整個排程迴圈
def _safe_parse_datetime(value, fmt):
    if not value:
        return None
    try:
        return datetime.strptime(value, fmt)
    except ValueError:
        return None

# 定義背景任務
async def check_and_send_reminders():
    db = SessionLocal()
    now = datetime.now()
    schedules = db.query(ScheduleModel).all()

    for sched in schedules:
        try:
            # 1. 處理「自訂提醒時間」寄送
            reminder_dt = _safe_parse_datetime(sched.reminder_time, "%Y-%m-%dT%H:%M")
            if reminder_dt and not sched.is_reminder_sent and now >= reminder_dt:
                subject = f"面試管家提醒：您與 {sched.company} 的面試即將到來"
                body = f"您好，\n\n系統依照您的設定提醒您：\n您應徵 {sched.company} 的 {sched.job_title} 面試，將於 {sched.date} {sched.time} 進行。\n\n請提早準備，祝您順利！"
                send_email(sched.candidate_email, subject, body)
                sched.is_reminder_sent = True
                db.commit()

            # 2. 處理「戰前 2 小時 AI 加油信」寄送
            interview_dt = _safe_parse_datetime(f"{sched.date} {sched.time}", "%Y-%m-%d %H:%M")
            if not interview_dt:
                continue
            time_until_interview = interview_dt - now

            # 如果距離面試小於等於 2 小時，且面試還沒過期，且還沒寄過
            if not sched.is_cheer_sent and timedelta(hours=0) < time_until_interview <= timedelta(hours=2):

                # 呼叫 AI 生成專屬加油語錄
                ai_prompt = f"求職者即將在2小時後前往【{sched.company}】面試【{sched.job_title}】職位。請用教練的口吻，寫一小段大約 50 字的熱血、安定人心的加油語錄給他。純文字，不要標題。"
                try:
                    completion = await aclient.chat.completions.create(
                        model="gpt-4o-mini",
                        messages=[{"role": "user", "content": ai_prompt}]
                    )
                    ai_cheer = completion.choices[0].message.content
                except Exception:
                    ai_cheer = "深呼吸，相信你累積的實力，放寬心去展現最棒的自己！加油！"

                subject = f"🔥 戰前 2 小時教練密語：征服 {sched.company} 吧！"
                body = f"面試倒數 2 小時！\n\n來自教練的專屬鼓勵：\n「{ai_cheer}」\n\n帶著自信上場吧，你一定沒問題的！💪"
                send_email(sched.candidate_email, subject, body)
                sched.is_cheer_sent = True
                db.commit()

        except Exception as e:
            print(f"排程處理 {sched.company} 時發生錯誤: {e}")
            
    db.close()

# 啟動排程器 (每分鐘執行一次檢查)
# 🔥 start() 需要一個正在執行的事件迴圈，模組匯入當下 (uvicorn 載入 app 時) 還沒有，
#    所以改成掛在 FastAPI 的 startup 事件，等應用程式真正啟動後才呼叫。
scheduler = AsyncIOScheduler()
scheduler.add_job(check_and_send_reminders, 'interval', minutes=1)

@router.on_event("startup")
async def start_scheduler():
    if not scheduler.running:
        scheduler.start()