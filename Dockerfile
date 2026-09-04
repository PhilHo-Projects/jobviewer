# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
# build toolchain for the better-sqlite3 native module (musl => must compile)
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runner
ENV NODE_ENV=production \
    PORT=3004 \
    DATA_DIR=/app/data
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
# public-sample.json is read at startup to seed the demo user's frozen jobs
COPY --from=build /app/public-sample.json ./public-sample.json

# data/ (SQLite db, session.secret, identity.json) is a mounted volume at runtime
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 3004
CMD ["node", "dist-server/server.js"]
