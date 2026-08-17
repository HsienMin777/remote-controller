import os
import html
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
    location = Column(Text, default="")       # 面試地點或線上會議連結
    cheer_message = Column(Text, default="")  # 建立行程當下就先生成好的 AI 打氣語錄，避免排程寄信時才臨時呼叫 LLM
    is_reminder_sent = Column(Boolean, default=False) # 第一封提醒是否已寄
    is_cheer_sent = Column(Boolean, default=False)    # 戰前 2 小時 AI 加油是否已寄

Base.metadata.create_all(bind=engine)

# 🔥 schedules 資料表的欄位是隨著功能迭代陸續加入的，create_all 不會幫舊表補欄位，
#    這裡用 ALTER TABLE 補齊，確保既有資料庫升級後不會噴 column does not exist。
def _ensure_schedule_columns():
    inspector = inspect(engine)
    columns = [col["name"] for col in inspector.get_columns("schedules")]
    missing_columns = {
        "notes": "TEXT",
        "location": "TEXT",
        "cheer_message": "TEXT",
    }
    with engine.begin() as conn:
        for name, ddl_type in missing_columns.items():
            if name not in columns:
                conn.execute(text(f"ALTER TABLE schedules ADD COLUMN {name} {ddl_type}"))

_ensure_schedule_columns()

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
    location: Optional[str] = ""

class InterviewEventResponse(InterviewEventBase):
    id: int
    is_reminder_sent: bool
    is_cheer_sent: bool
    class Config:
        from_attributes = True

# 預設打氣語錄：LLM 生成失敗時的備援，確保排程寄信不會因為缺乏文字而出錯
DEFAULT_CHEER_MESSAGE = "相信自己這段時間的準備與累積，你已經具備足夠的實力。放輕鬆，展現最真實的你，你一定可以的！"

# 在「建立/修改行程」當下就先生成好專屬打氣語錄，交給排程器直接使用——
# 避免排程寄信的當下才臨時呼叫 LLM，遇到 API 延遲或額度問題導致整封信寄送失敗。
async def generate_cheer_message(company_name: str, job_title: str) -> str:
    prompt = (
        f"你是一個溫暖且專業的職涯教練。求職者即將前往【{company_name}】面試【{job_title}】職位。"
        "請寫一段 2~3 句話的簡短面試前加油打氣。語氣要真誠、有力量、高情商，"
        "不需要加上問候語或結語，直接給出金句即可。"
    )
    try:
        completion = await aclient.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}]
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        print(f"⚠️ 生成打氣語錄失敗，改用預設文字: {e}")
        return DEFAULT_CHEER_MESSAGE

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
    cheer_message = await generate_cheer_message(event.company, event.job_title)
    new_schedule = ScheduleModel(**event.model_dump(), user_id=user_id, cheer_message=cheer_message)
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

    # 修改時間後，重置寄信狀態；公司/職位可能已變更，一併重新生成打氣語錄
    schedule.is_reminder_sent = False
    schedule.is_cheer_sent = False
    schedule.cheer_message = await generate_cheer_message(schedule.company, schedule.job_title)

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
def send_email(to_email: str, subject: str, body: str, is_html: bool = False):
    sender_email = os.getenv("SENDER_EMAIL")
    sender_password = os.getenv("SENDER_PASSWORD")
    if not sender_email or not sender_password:
        print(f"⚠️ 模擬寄信至 {to_email} | 主旨: {subject}")
        return

    msg = MIMEMultipart()
    msg['From'] = sender_email
    msg['To'] = to_email
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'html' if is_html else 'plain', 'utf-8'))

    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(sender_email, sender_password)
        server.send_message(msg)
        server.quit()
        print(f"✅ 信件已成功發送至: {to_email}")
    except Exception as e:
        print(f"❌ 寄信失敗: {str(e)}")

# 組裝提醒信的 HTML 內容：公司/職位/面試時間/地點 + 底部的專屬打氣語錄。
# 兩種提醒信（自訂提醒時間、戰前 2 小時）共用同一份排版，只有 subject 與開頭文字不同。
def _build_reminder_email_html(intro: str, company_name: str, job_title: str, interview_time: str, location: str, cheer_message: str) -> str:
    location_row = f"<li><b>地點／連結：</b>{html.escape(location)}</li>" if location else ""
    return f"""
    <div style="font-family: 'Microsoft JhengHei', -apple-system, sans-serif; color: #1f2937; line-height: 1.8; font-size: 15px;">
        <p>{intro}</p>
        <ul style="padding-left: 20px; margin: 16px 0;">
            <li><b>公司：</b>{html.escape(company_name)}</li>
            <li><b>職位：</b>{html.escape(job_title)}</li>
            <li><b>面試時間：</b>{html.escape(interview_time)}</li>
            {location_row}
        </ul>
        <p>請提早準備，祝您順利！</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="color: #6b7280; font-style: italic;">💬 {html.escape(cheer_message)}</p>
    </div>
    """

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
            interview_time_str = f"{sched.date} {sched.time}"
            # 🔥 打氣語錄已在建立/修改行程當下由 generate_cheer_message() 預先生成好，
            #    這裡排程寄信時直接取用，不再臨時呼叫 LLM，避免 API 延遲導致整封信寄送失敗。
            cheer_message = sched.cheer_message or DEFAULT_CHEER_MESSAGE

            # 1. 處理「自訂提醒時間」寄送
            reminder_dt = _safe_parse_datetime(sched.reminder_time, "%Y-%m-%dT%H:%M")
            if reminder_dt and not sched.is_reminder_sent and now >= reminder_dt:
                subject = f"面試管家提醒：您與 {sched.company} 的面試即將到來"
                body = _build_reminder_email_html(
                    intro="您好，系統依照您的設定提醒您，即將有一場重要的面試：",
                    company_name=sched.company,
                    job_title=sched.job_title,
                    interview_time=interview_time_str,
                    location=sched.location or "",
                    cheer_message=cheer_message,
                )
                send_email(sched.candidate_email, subject, body, is_html=True)
                sched.is_reminder_sent = True
                db.commit()

            # 2. 處理「戰前 2 小時 AI 加油信」寄送
            interview_dt = _safe_parse_datetime(interview_time_str, "%Y-%m-%d %H:%M")
            if not interview_dt:
                continue
            time_until_interview = interview_dt - now

            # 如果距離面試小於等於 2 小時，且面試還沒過期，且還沒寄過
            if not sched.is_cheer_sent and timedelta(hours=0) < time_until_interview <= timedelta(hours=2):
                subject = f"🔥 戰前 2 小時教練密語：征服 {sched.company} 吧！"
                body = _build_reminder_email_html(
                    intro="面試倒數 2 小時！來自教練的專屬提醒：",
                    company_name=sched.company,
                    job_title=sched.job_title,
                    interview_time=interview_time_str,
                    location=sched.location or "",
                    cheer_message=cheer_message,
                )
                send_email(sched.candidate_email, subject, body, is_html=True)
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