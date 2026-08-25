import os
import json
import base64
import mimetypes
from datetime import datetime
from zoneinfo import ZoneInfo
from io import BytesIO
from typing import Optional

# 使用者所在地一律視為台灣 (UTC+8)；伺服器容器通常跑在 UTC，「今天」的判斷若直接用
# datetime.utcnow() 會在台灣時間每天早上 8 點才重置額度，而不是台灣的午夜 0 點。
TAIPEI_TZ = ZoneInfo("Asia/Taipei")

# 🔥 Windows 的登錄檔常把 .js 對應到 text/plain，導致靜態檔案被送錯 MIME type，
#    這裡強制覆寫成正確的 JavaScript MIME type。
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
from api.calender_api import router as calendar_router, get_current_user_id, send_email, ScheduleModel
from fastapi import FastAPI, UploadFile, File, Form, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import PyPDF2
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
# SQLAlchemy 相關套件
from sqlalchemy import Column, Integer, String, Text, JSON, DateTime, inspect, text
from sqlalchemy.orm import declarative_base, Session

# 共用的 DB engine / OpenAI client / Supabase client（見 db_clients.py 的說明）
from db_clients import aclient, supabase_client, engine, SessionLocal, get_db
# ==========================================
# 0. 環境變數與靜態常數設定
# ==========================================

Base = declarative_base()

class InterviewRecord(Base):
    __tablename__ = "interview_records"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True, nullable=True)  # 紀錄屬於哪位登入使用者
    job_title = Column(String, index=True)
    company_name = Column(String)
    date = Column(DateTime, default=datetime.utcnow)
    total_score = Column(Integer)
    short_feedback = Column(String)
    detailed_scores = Column(JSON)
    strengths = Column(JSON)
    improvements = Column(JSON)
    transcript = Column(JSON, nullable=True)
    resume_url = Column(String, nullable=True)
    opportunities = Column(JSON, nullable=True)  # 「能力升級區」翻盤任務的生成/完成結果

class ResumeDiagnosis(Base):
    __tablename__ = "resume_diagnoses"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True, nullable=True)  # 紀錄屬於哪位登入使用者
    job_title = Column(String, index=True)
    company_name = Column(String)
    date = Column(DateTime, default=datetime.utcnow)
    resume_text = Column(Text)
    jd_text = Column(Text)
    match_score = Column(Integer)
    diagnosis_result = Column(JSON)  # AI 產出的完整診斷 JSON (summary / matched_skills / missing_skills / jd_analysis_summary / predicted_questions / advice)

class ConsultantChatLog(Base):
    __tablename__ = "consultant_chat_logs"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True)  # 紀錄屬於哪位登入使用者，同時用來計算每日額度
    message = Column(Text)
    reply = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

Base.metadata.create_all(bind=engine)

# 🔥 interview_records 資料表在加入 user_id / transcript / opportunities 前就已存在，
#    create_all 不會幫舊表補欄位，這裡用 ALTER TABLE 補齊，確保既有資料庫升級後不會噴 column does not exist。
def _ensure_interview_record_columns():
    inspector = inspect(engine)
    columns = [col["name"] for col in inspector.get_columns("interview_records")]
    with engine.begin() as conn:
        if "user_id" not in columns:
            conn.execute(text("ALTER TABLE interview_records ADD COLUMN user_id VARCHAR"))
        if "transcript" not in columns:
            conn.execute(text("ALTER TABLE interview_records ADD COLUMN transcript JSON"))
        if "opportunities" not in columns:
            conn.execute(text("ALTER TABLE interview_records ADD COLUMN opportunities JSON"))

_ensure_interview_record_columns()

# ==========================================
# 2. 資料模型與工具函數
# ==========================================
class SaveRecordRequest(BaseModel):
    job_title: str
    company_name: str
    total_score: int
    short_feedback: str
    detailed_scores: dict
    strengths: list
    improvements: list
    transcript: list
    resumeUrl: Optional[str] = None
    # diagnostic 只用於前端觸發「復仇翻盤任務」，資料庫不儲存，
    # 所以設為選填，避免 AI report 偶爾漏產生這個欄位時擋掉整筆儲存
    diagnostic: Optional[dict] = None
    # 「能力升級區」在即時報告頁面已生成（或使用者已完成）的翻盤任務，隨面試紀錄一併存檔
    opportunities: Optional[list] = None

class UpdateOpportunitiesRequest(BaseModel):
    opportunities: list

class ContactRequest(BaseModel):
    name: str
    email: str
    message: str

class SaveResumeDiagnosisRequest(BaseModel):
    job_title: str
    company_name: str
    resume_text: str
    jd_text: str
    match_score: int
    diagnosis_result: dict

class ConsultantChatRequest(BaseModel):
    message: str

# AI 面試諮詢室的成本防護參數：每日次數上限、單則訊息字數上限
CONSULTANT_DAILY_LIMIT = 5
CONSULTANT_MAX_CHARS = 500

# 網站經營者收信信箱，聯絡我們表單一律寄到這裡
CONTACT_RECEIVER_EMAIL = "bbei8640@gmail.com"

def extract_text_from_pdf(file_bytes):
    try:
        reader = PyPDF2.PdfReader(BytesIO(file_bytes))
        return "".join([page.extract_text() for page in reader.pages])
    except Exception as e:
        print(f"PDF 解析失敗: {e}")
        return ""

# ==========================================
# 3. 初始化 FastAPI
# ==========================================
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(calendar_router, prefix="/api", tags=["Calendar"])
# ==========================================

# ==========================================
# 4. 核心路由區：面試主流程
# ==========================================
@app.post("/api/interview/next")
async def next_question(
    audio_file: UploadFile = File(None),
    chat_history_str: str = Form(...),
    job_title: str = Form(...),        
    company_name: str = Form(...),
    interview_type: str = Form("job"),
    interview_difficulty: str = Form("medium"), # 🔥 1. 新增難度參數接收
    resume_file: UploadFile = File(None),
    text_answer: Optional[str] = Form(None),
    is_final_round: str = Form("false"),
    interview_language: str = Form("zh"),
    job_description: Optional[str] = Form(None) # 由「一鍵備戰」帶入的 JD，讓提問更貼合職缺
):
    chat_history = json.loads(chat_history_str)
    
    # 🔥 2. 定義難度的人格與追問策略
    difficulty_prompts = {
        "easy": """
- 難度設定：初級 (Junior/Entry-level)
- 語氣：溫和、鼓勵、有耐心。
- 提問風格：問基礎觀念、常見行為問題（如：為何想應徵、遇過什麼困難）。
- 追問深度：不需過度刁難，若求職者回答不夠完美，可以稍微引導。""",
        "medium": """
- 難度設定：中級 (Mid-level/Standard)
- 語氣：專業、務實、標準面試官。
- 提問風格：請以自然的口吻，引導求職者具體說明「當時的專案背景、遇到的最大困難、具體採取的技術行動，以及最終的量化成果。
- 追問深度：如果對方給出模糊的形容詞（如「效能變好」），必須追問具體數據或實作細節。""",
        "hard": """
- 難度設定：高級 (Senior/Advanced/Stress Interview)
- 語氣：嚴格、尖銳、高壓面試。
- 提問風格：直接針對系統架構、極端情境（Edge cases）、商業價值進行高難度測試。
- 追問深度：進行無情追問。如果對方回答空泛，請毫不客氣地質疑，並要求給出底層邏輯或量化指標。"""
    }
    
    # 取得對應難度，防呆預設為 medium
    level_prompt = difficulty_prompts.get(interview_difficulty, difficulty_prompts["medium"])

    # 🔥 3. 組合面試官人設 (動態加入公司、職位與難度)
    if interview_type == "academic":
        DYNAMIC_SYSTEM_PROMPT = f"""# Role
        你是一位擁有豐富招生經驗的資深教授與面試委員。你的風格以「啟發式教學」著稱。
        目前正在面試【{company_name}】的【{job_title}】專案/系所。

        # Objective & Tone
        {level_prompt}
        - 限制：每輪回答絕對不能超過 3 個問題或 50 個字。維持純文字。

        # Interaction Strategy
        1. 第一輪：親切問好並請他進行自我介紹。
        2. 後續互動：針對學生的回答，結合履歷與難度設定深入挖掘。
        """
    else:
        DYNAMIC_SYSTEM_PROMPT = f"""# Role
        你是一位在【{company_name}】擁有 10 年經驗的資深主管。你正在招募【{job_title}】。風格專業、目標導向。

        # Objective & Tone
        {level_prompt}
        - 限制：每輪回答絕對不能超過 3 個問題或 50 個字。維持純文字。

        # Interaction Strategy
        1. 第一輪：親切問好並請對方自我介紹。
        2. 後續互動：嚴格遵守難度設定的追問深度。靈活切換策略。
        """

    if job_description and job_description.strip():
        DYNAMIC_SYSTEM_PROMPT += f"\n\n# 職缺描述 (JD) 參考資料\n請優先針對此 JD 提及的技能與職責來提問與追問：\n{job_description.strip()}"

    user_text = ""
    returned_resume_url = None

    # 第一輪：處理履歷
    if len(chat_history) == 0:
        if resume_file and resume_file.filename:
            try:
                file_bytes = await resume_file.read()
                resume_text = extract_text_from_pdf(file_bytes)
                if resume_text:
                    DYNAMIC_SYSTEM_PROMPT += f"\n\n# 求職者履歷參考資料\n{resume_text}"
                
                file_ext = resume_file.filename.split(".")[-1]
                file_name = f"resume_{int(datetime.utcnow().timestamp())}.{file_ext}"
                
                supabase_client.storage.from_("resumes").upload(
                    file_name, file_bytes, file_options={"content-type": "application/pdf", "x-upsert": "true"}
                )                
                returned_resume_url = supabase_client.storage.from_("resumes").get_public_url(file_name)
            except Exception as e:
                print(f"履歷處理失敗: {e}")
    else:
        # 後續輪次：處理語音或文字
        if text_answer and text_answer.strip():
            user_text = text_answer.strip()
        elif audio_file:
            audio_bytes = await audio_file.read()
            audio_io = BytesIO(audio_bytes)
            audio_io.name = audio_file.filename if audio_file.filename else "user_input.wav"
            try:
                transcript = await aclient.audio.transcriptions.create(
                    model="whisper-1", file=audio_io, language=interview_language 
                )
                user_text = transcript.text
            except Exception as e:
                print(f"語音辨識失敗: {e}")
                user_text = "[求職者發出語音，但收音不清晰]"
        else:
            user_text = "[未提供回答]"
            
        chat_history.append({"role": "user", "content": user_text})

    # 語言與最後一輪限制
    if interview_language == "en":
        DYNAMIC_SYSTEM_PROMPT += "\n\n🚨 The user selected English. You MUST conduct the interview strictly in English."

    messages = [{"role": "system", "content": DYNAMIC_SYSTEM_PROMPT}] + chat_history
    
    if is_final_round == "true":
        if interview_language == "en":
            messages.append({"role": "system", "content": "🚨 CRITICAL: This is the end. DO NOT ask questions. Say goodbye."})
        else:
            messages.append({"role": "system", "content": "🚨 重要：面試結束。請做禮貌性結尾，絕對禁止提問。"})

    # 呼叫 LLM
    completion = await aclient.chat.completions.create(model="gpt-4o-mini", messages=messages)
    ai_text = completion.choices[0].message.content
    chat_history.append({"role": "assistant", "content": ai_text})
    
    # 產生語音 TTS
    tts_response = await aclient.audio.speech.create(
        model="tts-1", voice="onyx", input=ai_text, response_format="mp3"
    )
    audio_base64 = base64.b64encode(tts_response.content).decode("utf-8")
    
    return {
        "user_text": user_text,       
        "ai_text": ai_text,           
        "chat_history": chat_history, 
        "audio_base64": audio_base64,
        "resume_url": returned_resume_url 
    }

@app.post("/api/interview/report")
async def generate_report(
    chat_history_str: str = Form(...),
    job_title: str = Form(...),
    company_name: str = Form(...),
    interview_type: str = Form("job") 
):
    chat_history = json.loads(chat_history_str)
    
    if interview_type == "academic":
        role_desc = f"你是一位極其嚴謹的【{company_name}】入學審查教授。"
        metrics = '{"學術動機與熱忱": 80, "邏輯與口條表達": 90, "科系專業潛力": 85}'
    else:
        role_desc = f"你是一位極其嚴厲但專業的【{company_name}】資深高階主管。"
        metrics = '{"專業知識適配度": 80, "邏輯與口條表達": 90, "情境應變與抗壓": 85}'

    REPORT_SYSTEM_PROMPT = f"""# Role
    {role_desc}

    # 評分標準 (客觀與公平原則)
    1. 基準評分：請客觀評估，表現平穩且有回答出基本架構，起跳分為 65-70 分。若回答中包含「具體實例」、「量化數據」或「深入的技術見解」，請大方給予 85-95 甚至更高分。
    2. 扣分機制：只有在回答極度簡短、完全文不對題、或嚴重缺乏邏輯時，總分才給予不及格 (60 分以下)。
    3. 實事求是：切勿過度嚴苛或捏造缺點。若表現優異，優點請具體列出；若整場毫無建設性，優點才填 ["無明顯亮點"]。

    # 核心弱點診斷 (Diagnostic Analysis)
    請分析整場對話，挑選出該求職者最嚴重的【一個】弱點。若該求職者表現極度優異、邏輯清晰且對答如流，請選擇 "NONE"：
    - "LACK_OF_DATA"：缺乏量化與數據佐證 (回答空泛，只有形容詞沒有具體指標)
    - "LOGIC_UNCLEAR"：邏輯混亂與結構鬆散 (想到什麼講什麼，缺乏 STAR 架構)
    - "OFF_TOPIC"：答非所問與未抓重點 (沒有精準回答面試官的問題)
    - "TECHNICAL_GAP"：技術觀念薄弱 (專有名詞誤用或底層邏輯不清楚)
    - "NONE"：表現優異，無明顯致命弱點 (總分達 85 分以上方可使用此標籤)

    請務必只輸出合法的 JSON 格式，結構必須完全符合以下定義：
    {{
        "total_score": 85,
        "short_feedback": "一句客觀的總結評語",
        "detailed_scores": {metrics},
        "strengths": ["優點1", "優點2"],
        "improvements": ["缺點1", "缺點2"],
        "markdown_report": "完整且結構化的面試報告內容",
        "diagnostic": {{
            "primary_weakness": "填入上述五個標籤之一",
            "focus_question": "精確擷取：當時面試官問的那句話 (若標籤為 NONE，請填寫 '無')",
            "worst_answer": "精確擷取：求職者回答中最差、最籠統的原話 (若標籤為 NONE，請填寫 '無')",
            "weakness_context": "簡述為什麼判定這是弱點的具體原因分析，或判定無弱點的讚賞理由"
        }}
    }}
    """
    try:
        completion = await aclient.chat.completions.create(
            model="gpt-4o-mini", # 診斷任務需要較高智商，保持用 gpt-4o
            response_format={ "type": "json_object" }, 
            messages=[{"role": "system", "content": REPORT_SYSTEM_PROMPT}] + chat_history,
            temperature=0.3 # 降低溫度，讓判定更理性客觀
        )
        return json.loads(completion.choices[0].message.content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"報告生成失敗: {str(e)}")


@app.post("/api/interview/analyze-jd")
async def analyze_jd(
    job_title: str = Form(...),
    company_name: str = Form(...),
    job_description: str = Form(...),
    resume_file: UploadFile = File(None)
):
    if not resume_file or not resume_file.filename:
        return {"error": "必須上傳 PDF 履歷才能進行契合度比對！"}
    if not job_description.strip():
        return {"error": "請先貼上職缺描述 (JD)！"}

    try:
        file_bytes = await resume_file.read()
        resume_text = extract_text_from_pdf(file_bytes)
        
        # 🔥 升級版 Prompt：要求 AI 輸出詳細且結構化的 JSON
        SYSTEM_PROMPT = f"""
        你是一位擁有 15 年經驗的頂尖跨領域人資專家 (Talent Acquisition Expert)，同時也是【{job_title}】領域的資深面試主管。
        你的任務是針對求職者的履歷與職缺描述 (JD) 進行深度的 ATS 契合度比對與專業診斷。

        【輸入資訊】
        - 目標職位：{job_title}
        - 職缺描述 (JD)：{job_description}
        - 求職者履歷：{resume_text}

        【跨職業通用評估邏輯】
        不論該職缺屬於何種產業或職能，請嚴格遵循以下邏輯進行分析：
        1. 需求拆解：精準萃取該 JD 中要求的「硬實力 (工具/技術/專業知識)」、「軟實力 (溝通/管理/特質)」與「關鍵績效指標 (KPI/業務目標)」。
        2. 證據比對：在履歷中尋找對應的具體證據。若履歷僅有形容詞卻缺乏具體事蹟或量化成果，應視為說服力不足。
        3. 建設性疊加：不挑剔語病或排版，專注於「如何調整敘述角度，才能大幅提升該領域面試官的青睞」。

        【防幻覺守則與嚴格限制】
        1. 絕對不可捏造、猜測或延伸履歷中未提及的經歷。
        2. `jd_analysis_summary` 欄位必須嚴格基於 JD 原文進行整理與客觀分析，嚴禁過度推測或延伸 JD 未提及的內容。請用約 100~150 字的一段話，精準整理該 JD 的核心內容，並客觀、簡要地分析該職位的重點要求與潛在挑戰。
        3. 必須且只能回傳合法的 JSON 格式，絕對不要在前後加上 ```json 或是任何 Markdown 標籤與問候語。

        【預期 JSON 輸出格式】
        {{
            "match_score": 85,
            "summary": "2到3句精準短評，點出該職位最看重的優勢與核心落差。",
            "matched_skills": ["技能1", "技能2", "技能3"],
            "missing_skills": ["缺少的技能1", "缺少的技能2"],
            "jd_analysis_summary": "一段約 100~150 字的內容，精準整理 JD 核心內容，並客觀簡要分析該職位的重點要求與潛在挑戰。",
            "predicted_questions": [
                {{
                    "q": "結合 JD 需求與履歷盲點，預測該職業面試官會問的專業考題",
                    "intent": "面試官問這題想考核的核心能力是什麼？"
                }}
            ],
            "advice": "給予求職者在準備該職位面試時的 3 點具體策略建議。"
        }}
        """
        
        user_msg = f"公司：{company_name}\n職位：{job_title}\n\n【JD】\n{job_description}\n\n【履歷】\n{resume_text}"

        completion = await aclient.chat.completions.create(
            model="gpt-4o", # 建議使用 gpt-4o 以確保 JSON 格式輸出正確
            response_format={ "type": "json_object" },
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_msg}
            ]
        )
        
        result = json.loads(completion.choices[0].message.content)
        # 把履歷文字與職缺資訊一併帶回前端，供使用者確認儲存時打包送出
        result["resume_text"] = resume_text
        result["jd_text"] = job_description
        result["job_title"] = job_title
        result["company_name"] = company_name
        return result

    except Exception as e:
        print(f"分析錯誤: {str(e)}") # 在伺服器端記錄錯誤
        return {"error": f"分析錯誤: {str(e)}"}
    
# ==========================================
# 5. 資料庫操作路由 (儀表板儲存與讀取)
# ==========================================

@app.get("/api/interview/history")
def get_interview_history(db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id)):
    try:
        records = (
            db.query(InterviewRecord)
            .filter(InterviewRecord.user_id == user_id)
            .order_by(InterviewRecord.date.desc())
            .all()
        )
        formatted_records = []
        for r in records:
            date_str = r.date.strftime("%Y-%m-%d") if r.date else datetime.utcnow().strftime("%Y-%m-%d")
            formatted_records.append({
                "id": r.id,
                "role": getattr(r, "job_title", "未定職缺") or "未定職缺",
                "date": date_str,
                "totalScore": getattr(r, "total_score", 0) or 0,
                "shortFeedback": getattr(r, "short_feedback", "無評語") or "無評語",
                "detailedScores": getattr(r, "detailed_scores", {}) or {},
                "strengths": getattr(r, "strengths", []) or [],
                "improvements": getattr(r, "improvements", []) or [],
                "transcript": getattr(r, "transcript", []) or [],
                "resumeUrl": getattr(r, "resume_url", None),
                "opportunities": getattr(r, "opportunities", None)
            })
        return {"records": formatted_records}
    except Exception as e:
        return {"records": [], "error": str(e)}

@app.post("/api/interview/save")
def save_interview_record(req: SaveRecordRequest, db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id)):
    new_record = InterviewRecord(
        user_id=user_id,
        job_title=req.job_title,
        company_name=req.company_name,
        total_score=req.total_score,
        short_feedback=req.short_feedback,
        detailed_scores=req.detailed_scores,
        strengths=req.strengths,
        improvements=req.improvements,
        transcript=req.transcript,
        resume_url=req.resumeUrl,
        opportunities=req.opportunities
    )
    db.add(new_record)
    db.commit()
    db.refresh(new_record)
    return {"status": "success", "message": "紀錄已成功儲存！", "id": new_record.id}

@app.put("/api/interview/{record_id}/opportunities")
def update_interview_opportunities(record_id: int, req: UpdateOpportunitiesRequest, db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id)):
    # 供「能力升級區」在歷史檢視頁完成翻盤任務時，把最新的 cleared 狀態存回這筆已存在的面試紀錄
    record = (
        db.query(InterviewRecord)
        .filter(InterviewRecord.id == record_id, InterviewRecord.user_id == user_id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="找不到這筆面試紀錄")

    record.opportunities = req.opportunities
    db.commit()
    return {"status": "success"}

@app.post("/api/resume/save")
def save_resume_diagnosis(req: SaveResumeDiagnosisRequest, db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id)):
    new_record = ResumeDiagnosis(
        user_id=user_id,
        job_title=req.job_title,
        company_name=req.company_name,
        resume_text=req.resume_text,
        jd_text=req.jd_text,
        match_score=req.match_score,
        diagnosis_result=req.diagnosis_result
    )
    db.add(new_record)
    db.commit()
    db.refresh(new_record)
    return {"status": "success", "message": "診斷紀錄已成功儲存！", "id": new_record.id}

@app.get("/api/resume/history")
def get_resume_history(db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id)):
    try:
        records = (
            db.query(ResumeDiagnosis)
            .filter(ResumeDiagnosis.user_id == user_id)
            .order_by(ResumeDiagnosis.date.desc())
            .all()
        )
        formatted_records = []
        for r in records:
            date_str = r.date.strftime("%Y-%m-%d") if r.date else datetime.utcnow().strftime("%Y-%m-%d")
            formatted_records.append({
                "id": r.id,
                "jobTitle": getattr(r, "job_title", "未定職缺") or "未定職缺",
                "companyName": getattr(r, "company_name", "") or "",
                "date": date_str,
                "matchScore": getattr(r, "match_score", 0) or 0,
                "resumeText": getattr(r, "resume_text", "") or "",
                "jdText": getattr(r, "jd_text", "") or "",
                "diagnosisResult": getattr(r, "diagnosis_result", {}) or {}
            })
        return {"records": formatted_records}
    except Exception as e:
        return {"records": [], "error": str(e)}

# ==========================================
# 6. AI 面試諮詢室 (Consultant) — 成本防護 + 背景上下文注入
# ==========================================

# 計算某位使用者「今天」已經發問幾次，作為每日額度依據
# 🔥 「今天」以台灣時間的午夜為界：created_at 存的是 naive UTC 時間，若直接拿
#    datetime.utcnow() 的午夜去比對，額度會在台灣時間每天早上 8 點才重置，
#    而不是使用者體感的「隔天」。這裡先算出台灣午夜，再換算回 UTC 做比對。
def _get_consultant_usage_today(db: Session, user_id: str) -> int:
    taipei_midnight = datetime.now(TAIPEI_TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_utc = taipei_midnight.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)
    return (
        db.query(ConsultantChatLog)
        .filter(ConsultantChatLog.user_id == user_id, ConsultantChatLog.created_at >= today_start_utc)
        .count()
    )

# 查詢這位使用者最新的一筆面試排程或履歷診斷紀錄，組成給 AI 的背景資訊
def _get_consultant_context(db: Session, user_id: str) -> str:
    latest_schedule = (
        db.query(ScheduleModel)
        .filter(ScheduleModel.user_id == user_id)
        .order_by(ScheduleModel.id.desc())
        .first()
    )
    if latest_schedule:
        return f"使用者目前有一場即將到來的面試：應徵【{latest_schedule.company}】的【{latest_schedule.job_title}】職位（面試日期：{latest_schedule.date}）。"

    latest_resume = (
        db.query(ResumeDiagnosis)
        .filter(ResumeDiagnosis.user_id == user_id)
        .order_by(ResumeDiagnosis.id.desc())
        .first()
    )
    if latest_resume:
        return f"使用者最近分析過應徵【{latest_resume.company_name}】的【{latest_resume.job_title}】職位的履歷與 JD 契合度（契合度分數：{latest_resume.match_score}%）。"

    return "目前查無這位使用者的面試排程或履歷診斷紀錄，如有需要可請使用者補充應徵的職位與公司資訊。"

@app.get("/api/consultant/quota")
def get_consultant_quota(db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id)):
    used_today = _get_consultant_usage_today(db, user_id)
    remaining = max(0, CONSULTANT_DAILY_LIMIT - used_today)
    return {"remaining_quota": remaining, "daily_limit": CONSULTANT_DAILY_LIMIT}

@app.post("/api/consultant/chat")
async def consultant_chat(req: ConsultantChatRequest, db: Session = Depends(get_db), user_id: str = Depends(get_current_user_id)):
    message = req.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="訊息不可為空")
    # 🔥 字數防護：超過 500 字直接擋下，不呼叫 AI
    if len(message) > CONSULTANT_MAX_CHARS:
        raise HTTPException(status_code=400, detail=f"訊息長度不可超過 {CONSULTANT_MAX_CHARS} 字")

    # 🔥 每日額度防護：查詢今日已使用次數，超過上限直接回 429，不呼叫 AI
    used_today = _get_consultant_usage_today(db, user_id)
    if used_today >= CONSULTANT_DAILY_LIMIT:
        raise HTTPException(status_code=429, detail="今日諮詢次數已達上限，請明天再來！")

    # 🔥 背景上下文注入：查詢使用者最新的面試排程或履歷診斷紀錄
    context = _get_consultant_context(db, user_id)

    SYSTEM_PROMPT = f"""你是 OfferDash 的專屬 AI 職涯諮詢師，專門協助使用者解決面試、履歷與職涯發展相關的疑難雜症。

# 使用者背景資訊（後端自動查詢，請直接運用，不需要使用者重複輸入）
{context}

# 角色界線
如果使用者的問題與面試、履歷、職涯發展無關（例如要求寫程式碼、翻譯文件、日常聊天或其他不相關主題），請禮貌拒絕回答，並引導使用者把問題聚焦回面試或職涯主題。

# 防止功能重疊
如果使用者要求「幫我修改整份履歷」或「開始模擬面試」這類完整功能請求，不要嘗試直接完成，請明確回覆：
「請前往側邊欄的【履歷與 JD 契合度診斷】進行深入分析，或點擊【面試數據儀表板】準備開始模擬面試！」

# 回答風格
請用專業但親切的語氣，簡潔扼要地回答，控制在 200 字以內。"""

    try:
        completion = await aclient.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": message}
            ]
        )
        reply = completion.choices[0].message.content
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 諮詢失敗: {str(e)}")

    # 寫入紀錄，同時也是計算下次額度的依據
    log = ConsultantChatLog(user_id=user_id, message=message, reply=reply)
    db.add(log)
    db.commit()

    remaining = max(0, CONSULTANT_DAILY_LIMIT - (used_today + 1))
    return {"reply": reply, "remaining_quota": remaining, "daily_limit": CONSULTANT_DAILY_LIMIT}

@app.post("/api/contact")
def submit_contact(req: ContactRequest):
    subject = f"[OfferDash 聯絡我們] 來自 {req.name}"
    body = f"姓名：{req.name}\n回覆信箱：{req.email}\n\n訊息內容：\n{req.message}"
    send_email(CONTACT_RECEIVER_EMAIL, subject, body)
    return {"status": "success", "message": "訊息已送出，我們會盡快回覆您！"}

@app.post("/api/growth/generate-redemption")
async def generate_redemption(
    job_title: str = Form(...),
    transcript_str: str = Form(...) # 前端傳來的完整對話紀錄 (JSON 字串)
):
    try:
        # 1. 載入對話紀錄
        transcript = json.loads(transcript_str)
        
        # 將對話紀錄整理成容易讓 AI 閱讀的純文字格式
        formatted_history = ""
        for msg in transcript:
            role_name = "面試官" if msg["role"] == "assistant" else "求職者"
            formatted_history += f"【{role_name}】: {msg['content']}\n\n"

        SYSTEM_PROMPT = f"""
        你是一位專業的跨領域高階人資主管與職涯教練。
        目前求職者正在應徵的職位是：【{job_title}】。

        你的任務是精準分析這場模擬面試紀錄，找出求職者表現最不理想的 3 個回答，並將其轉化為「復仇翻盤任務」。

        ⚠️【核心原則 - 職業適配性】
        你必須完全切換到該職業的情境中！
        - 若職位是【老師/教育業】：請使用教學現場、班級經營、學生互動、家長溝通、教學挫折等教育術語。絕對不要出現「專案」、「高併發」、「產品上線」等科技業術語！
        - 若職位是【工程師/技術業】：則使用系統架構、程式開發、技術挫折。
        請依此類推，確保所有「worst_answer」的指責與「strategy」教練提示，完全符合該行業的真實職場生態。

        請務必回傳以下 JSON 格式：
        {{
            "original_score": 0到100的整體評分,
            "opportunities": [
                {{
                    "id": "q1",
                    "tag": "🔥 致命盲區", 
                    "tagColor": "#ef4444", 
                    "question": "面試官當時問的問題",
                    "flaw": "點出求職者回答的盲點（須完全契合該行業背景，例如：未提及如何安撫家長情緒）",
                    "strategy": "【教練提示】\\n請用條列式（1. 2. 3.）給予符合該行業的重答建議（如：套用班級經營 STAR 原則）。",
                    "xp_reward": 300,
                    "cleared": false
                }}
            ]
        }}

        【標籤與顏色規範】
        - 嚴重答非所問或專業錯誤：tag="🔥 致命盲區", tagColor="#ef4444", xp_reward=300
        - 回答太短、缺乏具體教學或工作案例：tag="✨ 最佳翻盤題", tagColor="#f59e0b", xp_reward=200
        - 缺乏該職業的核心關鍵字或職缺連結：tag="💡 關鍵字漏接", tagColor="#3b82f6", xp_reward=150

        請確保 opportunities 陣列中剛好有 3 個物件。
        """

        # 3. 呼叫 GPT-4o 生成結構化 JSON
        completion = await aclient.chat.completions.create(
            model="gpt-4o", # 建議使用 gpt-4o 確保 JSON 結構穩定
            response_format={ "type": "json_object" },
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"這是面試紀錄：\n{formatted_history}"}
            ]
        )
        
        # 4. 解析並回傳給前端
        result = json.loads(completion.choices[0].message.content)
        
        # 確保回傳結構包含 job_title 供前端使用
        result["job_title"] = job_title 
        
        return result

    except Exception as e:
        print(f"生成復仇局失敗: {str(e)}")
        return {"error": f"分析失敗: {str(e)}"}
    
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

# 🔥 進站首頁改為「訪客版總覽頁」而非登入表單：比照業界常見的公開首頁 + 登入按鈕模式，
#    裸網址 "/" 導向 overview.html（未登入時自動顯示鎖定版 UI，見 shared-sidebar.js），
#    使用者要按下「登入」才會前往真正的登入表單。用 redirect（而非直接回傳檔案內容）
#    是為了讓瀏覽器網址列同步更新，避免 auth-guard.js 的頁面判斷把裸網址誤認成登入頁。
@app.get("/", include_in_schema=False)
async def serve_root():
    return RedirectResponse(url="/frontend/pages/overview.html")

# 🔥 檔案改組：登入表單本體位於 frontend/index.html。
#    "/index.html"／"/login.html"（不帶 /frontend/ 前綴）都對應到這個登入頁，
#    保留這幾個網址是為了相容任何還指向舊路徑的書籤/連結，避免直接 404。
@app.get("/index.html", include_in_schema=False)
@app.get("/login.html", include_in_schema=False)
async def serve_login():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

# frontend/ 底下的靜態資源掛在 /frontend，對應 frontend/index.html 與 frontend/pages/*.html
# 內「./js/xxx.js」「./../js/xxx.js」的相對路徑寫法，同時也讓 /frontend/index.html、
# /frontend/pages/interview.html 這種完整路徑能直接被訪問到。
app.mount("/frontend", StaticFiles(directory=FRONTEND_DIR), name="frontend-static")