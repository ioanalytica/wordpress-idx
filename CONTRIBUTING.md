# Contributing to wordpress-idx

Thanks for helping. Bug reports, questions and pull requests are all welcome.

## Where things go

- **Bugs and feature requests**: [open an issue](https://github.com/ioanalytica/wordpress-idx/issues/new/choose).
  For a bug, the version and the part it is in (the sidecar's search API or
  the WordPress plugin) usually decide where to look.
- **Questions and ideas**: [Discussions](https://github.com/ioanalytica/wordpress-idx/discussions).
- **Security issues**: never in a public issue — see [SECURITY.md](SECURITY.md).
- **The Helm chart** that runs the sidecar next to WordPress is
  [wordpress-nginx](https://github.com/ioanalytica/wordpress-nginx). How the
  sidecar is deployed (values, ingress, probes) is decided there, and so are
  changes to it.

## What is where

| Path | What it holds |
|---|---|
| `app/` | The sidecar: Node.js, Express and FlexSearch. `src/` is the service, `test/` its `node:test` suite |
| `plugin/wordpress-idx-search/` | The WordPress plugin: PHP, plain JavaScript and CSS, with its PHPUnit tests in `tests/` |
| `scripts/sync-version.sh` | Writes the version into the plugin, see [Versions](#versions) |
| `API_PROMPT.md` | The API reference for agents that use the index; it follows every change to the API |
| `Dockerfile`, `docker-build.sh` | The sidecar image, which bundles the plugin. The release of wordpress-nginx builds it from the `Dockerfile`, see [Releases](#releases); the script builds it locally |
| `.github/renovate.json` | What Renovate updates, see [Dependency updates](#dependency-updates) |

## Running the checks

CI runs the checks below on every pull request and on `main`
(`.github/workflows/`). All of them run locally; each block of commands
starts in the repository root.

### Sidecar tests

```sh
cd app
npm ci
npm test
```

CI runs them on Node.js 24. This run needs no database: the tests of the
database layer are skipped and say so. One of the tests reads
[`API_PROMPT.md`](API_PROMPT.md) and fails when the routes, the query
parameters or the headers of the reindex call it names differ from the code,
so a change to the API changes that file in the same pull request.

To run those too, as the CI job "test (with MySQL)" does, give the suite a
MySQL it may write to:

```sh
docker run --rm -d --name idx-test-mysql -p 127.0.0.1:3306:3306 \
  -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=wordpress_idx_test mysql:8.0
cd app
IDX_TEST_DB=1 npm test          # once MySQL accepts connections
```

The connection comes from `IDX_TEST_DB_HOST`, `IDX_TEST_DB_PORT`,
`IDX_TEST_DB_USER`, `IDX_TEST_DB_PASS` and `IDX_TEST_DB_NAME`; the defaults
match the container above. The app's own `DB_*` variables are not read, and
the suite creates and drops its tables under a prefix of its own. Give it a
throwaway database all the same. `docker stop idx-test-mysql` removes the
container; the plugin's PHPUnit run below can use it first.

### Plugin: PHPCS and PHPUnit

```sh
cd plugin/wordpress-idx-search
composer install
composer lint       # PHPCS with the WordPress coding standards
composer format     # phpcbf, fixes what it can
```

PHPUnit runs the plugin inside the WordPress test suite, which needs a MySQL
or MariaDB and is installed once, into the temporary directory:

```sh
cd plugin/wordpress-idx-search
bash bin/install-wp-tests.sh wordpress_test root root 127.0.0.1:3306 latest
composer test
```

The arguments are the database name, user, password, host and the WordPress
version. The script downloads WordPress and its test library and creates the
database, for which it needs `mysqladmin`. The MySQL container of the
sidecar tests serves here too while it runs, with MySQL's own client;
MariaDB's `mariadb-admin` cannot log in to MySQL 8.0 and wants a MariaDB
server.

CI runs PHPUnit on PHP 7.4 and 8.2 and PHPCS on 8.2. The plugin supports
PHP 7.4, so its code stays within what 7.4 understands.

### Plugin assets

```sh
cd plugin/wordpress-idx-search
npm ci
npm run lint            # ESLint and Stylelint
npm run format:check    # Prettier; npm run format rewrites the files
```

### Version check

```sh
bash scripts/sync-version.sh --check
```

### Image build

CI builds the `Dockerfile` on every pull request, for one platform and
without pushing anything (the check "Dockerfile build"). Locally:

```sh
./docker-build.sh       # needs Docker with buildx, and hadolint
```

The script loads the image into the local Docker daemon as
`wordpress-idx:<version>`. It cannot push.

## Versions

The repository has one version: `version` in `app/package.json`. The sidecar
and the plugin both carry it.

`scripts/sync-version.sh` writes it where it is repeated: the `Version:` header
and the `VERSION` constant in `wordpress-idx-search.php`, `Stable tag:` in the
plugin's `readme.txt`, and `app/package-lock.json`. With `--check` it changes
nothing and fails when one of them differs; CI runs that on every pull
request.

- A pull request leaves the version alone. It is bumped when a release is
  made, see [Releases](#releases).
- The version never goes backwards. The sidecar serves the plugin it was built
  with, and WordPress installs it only when its version is higher than the
  installed one.
- Never edit the repeated places by hand; run the script.

## Releases

A version of wordpress-idx is made here; its image is published by
[wordpress-nginx](https://github.com/ioanalytica/wordpress-nginx).

In this repository, a release is a pull request that

1. sets `version` in `app/package.json` and runs `scripts/sync-version.sh`,
2. turns `## Unreleased` in [`CHANGELOG.md`](CHANGELOG.md) into the heading
   of that version, so that no line is left under `## Unreleased` when it is
   merged.

It is a pull request of its own, or the one that brings the version's last
change, with the two steps as its last commit.

The maintainer may mark the merged commit with a git tag of the version,
without a prefix (`1.3.7`). The tag is a marker and nothing more: no workflow
runs on it, and no git tag in this repository builds or publishes anything.
Only the maintainer can create, move or delete tags.

The image follows from wordpress-nginx, which has this repository as a git
submodule:

1. A pull request there moves the submodule pin to the released commit, by
   hand, with a line in the chart's changelog. Renovate does not move it.
2. The next release of wordpress-nginx builds the image from the pinned
   commit, signs it and publishes it as `ghcr.io/ioanalytica/wordpress-idx`
   under the chart version, and moves `latest` to it. The first release that
   builds a new wordpress-idx version also sets the tag of that version
   (`1.x.y`) on its image, once.

Until the pin has moved and that release is out, users run the version
before. The README says how to
[verify an image](README.md#verify-an-image) and which tags are this
repository's own earlier, unsigned builds.

Do not push an image to `ghcr.io/ioanalytica/wordpress-idx` by hand: it
would be unsigned, and a tag it takes is not set again by a release.

## Dependency updates

[Renovate](https://docs.renovatebot.com/) opens the update pull requests;
`.github/renovate.json` is its configuration, and the workflow "Renovate
config" validates the file when a pull request changes it.

| What | When | How |
|---|---|---|
| The sidecar's npm packages (`app/`) | weekly | minor and patch updates in one pull request, a new major in one of its own |
| The base images of the `Dockerfile` | weekly | one pull request each |
| The plugin's linters (npm) | monthly | one pull request, majors included |
| The plugin's PHP development tools (Composer) | monthly | one pull request, majors included; PHPUnit stays on 9, the last series that runs on PHP 7.4 |
| The workflows: actions, runner images, the Node.js they set up, service containers | monthly | one pull request, majors included |

Actions are pinned by their commit SHA with the version as a comment, and
Renovate keeps both in step. An update of the sidecar's packages or of a base
image changes the image, so its pull request gets a line under
`## Unreleased` in `CHANGELOG.md` before it is merged. Renovate's commits
carry the sign-off line. The issue "Dependency Dashboard" lists what is
pending and what waits for an approval there: a new MySQL series for the test
jobs, and a new commit under an action's unchanged version.

## Pull requests

A pull request is easiest to review when it:

- covers one change, with a test that fails without it — `app/test/*.test.js`
  for the sidecar, `plugin/wordpress-idx-search/tests/test-*.php` for the
  plugin;
- updates `README.md` and `API_PROMPT.md` when an endpoint, a query parameter
  or a response changes, and `README.md` and `.env.example` for a new
  environment variable;
- adds an entry under `## Unreleased` in [`CHANGELOG.md`](CHANGELOG.md), with
  that heading if it is not there yet, for anything a user of the sidecar or
  the plugin notices;
- pins a new GitHub Action by its commit SHA, with the version as a comment,
  and gives a new job a `timeout-minutes` and a pinned runner image, as the
  existing workflows do;
- uses the commit style of the history: `feat: …`, `fix(plugin): …`,
  `test: …`, `docs: …`, `ci: …`, with the reason in the body. The pull
  request's title follows the same style;
- has every commit signed off, see below.

Code, comments, documentation and commit messages are in English.

## Sign your commits (DCO)

Every commit must carry a `Signed-off-by` line, certifying the
[Developer Certificate of Origin](https://developercertificate.org/): that you
wrote the change or otherwise have the right to submit it under the license of
the part it changes. `git commit -s` adds the line from your git name and
e-mail.

There is no contributor license agreement.

## License

wordpress-idx is licensed under the [Apache License 2.0](LICENSE), except the
WordPress plugin in `plugin/`, which is licensed under the
[GNU General Public License v2.0 or later](plugin/wordpress-idx-search/LICENSE),
as WordPress requires of plugins. A contribution is accepted under the license
of the part it changes.

## Conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
