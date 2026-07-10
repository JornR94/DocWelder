#!/usr/bin/env bash
# Builds and tags the Docwelder container image for the current VERSION.
#
# Intended release flow (task 12.3 — NOT executed by this script, since it
# requires real GHCR credentials this environment does not have):
#   1. CI checks out a version tag (vX.Y.Z) on the project's own release
#      pipeline (task 18).
#   2. This script builds and tags the image.
#   3. The release pipeline runs `docker push` for both tags below, using a
#      GHCR-scoped credential (e.g. GITHUB_TOKEN with packages:write) stored
#      as a CI secret — provisioning that credential/org is a prerequisite
#      the project maintainer must set up before the first real release.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

VERSION="$(cat VERSION)"
IMAGE="ghcr.io/jornr94/docwelder"

echo "Building ${IMAGE}:${VERSION} ..."
docker build -t "${IMAGE}:${VERSION}" -t "${IMAGE}:latest" .

echo "Built ${IMAGE}:${VERSION} and ${IMAGE}:latest (not pushed — see header comment)."
