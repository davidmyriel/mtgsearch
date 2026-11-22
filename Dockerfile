# The web app. Build:  docker build -t mtgsearch .
# Run:  docker run -p 8000:8000 -e TOPK_API_KEY=... mtgsearch
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir ".[web]"

RUN useradd --create-home app
USER app

EXPOSE 8000
# --proxy-headers makes the per-client rate limit see the real client address behind the
# host's load balancer. Only run this image behind such a proxy.
CMD ["sh", "-c", "exec uvicorn mtgsearch.web:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
