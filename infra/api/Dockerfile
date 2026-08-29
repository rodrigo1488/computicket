FROM python:3.12-slim-bookworm

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=America/Sao_Paulo

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      curl \
      unixodbc \
      unixodbc-dev \
      gnupg \
      ca-certificates \
      tzdata \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt \
    && rm /tmp/requirements.txt

# Código: api/app contém o pacote Flask (app/) + templates/static
COPY app/ /app/

# run.py na raiz da imagem
COPY run.py /app/run.py

# Garante que `from app import create_app` resolva api/app/app
ENV PYTHONPATH=/app

RUN mkdir -p /app/instance /app/app/static/uploads

EXPOSE 5000

CMD ["python", "run.py"]
