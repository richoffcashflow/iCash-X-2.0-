#!/usr/bin/env bash
set -euo pipefail
PG_BIN=/tmp/icash-pg-review/root/usr/lib/postgresql/17/bin
export OWNER_RECORDING_NATIVE_TEST=1
export NODE_PATH=/tmp/icash-pg-review/root/usr/share/nodejs
DATA=$(mktemp -d /tmp/icash-owner-recording-native.XXXXXX)
cleanup(){ "$PG_BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; }
trap cleanup EXIT
"$PG_BIN/initdb" -D "$DATA" -A trust --no-locale >"$DATA-init.log"
"$PG_BIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" -o '-c unix_socket_directories= -c listen_addresses=127.0.0.1 -p55446' start >/dev/null
export OWNER_RECORDING_NATIVE_TEST=1
node --experimental-strip-types scripts/test-owner-recording-test-pglite.mjs "$(cd "$(dirname "$0")/.." && pwd)/tests/helpers/owner-recording-native-db.mjs"
