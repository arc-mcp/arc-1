# Claude Code Opus review — PR #1143

Performed 2026-10-31 with Claude Code 2.1.308, model `claude-opus-5-5` (`--model opus`).
The reviewer used isolated tracked-file snapshots, safe mode, Read/Glob/Grep only, no MCP
servers, no persistent session, and no credentials. It did not execute tests or live calls.
Two broad passes used high effort; two focused correction checks used medium effort.

## Findings and dispositions

| Finding | Resolution |
|---|---|
| P2: flat CLI exports included discovery blocks | `source` and `read --flat` select `none` for supported canonical types; alias and unsupported-type regression coverage added. |
| P2: failed index fallback suppressed child dedicated providers | Only the fallback is disabled; tests cover unavailable and oversized root indexes followed by a child with an advertised append. |
| P3: recovered auth/CSRF poisoned later ordinary errors | Completed data reads and final non-auth data errors settle retry evidence, including recovery and unavailability within one operation. Real HTTP tests cover continued child reads. |
| P3: bootstrap failures or login redirects could look recovered | `AdtCsrfBootstrapError` preserves control-request provenance; it cannot clear auth evidence or mean where-used unsupported. Redirects stop the phase. Tests cover failed initial bootstrap, failed refetch after POST 403, redirects, final 401 after retry, and network loss after 401. |
| P3: nested source-graph edges had disconnected version keys | Traversal carries the discovered owner identity; edges separately label observation version. A graph-join regression verifies every edge endpoint. |
| P3: structure context exposed incomplete secondary edges | Its existing occurrence tree remains the hierarchy. `extensionDiscovery` projects metadata without the append-only `edges` array; a nested append/include/append regression verifies the result. |
| P3: E2E required positive fixtures after valid deadline exhaustion | Cases explicitly validate deadline-only partial coverage; recorded final live runs nevertheless have positive coverage without deadline-only passes. |
| Test gaps: real structure send cap, default 401 recovery, empty index body, misleading mocked accounting | Real HTTP regressions cover CSRF and index POSTs under the 20-send ceiling. Mocks charge the caller's actual session. Empty index responses remain explicit protocol failures. |

## Review qualifications

- The first snapshot used a two-dot comparison with newer `main`, incorrectly showing deletion
  of the ATC precondition and unrelated documentation. The actual three-dot PR diff contains no
  such deletions; the merge-tree is clean. Subsequent reviews used the merge-base comparison.
  GitHub's default PR merge checkout also retains and tests the current-main ATC guard.
- The suggested capacity optimization is not a correctness requirement: the 20-node and
  20-send bounds are simultaneous ceilings. Documentation now makes this explicit. Metadata,
  fallback and control requests may exhaust the send budget before the node ceiling.
- Distinct version observations deliberately retain canonical type/name/version identities.
  An unversioned discovery observation must not be relabelled active because source was read.
- Empty/malformed index responses remain terminal protocol failures under the approved contract;
  they are not valid empty lists. The parser now preserves typed byte-limit errors.
- Review snapshots naturally predated the last live reruns. The committed MCP/BTP evidence was
  subsequently regenerated on the final source tree. This also replaces an earlier malformed,
  manually copied MCP source hash with the same computed 64-character hash used by the smoke script.
- Live CF HTTP authentication, principal propagation and Connectivity-proxy qualification are
  not claimed. Auth-recovery fault injection was exercised over loopback HTTP.

## Final focused verification

After the typed bootstrap-error and redirect corrections, Opus reported:

> The corrections resolve all three points, and I found no new correctness or security defects.

Its final disposition was **“Actionable defects: none.”** This is a scoped static verification,
not a GitHub approval or proof of absence of defects. Executed tests and exact live source-tree
hashes are recorded in the [implementation evidence](README.md).
