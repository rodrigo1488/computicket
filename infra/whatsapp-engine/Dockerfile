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
    NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000

COPY package.json package-lock.json ./
RUN npm ci --omit=optional --no-audit --no-fund --fetch-timeout=600000 \
    || npm install --no-audit --no-fund --fetch-timeout=600000

COPY . .
RUN mkdir -p /app/public \
    && npm run build \
    && npm cache clean --force

EXPOSE 4000

CMD ["sh", "-c", "npx sequelize db:migrate; npx sequelize db:seed:all || true; exec node dist/server.js"]
