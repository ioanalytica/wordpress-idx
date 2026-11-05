# Security policy

## Reporting a vulnerability

Report it privately through GitHub:
[**Report a vulnerability**](https://github.com/ioanalytica/wordpress-idx/security/advisories/new)
(the Security tab of this repository). Please do not open a public issue,
discussion or pull request for a vulnerability that is not public yet.

A useful report names the version, the part it is in (the sidecar or the
plugin), the configuration it needs and what an attacker gains. We confirm the
report, keep you informed while we work on it, and credit you in the advisory
unless you prefer otherwise.

## Supported versions

Fixes go into the next version; there are no backports to older ones. The
sidecar and the plugin share one version, so upgrade both to the latest one
(the highest [tag](https://github.com/ioanalytica/wordpress-idx/tags)) to
receive them.

## Scope

This policy covers what this repository holds:

- the **sidecar** in `app/`, with the search API it serves and the container
  image the `Dockerfile` builds;
- the **WordPress plugin** in `plugin/wordpress-idx-search`.

To judge a finding, it helps to know what is intended:

- The search, entry and statistics endpoints take no authentication. Whether
  they can be reached from outside is decided where the sidecar is deployed.
- `POST /api/reindex` takes an API key and is switched off while none is
  configured.

Not covered here:

- A vulnerability in **WordPress** itself belongs to
  [WordPress](https://wordpress.org/about/security/).
- The **Helm chart** that deploys the sidecar is
  [wordpress-nginx](https://github.com/ioanalytica/wordpress-nginx); a
  vulnerability in the chart is reported there.
- A known CVE in a third-party package, be it an npm or Composer dependency or
  a package of the image's base, is already public: a normal issue about it is
  fine.
