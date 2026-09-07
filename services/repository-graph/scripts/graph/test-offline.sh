#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$project_dir"

docker compose -f compose.graph.yaml build graph-api
docker compose -f compose.graph.yaml up -d graph-api
docker compose -f compose.graph.yaml run --rm collector node dist/graph/cli.js seed-golden
docker compose -f compose.graph.yaml run --rm collector node dist/graph/cli.js seed-golden
docker compose -f compose.graph.yaml run --rm graph-api node dist/graph/cli.js verify-golden
docker compose -f compose.graph.yaml run --rm collector node dist/graph/cli.js collect-mock
docker compose -f compose.graph.yaml run --rm graph-api node dist/graph/cli.js verify-extraction
docker compose -f compose.graph.yaml run --rm collector node dist/graph/cli.js verify-refresh
docker compose -f compose.graph.yaml run --rm graph-api node dist/graph/cli.js retention-check
docker compose -f compose.graph.yaml run --rm graph-api node dist/graph/cli.js benchmark
docker compose -f compose.graph.yaml run --rm --no-deps collector node tests/graph/api-v2.mjs
docker compose -f compose.graph.yaml run --rm --no-deps collector node tests/graph/collector-quality.mjs
docker compose -f compose.graph.yaml run --rm --no-deps collector node tests/graph/snapshot-lease.mjs
