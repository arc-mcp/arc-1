# #777: local source through an existing Codex connection

The user selected this host workflow, excluding a standalone remote MCP/OAuth client.
`arc1-source` is a dependency-free local byte-transfer helper, not a SAP client. It
reads a selected UTF-8 file once, emits source/length/SHA-256, and separately verifies
the received envelope before Codex passes its source directly to the connected tool.
The model does not reconstruct the source. No server input schema, authentication,
filesystem access, activation behavior or HTTP limit changes.

## Verification, 12 October 2026

- New helper through this actual Codex `functions.exec` → connected
  `mcp__arc_1__SAPWrite`: **157,917 bytes**, about 1,500 lines. Created CLAS, activated,
  exact read-back after only CRLF→LF and one terminal newline normalization, deleted,
  then confirmed 404. Quotes, XML-sensitive symbols, field symbols and Unicode survived.
  The existing connection's transport/authentication mode was not independently identified;
  this is not a claim of remote OAuth or PP qualification.
- New helper followed by public dispatcher against real SAP_BASIS **750, 758, 816,
  and BTP ABAP 920**: ~158 KB class create, full-source update, small method-body edit,
  activation/read-back after each, owner deletion and 404. On-prem used local HTTPS
  Basic clients; BTP used the existing named-user OAuth client. These calls bypassed
  MCP transport and therefore do not prove deployed CF/XSUAA/PP identity continuity.
- `edit_unit` with a complete FORM block passed on all three on-prem systems. BTP does
  not support that procedural action. One 750 cleanup attempt lacked loaded discovery
  and hit the absent text-pool endpoint; after loading native discovery, public deletion
  passed and the owned program was confirmed absent. This was test setup, not a helper
  or source-transfer failure. These original test objects were confirmed absent.
- Unit CLI tests cover exact Unicode/newline preservation and BOM refusal, transfer truncation that
  remains valid JSON, same-length corruption, wrong counts, lone surrogates, strict UTF-8,
  NUL/empty/missing/non-file input, byte caps, encoded-envelope expansion and bad arguments.
  Verification emits metadata only. The packed npm tarball includes the executable and
  its read→verify pipeline passed outside the source checkout.

## Final review follow-up

A leading UTF-8 BOM reached SAP despite passing pre-write lint. Class source PUT
returned HTTP 400 (unexpected CLASS token) on 750, 758 and 816. The helper now
refuses a leading BOM in both read and verify, before any SAP call; it never silently
changes the selected source. Save such files as UTF-8 without BOM. Controls without
a BOM and filenames containing quotes/shell metacharacters passed on those systems.
BTP stopped before the follow-up create request (503 during CSRF acquisition), so its
repeat and the attempted fixture-name absence checks remain pending availability.

## Boundaries

The source cap is 200,000 bytes; the encoded envelope cap is 300,000 bytes, including
its trailing newline. Both reads allocate bounded buffers. This is a local authorized
file read, not a shared-server sandbox. Normal local symlinks may resolve to a regular
file. The POSIX heredoc recipe was tested on macOS only; lower host output/argv limits
fail closed. Linux limits a single shell argument to roughly 128 KiB, so the heredoc
recipe needs a smaller source part there. Windows shell handling is unqualified.

Existing authenticated loopback-MCP research separately established default 100 KiB
HTTP rejection and an explicit 256 KiB opt-in admitting the large request on all four
SAP targets. This PR does not retest or change that server limit. The helper's digest
checks received source, not SAP concurrency, trust, or an untouched original disk file.
No claim of portability to hosts without programmatic tool composition.

No roadmap impact after checking: no existing item covers this selected host workflow;
there is no new commitment to server paths, uploads, or a remote-auth client.
