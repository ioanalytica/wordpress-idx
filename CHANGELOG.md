# Changelog

What changed in each version of wordpress-idx. The sidecar and the WordPress
plugin share one version; the entry of a version is its release notes.

## 1.3.9

* **The index of a large site is built and served with a fraction of the
  memory.** The sidecar kept every entry and the whole search index as
  JavaScript objects, and wrote and read them as one JSON document. On a site
  of 15,600 posts and pages the build needed 4.7 GiB and failed with Node's
  default heap, a rebuild needed 6.6 GiB, the sidecar held 1.1 GiB at rest,
  and the document was at three quarters of the largest string Node can hold.
  Now the entries and the index are kept in a compact binary form outside
  the JavaScript heap, the site is read from the database in batches, indexed
  in parts and merged on disk. The same site builds in 0.4 GiB, rests at
  0.24 GiB and loads in 0.2 s instead of 2 s, with the default heap: no
  `NODE_OPTIONS` is needed, and neither the build nor the file has a size at
  which it stops working. The README has the figures under "Memory".
* **The sidecar answers while it builds the index.** The build ran in the
  thread that answers requests: for as long as it took, neither the search
  nor `/healthz` answered, and on a large site Kubernetes restarted the
  container in the middle of it. The build now runs in a process of its own.
  During a rebuild the search keeps answering from the index that is there.
* **A build that fails leaves the index in place.** The index file is written
  under another name and gets its name when it is complete.
* **The index file is `wp-index.bin`, and an index file of an earlier version
  is rebuilt once.** The sidecar builds its index anew from the database at
  the first start of this version, and needs the database for that start. It
  then deletes `wp-index-flex.json`. No manual "Rebuild index" is needed.
* **What the search returns has not changed**: the same entries in the same
  order for every query, with every option, and the same statistics. The
  tests hold each response against the one version 1.3.8 gave. Two orders
  that were left to the database are now fixed: posts published in the same
  second are ordered by their ID, newest first, and comments written in the
  same second by their ID.
* `/api/stats` answers faster: the characters and words of an entry are
  counted when the index is built, not for every request.

## 1.3.8

* **A query returns every match.** With `q`, the search returned at most 100
  entries per searched field, and `total`, the filters and `/api/stats`
  counted only those. They now see every entry that matches.
* **A query matches titles.** The index covered the content and the comments
  of an entry; a word that stood only in its title found nothing. Titles are
  now searched like the content, as plain text and also by a quoted phrase,
  in the API and in the plugin's search form. Several words must still all occur in one field:
  the title, the content or, with `include_comments`, the comments.
* **Posts without an author are in the index.** A published post or page
  whose author is not a WordPress user (author ID 0, as `wp post create`
  leaves it without `--post_author`, or a user that was deleted) was left
  out. It is now indexed with an empty `author`, matches no `author` filter
  and adds nothing to `topAuthors`.
* **Hardening: the index holds only posts and pages that are public without
  a password.**
* **An index file of an earlier version is rebuilt once.** The index file
  now carries a format number. A file without it, or with another one, is
  not loaded: the sidecar builds its index anew from the database at the
  first start of this version, and needs the database for that start. This
  is what brings titles and the entries above into an existing
  installation's index; no manual "Rebuild index" is needed.
* **The sidecar waits for WordPress.** The index was built in one attempt
  after the start; when the database did not answer yet or WordPress had
  not created its tables, the sidecar stayed without an index until it was
  restarted. It now tries again every 5 seconds until the build succeeds,
  and builds an index without entries a second time before it serves it.
* **The plugin's search form follows the sidecar's path.** Its script called
  the sidecar under `/idx`, whatever path the sidecar was configured with
  (`BASE_PATH`, `idx.basePath` in the Helm chart). It now uses the path of
  `WORDPRESS_IDX_BASE`, which the chart defines, and `/idx` without it. The
  settings page shows the same path.
* **The search form shows every result of a quoted phrase.** The form
  checked the phrase a second time in the browser. With "context snippet
  only" it checked the snippet, and dropped a result whose phrase lies
  outside it. The sidecar's match now stands.

### Project

* **Released images come from wordpress-nginx.** The image
  `ghcr.io/ioanalytica/wordpress-idx` is built, signed with cosign and
  published by the release of
  [wordpress-nginx](https://github.com/ioanalytica/wordpress-nginx), from the
  commit of this repository it pins as a submodule, and carries the chart
  version as its tag. This repository publishes no image any more: its build
  and push workflow and its daily CVE scan are gone, a git tag here starts
  nothing, and `docker-build.sh` builds locally only. The README says how to
  verify an image; the tags `1.x.y` up to `1.3.7` are this repository's
  earlier, unsigned builds and stay as they are.
* **Dependency updates by Renovate** instead of Dependabot, with the same
  groups and cadence. The workflows pin their actions by commit SHA, have a
  time limit per job, read-only permissions and pinned runner images, run
  once per pull request, and one of them builds the `Dockerfile` without
  pushing.
* **Legacy files removed and the README matched to the code.** `LICENSE` is
  the verbatim Apache-2.0 text, with the copyright line and the note on the
  plugin's licence in `NOTICE`.
* **`API_PROMPT.md` is checked against the code.** The API reference for
  agents was corrected, and a test fails when the routes, the query
  parameters or the headers of the reindex call it names differ from the
  sidecar.
* **Contribution guide, security policy and code of conduct.**
  `CONTRIBUTING.md` says how to run the checks CI runs and how the one
  version in `app/package.json` reaches the plugin, `SECURITY.md` how to
  report a vulnerability privately, `CODE_OF_CONDUCT.md` what is expected of
  everyone taking part. Contributions are signed off on every commit (DCO);
  there is no contributor license agreement. Issues and pull requests start
  from templates, and this changelog is kept from here on.

## 1.3.7

* **The plugin sees a new sidecar's plugin at the next update check.** The
  check asks the sidecar for its update manifest every time, instead of
  reading a copy cached for six hours.

## 1.3.6

* Dependency updates of the sidecar (dotenv, mysql2).

## 1.3.5

* Dependency updates of the sidecar (Express 5.3, dotenv 18, mysql2).

### Project

* The sidecar's database layer is tested against a real MySQL, in a CI job of
  its own.

## 1.3.4

* **The plugin's own calls to the sidecar follow `WORDPRESS_IDX_BASE`.** The
  index rebuild from the settings page uses the same base URL as the update
  check, so both work where the site's public URL cannot be reached from
  inside WordPress.
* **The settings page shows why an update check failed**, with the endpoint
  it asked and the installed and the offered version.

## 1.3.3

* Dependency update of the sidecar (mysql2).

## 1.3.2

* **The update manifest describes the plugin the sidecar ships.** Version and
  WordPress compatibility are read from the bundled plugin's own header and
  `readme.txt`, and the manifest answers 503 when no plugin is bundled. 1.3.1
  offered WordPress an update it then did not contain.
* The plugin is declared as tested with WordPress 7.1.

## 1.3.1

* Dependency update of the sidecar (mysql2).

## 1.3.0

* **The sidecar ships the WordPress plugin.** The image bundles the plugin
  and serves it under `/plugin/`, and the plugin updates itself from its
  sidecar through WordPress' own update mechanism. `PLUGIN_AUTO_UPDATE=false`
  leaves the installation of updates to the administrator.
* **One version for the sidecar and the plugin**, taken from
  `app/package.json`. Before, the plugin was at 1.2.0 and the sidecar's
  last tag was 0.1.11.
* The sidecar runs on Express 5 and the image on Node.js 26.
