# wordpress-idx

A lightweight Node.js sidecar that extracts published WordPress posts and pages, builds a [FlexSearch](https://github.com/nextapps-de/flexsearch) full-text index, and exposes a search & statistics REST API. Designed to run as an optional sidecar container in a WordPress pod on Kubernetes.

The repository also holds the WordPress plugin that puts a search form in front of the API: [`plugin/wordpress-idx-search`](plugin/wordpress-idx-search). The sidecar image bundles the plugin and serves it to WordPress for updates (see [Plugin distribution](#plugin-distribution)).

[`API_PROMPT.md`](API_PROMPT.md) is a compact reference of the API, written to be handed to an agent that uses the index for research.

## Quick start

```bash
cp .env.example .env    # fill in the DB credentials
mkdir -p data           # DATA_DIR=./data in .env.example
npm --prefix app ci
node app/src/index.js
```

The app loads `.env` from the directory it is started in, here the repository root, and `DATA_DIR` must exist: the app does not create it. `.env` and `data/` at the root are ignored by git and kept out of the image's build context.

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

All parameters are optional. Omitting `q` returns all entries (metadata-only filtering). With `q`, the index returns at most 100 matches from the post content (and 100 more from comments with `include_comments`); the filters and `total` apply to those.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `q` | string | | Full-text search query (FlexSearch forward tokenizer). Several words must all match; a query in double quotes (`"exact phrase"`) matches the phrase only |
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
| `include_comments` | boolean | `false` | When `true`, full-text search also matches against comment text |

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
      "content": "Full text or context snippet...",
      "comments": [
        {
          "author": "Bob",
          "date": "2024-03-16T08:00:00.000Z",
          "content": "Great post!"
        }
      ]
    }
  ]
}
```

### Entry by ID

```
GET /api/entry/:id
```

Returns a single post or page by its WordPress ID.

| Status | Meaning |
|---|---|
| 200 | Entry found |
| 400 | Invalid ID (not an integer) |
| 404 | No entry with the given ID |

**Response (200):**

```json
{
  "id": 1234,
  "type": "post",
  "author": "Jane Doe",
  "title": "Example Post",
  "date": "2024-03-15T10:30:00.000Z",
  "slug": "/example-post/",
  "categories": ["Tech"],
  "tags": ["kubernetes", "docker"],
  "content": "Full text content...",
  "comments": [
    {
      "author": "Bob",
      "date": "2024-03-16T08:00:00.000Z",
      "content": "Great post!"
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
| 500 | Reindex failed, returns `{ "error": "Reindex failed", "message": "…" }` |
| 503 | `REINDEX_API_KEY` not configured |

### Plugin distribution

The image bundles the WordPress plugin, and the sidecar serves it so that WordPress can update the plugin from its own sidecar (the plugin's `Update URI` mechanism).

| Endpoint | Purpose |
|---|---|
| `GET /plugin/update-info.json` | Update manifest: version and WordPress compatibility of the bundled plugin, read from the plugin's own header and `readme.txt`, and `auto_update` (see `PLUGIN_AUTO_UPDATE`). 503 when the plugin is not bundled |
| `GET /plugin/wordpress-idx-search.zip` | The plugin package. 404 when it is not bundled |

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
| `DATA_DIR` | `/data` | Directory for index files; must exist and be writable. `.env.example` sets `./data`. The image prepares `/idx` for it, and the Helm chart sets `DATA_DIR=/idx` |
| `BASE_PATH` | | URL prefix for all routes (e.g. `/idx`) |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |
| `REINDEX_API_KEY` | | API key for `/api/reindex` (disabled when empty) |
| `FORCE_UPDATE` | `false` | Rebuild index on every startup |
| `STARTUP_DELAY` | `0` | Seconds to wait before DB connection (sidecar startup ordering) |
| `PLUGIN_AUTO_UPDATE` | `true` | `false` makes the update manifest tell the plugin not to install its updates automatically |
| `PLUGIN_ZIP_PATH` | `/app/wordpress-idx-search.zip` | The plugin package served at `/plugin/wordpress-idx-search.zip` |
| `PLUGIN_SRC_PATH` | `/app/plugin-src`, else the checkout's `plugin/wordpress-idx-search` | The plugin tree the update manifest reads its version from |

## Data extraction

Extracts all `publish`-status posts and pages from the WordPress database:

- Joins `wp_posts` with `wp_users` for author display names
- Joins `wp_term_relationships` / `wp_term_taxonomy` / `wp_terms` for categories and tags
- Fetches approved comments from `wp_comments` (regular comments only, no pingbacks/trackbacks)
- Strips HTML tags and decodes common entities
- Normalises whitespace
- Uses a single DB connection, closed after extraction

Each indexed entry contains: `id`, `type`, `author`, `title`, `date`, `slug`, `categories`, `tags`, `content`, `comments`.

## Index files

Stored in `DATA_DIR`:

| File | Purpose | Persistent |
|---|---|---|
| `wp-index-flex.json` | FlexSearch index chunks + entry metadata | Yes |
| `wp-index-source.json` | Intermediate extraction output | Deleted after index build |

On startup the app checks for `wp-index-flex.json`. If found, it loads the index directly (no DB connection needed). If missing or `FORCE_UPDATE=true`, it extracts from the database and builds the index.

## Kubernetes sidecar deployment

The app is designed to run as a sidecar in a WordPress pod. The companion Helm chart ([`wordpress-nginx`](https://github.com/ioanalytica/wordpress-nginx)) supports this via the `idx` values section:

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
# Build for the host architecture and load the image into the local Docker daemon
./docker-build.sh
```

The script reads the image tag from `version` in `app/package.json`, asks before it builds (`-y` skips the question) and runs [hadolint](https://github.com/hadolint/hadolint) on the `Dockerfile` first; its findings are printed and do not stop the build. With `--push` it builds for `linux/amd64` and `linux/arm64` and pushes the image instead of loading it, which needs write access to the registry.

Image: `node:26-alpine`, non-root (`node` user).

## Request logging

Every request answered with JSON is logged, except `/healthz` and `/readyz`:

```
2026-02-19T15:42:33.123Z 10.11.0.1 GET /idx/api/search?q=test 200 12ms results=30
2026-02-19T15:42:35.456Z 10.11.0.1 GET /idx/api/stats 200 45ms results=1695
```

Format: `timestamp ip method url status duration [results=N]`

## Contributing

Bug reports, questions and pull requests are welcome: [CONTRIBUTING.md](CONTRIBUTING.md) says where they go and how to run the checks. A vulnerability is reported privately, as [SECURITY.md](SECURITY.md) describes. [CHANGELOG.md](CHANGELOG.md) lists what changed in each version.

## License

Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE)

The WordPress plugin (`plugin/`) is separately licensed under GPL-2.0-or-later, as required by WordPress plugin licensing terms — see [plugin/wordpress-idx-search/LICENSE](plugin/wordpress-idx-search/LICENSE).
