FROM node:22-alpine AS build
WORKDIR /app
COPY app/package*.json ./
RUN npm ci --omit=dev
COPY app/ ./

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app .
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "src/index.js"]
