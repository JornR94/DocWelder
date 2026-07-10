# Container image: ghcr.io/jornr94/docwelder
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY VERSION ./VERSION
RUN npm run build

FROM node:22-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY VERSION ./VERSION
ENTRYPOINT ["node", "/app/dist/cli.js"]
