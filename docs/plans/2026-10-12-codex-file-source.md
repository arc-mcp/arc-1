# #777 — local files through the existing Codex connection

## Evidence and scope

The reported failure is model transcription of a large class, including XML entity
substitution. A 157,921-byte local class already passed through this Codex host's
programmatic tool composition into the connected SAPWrite, with faithful SAP read-back
modulo native newlines. Separate authenticated loopback-MCP tests passed 750/758/816/BTP.
Neither proves deployed CF/XSUAA/PP continuity. The user selected only this existing-host
connection workflow; a standalone remote MCP/OAuth client is excluded.

## Plan

1. Add a small dependency-free local `arc1-source` helper: `read FILE` emits source,
   UTF-8 byte count and SHA-256; `verify` checks a received envelope on stdin. Bound
   both reads, require regular files and strict UTF-8, reject NUL/empty source, and
   preserve all characters/newlines. No SAP connection, config loading or file writes.
2. Document one Codex composition recipe: prepare → parse machine output → verify
   received bytes → call the chosen connected SAPWrite with reviewed small arguments.
   Never reconstruct source in model text. Keep source out of printed tool summaries.
3. Keep current server limits/safety/auth unchanged. Explain HTTP whole-request size,
   host output/command limits, action-specific source shape and separate activation.
   The digest protects transfer integrity, not SAP concurrency or source trust.
4. Test CLI behavior, Unicode/entity/newline fidelity, corruption/truncation, invalid
   encoding, directories/oversize and packaging. Repeat real-host source transfer and
   public write actions on available systems; qualify exactly which route was tested.

## Plan review

Two commands and a short recipe suffice. No SDK client, new npm dependency, root sandbox,
server path, upload handle, background process, generic source export, or argument-schema
copy. The local file path is explicitly user-selected; this is not an HTTP filesystem
boundary. No claim that every Codex/Claude host exposes the same composition API. Empty
files remain an explicit inline operation rather than an accidental helper clear.

Roadmap checked: no matching approved server-filesystem work; document the narrow workflow
without inventing a new execution commitment for other hosts.

## Implementation review

The helper is under 90 lines and imports only Node built-ins. No source is emitted by
verification or included in JSON parse errors. Both source and envelope allocation are
bounded; encoded output includes its newline in the cap. Meaningful CLI tests and real
host/public-dispatch roundtrips pass. The recipe explicitly fails on incomplete local
commands or failed integrity checks before invoking any write. Docs separate transferred
bytes from native SAP newline normalization and retain the untested CF/Windows boundaries.

Final review: reject a leading BOM before SAP (native 400 reproduced on 750/758/816);
keep exact-byte transfer for accepted files. Quote selected paths with a POSIX quoting
helper and document Linux's single-argument limit. Length alone is not a replacement
for SHA-256 verification because same-length transfer corruption must still fail.
