=== WordPress IDX Search ===
Contributors: ioanalytica
Tags: search, fulltext, full-text, flexsearch, idx
Requires at least: 5.0
Tested up to: 6.7
Stable tag: 1.2.0
Requires PHP: 7.4
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Full-text search interface for the wordpress-idx sidecar API.

== Description ==

WordPress IDX Search provides a powerful full-text search form for your WordPress site, powered by a [FlexSearch](https://github.com/nextapps-de/flexsearch) sidecar API.

**Features:**

* Full-text search across all posts and pages
* Filter by type, author, category, tag, and date range
* Optional comment search
* Context snippet mode with search term highlighting
* Exact phrase search using quotes (Google-style: `"search phrase"`)
* Expandable result list sorted by date
* Multilingual UI (German, English, French, Spanish)
* Admin settings for language selection, API key, and index rebuild
* Lightweight — no external dependencies on the frontend

**How it works:**

The plugin connects to the [wordpress-idx](https://github.com/ioanalytica/wordpress-idx) sidecar API, which runs as a companion container alongside your WordPress installation. The sidecar extracts content from your WordPress database, builds a FlexSearch index, and exposes a REST API for searching.

**Usage:**

Place the HTML comment `<!-- wordpress-idx-search -->` in any post or page content. The plugin replaces it with the full search form and results area.

== Installation ==

1. Upload the `wordpress-idx-search` folder to `/wp-content/plugins/`.
2. Activate the plugin through the "Plugins" menu in WordPress.
3. Ensure the wordpress-idx sidecar is running and accessible at `/idx/` on your domain.
4. Go to **Settings > IDX Search** to configure the language and API key.
5. Create a page and add `<!-- wordpress-idx-search -->` to its content.

== Frequently Asked Questions ==

= What is the wordpress-idx sidecar? =

It is a lightweight Node.js application that extracts your WordPress content, builds a FlexSearch full-text index, and provides a search API. It is designed to run as a sidecar container in a Kubernetes pod alongside WordPress.

= How do I trigger a reindex? =

Go to **Settings > IDX Search** in the WordPress admin. Enter your Reindex API key and click "Rebuild index". The sidecar will re-extract all content from the database and rebuild the search index.

= Can editors use the admin settings? =

Editors can change the UI language and trigger a reindex. Only administrators can modify the API key.

= How does phrase search work? =

Wrap your search term in double quotes, e.g. `"Benjamin Stein"`. This ensures only results containing the exact phrase are returned — just like Google search.

= Which languages are supported? =

The search UI is available in German, English, French, and Spanish. The language can be changed in **Settings > IDX Search**.

== Screenshots ==

1. Search form with filters and options
2. Search results with expandable entries and highlighted terms
3. Admin settings page

== Changelog ==

= 1.2.0 =
* Added exact phrase search with double quotes (Google-style)
* Client-side and server-side phrase filtering
* Whitespace-normalized phrase matching

= 1.1.0 =
* Left-aligned form labels, removed form title
* Results sorted by date (ascending)
* Form width adapts to parent container
* Author link in plugin listing
* Context mode filters comments without matches
* HTML stripping for content display
* Settings link in plugin listing

= 1.0.0 =
* Initial release
* Full-text search form with all API options
* Filter by type, author, category, tag, date range
* Context snippet mode
* Comment search
* Multilingual UI (DE, EN, FR, ES)
* Admin settings for language, API key, and reindex

== Upgrade Notice ==

= 1.2.0 =
Adds Google-style exact phrase search. Wrap your query in double quotes for precise matching.
