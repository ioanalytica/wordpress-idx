#!/bin/bash

set -euo pipefail

RAW="$(
  grep -m1 -E '^version:[[:space:]]*' ../chart/Chart.yaml \
  | sed -E 's/^version:[[:space:]]*"?([^"#\r]+)"?.*/\1/' \
  | tr -d '\r'
)"

if [ -z "${RAW:-}" ]; then
  echo "ERROR: could not read chart version from ../chart/Chart.yaml"
  exit 1
fi

# Docker tag friendly (no '+')
TAG="${RAW//+/-}"

PROD_IMAGE="harbor.ioanalytica.com/wordpress/wordpress-idx:${TAG}"

# docker login harbor.ioanalytica.com
docker buildx build --platform linux/amd64,linux/arm64 -f Dockerfile -t ${PROD_IMAGE} --push --pull ..

# end
