FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY server ./server
COPY web ./web

RUN apk add --no-cache postgresql-client \
    && addgroup -S mercora && adduser -S mercora -G mercora \
    && chown -R mercora:mercora /app

USER mercora
EXPOSE 8080

CMD ["node", "server/server.js"]
