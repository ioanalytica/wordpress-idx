# hadolint ignore=DL3007
FROM node:22-alpine AS build
WORKDIR /app
COPY app/package*.json ./
RUN npm ci --omit=dev
COPY app/ ./

# hadolint ignore=DL3007
FROM node:22-alpine
RUN mkdir -p /idx && chown node:node /idx
WORKDIR /app
COPY --from=build --chown=node:node /app .
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
