# Read-only syntax checks (#841)

## Root cause and decision

`syntaxCheck` already checks `OperationType.Read` and only POSTs a checkrun; it does not save,
activate or execute the supplied source. `SAPDiagnose` correctly advertises `readOnlyHint:false`
because other actions change trace/formatter state or request quickfix operations. Annotations
apply to a whole MCP tool, not an action. The issue reports client approval cost; those private
measurements are not independently reproduced here.

Expose `SAPRead(type="SYNTAX", objectType, name, version?, source?)`, following the existing
metadata pseudo-types. Keep twelve tools and the old diagnose route. A thirteenth `SAPCheck`
would duplicate registration and expand every client's surface; marking all of SAPDiagnose
read-only would misrepresent mutating actions. Dynamic hints on read-only deployments would not
address the reported development workflow with writes enabled.

## Implementation

1. Extract the existing syntax handler without changing its wire/result behavior and reuse it.
   Empty/whitespace source retains the shared normalizer's omitted-source behavior.
2. Add the read type and optional inline source to both schemas and model-facing guidance. Refuse
   meaningful unrelated read options (false, empty arrays and default text/zero filler are ignored) and `version:auto` instead of silently ignoring them.
3. Preserve existing `SAPDiagnose`/`SAPDiagnose.syntax` and hyperfocused `SAP.diagnose` deny rules on the new alias, including tool
   listing. Keep normal read scope, audit, target identity, safety and error handling.
4. Test real dispatch, request/result equivalence, read-only annotation, deny/scope failures,
   malformed arguments and not-processed evidence. Verify live without changing stored source.

Review: no new SAP endpoint, configuration switch, cross-call state or approval override. The
new alias alone can additionally be disabled with `SAPRead.SYNTAX`; the legacy route remains.
Hyperfocused mode remains mixed and unannotated. Multi-target already marks its pruned
SAPDiagnose read-only; this alias does not change its mutation boundary. Roadmap: FEAT-69 now targets this read-only route; mass checking remains deferred.

## Evidence and limits

[MCP ToolAnnotations](https://modelcontextprotocol.io/specification/2025-06-18/schema#toolannotations)
are advisory. This gives clients an accurately annotated route, not guaranteed auto-approval or
a measured token saving. Local validation covers both entry points, class/program routing, policy and schema budgets.
Live SAP_BASIS 758 and 816, direct HTTPS/Basic, client 001: both routes returned equal active,
inactive and inline-source results with `allowWrites:false`. Invalid inline text produced findings
without changing stored source. An invalid saved draft failed while the active version stayed clean.
Missing programs returned native errors (`checked:true` on these systems); explicit `notProcessed`
is regression-tested separately. Disposable `$TMP` reports were deleted and metadata returned 404.
The alias and legacy route also returned identical checked results for CLAS/OC on both systems
with writes disabled. No live BTP/PP, native client approval or token-saving measurement is claimed.

The description-count budget includes this property and #853’s source precondition so either
merge order passes. Existing wire/token ceilings are unchanged; repeated type prose was shortened.

Compatibility limits: FUNC syntax routing and inline JSON server-driven checks retain the legacy
limitations; this alias does not add endpoint/type support. A not-processed result is never clean.
