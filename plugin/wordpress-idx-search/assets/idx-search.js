(function () {
    'use strict';

    var API_BASE = '/idx';
    var t = window.idxI18n || {};

    var form = document.getElementById('idx-form');
    var status = document.getElementById('idx-status');
    var statsEl = document.getElementById('idx-stats');
    var resultsEl = document.getElementById('idx-results');
    var authorSelect = document.getElementById('idx-author');
    var categorySelect = document.getElementById('idx-category');
    var tagSelect = document.getElementById('idx-tag');

    if (!form) return;

    var locale = t.locale || 'de-DE';

    // Load stats to populate dropdowns and show index info
    fetch(API_BASE + '/api/stats')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            populateSelect(authorSelect, data.topAuthors);
            populateSelect(categorySelect, data.topCategories);
            populateSelect(tagSelect, data.topTags);

            if (data.dateRange.earliest) {
                document.getElementById('idx-from').value = data.dateRange.earliest.slice(0, 10);
            }
            if (data.dateRange.latest) {
                document.getElementById('idx-to').value = data.dateRange.latest.slice(0, 10);
            }

            status.style.display = 'none';
            form.style.display = '';

            showStats(data);
        })
        .catch(function (err) {
            status.textContent = (t.unreachable || '') + err.message;
        });

    function populateSelect(select, items) {
        if (!items) return;
        items.forEach(function (item) {
            var opt = document.createElement('option');
            opt.value = item.name;
            opt.textContent = item.name + ' (' + item.count + ')';
            select.appendChild(opt);
        });
    }

    function showStats(data) {
        var earliest = data.dateRange.earliest ? new Date(data.dateRange.earliest).toLocaleDateString(locale) : '\u2013';
        var latest = data.dateRange.latest ? new Date(data.dateRange.latest).toLocaleDateString(locale) : '\u2013';

        statsEl.innerHTML =
            '<strong>' + data.total + '</strong> ' + (t.entries || 'Eintr\u00e4ge') +
            ' (' + data.posts + ' ' + (t.posts || 'Beitr\u00e4ge') + ', ' + data.pages + ' ' + (t.pages || 'Seiten') + ')' +
            ' &middot; ' + data.words.toLocaleString(locale) + ' ' + (t.words || 'W\u00f6rter') +
            ' &middot; ' + earliest + ' ' + (t.to_date || 'bis') + ' ' + latest;
        statsEl.style.display = '';
    }

    // Search
    form.addEventListener('submit', function (e) {
        e.preventDefault();
        doSearch();
    });

    form.addEventListener('reset', function () {
        setTimeout(function () {
            resultsEl.innerHTML = '';
            fetch(API_BASE + '/api/stats')
                .then(function (r) { return r.json(); })
                .then(showStats);
        }, 0);
    });

    function doSearch() {
        var params = buildParams();
        var qs = new URLSearchParams(params).toString();

        resultsEl.innerHTML = '<div class="idx-search__loading">' + (t.searching || 'Suche l\u00e4uft\u2026') + '</div>';

        Promise.all([
            fetch(API_BASE + '/api/search?' + qs).then(function (r) { return r.json(); }),
            fetch(API_BASE + '/api/stats?' + qs).then(function (r) { return r.json(); })
        ]).then(function (responses) {
            var searchData = responses[0];
            var statsData = responses[1];
            showStats(statsData);
            renderResults(searchData);
        }).catch(function (err) {
            resultsEl.innerHTML = '<div class="idx-search__loading">' + (t.error || 'Fehler: ') + escapeHtml(err.message) + '</div>';
        });
    }

    function buildParams() {
        var params = {};
        var q = form.q.value.trim();
        if (q) params.q = q;

        var type = form.type.value;
        if (type) params.type = type;

        var author = form.author.value;
        if (author) params.author = author;

        var category = form.category.value;
        if (category) params.category = category;

        var tag = form.tag.value;
        if (tag) params.tag = tag;

        var from = form.from.value;
        if (from) params.from = from;

        var to = form.to.value;
        if (to) params.to = to;

        var limit = form.limit.value;
        if (limit) params.limit = limit;

        if (form.context.checked) params.context = 'true';
        if (form.include_comments.checked) params.include_comments = 'true';

        return params;
    }

    function renderResults(data) {
        var useContext = form.context.checked;
        var showComments = form.include_comments.checked;

        var rawQuery = form.q.value.trim();
        var isPhrase = /^".*"$/.test(rawQuery);
        var query = isPhrase ? rawQuery.slice(1, -1) : rawQuery;

        // Client-side phrase filter for quoted queries: word-boundary regex match
        var results = data.results;
        if (isPhrase && query) {
            var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            var phraseRegex = new RegExp('\\b' + escaped.replace(/\s+/g, '\\s+') + '\\b', 'i');
            results = results.filter(function (entry) {
                if (entry.content && phraseRegex.test(stripHtml(entry.content))) return true;
                if (showComments && entry.comments) {
                    return entry.comments.some(function (c) {
                        return c.content && phraseRegex.test(stripHtml(c.content));
                    });
                }
                return false;
            });
        }

        if (!results.length) {
            resultsEl.innerHTML = '<div class="idx-search__loading">' + (t.no_results || 'Keine Ergebnisse gefunden.') + '</div>';
            return;
        }

        results.sort(function (a, b) {
            return new Date(a.date) - new Date(b.date);
        });

        var header = '<div class="idx-search__loading"><strong>' + results.length + '</strong> ' + (t.hits || 'Treffer');
        if (results.length < data.total) {
            header += ' (' + (t.showing || 'zeige') + ' ' + results.length + ')';
        }
        header += '</div>';

        var html = header;
        results.forEach(function (entry) {
            html += renderEntry(entry, showComments, useContext, query);
        });
        resultsEl.innerHTML = html;
    }

    function renderEntry(entry, showComments, useContext, query) {
        var date = new Date(entry.date).toLocaleDateString(locale, {
            year: 'numeric', month: '2-digit', day: '2-digit'
        });
        var badgeClass = entry.type === 'post' ? 'idx-result__badge--post' : 'idx-result__badge--page';
        var typeLabel = entry.type === 'post' ? (t.post || 'Beitrag') : (t.page || 'Seite');

        var html = '<details class="idx-result">';
        html += '<summary class="idx-result__summary">';
        html += '<span class="idx-result__date">' + date + '</span>';
        html += '<span class="idx-result__title"><a href="' + escapeHtml(entry.slug) + '">' + escapeHtml(entry.title) + '</a></span>';
        html += '<span class="idx-result__badge ' + badgeClass + '">' + typeLabel + '</span>';
        html += '</summary>';

        html += '<div class="idx-result__body">';

        html += '<div class="idx-result__meta">';
        html += '<span>' + escapeHtml(entry.author) + '</span>';
        if (entry.categories && entry.categories.length) {
            html += '<span>' + entry.categories.map(escapeHtml).join(', ') + '</span>';
        }
        html += '</div>';

        html += '<div class="idx-result__content">' + highlightText(stripHtml(entry.content), query) + '</div>';

        if (entry.tags && entry.tags.length) {
            html += '<div class="idx-result__tags">';
            entry.tags.forEach(function (tg) {
                html += '<span class="idx-result__tag">' + escapeHtml(tg) + '</span>';
            });
            html += '</div>';
        }

        if (showComments && entry.comments && entry.comments.length) {
            var filtered = entry.comments;
            if (useContext && query) {
                var re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                filtered = filtered.filter(function (c) { return re.test(c.content); });
            }
            if (filtered.length) {
                var commentWord = filtered.length > 1 ? (t.comment_plural || 'Kommentare') : (t.comment || 'Kommentar');
                html += '<div class="idx-result__comments">';
                html += '<div class="idx-result__comments-title">' + filtered.length + ' ' + commentWord + '</div>';
                filtered.forEach(function (c) {
                    var cDate = new Date(c.date).toLocaleDateString(locale);
                    html += '<div class="idx-result__comment"><strong>' + escapeHtml(c.author) + '</strong> (' + cDate + '): ' + highlightText(stripHtml(c.content), query) + '</div>';
                });
                html += '</div>';
            }
        }

        html += '</div>';
        html += '</details>';
        return html;
    }

    function highlightText(str, query) {
        if (!str || !query) return escapeHtml(str);
        var pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var re = new RegExp(pattern, 'gi');
        var result = '';
        var lastIndex = 0;
        var match;
        while ((match = re.exec(str)) !== null) {
            result += escapeHtml(str.slice(lastIndex, match.index));
            result += '<mark class="idx-highlight">' + escapeHtml(match[0]) + '</mark>';
            lastIndex = re.lastIndex;
        }
        result += escapeHtml(str.slice(lastIndex));
        return result;
    }

    function stripHtml(str) {
        if (!str) return '';
        var doc = new DOMParser().parseFromString(str, 'text/html');
        return doc.body.textContent || '';
    }

    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }
})();
