# wordpress-idx

A lightweight Node.js sidecar that extracts published WordPress posts and pages, builds a [FlexSearch](https://github.com/nextapps-de/flexsearch) full-text index, and exposes a search & statistics REST API. Designed to run as an optional sidecar container in a WordPress pod on Kubernetes.

## Quick start

```bash
cp .env.example .env   # fill in DB credentials
cd app && npm install
node src/index.js
```

## API

All endpoints are served under the configurable `BASE_PATH` prefix (empty by default, `/idx` when deployed behind an ingress).

### Health & readiness

| Endpoint | Purpose | 200 when |
|---|---|---|
| `GET /healthz` | Liveness probe | DB connected or existing index found |
| `GET /readyz`  | Readiness probe | Search index loaded and API ready |

### Search

```
GET /api/search
```

All parameters are optional. Omitting `q` returns all entries (metadata-only filtering).

| Parameter | Type | Default | Description |
|---|---|---|---|
| `q` | string | | Full-text search query (FlexSearch forward tokenizer) |
| `type` | string | | `post` or `page` |
| `author` | string | | Case-insensitive substring match on author name |
| `category` | string | | Case-insensitive exact match on category |
| `tag` | string | | Case-insensitive exact match on tag |
| `from` | string | | Start date (`YYYY`, `YYYY-MM`, or `YYYY-MM-DD`) |
| `to` | string | | End date (`YYYY`, `YYYY-MM`, or `YYYY-MM-DD`) |
| `from_year`, `from_month`, `from_day` | string | | Alternative date components |
| `to_year`, `to_month`, `to_day` | string | | Alternative date components |
| `limit` | integer | no limit | Maximum results to return |
| `context` | boolean | `false` | When `true` and `q` is set, returns a ~500-char snippet around the match instead of full content |

**Response:**

```json
{
  "total": 42,
  "results": [
    {
      "id": 1234,
      "type": "post",
      "author": "Jane Doe",
      "title": "Example Post",
      "date": "2024-03-15T10:30:00.000Z",
      "slug": "/example-post/",
      "categories": ["Tech"],
      "tags": ["kubernetes", "docker"],
      "content": "Full text or context snippet..."
    }
  ]
}
```

### Statistics

```
GET /api/stats
```

Accepts the same filter parameters as `/api/search`. Returns aggregate statistics over the matching entries.

```json
{
  "total": 1695,
  "posts": 1456,
  "pages": 239,
  "words": 588207,
  "characters": 3818613,
  "averageWords": 347,
  "averageCharacters": 2253,
  "dateRange": { "earliest": "2006-11-25T...", "latest": "2024-12-05T..." },
  "topAuthors": [{ "name": "Jane Doe", "count": 1671 }],
  "topCategories": [{ "name": "General", "count": 613 }],
  "topTags": [{ "name": "docker", "count": 162 }]
}
```

### Reindex

```
POST /api/reindex
```

Triggers a full re-extraction from the WordPress database and rebuilds the search index. Requires an API key.

**Authentication** (one of):
- `Authorization: Bearer <key>`
- `X-Api-Key: <key>`

| Status | Meaning |
|---|---|
| 200 | Reindex complete, returns `{ "status": "ok", "entries": 1695 }` |
| 401 | Invalid or missing API key |
| 409 | Reindex already in progress |
| 503 | `REINDEX_API_KEY` not configured |

## Configuration

| Variable | Default | Description |
|---|---|---|
| `DB_HOST` | | MySQL/MariaDB host (required) |
| `DB_PORT` | `3306` | Database port |
| `DB_USER` | | Database user (required) |
| `DB_PASS` | | Database password (required) |
| `DB_NAME` | | WordPress database name (required) |
| `DB_PREFIX` | `wp_` | Table prefix |
| `DB_CHARSET` | `utf8mb4` | Connection charset |
| `DB_COLLATE` | `utf8mb4_unicode_ci` | Connection collation |
| `PORT` | `3000` | HTTP listen port |
| `DATA_DIR` | `./data` (dev) / `/idx` (container) | Directory for index files |
| `BASE_PATH` | | URL prefix for all routes (e.g. `/idx`) |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |
| `REINDEX_API_KEY` | | API key for `/api/reindex` (disabled when empty) |
| `FORCE_UPDATE` | `false` | Rebuild index on every startup |
| `STARTUP_DELAY` | `0` | Seconds to wait before DB connection (sidecar startup ordering) |

## Data extraction

Extracts all `publish`-status posts and pages from the WordPress database:

- Joins `wp_posts` with `wp_users` for author display names
- Joins `wp_term_relationships` / `wp_term_taxonomy` / `wp_terms` for categories and tags
- Strips HTML tags and decodes common entities
- Normalises whitespace
- Uses a single DB connection, closed after extraction

Each indexed entry contains: `id`, `type`, `author`, `title`, `date`, `slug`, `categories`, `tags`, `content`.

## Index files

Stored in `DATA_DIR`:

| File | Purpose | Persistent |
|---|---|---|
| `wp-index-flex.json` | FlexSearch index chunks + entry metadata | Yes |
| `wp-index-source.json` | Intermediate extraction output | Deleted after index build |

On startup the app checks for `wp-index-flex.json`. If found, it loads the index directly (no DB connection needed). If missing or `FORCE_UPDATE=true`, it extracts from the database and builds the index.

## Kubernetes sidecar deployment

The app is designed to run as a sidecar in a WordPress pod. The companion Helm chart (`wordpress-nginx`) supports this via the `idx` values section:

```yaml
idx:
  enabled: true
  basePath: /idx
  startupDelay: 30
  resourcesPreset: "small"
  image:
    pullPolicy: Always
```

Key integration points:

- **Shared PVC**: Mounts the pod's PVC at `/idx` (subPath: `idx`) for persistent index storage
- **DB credentials**: Derived from the existing WordPress database configuration
- **Ingress**: Path `/idx` routed to the sidecar's port 3000
- **NetworkPolicy**: Port 3000 added to allowed ingress when `idx.enabled`
- **Probes**: Liveness on `/healthz`, readiness on `/readyz`
- **Startup delay**: Waits for WordPress to initialise before extracting from the shared database

## Docker

```bash
# Build and push (reads tag from git describe)
./docker-build.sh
```

Image: `node:22-alpine`, multi-arch (`linux/amd64`, `linux/arm64`), non-root (`node` user).

## Request logging

All requests except `/healthz` and `/readyz` are logged:

```
2026-02-19T15:42:33.123Z 10.11.0.1 GET /idx/api/search?q=test 200 12ms results=30
2026-02-19T15:42:35.456Z 10.11.0.1 GET /idx/api/stats 200 45ms results=1695
```

Format: `timestamp ip method url status duration [results=N]`

## License

ISC
