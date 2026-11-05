# Changelog

What changed in each version of wordpress-idx. The sidecar and the WordPress
plugin share one version; the entry of a version is its release notes.

## Unreleased

### Project

* **Contribution guide, security policy and code of conduct.**
  `CONTRIBUTING.md` says how to run the checks CI runs and how the one
  version in `app/package.json` reaches the plugin, `SECURITY.md` how to
  report a vulnerability privately, `CODE_OF_CONDUCT.md` what is expected of
  everyone taking part. Issues and pull requests start from templates, and
  this changelog is kept from here on.

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
