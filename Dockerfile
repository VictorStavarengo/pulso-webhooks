# Imagem única: compila o painel e entrega API + estáticos pela mesma origem.
FROM node:22-alpine AS painel
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PULSO_SERVIR_FRONTEND=1 \
    PULSO_SESSAO_ARQUIVO=/dados/.pulso-sessao \
    DATABASE_URL=sqlite:////dados/ecommerce.db

WORKDIR /app

COPY requirements.txt requirements-extras.txt ./
RUN pip install -r requirements.txt -r requirements-extras.txt

COPY . .
COPY --from=painel /app/frontend/dist frontend/dist

RUN useradd --create-home --shell /usr/sbin/nologin pulso \
    && mkdir -p /dados \
    && chown -R pulso:pulso /app /dados

USER pulso
VOLUME ["/dados"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os, sys, urllib.request; porta = os.getenv('PORT', '8000'); sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:' + porta + '/health', timeout=4).status == 200 else 1)"

CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
