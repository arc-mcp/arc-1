#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$project_dir"

docker compose -f compose.graph.yaml build graph-api
docker compose -f compose.graph.yaml up -d graph-api
docker compose -f compose.graph.yaml run --rm collector node dist/graph/cli.js seed-scale 100000 10
docker compose -f compose.graph.yaml run --rm collector node dist/graph/cli.js verify-bounds
docker compose -f compose.graph.yaml run --rm graph-api node dist/graph/cli.js benchmark-scale
docker compose -f compose.graph.yaml run --rm graph-api node tests/graph/metadata-benchmark.mjs
