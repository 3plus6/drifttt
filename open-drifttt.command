#!/bin/zsh
set -e

cd "$(dirname "$0")"

echo "Starting drifttt..."
echo "Project: $(pwd)"
echo ""

npm run dev
