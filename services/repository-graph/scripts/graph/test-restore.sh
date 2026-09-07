#!/bin/sh
# Offline only: creates/drops a uniquely named scratch database, never the original volume.
set -eu
cd "$(dirname "$0")/../.."
docker compose -f compose.graph.yaml exec -T postgres sh -eu -c '
  umask 077
  scratch="arc_graph_restore_$$"
  backup="/tmp/$scratch.dump"
  trap '\''dropdb -U postgres --if-exists "$scratch" >/dev/null; rm -f "$backup"'\'' EXIT
  before=$(psql -U postgres -d arc_graph -Atc "SELECT (SELECT count(*) FROM arc_graph.nodes), (SELECT count(*) FROM arc_graph.edge_observations)")
  pg_dump -U postgres -d arc_graph -Fc -f "$backup"
  createdb -U postgres "$scratch"
  pg_restore -U postgres --exit-on-error -d "$scratch" "$backup"
  after=$(psql -U postgres -d "$scratch" -Atc "SELECT (SELECT count(*) FROM arc_graph.nodes), (SELECT count(*) FROM arc_graph.edge_observations)")
  test "$before" = "$after"
  psql -U postgres -d "$scratch" -v ON_ERROR_STOP=1 -Atc "SET ROLE arc_graph_api; SELECT count(*) FROM arc_graph.nodes" >/dev/null
  printf "Restore verified: nodes|observations=%s; reader access preserved; original database unchanged\n" "$after"
'
