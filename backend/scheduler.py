from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
import logging
from google import genai
import os
import json

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

jobstores = {
    'default': SQLAlchemyJobStore(url='sqlite:///jobs.sqlite')
}

scheduler = BackgroundScheduler(jobstores=jobstores)

def generate_monthly_report(user_id: int):
    # This would typically fetch data from DB and use Gemini to generate a report.
    # To avoid cyclic imports here, we handle DB session directly or via API.
    logger.info(f"Generating monthly report for user {user_id}...")
    from backend.models import User, Transaction, Report
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    
    engine = create_engine("sqlite:///finai.db", connect_args={"check_same_thread": False})
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()
    
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user: return
        
        transactions = db.query(Transaction).filter(Transaction.user_id == user_id).all()
        # Summarize
        income = user.monthly_income
        spent = sum(t.amount for t in transactions)
        
        # Call Gemini
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            logger.warning("GEMINI_API_KEY not configured; skipping AI report generation.")
            return

        client = genai.Client(api_key=api_key)
        prompt = f"""
        Act as an expert financial advisor. Review this monthly summary and provide a brief Markdown report.
        Income: {income}
        Total Spent: {spent}
        Savings Rate: {((income - spent)/income)*100:.1f}% if {income} > 0 else 0
        """
        response = client.models.generate_content(
            model='gemini-flash-latest',
            contents=prompt
        )
        
        report = Report(
            month="Current Month",
            content=response.text,
            user_id=user_id
        )
        db.add(report)
        db.commit()
        logger.info(f"Report generated for user {user_id}")
    except Exception as e:
        logger.error(f"Error generating report: {e}")
    finally:
        db.close()

def start_scheduler():
    if not scheduler.running:
        scheduler.start()
        logger.info("Scheduler started.")
