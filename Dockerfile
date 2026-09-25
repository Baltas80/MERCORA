FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && apk add --no-cache --virtual .better-sqlite3-build-deps python3 make g++ \
    && npm rebuild better-sqlite3 --build-from-source \
    && apk del .better-sqlite3-build-deps \
    && npm cache clean --force

COPY server ./server
COPY web ./web
COPY docker-compose.yml docker-compose.onion.yml ./
COPY tor ./tor

RUN addgroup -S mercora && adduser -S mercora -G mercora \
    && chown -R mercora:mercora /app

USER mercora
EXPOSE 8080

CMD ["node", "server/server.js"]
