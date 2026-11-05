# wordpress-idx API Reference

REST API for searching WordPress posts and pages. Base URL includes a configurable prefix (e.g. `/idx`). All endpoints return JSON.

## Endpoints

### GET /api/search

Full-text search and metadata filtering. All parameters are optional query strings. Omitting `q` returns all entries.

| Param | Type | Description |
|---|---|---|
| `q` | string | Full-text search, case-insensitive. Words match by prefix (forward tokenizer); several words must all match, in any order. In double quotes (`q="exact phrase"`) only entries that contain the phrase match |
| `type` | string | `post` or `page` |
| `author` | string | Case-insensitive substring match on author name |
| `category` | string | Case-insensitive exact match on category name |
| `tag` | string | Case-insensitive exact match on tag name |
| `from` | string | Start date: `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` |
| `to` | string | End date: `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` |
| `from_year`, `from_month`, `from_day` | string | Start date in parts, read only when `from` is absent; month and day are ignored without the year |
| `to_year`, `to_month`, `to_day` | string | End date in parts, read only when `to` is absent; month and day are ignored without the year |
| `limit` | integer | Max results to return (default: unlimited) |
| `context` | boolean | `true` returns a ~500-char snippet around the match instead of the full content (only with `q`) |
| `include_comments` | boolean | `true` includes comment text in the full-text search (default: `false`, searches post content only) |

Response: `{ "total": number, "results": Entry[] }`. `total` counts the matches before `limit` is applied; with `q` it is capped, see Key Behaviours.

### GET /api/entry/:id

Single entry by WordPress post ID. Returns 200 with Entry, 400 if the ID does not parse as an integer, 404 if not found.

### GET /api/stats

Same filter params as `/api/search`; `limit` and `context` have no effect. Returns aggregate statistics:
```json
{ "total", "posts", "pages", "words", "characters", "averageWords", "averageCharacters",
  "dateRange": { "earliest", "latest" },
  "topAuthors": [{ "name", "count" }],
  "topCategories": [{ "name", "count" }],
  "topTags": [{ "name", "count" }] }
```

`words` and `characters` count the entries' content, without comments. The `top…` lists hold every value, sorted by count. `earliest` and `latest` are `null` when nothing matches.

### POST /api/reindex

Rebuilds index from WordPress DB and answers when the rebuild is done. Auth: `Authorization: Bearer <key>` or `X-Api-Key: <key>`. Returns 200 `{ "status": "ok", "entries": N }`, 401 bad key, 409 already running, 500 rebuild failed, 503 key not configured.

### GET /readyz

200 `{ "status": "ok" }` once the index is loaded, 503 before. Until then `/api/search`, `/api/stats` and `/api/entry/:id` answer 404, not as JSON.

### GET /healthz

Liveness probe: 200 `{ "status": "ok", "ready": boolean }` once the service has its database connection or an existing index, 503 before. `ready` is what `/readyz` reports.

## Entry Object

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
  "content": "Plain text content (HTML stripped)...",
  "comments": [
    { "author": "Bob", "date": "2024-03-16T08:00:00.000Z", "content": "Comment text..." }
  ]
}
```

## Key Behaviours

- `q` uses FlexSearch forward tokenizer: "kube" matches "kubernetes". Without `q`, all entries are returned and only metadata filters apply.
- With `q`, the index returns at most 100 matches from the post content, and at most 100 more from the comment text with `include_comments=true`. The phrase check and all metadata filters apply to those matches only, so `total`, `results` and `/api/stats` can miss entries when a query matches more. Without `q` there is no such cap.
- `q="exact phrase"` keeps only entries in which the words follow each other as whole words, case-insensitive, with any whitespace between them. Word boundaries know ASCII letters only: at an end of the phrase that is another letter (`ä`, `é`, `ß`), the phrase is found only where an ASCII letter, digit or underscore touches it. `q="café"` matches in `cafés` and not in `café.`
- `include_comments=true` extends `q` matching to comment text. Comments are always present in the response regardless of this flag.
- `context=true` with `q` returns a ~500-char snippet around the first place where `q` occurs literally in the content, with `...` where text was cut. If `include_comments=true` and `q` occurs only in comments, the snippet is drawn from comment text. If `q` does not occur literally (several words that are apart, or a quoted phrase, whose quotes are part of the lookup), the first 500 chars of the content are returned.
- Filters are combined with AND logic. All filters are optional and can be mixed freely.
- Date ranges are inclusive. Partial dates expand: `from=2024` → Jan 1 2024, `to=2024` → Dec 31 2024.
- Without `q`, results come newest first. With `q`, they come in the index's match order, not by date.
- Slugs are always formatted as `/{post_name}/`.
- An unexpected failure returns 500 with `{ "error": string, "message": string }`; the 4xx and 503 answers of the `/api/` endpoints carry an `error` text as well, except the 404 before the index is loaded.
