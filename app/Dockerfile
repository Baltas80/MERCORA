FROM python:3.13-alpine

RUN addgroup -S mercora && adduser -S -G mercora mercora
WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --disable-pip-version-check -r requirements.txt

COPY --chown=mercora:mercora server.py ./server.py
COPY --chown=mercora:mercora db.py ./db.py
COPY --chown=mercora:mercora domain.py ./domain.py
COPY --chown=mercora:mercora passwords.py ./passwords.py
COPY --chown=mercora:mercora auth.py ./auth.py
COPY --chown=mercora:mercora inventory.py ./inventory.py
COPY --chown=mercora:mercora fees.py ./fees.py
COPY --chown=mercora:mercora orders.py ./orders.py
COPY --chown=mercora:mercora checkout.py ./checkout.py
COPY --chown=mercora:mercora rate_limit.py ./rate_limit.py

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

USER mercora
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2)"
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
