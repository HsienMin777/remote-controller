import os
import json
import base64
from datetime import datetime
from io import BytesIO
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import PyPDF2
from dotenv import load_dotenv

# SQLAlchemy 相關套件
from sqlalchemy import create_engine, Column, Integer, String, JSON, DateTime
from sqlalchemy.orm import sessionmaker, declarative_base, Session

# 外部 API 客戶端
from openai import AsyncOpenAI
from supabase import create_client, Client

# ==========================================
# 0. 環境變數與靜態常數設定
# ==========================================


load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# 加上防呆機制，如果在本地端忘記設定 .env，伺服器啟動時會提早報錯
if not all([DATABASE_URL, OPENAI_API_KEY, SUPABASE_URL, SUPABASE_KEY]):
    raise ValueError("環境變數缺失！請確認根目錄下有 .env 檔案，並填妥所有金鑰。")

# 初始化非同步的 OpenAI 客戶端與 Supabase
aclient = AsyncOpenAI(api_key=OPENAI_API_KEY)
supabase_client: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class InterviewRecord(Base):
    __tablename__ = "interview_records"
    id = Column(Integer, primary_key=True, index=True)
    job_title = Column(String, index=True)
    company_name = Column(String)
    date = Column(DateTime, default=datetime.utcnow)
    total_score = Column(Integer)
    short_feedback = Column(String)
    detailed_scores = Column(JSON)
    strengths = Column(JSON)      
    improvements = Column(JSON)
    transcript = Column(JSON)
    resume_url = Column(String, nullable=True)

Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

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
    transcript: list 
    resumeUrl: Optional[str] = None
    diagnostic: dict

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
    interview_language: str = Form("zh") 
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
- 提問風格：要求使用 STAR 原則回答。針對履歷或專案細節進行 1~2 層的追問。
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

    # 嚴格評分標準
    1. 拒絕放水：回答極度簡短、文不對題，總分不得超過 40 分。
    2. 絕不捏造優點：整場無建設性，優點請填 ["無明顯亮點"]。
    3. 嚴格審視深度：無具體做法實例，該項不及格。

    # 核心弱點診斷 (Diagnostic Analysis)
    請分析整場對話，並從以下四個標籤中，挑選出該求職者最嚴重的【一個】致命弱點：
    - "LACK_OF_DATA"：缺乏量化與數據佐證 (回答空泛，只有形容詞沒有具體指標)
    - "LOGIC_UNCLEAR"：邏輯混亂與結構鬆散 (想到什麼講什麼，缺乏 STAR 架構)
    - "OFF_TOPIC"：答非所問與未抓重點 (沒有精準回答面試官的問題)
    - "TECHNICAL_GAP"：技術觀念薄弱 (專有名詞誤用或底層邏輯不清楚)

    請務必只輸出合法的 JSON 格式，結構必須完全符合以下定義：
    {{
        "total_score": 85,
        "short_feedback": "一句總結",
        "detailed_scores": {metrics},
        "strengths": ["優點1"],
        "improvements": ["缺點1"],
        "markdown_report": "完整報告內容",
        "diagnostic": {{
            "primary_weakness": "填入上述四個標籤之一",
            "focus_question": "精確擷取：當時面試官問的那句話",
            "worst_answer": "精確擷取：求職者回答中最差、最籠統的原話 (必須是原話)",
            "weakness_context": "簡述為什麼判定這是弱點的具體原因分析"
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
        SYSTEM_PROMPT = """
你是頂尖的人資專家，請針對求職者的履歷與職缺描述 (JD) 進行深度 ATS 契合度比對。

請務必回傳合法 JSON（不要加入 Markdown、不要加入 ```json）。

JSON 格式如下：

{
    "match_score": 0-100,
    "summary": "一段 2-3 句的精準綜合短評，點出履歷優勢與 JD 要求的核心落差。",
    "matched_skills": ["技能1", "技能2"],
    "missing_skills": ["缺少的技能1", "缺少的技能2"],
    "resume_tips": [
        {
            "before": "原始履歷內容",
            "after": "優化後內容",
            "reason": "說明這樣修改如何提升 ATS 關鍵字匹配率、可讀性或錄取機率"
        }
    ],
    "predicted_questions": [
        {
            "q": "預測的專業考題",
            "intent": "面試官為什麼要問這個？（考核重點）"
        }
    ],
    "advice": "最終提醒，例如提醒面試時要著重哪個專案。"
}

請遵守以下規則：

1. match_score 必須介於 0~100。
2. summary 控制在 2~3 句。
3. matched_skills 至少列出 8 項（若不足則全部列出）。
4. missing_skills 至少列出 8 項（若不足則全部列出）。
5. resume_tips 必須提供 **7~10 項**，不得少於 7 項。
6. 每一項 resume_tip 都必須包含 before、after、reason 三個欄位。
7. before 與 after 必須是真正可以直接放進履歷的內容，而不是一句修改建議。
8. predicted_questions 必須提供 **8~10 題**，並且每題都要有 intent。
9. advice 至少提供 3 點具體建議，使用完整句子。
10. 僅輸出 JSON，不要輸出任何其他文字。
"""
        
        user_msg = f"公司：{company_name}\n職位：{job_title}\n\n【JD】\n{job_description}\n\n【履歷】\n{resume_text}"

        completion = await aclient.chat.completions.create(
            model="gpt-4o-mini", # 建議使用 gpt-4o 以確保 JSON 格式輸出正確
            response_format={ "type": "json_object" },
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_msg}
            ]
        )
        
        result = json.loads(completion.choices[0].message.content)
        return result

    except Exception as e:
        print(f"分析錯誤: {str(e)}") # 在伺服器端記錄錯誤
        return {"error": f"分析錯誤: {str(e)}"}
    
# ==========================================
# 5. 資料庫操作路由 (儀表板儲存與讀取)
# ==========================================

@app.get("/api/interview/history")
def get_interview_history(db: Session = Depends(get_db)):
    try:
        records = db.query(InterviewRecord).order_by(InterviewRecord.date.desc()).all()
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
                "resumeUrl": getattr(r, "resume_url", None)
            })
        return {"records": formatted_records}
    except Exception as e:
        return {"records": [], "error": str(e)}

@app.post("/api/interview/save")
def save_interview_record(req: SaveRecordRequest, db: Session = Depends(get_db)):
    new_record = InterviewRecord(
        job_title=req.job_title,
        company_name=req.company_name,
        total_score=req.total_score,
        short_feedback=req.short_feedback,
        detailed_scores=req.detailed_scores,
        strengths=req.strengths,
        improvements=req.improvements,
        transcript=req.transcript,
        resume_url=req.resumeUrl
    )
    db.add(new_record)
    db.commit()
    return {"status": "success", "message": "紀錄已成功儲存！"}

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
            model="gpt-4o-mini", # 建議使用 gpt-4o 確保 JSON 結構穩定
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