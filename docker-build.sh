#!/bin/bash

# Builds the sidecar image for the host architecture and loads it into the
# local Docker daemon, to try a change. It publishes nothing.
#
# Released images are built, signed and published by the release of
# wordpress-nginx (https://github.com/ioanalytica/wordpress-nginx), from the
# commit of this repository it pins as a submodule. An image pushed from here
# would be unsigned and could take a tag that a release sets.
refuse_push() {
  echo "ERROR: this script does not push. Released images of wordpress-idx are built," >&2
  echo "signed and published by the release of wordpress-nginx:" >&2
  echo "https://github.com/ioanalytica/wordpress-nginx#verify-a-release" >&2
  exit 1
}

# PUSH=1 and --push used to build for two platforms and push the image.
case "${PUSH:-0}" in
  0|"") ;;
  *) refuse_push ;;
esac
# Skip the confirmation prompt when CI=1 or ASSUME_YES=1; -y/--yes overrides ENV.
ASSUME_YES="${ASSUME_YES:-0}"
if [ "${CI:-0}" = "1" ] || [ "${CI:-}" = "true" ]; then ASSUME_YES=1; fi
for arg in "$@"; do
  case "$arg" in
    --push)     refuse_push ;;
    --no-push)  ;; # the only mode there is; accepted for callers that pass it
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

# A name without a registry: the image stays local, and a plain `docker push`
# of it cannot reach the tags the release of wordpress-nginx sets.
IMAGE="wordpress-idx:${TAG}"

if [ "$ASSUME_YES" = "1" ]; then
  echo "Build for the host architecture, tag ${TAG} (ASSUME_YES — no prompt)."
else
  read -r -p "Build for the host architecture, tag ${TAG} (y/N)? " REPLY
  if [[ ! "$REPLY" =~ ^[yY]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

echo "Linting Dockerfile …"
hadolint Dockerfile

echo "Building ${IMAGE} …"
# Without --platform buildx builds for the host architecture, and --load puts
# the image into the local Docker daemon.
docker buildx build --no-cache --pull -t "${IMAGE}" . --load

# end
