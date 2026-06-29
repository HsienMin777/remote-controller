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

# ==========================================
# 1. 資料庫連線設定 (Database Setup)
# ==========================================
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
    resume_file: UploadFile = File(None),
    text_answer: Optional[str] = Form(None),
    is_final_round: str = Form("false"),
    interview_language: str = Form("zh") 
):
    chat_history = json.loads(chat_history_str)
    
    # 決定面試官人格
    if interview_type == "academic":
        DYNAMIC_SYSTEM_PROMPT = f"""# Role
你是一位擁有豐富招生經驗的資深教授與面試委員。你的風格以「啟發式教學」著稱。

# Objective & Tone
- 以嚴謹、具啟發性、關注學術熱忱的語氣主持面試。
- 觀察學生回答的深度，若發現內容空泛，請務必進行「追問」。
- 限制：每輪回答絕對不能超過 3 個問題或 50 個字。維持純文字。

# Interaction Strategy
1. 第一輪：親切問好並請他進行自我介紹。
2. 後續互動：針對學生的回答，結合履歷深入挖掘。
"""
    else:
        DYNAMIC_SYSTEM_PROMPT = f"""# Role
你是一位該行業擁有 10 年經驗的資深主管。風格專業、目標導向。

# Objective & Tone
- 完全模擬真實業界主管，氛圍需具備專業壓迫感與洞察力。
- 限制：每輪回答絕對不能超過 3 個問題或 50 個字。維持純文字。

# Interaction Strategy
1. 第一輪：親切問好並請對方自我介紹。
2. 後續互動：靈活切換策略。若回答平庸，採取「壓力測試」；若精彩，進行「情境模擬」。
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
2. 不捏造優點：若整場無建設性，優點請填 ["無明顯亮點"]。
3. 嚴格審視深度：無具體做法實例，該項不及格。

請務必只輸出合法的 JSON 格式：
{{
    "total_score": 85,
    "short_feedback": "一句總結",
    "detailed_scores": {metrics},
    "strengths": ["優點1"],
    "improvements": ["缺點1"],
    "markdown_report": "完整報告內容"
}}
"""
    try:
        completion = await aclient.chat.completions.create(
            model="gpt-4o",
            response_format={ "type": "json_object" }, 
            messages=[{"role": "system", "content": REPORT_SYSTEM_PROMPT}] + chat_history,
            temperature=0.5
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
        
        SYSTEM_PROMPT = f"""
        你是【{company_name}】的 ATS 系統。請嚴格審視履歷與 JD 的落差。
        回傳 JSON：
        {{
            "match_score": 75,
            "missing_skills": ["缺A"],
            "predicted_questions": ["陷阱題1"],
            "advice": "面試前警告"
        }}
        """
        user_msg = f"【JD】\n{job_description}\n\n【履歷】\n{resume_text}"

        completion = await aclient.chat.completions.create(
            model="gpt-4o-mini",
            response_format={ "type": "json_object" },
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_msg}
            ]
        )
        return json.loads(completion.choices[0].message.content)
    except Exception as e:
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

# ==========================================
# 6. 賽後修煉區 (Growth Engine)
# ==========================================

@app.post("/api/growth/generate_showcase")
async def generate_showcase(
    job_title: str = Form(...),
    weakness_code: str = Form(...),
    user_choice: str = Form(...),
    worst_user_answer: str = Form(...),
    focus_question: str = Form(""),
    interview_transcript: str = Form("[]")
):
    weakness_labels = {
        "LACK_OF_DATA": "缺少量化數據與可驗證成果",
        "LOGIC_UNCLEAR": "回答結構鬆散，缺少 STAR 脈絡",
        "OFF_TOPIC": "回答沒有直接扣回題目"
    }
    selected_reason = {
        "A": "使用者選了最接近高分答案的方向",
        "B": "使用者可能把語氣當成主要問題",
        "C": "使用者可能過度聚焦感受而不是證據",
        "D": "使用者可能想縮短答案，但核心資訊仍不足"
    }.get(user_choice, "使用者完成了反思選擇")

    prompt = f"""
你是面試教練，請直接、務實，不要安慰式灌水。

任務：
1. 根據 transcript 與 focus_question，擷取使用者針對該問題的真實回答作為 user_version。若 transcript 不足，才使用 worst_user_answer。
2. 針對同一問題、同一職位背景，重寫一份 high_score_version。必須使用 STAR 原則，且包含合理的量化數據或可驗證結果。
3. 用條列 difference_analysis 說明差異，請指出真實缺口，不要客套。
4. 回傳三段式 resources：immediate、course、extension。

職位：{job_title}
弱項分類：{weakness_labels.get(weakness_code, weakness_code)}
反思選擇：{user_choice} - {selected_reason}
面試問題：{focus_question}
候選回答：{worst_user_answer}
完整 transcript：{interview_transcript}

只輸出 JSON：
{{
  "user_version": "使用者原回答",
  "high_score_version": "高分範例",
  "difference_analysis": ["差異1", "差異2", "差異3"],
  "resources": {{
    "immediate": "1 分鐘可做的練習",
    "course": "適合 1 小時學習的主題",
    "extension": "延伸任務"
  }}
}}
"""
    try:
        response = await aclient.chat.completions.create(
            model="gpt-4o-mini",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "You output strictly valid JSON for an interview coaching UI."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.35
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"深度點評生成失敗: {str(e)}")

    reason_map = {
        "A": "忘記當時具體數據是多少",
        "B": "太緊張，腦袋一片空白",
        "C": "不知道如何把成果量化"
    }
    user_reason = reason_map.get(user_choice, "缺乏表達技巧")

    prompt = f"""
    你現在是專業的技術面試教練。求職者正在應徵【{job_title}】。
    【當前痛點】他在面試中講了這句話：『{worst_user_answer}』。他自認原因是：『{user_reason}』。
    
    請回傳純 JSON 格式：
    {{
      "user_version": "{worst_user_answer}",
      "high_score_version": "幫他重寫的高分範例(約80字)",
      "bullet_points": ["✓ 優點1", "✓ 優點2"],
      "immediate_tool": "15字內的實用表達公式"
    }}
    """
    try:
        response = await aclient.chat.completions.create(
            model="gpt-4o-mini",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "You are a helpful assistant designed to output strictly JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.5
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成對照組失敗: {str(e)}")


@app.post("/api/growth/start_quick_drill")
async def start_quick_drill(
    job_title: str = Form(...),
    weakness_code: str = Form(...),
    focus_question: str = Form(""),
    worst_user_answer: str = Form("")
):
    drill_focus = {
        "LACK_OF_DATA": "只追問數據、規模、前後對比、可驗證成果，不要問其他面向。",
        "LOGIC_UNCLEAR": "只追問 STAR 結構：情境、任務、行動、結果的缺口，不要擴散。",
        "OFF_TOPIC": "只追問是否直接回答原題，要求先一句話回答再補例子。"
    }.get(weakness_code, "只追問上一輪暴露出的單一弱點，不要擴散。")

    first_message = (
        f"我們只練一件事：{drill_focus} "
        f"原題是「{focus_question or '剛才那題'}」。"
        f"你原本的回答是「{worst_user_answer[:160]}」。"
        "現在重答一次，請用 45 秒內講完。"
    )
    return {
        "system_prompt": drill_focus,
        "ai_first_message": first_message
    }

    drill_prompts = {
        "LACK_OF_DATA": f"""
        # Role & Task
        你現在是一位專業且客觀的技術面試官。求職者正在進行為期 3 分鐘的「數據化表達快閃實戰」。
        
        # Tone
        中性、務實、直指核心。不需要刻意嚴厲打擊，也絕對不要過度讚美或安撫。
        
        # Rule
        1. 直接提出一個與【{job_title}】相關的面試題。
        2. 目標是檢驗求職者是否能用「具體數據、比例或指標」來佐證專案成果。
        3. 如果他的回答缺乏數據，請直接點出盲點並要求補充。
        4. 最多進行 2 輪問答。
        """
    }
    system_prompt = drill_prompts.get(weakness_code, "請進行 3 分鐘的專業追問實戰。")
    return {
        "system_prompt": system_prompt,
        "ai_first_message": "實戰練習開始。請分享一個你近期參與的專案，並具體說明你的貢獻與最終的量化成效。"
    }


@app.post("/api/growth/drill_next")
async def drill_next(
    job_title: str = Form(...),
    weakness_code: str = Form(...),
    drill_chat_history: str = Form(...)
):
    drill_focus = {
        "LACK_OF_DATA": "只針對數據化追問。要求候選人補上百分比、規模、時間、成本或前後對比。",
        "LOGIC_UNCLEAR": "只針對 STAR 結構追問。要求候選人補齊情境、任務、行動、結果其中缺的一段。",
        "OFF_TOPIC": "只針對題目對焦追問。要求候選人先用一句話直接回答原問題。"
    }.get(weakness_code, "只針對上一輪弱點追問，不要開新題。")

    prompt = f"""
你是嚴格的面試快閃實戰教練。現在的職位是 {job_title}。
規則：{drill_focus}

請根據目前對話，只輸出下一句追問。不要講解，不要換題，不要稱讚。
對話：
{drill_chat_history}

JSON 格式：
{{"ai_message": "下一句追問"}}
"""
    try:
        response = await aclient.chat.completions.create(
            model="gpt-4o-mini",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "Output strictly valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"追問生成失敗: {str(e)}")


@app.post("/api/growth/evaluate_drill")
async def evaluate_drill(
    original_score: int = Form(...), 
    weakness_code: str = Form(...),  
    job_title: str = Form(...),
    drill_chat_history: str = Form(...),
    focus_question: str = Form(""),
    worst_user_answer: str = Form("")
):
    criteria_map = {
        "LACK_OF_DATA": "是否補上具體數字、規模、前後對比或可驗證成果。沒有數字不得大幅加分。",
        "LOGIC_UNCLEAR": "是否補齊 STAR 結構，且順序清楚。只是變長不得大幅加分。",
        "OFF_TOPIC": "是否先直接回答問題，並用例子支撐。沒有扣回題目不得大幅加分。"
    }
    criteria = criteria_map.get(weakness_code, "是否確實修正上一輪的單一弱點。")

    prompt = f"""
你是嚴格的面試評分員。請用第一次面試的同一把尺重新評分，不要為了鼓勵使用者而放水。

原始分數：{original_score}/100
職位：{job_title}
原題：{focus_question}
原始回答：{worst_user_answer}
本輪評分標準：{criteria}
快閃實戰對話：{drill_chat_history}

評分規則：
1. 如果只是語氣更好但沒有補核心缺口，delta 必須是 0 到 3。
2. 如果部分修正但仍不完整，delta 必須是 4 到 8。
3. 只有在明確修正弱點且可拿去真實面試時，delta 才能是 9 到 15。
4. delta 最高 15，最低 0；new_score 不能超過 100。

只輸出 JSON：
{{
  "new_score": 78,
  "delta": 13,
  "coach_comment": "直接說明哪裡真的進步、哪裡仍然會被面試官追打。"
}}
"""
    try:
        response = await aclient.chat.completions.create(
            model="gpt-4o-mini",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "You are a strict evaluator. Output strictly valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.15
        )
        result = json.loads(response.choices[0].message.content)
        delta = max(0, min(15, int(result.get("delta", 0))))
        new_score = max(original_score, min(100, original_score + delta))
        return {
            "new_score": new_score,
            "delta": new_score - original_score,
            "coach_comment": result.get("coach_comment", "")
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"二次評分失敗: {str(e)}")

    evaluation_criteria = {
        "LACK_OF_DATA": "是否在回答中明確提出了客觀的量化指標？若依然只有模糊形容，視為未改善。"
    }
    criteria = evaluation_criteria.get(weakness_code, "是否確實修正了上一輪的表達弱點？")

    prompt = f"""
    你現在是一位嚴格的面試評委。求職者剛結束針對【{job_title}】的 3 分鐘補強訓練。
    上一場原始分數為：【{original_score} / 100】。
    
    對話紀錄：
    {drill_chat_history}
    
    1. 檢驗實質改變：{criteria}
    2. 給分限制：未達標給原分(delta為0)；明確改善最多加 15 分。
    
    回傳 JSON：
    {{
        "new_score": 78,
        "delta": 13,
        "coach_comment": "客觀點出進步或欠缺的細節。"
    }}
    """
    try:
        response = await aclient.chat.completions.create(
            model="gpt-4o-mini",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "You are an evaluator. Output strictly JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"評分結算失敗: {str(e)}")
