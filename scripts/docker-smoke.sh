#!/bin/sh
# Boots a built image and waits for /api/health/ready, which fails until QuestDB
# is connected and migrations have finished (/api/health/live passes without a
# database). Then checks, from inside the container (no host port is published):
# - nginx sends exactly one copy of each security header on pages, assets, API
#   answers and error responses, and never forwards `Upgrade` or `Connection`
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

response_headers() {
  docker exec "$id" curl -sS --max-time 5 -o /dev/null -D - "${base_url}$1" | tr -d '\r'
}

expect_security_headers() {
  path=$1
  want_status=$2
  headers=$(response_headers "$path") || fail "GET $path failed"
  status=$(printf '%s\n' "$headers" | sed -n '1s/^HTTP\/[0-9.]* \([0-9]*\).*/\1/p')
  [ "$status" = "$want_status" ] ||
    fail "GET $path answered ${status:-nothing}, expected $want_status"
  for header in "X-Content-Type-Options: nosniff" "X-Frame-Options: SAMEORIGIN"; do
    count=$(printf '%s\n' "$headers" | grep -ci "^${header}\$" || true)
    [ "$count" = "1" ] ||
      fail "GET $path sent '$header' $count times, expected once"
  done
  if printf '%s\n' "$headers" | grep -qi '^X-XSS-Protection:'; then
    fail "GET $path sent the deprecated X-XSS-Protection header"
  fi
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

asset=$(docker exec "$id" curl -fsS --max-time 5 "${base_url}/" |
  grep -o '/assets/[^"]*\.js' | head -n 1 || true)
[ -n "$asset" ] || fail "/ does not reference a /assets/*.js file"

expect_security_headers / 200
expect_security_headers "$asset" 200
expect_security_headers /api/health/live 200
expect_security_headers /assets/does-not-exist.js 404
expect_security_headers /api/does-not-exist 404

# A client cannot see which headers nginx sends upstream, so check the config.
conf=$(docker exec "$id" nginx -T 2>/dev/null) || fail "nginx -T failed"
if printf '%s\n' "$conf" |
  grep -Eqi 'proxy_set_header[[:space:]]+(Upgrade|Connection)[[:space:]]'; then
  fail "nginx still sets an Upgrade or Connection header on proxied requests"
fi

echo "docker-smoke: security headers and proxy headers ok"
