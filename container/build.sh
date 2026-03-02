#!/bin/bash
# Build the Mercury agent container images
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

IMAGE_NAME="mercury-agent"

# Parse arguments
BUILD_ALL=false
BUILD_LATEST=false
BUILD_MINIMAL=false

if [ $# -eq 0 ]; then
    BUILD_LATEST=true
elif [ "$1" = "all" ]; then
    BUILD_ALL=true
elif [ "$1" = "latest" ]; then
    BUILD_LATEST=true
elif [ "$1" = "minimal" ]; then
    BUILD_MINIMAL=true
else
    echo "Usage: $0 [all|latest|minimal]"
    echo ""
    echo "Presets:"
    echo "  latest   Full devcontainer with Node, Python, Go, git (~2.8GB)"
    echo "  minimal  Bun + pi + browser only (~1.9GB)"
    echo "  all      Build both presets"
    echo ""
    echo "Default: latest"
    exit 1
fi

if [ "$BUILD_ALL" = true ] || [ "$BUILD_LATEST" = true ]; then
    echo "Building ${IMAGE_NAME}:latest (full devcontainer)..."
    docker build -f container/Dockerfile -t "${IMAGE_NAME}:latest" .
    echo "✓ Built ${IMAGE_NAME}:latest"
    echo ""
fi

if [ "$BUILD_ALL" = true ] || [ "$BUILD_MINIMAL" = true ]; then
    echo "Building ${IMAGE_NAME}:minimal (bun-only)..."
    docker build -f container/Dockerfile.minimal -t "${IMAGE_NAME}:minimal" .
    echo "✓ Built ${IMAGE_NAME}:minimal"
    echo ""
fi

echo "Build complete!"
if [ "$BUILD_ALL" = true ]; then
    echo "  ${IMAGE_NAME}:latest  - Full devcontainer (~2.8GB)"
    echo "  ${IMAGE_NAME}:minimal - Bun + pi + browser (~1.9GB)"
fi
