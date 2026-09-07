#!/bin/sh
set -eu

api_password=$(tr -d '\r\n' </run/secrets/pg_api_password)
writer_password=$(tr -d '\r\n' </run/secrets/pg_writer_password)

ARC_GRAPH_API_PASSWORD="$api_password" ARC_GRAPH_WRITER_PASSWORD="$writer_password" \
  psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv api_password ARC_GRAPH_API_PASSWORD
\getenv writer_password ARC_GRAPH_WRITER_PASSWORD
CREATE ROLE arc_graph_api LOGIN PASSWORD :'api_password';
CREATE ROLE arc_graph_writer LOGIN PASSWORD :'writer_password';
SQL
