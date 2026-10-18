#!/bin/sh
# Boots a built image and waits for /api/health/ready, which fails until QuestDB
# is connected and migrations have finished (/api/health/live passes without a
# database). Probes run inside the container, so no host port is published.
#
# Usage: docker-smoke.sh <image> [timeout-seconds]
# CONTAINER_NAME overrides the container name (default: wan-monitor-smoke-<pid>).

set -eu

image=${1:?usage: docker-smoke.sh <image> [timeout-seconds]}
timeout=${2:-120}
name=${CONTAINER_NAME:-wan-monitor-smoke-$$}
base_url="http://127.0.0.1"

id=""
cleanup() {
  if [ -n "$id" ]; then
    docker rm -f -v "$id" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

fail() {
  echo "docker-smoke: $1" >&2
  echo "docker-smoke: container logs follow" >&2
  docker logs "$id" >&2 || true
  exit 1
}

probe() {
  docker exec "$id" curl -fsS --max-time 5 -o /dev/null "${base_url}$1" 2>/dev/null
}

id=$(docker run -d --name "$name" "$image")

start=$(date +%s)
deadline=$((start + timeout))
until probe /api/health/ready; do
  if [ "$(docker inspect -f '{{.State.Running}}' "$id")" != "true" ]; then
    fail "container exited before /api/health/ready answered"
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    fail "/api/health/ready did not answer within ${timeout}s"
  fi
  sleep 2
done

probe /api/health/live ||
  fail "/api/health/live failed after /api/health/ready answered"

echo "docker-smoke: ready after $(($(date +%s) - start))s"
