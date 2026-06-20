#!/bin/sh
# Build and push a new version to Docker Hub.
# Run this from the project root after making changes.
#
# Usage:
#   ./publish.sh           → builds and pushes :latest
#   ./publish.sh 1.2.3     → also tags as :1.2.3
#
# After pushing, update the NAS with:
#   docker-compose -f docker-compose.nas.yml pull
#   docker-compose -f docker-compose.nas.yml up -d

IMAGE="marstonstudio/rail-trail-tracker"
TAG="${1:-latest}"

set -e

echo "→ Building $IMAGE:latest ..."
docker build -t "$IMAGE:latest" .

if [ "$TAG" != "latest" ]; then
  echo "→ Tagging as $IMAGE:$TAG ..."
  docker tag "$IMAGE:latest" "$IMAGE:$TAG"
fi

echo "→ Pushing to Docker Hub ..."
docker push "$IMAGE:latest"

if [ "$TAG" != "latest" ]; then
  docker push "$IMAGE:$TAG"
fi

echo "✓ Done. Update the NAS:"
echo "    docker-compose -f docker-compose.nas.yml pull"
echo "    docker-compose -f docker-compose.nas.yml up -d"
