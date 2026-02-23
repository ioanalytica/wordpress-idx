# wordpress-idx API Reference

REST API for searching WordPress posts and pages. Base URL includes a configurable prefix (e.g. `/idx`). All endpoints return JSON.

## Endpoints

### GET /api/search

Full-text search and metadata filtering. All parameters optional query strings. Omitting `q` returns all entries.

| Param | Type | Description |
|---|---|---|
| `q` | string | Full-text search (forward tokenizer, matches partial prefixes) |
| `type` | string | `post` or `page` |
| `author` | string | Case-insensitive substring match on author name |
| `category` | string | Case-insensitive exact match on category name |
| `tag` | string | Case-insensitive exact match on tag name |
| `from` | string | Start date: `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` |
| `to` | string | End date: `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` |
| `limit` | integer | Max results to return (default: unlimited) |
| `context` | boolean | `true` returns ~500-char snippet around match instead of full content (only with `q`) |
| `include_comments` | boolean | `true` includes comment text in full-text search (default: `false`, searches post content only) |

Alternative date params: `from_year`/`from_month`/`from_day`, `to_year`/`to_month`/`to_day`.

Response: `{ "total": number, "results": Entry[] }`

### GET /api/entry/:id

Single entry by WordPress post ID. Returns 200 with Entry, 400 if ID is not an integer, 404 if not found.

### GET /api/stats

Same filter params as `/api/search`. Returns aggregate statistics:
```json
{ "total", "posts", "pages", "words", "characters", "averageWords", "averageCharacters",
  "dateRange": { "earliest", "latest" },
  "topAuthors": [{ "name", "count" }],
  "topCategories": [{ "name", "count" }],
  "topTags": [{ "name", "count" }] }
```

### POST /api/reindex

Rebuilds index from WordPress DB. Auth: `Authorization: Bearer <key>` or `X-Api-Key: <key>`. Returns 200 `{ "status": "ok", "entries": N }`, 401 bad key, 409 already running, 503 key not configured.

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
- `include_comments=true` extends `q` matching to comment text. Comments are always present in the response regardless of this flag.
- `context=true` with `q` returns a ~500-char snippet centred on the first match. If `include_comments=true` and the match is only in comments, the snippet is drawn from comment text.
- Filters are combined with AND logic. All filters are optional and can be mixed freely.
- Date ranges are inclusive. Partial dates expand: `from=2024` → Jan 1 2024, `to=2024` → Dec 31 2024.
- Slugs are always formatted as `/{post_name}/`.
