import { Router } from 'express';

export function createSearchRouter(index, entriesMap) {
  const router = Router();

  router.get('/api/search', (req, res) => {
    try {
      const { limit, context, q } = req.query;

      let candidates = filterEntries(req.query, index, entriesMap);

      const total = candidates.length;
      if (limit) {
        candidates = candidates.slice(0, parseInt(limit, 10));
      }

      const useContext = context === 'true' && q;
      const includeComments = req.query.include_comments === 'true';
      const results = candidates.map((e) => ({
        id: e.id,
        type: e.type,
        author: e.author,
        title: e.title,
        date: e.date,
        slug: e.slug,
        categories: e.categories,
        tags: e.tags,
        content: useContext ? extractSnippet(e.content, q, includeComments ? e.commentsText : null) : e.content,
        comments: e.comments || [],
      }));

      res.json({ total, results });
    } catch (err) {
      console.error('Search error:', err.message);
      res.status(500).json({ error: 'Search failed', message: err.message });
    }
  });

  router.get('/api/entry/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid ID', message: 'ID must be an integer' });
      }
      const entry = entriesMap.get(id);
      if (!entry) {
        return res.status(404).json({ error: 'Not found', message: `No entry with ID ${id}` });
      }
      const { commentsText, ...rest } = entry;
      res.json(rest);
    } catch (err) {
      console.error('Entry lookup error:', err.message);
      res.status(500).json({ error: 'Lookup failed', message: err.message });
    }
  });

  router.get('/api/stats', (req, res) => {
    try {
      const candidates = filterEntries(req.query, index, entriesMap);

      const posts = candidates.filter((e) => e.type === 'post').length;
      const pages = candidates.filter((e) => e.type === 'page').length;

      let totalWords = 0;
      let totalChars = 0;
      let earliest = null;
      let latest = null;
      const authorCounts = {};
      const categoryCounts = {};
      const tagCounts = {};

      for (const e of candidates) {
        const chars = e.content.length;
        const words = e.content.split(/\s+/).filter(Boolean).length;
        totalChars += chars;
        totalWords += words;

        const d = new Date(e.date);
        if (!earliest || d < earliest) earliest = d;
        if (!latest || d > latest) latest = d;

        authorCounts[e.author] = (authorCounts[e.author] || 0) + 1;

        if (e.categories) {
          for (const c of e.categories) {
            categoryCounts[c] = (categoryCounts[c] || 0) + 1;
          }
        }
        if (e.tags) {
          for (const t of e.tags) {
            tagCounts[t] = (tagCounts[t] || 0) + 1;
          }
        }
      }

      const count = candidates.length;

      res.json({
        total: count,
        posts,
        pages,
        words: totalWords,
        characters: totalChars,
        averageWords: count ? Math.round(totalWords / count) : 0,
        averageCharacters: count ? Math.round(totalChars / count) : 0,
        dateRange: {
          earliest: earliest ? earliest.toISOString() : null,
          latest: latest ? latest.toISOString() : null,
        },
        topAuthors: sortedEntries(authorCounts),
        topCategories: sortedEntries(categoryCounts),
        topTags: sortedEntries(tagCounts),
      });
    } catch (err) {
      console.error('Stats error:', err.message);
      res.status(500).json({ error: 'Stats failed', message: err.message });
    }
  });

  return router;
}

function filterEntries(query, index, entriesMap) {
  const {
    q,
    type,
    author,
    category,
    tag,
    from,
    to,
    from_year,
    from_month,
    from_day,
    to_year,
    to_month,
    to_day,
    include_comments,
  } = query;

  let candidates;
  if (q) {
    // Detect quoted phrase search: "..." triggers exact phrase matching
    const isPhrase = /^".*"$/.test(q);
    const searchTerm = isPhrase ? q.slice(1, -1) : q;

    const searchOpts = include_comments === 'true'
      ? { enrich: true }
      : { index: ['content'], enrich: true };
    const searchResults = index.search(searchTerm, searchOpts);
    const idSet = new Set();
    for (const fieldResult of searchResults) {
      for (const item of fieldResult.result) {
        idSet.add(item.id);
      }
    }
    candidates = [...idSet].map((id) => entriesMap.get(id)).filter(Boolean);

    // Post-filter for quoted phrase: word-boundary regex match
    if (isPhrase) {
      const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const phraseRegex = new RegExp('\\b' + escaped.replace(/\s+/g, '\\s+') + '\\b', 'i');
      candidates = candidates.filter((e) => {
        if (e.content && phraseRegex.test(e.content)) return true;
        if (include_comments === 'true' && e.comments) {
          return e.comments.some((c) => c.content && phraseRegex.test(c.content));
        }
        return false;
      });
    }
  } else {
    candidates = [...entriesMap.values()];
  }

  if (type) {
    candidates = candidates.filter((e) => e.type === type);
  }

  if (author) {
    const authorLower = author.toLowerCase();
    candidates = candidates.filter(
      (e) => e.author && e.author.toLowerCase().includes(authorLower),
    );
  }

  if (category) {
    const catLower = category.toLowerCase();
    candidates = candidates.filter(
      (e) =>
        e.categories &&
        e.categories.some((c) => c.toLowerCase() === catLower),
    );
  }

  if (tag) {
    const tagLower = tag.toLowerCase();
    candidates = candidates.filter(
      (e) =>
        e.tags && e.tags.some((t) => t.toLowerCase() === tagLower),
    );
  }

  const fromDate = parseFromDate(from, from_year, from_month, from_day);
  const toDate = parseToDate(to, to_year, to_month, to_day);

  if (fromDate) {
    candidates = candidates.filter((e) => new Date(e.date) >= fromDate);
  }
  if (toDate) {
    candidates = candidates.filter((e) => new Date(e.date) <= toDate);
  }

  return candidates;
}

function sortedEntries(counts) {
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function extractSnippet(content, query, commentsText) {
  let idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1 && commentsText) {
    const cIdx = commentsText.toLowerCase().indexOf(query.toLowerCase());
    if (cIdx !== -1) {
      return snippetAround(commentsText, cIdx, query.length);
    }
  }
  if (idx === -1) {
    return content.slice(0, 500);
  }

  return snippetAround(content, idx, query.length);
}

function snippetAround(text, idx, matchLen) {
  let start = Math.max(0, idx - 200);
  let end = Math.min(text.length, idx + matchLen + 200);

  if (end - start > 500) {
    end = start + 500;
  }

  let snippet = text.slice(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';

  return snippet;
}

function parseFromDate(from, year, month, day) {
  if (from) {
    const parts = from.split('-');
    const y = parts[0];
    const m = parts[1] || '01';
    const d = parts[2] || '01';
    return new Date(`${y}-${m}-${d}T00:00:00`);
  }
  if (year) {
    const m = month || '01';
    const d = day || '01';
    return new Date(`${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00`);
  }
  return null;
}

function parseToDate(to, year, month, day) {
  if (to) {
    const parts = to.split('-');
    const y = parts[0];
    const m = parts[1] || '12';
    const d = parts[2] || lastDay(y, m);
    return new Date(`${y}-${m}-${d}T23:59:59`);
  }
  if (year) {
    const m = month || '12';
    const d = day || lastDay(year, m);
    return new Date(`${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T23:59:59`);
  }
  return null;
}

function lastDay(year, month) {
  return new Date(parseInt(year, 10), parseInt(month, 10), 0)
    .getDate()
    .toString()
    .padStart(2, '0');
}
