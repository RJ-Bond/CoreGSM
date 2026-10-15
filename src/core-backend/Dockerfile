FROM node:22-bookworm-slim AS build
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /srv
RUN apt-get update && apt-get install -y --no-install-recommends \
        fontconfig fonts-dejavu-core fonts-liberation \
    && rm -rf /var/lib/apt/lists/* && fc-cache -f
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/dist ./dist
COPY package.json package-lock.json ./
RUN mkdir -p /data && chown -R node:node /data /srv
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
