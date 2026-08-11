#!/bin/bash

# Determine push mode: ENV default (compatible with sub-script calls); a flag overrides ENV.
PUSH="${PUSH:-0}"
# Skip the confirmation prompt when CI=1 or ASSUME_YES=1; -y/--yes overrides ENV.
ASSUME_YES="${ASSUME_YES:-0}"
if [ "${CI:-0}" = "1" ] || [ "${CI:-}" = "true" ]; then ASSUME_YES=1; fi
for arg in "$@"; do
  case "$arg" in
    --push)     PUSH=1 ;;
    --no-push)  PUSH=0 ;;
    -y|--yes)   ASSUME_YES=1 ;;
    *) echo "WARN: ignoring unknown argument '$arg'" >&2 ;;
  esac
done

# Derive the version from the single source of truth: app/package.json.
RAW="$(
  grep -m1 -E '"version"[[:space:]]*:' app/package.json \
  | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' \
  | tr -d '\r'
)"

if [ -z "${RAW:-}" ]; then
  echo "ERROR: could not read version from app/package.json"
  exit 1
fi

# Docker tag friendly (no '+')
TAG="${RAW//+/-}"

echo "Using tag: $TAG"

PROD_IMAGE="ghcr.io/ioanalytica/wordpress-idx:${TAG}"

# Mode label: push builds multi-arch, local builds host-arch only (--load cannot
# load a multi-arch manifest list into the local Docker daemon).
if [ "$PUSH" = "1" ]; then
  MODE_LABEL="push (multi-arch amd64+arm64)"
else
  MODE_LABEL="local (host arch, --load)"
fi

if [ "$ASSUME_YES" = "1" ]; then
  echo "Build ${MODE_LABEL} for tag ${TAG} (ASSUME_YES — no prompt)."
else
  read -r -p "Build ${MODE_LABEL} for tag ${TAG} (y/N)? " REPLY
  if [[ ! "$REPLY" =~ ^[yY]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

echo "Linting Dockerfile …"
hadolint Dockerfile

echo "Building ${PROD_IMAGE} …"
if [ "$PUSH" = "1" ]; then
  # Multi-arch only on push — the registry holds the manifest list.
  docker buildx build --no-cache --pull --platform linux/amd64,linux/arm64 -t "${PROD_IMAGE}" . --push
else
  # Local: without --platform buildx builds for the host arch and --load loads the
  # single-arch image into the local Docker daemon (multi-arch + --load is unsupported).
  docker buildx build --no-cache --pull -t "${PROD_IMAGE}" . --load
fi

# end
