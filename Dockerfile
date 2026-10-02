FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=10000

WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --create-home --uid 10001 demo

COPY --chown=demo:demo demo_app.py ./demo_app.py
COPY --chown=demo:demo static/demo ./static/demo

USER demo
EXPOSE 10000
CMD ["sh", "-c", "uvicorn demo_app:app --host 0.0.0.0 --port ${PORT:-10000}"]
