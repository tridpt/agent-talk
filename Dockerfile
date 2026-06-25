# Image gon nhe cho Agent Talk
FROM python:3.13-slim

WORKDIR /app

# Cai dependencies truoc de tan dung cache layer
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy ma nguon ung dung
COPY backend ./backend
COPY frontend ./frontend

EXPOSE 8000

# Cau hinh API key truyen qua bien moi truong khi chay container, vi du:
#   docker run -p 8000:8000 -e LLM_API_KEY=xxx agent-talk
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
