(function () {
    'use strict';

    var btn = document.getElementById('idx-reindex-btn');
    var statusEl = document.getElementById('idx-reindex-status');
    if (!btn || !statusEl) return;

    var cfg = window.idxAdmin || {};

    // The rebuild runs in the sidecar and ends after seconds or, on a large
    // site, minutes: the first call starts it, the following ones ask how far
    // it is, until it is done or has failed.
    var POLL_MS = 3000;
    // Calls in a row that may fail (a replica restarting, a proxy hiccup)
    // before the page gives up asking.
    var MAX_ERRORS = 3;

    /** Calls an admin-ajax action of the plugin and resolves with its JSON. */
    function ajax(action) {
        var body = new FormData();
        body.append('action', action);
        body.append('_ajax_nonce', cfg.nonce);
        return fetch(cfg.ajaxUrl, { method: 'POST', body: body }).then(
            function (r) {
                return r.json();
            },
        );
    }

    /** Shows how the rebuild ended and lets the button be pressed again. */
    function finish(text, color) {
        statusEl.textContent = text;
        statusEl.style.color = color;
        btn.disabled = false;
    }

    /** The rebuild is done, with that many entries. */
    function done(entries) {
        var msg = (cfg.reindexDone || 'Done – %s entries indexed.').replace(
            '%s',
            entries === null || entries === undefined ? '?' : entries,
        );
        finish(msg, '#0a7b2e');
    }

    /** The rebuild failed, or its state could not be learned. */
    function fail(reason) {
        finish(
            (cfg.reindexError || 'Error: ') + (reason || 'Unknown'),
            '#b32d2e',
        );
    }

    var errors = 0;

    /** A call failed: asks again, until MAX_ERRORS calls in a row have failed. */
    function failedCall(reason) {
        errors++;
        if (errors >= MAX_ERRORS) fail(reason);
        else setTimeout(poll, POLL_MS);
    }

    /** Asks for the state of the rebuild, again until it has ended. */
    function poll() {
        ajax('idx_reindex_status')
            .then(function (resp) {
                if (!resp.success) {
                    failedCall(resp.data);
                    return;
                }
                errors = 0;
                var state = resp.data && resp.data.state;
                if (state === 'running') setTimeout(poll, POLL_MS);
                else if (state === 'done') done(resp.data.entries);
                else if (state === 'failed') fail(resp.data.message);
                else fail(state);
            })
            .catch(function (err) {
                failedCall(err.message);
            });
    }

    btn.addEventListener('click', function () {
        btn.disabled = true;
        errors = 0;
        statusEl.textContent = cfg.reindexRun || 'Reindex running…';
        statusEl.style.color = '';

        ajax('idx_reindex')
            .then(function (resp) {
                if (!resp.success) fail(resp.data);
                else if (resp.data && resp.data.state === 'done')
                    done(resp.data.entries);
                else setTimeout(poll, POLL_MS);
            })
            .catch(function (err) {
                fail(err.message);
            });
    });
})();
