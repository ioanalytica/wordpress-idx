# hadolint ignore=DL3007
FROM node:26-alpine AS build
WORKDIR /app
RUN npm install -g npm@latest
COPY app/package*.json ./
RUN npm ci --omit=dev
COPY app/ ./

# Package the WordPress plugin so the sidecar can serve it for auto-updates.
# Dev-only files are kept out of the build context via .dockerignore, so the
# copied tree is already the distributable plugin.
# hadolint ignore=DL3007
FROM alpine:3 AS plugin
# hadolint ignore=DL3018
RUN apk add --no-cache zip
WORKDIR /build
COPY plugin/wordpress-idx-search/ ./wordpress-idx-search/
RUN zip -r -X /wordpress-idx-search.zip wordpress-idx-search

# hadolint ignore=DL3007
FROM node:26-alpine
# hadolint ignore=DL3018
RUN apk update && apk upgrade --no-cache && rm -rf /var/cache/apk/*
RUN npm uninstall -g npm corepack && rm -rf /usr/local/lib/node_modules /opt/yarn* /root/.npm
RUN mkdir -p /idx && chown node:node /idx
WORKDIR /app
COPY --from=build --chown=node:node /app .
COPY --from=plugin --chown=node:node /wordpress-idx-search.zip /app/wordpress-idx-search.zip
# Same tree the zip was built from — the update manifest reads its version and
# compatibility headers from here, so the two can never disagree.
COPY --from=plugin --chown=node:node /build/wordpress-idx-search /app/plugin-src
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
