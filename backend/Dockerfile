FROM python:3.11-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

# 云端默认装上 Postgres / Redis 驱动
COPY requirements.txt .
RUN pip install -r requirements.txt asyncpg redis

COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
