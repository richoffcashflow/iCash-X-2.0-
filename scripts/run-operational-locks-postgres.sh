#!/usr/bin/env bash
set -euo pipefail
# Uses already-installed official test binaries only. Isolated localhost database.
PG_BIN=/tmp/icash-pg-review/root/usr/lib/postgresql/17/bin
export OPERATIONAL_NATIVE_TEST=1
export NODE_PATH=/tmp/icash-pg-review/root/usr/share/nodejs
DATA=$(mktemp -d /tmp/icash-operational-locks.XXXXXX)
cleanup() { "$PG_BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; }
trap cleanup EXIT
"$PG_BIN/initdb" -D "$DATA" -A trust --no-locale > "$DATA-init.log"
"$PG_BIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" -o "-c unix_socket_directories= -c listen_addresses=127.0.0.1 -p 55442" start >/dev/null
if [[ "${1:-locks}" == "voice" ]]; then
  node --experimental-strip-types "$(dirname "$0")/test-operational-voice-eligibility-pglite.mjs" "$(cd "$(dirname "$0")/.." && pwd)/tests/helpers/operational-native-db.mjs"
elif [[ "${1:-locks}" == "campaign" ]]; then
  node --experimental-strip-types "$(dirname "$0")/test-self-service-campaigns-pglite.mjs" "$(cd "$(dirname "$0")/.." && pwd)/tests/helpers/operational-native-db.mjs"
elif [[ "${1:-locks}" == "locks" ]]; then
  node --experimental-strip-types "$(dirname "$0")/test-operational-locks-postgres.mjs"
else
  echo "Use locks, voice, or campaign" >&2; exit 1
fi
