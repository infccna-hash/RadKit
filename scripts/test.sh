#!/usr/bin/env bash
# Run the whole test-suite with one command.
#   ./scripts/test.sh          → in Docker (nothing to install but Docker)
#   ./scripts/test.sh --local  → on this machine (needs Node 20+, python3 + pydicom + numpy, and TEST_DATABASE_URL)
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${1:-}" = "--local" ]; then
  (cd api && npm ci --silent)
  (cd tests && npm ci --silent && node --test)
  exit $?
fi

COMPOSE="docker compose -f tests/docker-compose.test.yml"
trap '$COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true' EXIT
$COMPOSE build tests
$COMPOSE run --rm tests
