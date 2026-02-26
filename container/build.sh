#!/bin/bash
# Build the Clawbber agent container image
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

IMAGE_NAME="clawbber-agent"
TAG="${1:-latest}"

echo "Building Clawbber agent container image..."
echo "Image: ${IMAGE_NAME}:${TAG}"

docker build -f container/Dockerfile -t "${IMAGE_NAME}:${TAG}" .

echo ""
echo "Build complete: ${IMAGE_NAME}:${TAG}"
