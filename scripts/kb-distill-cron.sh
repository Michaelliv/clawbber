#!/bin/bash
# KB Distillation cron wrapper
# Usage: Add to crontab: 0 * * * * /path/to/mercury/scripts/kb-distill-cron.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Source .env if exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

exec bun run src/cli/mercury.ts kb-distill
