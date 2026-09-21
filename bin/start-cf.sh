#!/bin/sh
set -eu

if [ "${OPTIMIZE_MEMORY:-}" != "true" ]; then
  exec node dist/index.js
fi

memory_available=${MEMORY_AVAILABLE:-}
case "$memory_available" in
  ''|*[!0-9]*)
    echo "ARC-1 startup refused: OPTIMIZE_MEMORY=true requires MEMORY_AVAILABLE as decimal MiB." >&2
    exit 1
    ;;
esac

# Avoid octal interpretation and arithmetic overflow in POSIX shells. CF values
# are vastly smaller than this nine-digit upper bound.
while [ "${memory_available#0}" != "$memory_available" ]; do
  memory_available=${memory_available#0}
done
if [ -z "$memory_available" ] || [ "${#memory_available}" -gt 9 ]; then
  echo "ARC-1 startup refused: MEMORY_AVAILABLE is outside the supported decimal-MiB range." >&2
  exit 1
fi

old_space_mib=$((memory_available / 4 * 3 + memory_available % 4 * 3 / 4))
if [ "$old_space_mib" -lt 1 ]; then
  echo "ARC-1 startup refused: MEMORY_AVAILABLE is too small for the 75% old-space policy." >&2
  exit 1
fi

exec node "--max-old-space-size=${old_space_mib}" dist/index.js
