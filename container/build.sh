#!/bin/bash
# Build the Mercury agent container image
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

IMAGE_NAME="mercury-agent"
TAG="${1:-latest}"

echo "Building Mercury agent container image..."
echo "Image: ${IMAGE_NAME}:${TAG}"

docker build -f container/Dockerfile -t "${IMAGE_NAME}:${TAG}" .

echo ""
echo "Build complete: ${IMAGE_NAME}:${TAG}"
