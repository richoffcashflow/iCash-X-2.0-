#!/usr/bin/env bash
set -euo pipefail
# Uses existing official PostgreSQL binaries only; no installation or network.
PG_BIN=${PG_BIN:-/tmp/icash-pg-review/root/usr/lib/postgresql/17/bin}
export NODE_PATH="/tmp/icash-pg-review/root/usr/share/nodejs${NODE_PATH:+:$NODE_PATH}"
export PG_MODULE=${PG_MODULE:-/tmp/icash-pg-review/root/usr/share/nodejs/pg}
export QUEUE_TEST_PORT=${QUEUE_TEST_PORT:-55441}
export QUEUE_TEST_LOCAL=1
DATA=$(mktemp -d /tmp/icash-outbound-queue-test.XXXXXX)
cleanup() { "$PG_BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; }
trap cleanup EXIT
"$PG_BIN/initdb" -D "$DATA" -A trust --no-locale > "$DATA-init.log"
"$PG_BIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" -o "-c unix_socket_directories= -c listen_addresses=127.0.0.1 -p $QUEUE_TEST_PORT" start >/dev/null
node "$(dirname "$0")/test-outbound-billing-queue-postgres.mjs"
