#!/usr/bin/env bash
# Runs the database security test-suite.
#
#   DATABASE_URL set   -> uses that database (must be disposable!). If it is a
#                         local Supabase stack (`supabase start`, port 54322),
#                         migrations are already applied: set SKIP_MIGRATIONS=1.
#   DATABASE_URL unset -> starts a throwaway PostgreSQL cluster with initdb,
#                         applies the Supabase shim + migrations, runs tests,
#                         and deletes the cluster.
set -euo pipefail
cd "$(dirname "$0")/.."

cleanup() { :; }
trap 'cleanup' EXIT

if [[ -z "${DATABASE_URL:-}" ]]; then
  PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
  [[ -x "$PG_BIN/initdb" ]] || { echo "PostgreSQL server binaries not found; set PG_BIN or DATABASE_URL" >&2; exit 1; }
  TMP="$(mktemp -d)"
  PORT="${PGPORT_TEST:-55432}"
  RUN_AS=()
  if [[ "$(id -u)" == "0" ]]; then
    chown -R postgres "$TMP"; RUN_AS=(runuser -u postgres --)
  fi
  "${RUN_AS[@]}" "$PG_BIN/initdb" -D "$TMP/data" -U postgres --auth=trust >/dev/null
  "${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=127.0.0.1" -l "$TMP/log" -w start >/dev/null
  cleanup() { "${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
  export DATABASE_URL="postgresql://postgres@127.0.0.1:$PORT/postgres"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f tests/db/supabase-shim.sql
fi

if [[ -z "${SKIP_MIGRATIONS:-}" ]]; then
  for f in supabase/migrations/*.sql; do
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
  done
fi

npx vitest run tests/db
