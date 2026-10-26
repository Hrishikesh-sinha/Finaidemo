#!/bin/bash
set -e

if [ ! -d ".venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
  echo "Installing Python dependencies..."
  .venv/bin/pip install --no-cache-dir fastapi uvicorn sqlalchemy 'python-jose[cryptography]' 'passlib[bcrypt]' scikit-learn pandas numpy pytesseract opencv-python-headless python-multipart APScheduler 'bcrypt==4.0.1' google-genai
fi

# Seed database if not present
if [ ! -f "finai.db" ]; then
  echo "Seeding initial database..."
  .venv/bin/python -m backend.seed || true
fi

