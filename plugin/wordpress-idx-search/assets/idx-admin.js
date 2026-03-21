(function () {
    'use strict';

    var btn = document.getElementById('idx-reindex-btn');
    var statusEl = document.getElementById('idx-reindex-status');
    if (!btn || !statusEl) return;

    var cfg = window.idxAdmin || {};

    btn.addEventListener('click', function () {
        btn.disabled = true;
        statusEl.textContent = cfg.reindexRun || 'Reindex running…';
        statusEl.style.color = '';

        var body = new FormData();
        body.append('action', 'idx_reindex');
        body.append('_ajax_nonce', cfg.nonce);

        fetch(cfg.ajaxUrl, { method: 'POST', body: body })
            .then(function (r) { return r.json(); })
            .then(function (resp) {
                if (resp.success) {
                    var entries = resp.data && resp.data.entries ? resp.data.entries : '?';
                    var msg = (cfg.reindexDone || 'Done – %s entries indexed.').replace('%s', entries);
                    statusEl.textContent = msg;
                    statusEl.style.color = '#0a7b2e';
                } else {
                    statusEl.textContent = (cfg.reindexError || 'Error: ') + (resp.data || 'Unknown');
                    statusEl.style.color = '#b32d2e';
                }
            })
            .catch(function (err) {
                statusEl.textContent = (cfg.reindexError || 'Error: ') + err.message;
                statusEl.style.color = '#b32d2e';
            })
            .finally(function () {
                btn.disabled = false;
            });
    });
})();
