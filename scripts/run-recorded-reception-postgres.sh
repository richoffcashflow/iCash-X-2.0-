#!/usr/bin/env bash
set -euo pipefail
# Official PostgreSQL17 binaries already installed in this local review workspace.
# Disposable localhost-only synthetic fixture. No package install or provider use.
# The helper accepts ONLY localhost:55442; refuse to touch an existing server.
PG_BIN=/tmp/icash-pg-review/root/usr/lib/postgresql/17/bin
export OPERATIONAL_NATIVE_TEST=1
export NODE_PATH=/tmp/icash-pg-review/root/usr/share/nodejs
if "$PG_BIN/pg_isready" -h 127.0.0.1 -p 55442 >/dev/null 2>&1; then
 echo 'Port55442 is in use; refusing to reuse an existing database.' >&2; exit 1
fi
DATA=$(mktemp -d /tmp/icash-recorded-reception-pg.XXXXXX)
cleanup() { "$PG_BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; }
trap cleanup EXIT
"$PG_BIN/initdb" -D "$DATA" -A trust --no-locale > "$DATA-init.log"
"$PG_BIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" -o "-c unix_socket_directories= -c listen_addresses=127.0.0.1 -p 55442" start >/dev/null
ROOT=$(cd "$(dirname "$0")/.." && pwd)
node --experimental-strip-types "$ROOT/scripts/test-recorded-reception-pglite.mjs" "$ROOT/tests/helpers/operational-native-db.mjs"
