FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache \
    git \
    python3 \
    make \
    g++ \
    netcat-openbsd \
    tzdata \
    ffmpeg \
    ca-certificates

ENV TZ=America/Sao_Paulo
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    HOST=0.0.0.0 \
    PORT=4000

COPY package.json ./
COPY package-lock.json* pnpm-lock.yaml* yarn.lock* ./
# Instala deps de build (typescript/@types) — NODE_ENV=production pularia as devDependencies
RUN if [ -f package-lock.json ]; then \
      npm ci --include=dev --omit=optional --no-audit --no-fund --fetch-timeout=600000; \
    else \
      npm install --include=dev --no-audit --no-fund --fetch-timeout=600000; \
    fi

COPY . .
RUN mkdir -p /app/public \
    && npm run build \
    && npm prune --omit=dev \
    && npm cache clean --force

ENV NODE_ENV=production

EXPOSE 4000

CMD ["sh", "-c", "npx sequelize db:migrate; npx sequelize db:seed:all || true; exec node dist/server.js"]
