FROM python:3.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY app/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY app /app
COPY db /app/db
RUN useradd --system --create-home --uid 10001 mercora && mkdir -p /data && chown -R mercora:mercora /app /data
USER mercora
EXPOSE 8000
CMD ["uvicorn","server:app","--host","0.0.0.0","--port","8000","--proxy-headers","--forwarded-allow-ips","127.0.0.1"]
