# Freestyle SQL framing (#955)

The reporter's SAP_BASIS 740 SP22 matrix isolates separators: a 200-character LF
query fails, its 201-character CRLF equivalent succeeds, and 1,008-character CRLF
SQL succeeds. Bodies were reconstructed with ARC-1's exported helpers and matched
logged lengths; they were not wire captures. We do not have a 7.40 test system.

Current main `128aafbff` preserves short LF input and inserts bare LF while wrapping
long lines, even into an otherwise CRLF input. The existing shared formatter runs
for ordinary queries, structured TABLE_QUERY and generated IN-list chunks.

## Plan and review

1. Normalize existing LF/CRLF and inserted wraps to CRLF in that formatter.
2. Keep its 255-character payload-line limit and literal/comment refusals.
3. Test the short pair, boundary lengths, CRLF idempotence, comments/literals and
   actual request bodies for wrapped IN-list chunks, including restrictive tails.
4. Run controls on available systems; request the reporter's branch retest on 740.

Review: no total-query cap, release detector, COUNT rewrite, new SQL parser or
chunking mechanism is necessary. Existing authorization and cumulative response
limits remain at their shared boundary. This fixes framing without promising that
an unsupported endpoint exists on every release; 750's freestyle endpoint was absent
in prior qualification. COMPAT-13 retains only the affected-system retest.

Evidence: [reporter matrix](https://github.com/arc-mcp/arc-1/issues/955#issuecomment-6119866814).

## Qualification completed (2026-10-13)

The reporter retested revision `9f642f0f` on SAP_BASIS 740 SP22: all 16 cases and
20 POSTs passed with expected rows. Actual transmitted bodies confirmed CRLF,
including wrapped IN-list chunks, with no line over 255 characters. This is
[reporter evidence](https://github.com/arc-mcp/arc-1/issues/955#issuecomment-6143358475),
not a local 740 run. Issue #955 is closed; COMPAT-13 has been removed from the roadmap.
