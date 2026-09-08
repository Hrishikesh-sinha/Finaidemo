import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.models import Base, User, Transaction, Goal
from backend.main import get_password_hash
from datetime import datetime, timedelta
import random

# DB Setup
SQLALCHEMY_DATABASE_URL = "sqlite:///./finai.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base.metadata.create_all(bind=engine)

def seed():
    db = SessionLocal()
    
    # Create or update user
    user = db.query(User).filter(User.username == "demo_user").first()
    if not user:
        user = User(
            username="demo_user",
            hashed_password=get_password_hash("password123"),
            monthly_income=50000.0,
            target_savings_percent=20.0
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        user.monthly_income = 50000.0
        user.target_savings_percent = 20.0
        db.commit()
        
    # Clear existing transactions to reset state
    db.query(Transaction).filter(Transaction.user_id == user.id).delete()
    db.commit()

    transactions = []
    end_date = datetime.utcnow()
    
    # Generate exactly 3 months of data for modeling, each month totaling EXACTLY ₹35,000
    for month_offset in range(3):
        base_date = end_date - timedelta(days=30 * month_offset)
        
        # Bills: 12000
        transactions.append(Transaction(amount=8000.0, merchant="Rent", category="Bills", date=base_date.replace(day=1), user_id=user.id))
        transactions.append(Transaction(amount=2000.0, merchant="Electric Utility", category="Bills", date=base_date.replace(day=5), user_id=user.id))
        transactions.append(Transaction(amount=2000.0, merchant="Internet Provider", category="Bills", date=base_date.replace(day=10), user_id=user.id))
        
        # Food: 8000
        for _ in range(8):
            day = random.randint(1, 28)
            transactions.append(Transaction(amount=1000.0, merchant=random.choice(["Local Restaurant", "Whole Foods", "Starbucks"]), category="Food", date=base_date.replace(day=day), user_id=user.id))
            
        # Transport: 4000
        for _ in range(4):
            day = random.randint(1, 28)
            transactions.append(Transaction(amount=1000.0, merchant=random.choice(["Uber", "Lyft", "MTA Subway"]), category="Transport", date=base_date.replace(day=day), user_id=user.id))
            
        # Shopping: 7000
        for _ in range(2):
            day = random.randint(1, 28)
            transactions.append(Transaction(amount=3500.0, merchant=random.choice(["Amazon", "Target", "Apple Store"]), category="Shopping", date=base_date.replace(day=day), user_id=user.id))
            
        # Entertainment: 4000
        for _ in range(2):
            day = random.randint(1, 28)
            transactions.append(Transaction(amount=2000.0, merchant=random.choice(["Netflix", "Movie Theater"]), category="Entertainment", date=base_date.replace(day=day), user_id=user.id))

    db.add_all(transactions)
    db.commit()
    print("Seed complete! Income: ₹50,000, Expenses: ₹35,000 per month.")
    db.close()

if __name__ == "__main__":
    seed()
