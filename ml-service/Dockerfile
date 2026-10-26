# Hugging Face Spaces expects the app to listen on port 7860.
FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    # Spaces runs the container as a non-root user, so keep the model cache
    # somewhere writable.
    HF_HOME=/app/.cache/huggingface

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
      --extra-index-url https://download.pytorch.org/whl/cpu

COPY app ./app

RUN mkdir -p /app/.cache/huggingface && chmod -R 777 /app/.cache

EXPOSE 7860

# The model is downloaded lazily on the first /forecast request, so the
# container becomes healthy without waiting on a ~500MB download.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
