# Bounded MCP HTTP request bodies (OPS-07)

On main a0fc4cb8, the real HTTP server accepts 102400-byte JSON bodies but returns
HTML 413 for 102401 bytes, before dispatch. Larger source writes need an explicit
operator opt-in and bounded admission.

## Contract

- `ARC1_MAX_HTTP_REQUEST_BYTES` / `--max-http-request-bytes`: default 102400,
  integer 1–16777216. Applies to `/mcp`, pinned/aggregate routes and Copilot JSON
  `/authorize`; other JSON and forms stay at 100 KiB.
- Reserve uncompressed declared bytes, capped at the limit; unknown/compressed
  lengths reserve the full limit. Only reservations above 100 KiB count against
  32 MiB. Exhaustion returns 503 with `Retry-After`; known small uncompressed
  bodies remain available. Release once on response completion or disconnect.
- Errors are concise JSON (413 with `limitBytes`, 400, 503), without payload echo.
  Authentication, tool schemas and SAP safety gates remain unchanged.
- This limits admission, not live memory or dispatched SAP work. Disconnected
  tools can retain input (36 MiB across three synthetic tools in a real-server
  reproduction). Slow unauthenticated uploads can hold large-body capacity;
  operators need proxy timeouts and workload memory measurements.

The size-aware rule replaces a fixed reservation that let 330 slow default-size
uploads, or two 16 MiB uploads, block every request. One parser helper and counter
suffice; only budgeted requests register release listeners, including parse errors.

## Validation

Tests cover route/byte boundaries, UTF-8, chunked/gzip input, malformed JSON,
declared-size accounting, small requests at capacity, authentication and release
on completion, parse failure or disconnect during upload and dispatch. The new
dispatch-disconnect test fails when the close listener is removed.

Real-server probes with 2 × 16 MiB and 330 × 100 KiB slow uploads leave ordinary
requests at 401/200. Through the MCP HTTP server with admin/viewer API keys and a
262144-byte limit, ~143 KB requests created disposable classes, activated them
and read back identical source on 750 SP02, 758 SP02, 816 SP01 (HTTPS Basic) and
BTP (named-user OAuth). Viewer writes were denied; deletion returned metadata
404. Only 758 was rerun after the admission correction. No CF peak-RSS,
reverse-proxy or principal-propagation coverage is claimed.

All local gates pass. Completed OPS-07 is removed from the roadmap.
