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
| `Dockerfile`, `docker-build.sh` | The sidecar image, which bundles the plugin |

## Running the checks

CI runs the checks below on every push and every pull request
(`.github/workflows/`). All of them run locally; each block of commands
starts in the repository root.

### Sidecar tests

```sh
cd app
npm ci
npm test
```

CI runs them on Node.js 24. This run needs no database: the tests of the
database layer are skipped and say so.

To run those too, as the CI job "test (with MySQL)" does, give the suite a
MySQL it may write to:

```sh
docker run --rm -d --name idx-test-mysql -p 127.0.0.1:3306:3306 \
  -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=wordpress_idx_test mysql:8.0
cd app
IDX_TEST_DB=1 npm test          # once MySQL accepts connections
docker stop idx-test-mysql
```

The connection comes from `IDX_TEST_DB_HOST`, `IDX_TEST_DB_PORT`,
`IDX_TEST_DB_USER`, `IDX_TEST_DB_PASS` and `IDX_TEST_DB_NAME`; the defaults
match the container above. The app's own `DB_*` variables are not read, and
the suite creates and drops its tables under a prefix of its own. Give it a
throwaway database all the same.

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
database, for which it needs `mysqladmin`. The MySQL container above serves
here too, with MySQL's own client; MariaDB's `mariadb-admin` cannot log in
to MySQL 8.0 and wants a MariaDB server.

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

## Versions

The repository has one version: `version` in `app/package.json`. The sidecar
and the plugin both carry it, and a release's git tag is that version, without
a prefix (`1.3.7`).

`scripts/sync-version.sh` writes it where it is repeated: the `Version:` header
and the `VERSION` constant in `wordpress-idx-search.php`, `Stable tag:` in the
plugin's `readme.txt`, and `app/package-lock.json`. With `--check` it changes
nothing and fails when one of them differs; CI runs that on every push.

- A pull request leaves the version alone. It is bumped when a release is
  made: `version` in `app/package.json`, then `scripts/sync-version.sh`, in one
  commit.
- The version never goes backwards. The sidecar serves the plugin it was built
  with, and WordPress installs it only when its version is higher than the
  installed one.
- Never edit the repeated places by hand; run the script.

## Pull requests

A pull request is easiest to review when it:

- covers one change, with a test that fails without it — `app/test/*.test.js`
  for the sidecar, `plugin/wordpress-idx-search/tests/test-*.php` for the
  plugin;
- updates `README.md` and `API_PROMPT.md` when an endpoint, a query parameter
  or a response changes, and `README.md` and `.env.example` for a new
  environment variable;
- adds an entry under `## Unreleased` in [`CHANGELOG.md`](CHANGELOG.md) for
  anything a user of the sidecar or the plugin notices;
- uses the commit style of the history: `feat: …`, `fix(plugin): …`,
  `test: …`, `docs: …`, `ci: …`, with the reason in the body. The pull
  request's title follows the same style.

Code, comments, documentation and commit messages are in English.

## License

wordpress-idx is licensed under the [Apache License 2.0](LICENSE), except the
WordPress plugin in `plugin/`, which is licensed under the
[GNU General Public License v2.0 or later](plugin/wordpress-idx-search/LICENSE),
as WordPress requires of plugins. A contribution is accepted under the license
of the part it changes.

## Conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
