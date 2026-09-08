import os
import cv2
import numpy as np
import pytesseract
import re
import json
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, status, File, UploadFile
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from jose import JWTError, jwt
from passlib.context import CryptContext
from google import genai

from backend.models import Base, User, Transaction, Goal, Report
from backend.ml_engine import ml_engine
from backend.scheduler import start_scheduler

# DB Setup
SQLALCHEMY_DATABASE_URL = "sqlite:///./finai.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base.metadata.create_all(bind=engine)

# Auth Setup
SECRET_KEY = "super-secret-key-for-viva-only"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/token")

app = FastAPI(title="FinAI API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_password_hash(password):
    return pwd_context.hash(password)

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    return user

# Pydantic Schemas
class UserCreate(BaseModel):
    username: str
    password: str
    monthly_income: float = 50000.0

class UserProfile(BaseModel):
    username: str
    monthly_income: float
    target_savings_percent: float

class TransactionCreate(BaseModel):
    amount: float
    merchant: str
    date: Optional[str] = None
    category: Optional[str] = None

class ChatRequest(BaseModel):
    prompt: str

# Endpoints
@app.post("/api/register")
def register(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    hashed_password = get_password_hash(user.password)
    new_user = User(username=user.username, hashed_password=hashed_password, monthly_income=user.monthly_income)
    db.add(new_user)
    db.commit()
    return {"message": "User registered successfully"}

@app.post("/api/token")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/profile", response_model=UserProfile)
def read_profile(current_user: User = Depends(get_current_user)):
    return current_user

@app.post("/api/transactions")
def add_transaction(t: TransactionCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    cat = t.category if t.category else ml_engine.predict_category(t.merchant)
    dt = datetime.fromisoformat(t.date.replace("Z", "")) if t.date else datetime.utcnow()
    new_t = Transaction(amount=t.amount, merchant=t.merchant, category=cat, date=dt, user_id=current_user.id)
    db.add(new_t)
    db.commit()
    db.refresh(new_t)
    return {"message": "Transaction added", "id": new_t.id, "category": cat}

@app.get("/api/transactions")
def get_transactions(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    txs = db.query(Transaction).filter(Transaction.user_id == current_user.id).order_by(Transaction.date.desc()).all()
    return [{"id": t.id, "amount": t.amount, "merchant": t.merchant, "category": t.category, "date": t.date.isoformat()} for t in txs]

@app.post("/api/transactions/voice")
def add_voice_transaction(text: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Simple regex/spaCy mock pattern extraction
    # E.g., "Spent 15 on coffee at Starbucks"
    amount_match = re.search(r'\d+(\.\d{1,2})?', text)
    amount = float(amount_match.group()) if amount_match else 0.0
    
    # Very crude merchant extraction (word after "at")
    merchant_match = re.search(r'at\s+([a-zA-Z0-9_ ]+)', text, re.IGNORECASE)
    merchant = merchant_match.group(1).strip() if merchant_match else "Unknown"
    
    cat = ml_engine.predict_category(merchant)
    new_t = Transaction(amount=amount, merchant=merchant, category=cat, user_id=current_user.id)
    db.add(new_t)
    db.commit()
    return {"amount": amount, "merchant": merchant, "category": cat}

@app.post("/api/transactions/ocr")
async def ocr_transaction(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    # Preprocessing
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    filtered = cv2.bilateralFilter(gray, 9, 75, 75)
    thresh = cv2.adaptiveThreshold(filtered, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
    
    text = pytesseract.image_to_string(thresh)
    
    # Extraction heuristics
    amounts = re.findall(r'\b\d+\.\d{2}\b', text)
    amount = max([float(a) for a in amounts]) if amounts else 0.0
    
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    merchant = lines[0] if lines else "Unknown OCR Merchant"
    
    return {"amount": amount, "merchant": merchant, "preview_text": text[:200]}

@app.get("/api/dashboard")
def get_dashboard_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    txs = db.query(Transaction).filter(Transaction.user_id == current_user.id).all()
    
    # Filter for the last 30 days for dashboard totals
    now = datetime.utcnow()
    thirty_ago = now - timedelta(days=30)
    current_month_txs = [t for t in txs if t.date >= thirty_ago]
    
    total_spent = sum(t.amount for t in current_month_txs)
    income = max(current_user.monthly_income, 1.0)
    savings_rate = ((income - total_spent) / income) * 100
    
    # Financial Health Score (0-100) based on new formula
    # Savings rate (30 pts)
    savings_score = min(30, max(0, (savings_rate / 20.0) * 30)) if savings_rate > 0 else 0
    
    # Expense-to-income ratio <= 70% (25 pts)
    expense_ratio = total_spent / income
    if expense_ratio <= 0.7:
        expense_score = 25
    else:
        expense_score = max(0, 25 - ((expense_ratio - 0.7) / 0.3 * 25))
        
    # Budget limit discipline (25 pts)
    budget_score = 25 if total_spent <= income else 0
    
    # Spending stability (20 pts)
    anomalies = ml_engine.detect_anomalies(txs)
    recent_anomalies = [a for a in anomalies if a.date >= thirty_ago]
    stability_score = max(0, 20 - (len(recent_anomalies) * 5))
    
    health_score = int(savings_score + expense_score + budget_score + stability_score)
    
    forecast = ml_engine.forecast_spending(txs)
    smart_budget = ml_engine.recommend_budget(income, current_month_txs)
    
    return {
        "total_spent": total_spent,
        "savings_rate": round(savings_rate, 2),
        "health_score": health_score,
        "forecast_next_30_days": round(forecast, 2),
        "smart_budget": smart_budget,
        "anomalies": [{"id": a.id, "amount": a.amount, "merchant": a.merchant} for a in anomalies]
    }

@app.post("/api/chat")
def chat_with_gemini(req: ChatRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Context injected
    txs = db.query(Transaction).filter(Transaction.user_id == current_user.id).all()
    total_spent = sum(t.amount for t in txs)
    
    cat_totals = {}
    for t in txs:
        cat_totals[t.category] = cat_totals.get(t.category, 0) + t.amount
        
    context = {
        "monthly_income": current_user.monthly_income,
        "total_spent": total_spent,
        "category_breakdown": cat_totals,
        "target_savings": current_user.target_savings_percent
    }
    
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return {"response": "Gemini API key is not configured. Please add GEMINI_API_KEY in Settings to enable live AI responses."}
        
    client = genai.Client(api_key=api_key)
    prompt = f"""
    System Instruction: You are FinAI, a zero-cost, privacy-first financial assistant. 
    Ground all answers EXCLUSIVELY on this financial context: {json.dumps(context)}.
    Do not give generic advice. Keep answers under 4 sentences.
    
    User Query: {req.prompt}
    """
    try:
        response = client.models.generate_content(
            model='gemini-flash-latest',
            contents=prompt
        )
        return {"response": response.text}
    except Exception as e:
        return {"response": f"Error querying AI: {str(e)}"}

@app.on_event("startup")
def on_startup():
    start_scheduler()

# Serve Frontend - Must be placed last!
if os.path.exists("dist"):
    app.mount("/assets", StaticFiles(directory="dist/assets"), name="assets")

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"])
    async def serve_spa(full_path: str):
        # Don't intercept API routes
        if full_path.startswith("api"):
            raise HTTPException(status_code=404, detail="Endpoint not found")
        file_path = os.path.join("dist", full_path)
        if full_path and os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)
        index_path = os.path.join("dist", "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        raise HTTPException(status_code=404, detail="Frontend build not found")

