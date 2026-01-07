#!/bin/bash
set -e

# E2E Test Runner
# Orchestrates the test environment: starts QuestDB, seeds data, and runs Playwright

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "🚀 Starting E2E test environment..."

# Cleanup function
cleanup() {
  echo ""
  echo "🧹 Cleaning up test environment..."
  cd "${ROOT_DIR}"
  docker compose -f docker-compose.e2e.yml down -v 2>/dev/null || true
  exit_code=$?
  if [ $exit_code -eq 0 ]; then
    echo "✅ Cleanup completed"
  fi
  exit $exit_code
}

# Set trap to cleanup on exit
trap cleanup EXIT INT TERM

cd "${ROOT_DIR}"

# Start QuestDB E2E instance
echo "🐳 Starting QuestDB E2E instance..."
docker compose -f docker-compose.e2e.yml up -d

# Wait for QuestDB to be healthy
echo "⏳ Waiting for QuestDB to be healthy..."
max_retries=30
retry_count=0
until docker compose -f docker-compose.e2e.yml ps | grep -q "healthy"; do
  retry_count=$((retry_count + 1))
  if [ $retry_count -ge $max_retries ]; then
    echo "❌ QuestDB did not become healthy after ${max_retries} attempts"
    docker compose -f docker-compose.e2e.yml logs questdb-e2e
    exit 1
  fi
  echo "   Attempt ${retry_count}/${max_retries}..."
  sleep 2
done

echo "✅ QuestDB is healthy"

# Seed the database
echo "🌱 Seeding test database..."
export DB_HOST=localhost
export DB_PORT=9100
"${SCRIPT_DIR}/seed-test-db.sh"

echo "✅ Test environment ready"

# Run Playwright tests
echo ""
echo "🎭 Running Playwright E2E tests..."
echo ""

# Set environment variables for server to use test database
export DB_HOST=localhost
export DB_PORT=9100
export DB_PROTOCOL=http
export DB_AUTO_FLUSH_ROWS=100
export DB_AUTO_FLUSH_INTERVAL=1000
export DB_REQUEST_TIMEOUT=10000
export DB_RETRY_TIMEOUT=1000
export WAN_MONITOR_PASSWORD=""  # Disable auth for tests
export QUESTDB_AVAILABLE=true

# Run Playwright with all environment variables
pnpm test:e2e "$@"

echo ""
echo "✅ E2E tests completed successfully!"
