# ==========================================
# 🔌 共用的資料庫 / 外部 API client 初始化
# main.py 與 api/calender_api.py 原本各自建立一份 SQLAlchemy engine、
# OpenAI client、Supabase client（都指向同一組資源），每次 --reload 都要
# 重複做兩次 TLS 連線 + schema 檢查，本機約多花 10 秒。集中成這一份共用模組，
# 兩邊改成 import 同一個實例即可。
# ==========================================

import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from openai import AsyncOpenAI
from supabase import create_client, Client

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not all([DATABASE_URL, OPENAI_API_KEY, SUPABASE_URL, SUPABASE_KEY]):
    raise ValueError("環境變數缺失！請確認根目錄下有 .env 檔案，並填妥所有金鑰。")

aclient = AsyncOpenAI(api_key=OPENAI_API_KEY)
supabase_client: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
