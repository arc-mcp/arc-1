# Native source and activation contracts

These notes retain useful SAP wire distinctions. The [research index](inventory.md) links current
admission and qualification status; historical candidate restrictions are not current support.

## Class structure

A4H metadata for `CL_ABAP_CONTEXT_INFO` gave eleven chained CLASS-METHODS declarations the same
start row. A local whole-line splice removed a neighbour. Native ranges therefore need an
independent lexical inventory and complete statement boundaries: individual chained edits refuse,
while insertion after a verified final member is distinct. No returned source URI is followed.

Class proof binds the exact owner/namespaces, declaration/implementation inventory, visibility,
static/instance and abstract/redefinition state, identifier tokens and terminating punctuation.
Split metadata and nested local classes cannot overwrite verified global members. Ambiguous ranges
require whole-source editing. A visibility no-op still verifies source and reports cleanup failures.
[Original native range and metadata findings](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-01-pinned-class-metadata.md).

Whole-include replacement is separate from method surgery. Existing includes need the exact hash;
a clear needs explicit empty source plus that hash. Typed missing-include initialization uses the
parent lock/request. Definition replacement keeps its newline preparation; ordinary include update
preserves submitted bytes. FORM/MODULE edits need complete blocks and preserve neighbours; additions
do not relocate INCLUDE statements. Native PROGNAME CHAR(40) establishes a field envelope, not that
every such name is creatable. [Shared source findings](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-01-pinned-source-adapters.md).

## Native ownership

Standalone CDS/RAP metadata was also captured read-only, with its own package rather than a
borrowed container package. The [sanitized fixture](../../../tests/fixtures/declarative-owners/native-metadata.json)
retains native identities and original-body hashes; it is not the complete hashed XML.

| Owner | Native type | Root / namespace |
| --- | --- | --- |
| DDLS | `DDLS/DF` | ddlSource / http://www.sap.com/adt/ddic/ddlsources |
| DCLS | `DCLS/DL` | dclSource / http://www.sap.com/adt/acm/dclsources |
| DDLX | `DDLX/EX` | ddlxSource / http://www.sap.com/adt/ddic/ddlxsources |
| BDEF | `BDEF/BDO` | blueSource / http://www.sap.com/wbobj/blue |
| SRVD | `SRVD/SRV` | srvdSource / http://www.sap.com/adt/ddic/srvdsources |

[Read-only A4H/758 captures](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-01-pinned-function-resources.md)
establish these distinct resources, including namespaced examples:

| Resource | Native distinction |
| --- | --- |
| Function group | group:abapFunctionGroup, FUGR/F, own package |
| Function module | fmodule:abapFunctionModule, FUGR/FF, exact group container/package |
| Group structural include | finclude:abapFunctionGroupInclude, FUGR/I; not a standalone include |
| Group text pool | rept:textElement, FUGR/PX; metadata identity is not an activation reference |

Prove the parent independently before a child inherits its package. Container name/type/URI and
package must agree; encoded namespace separators may differ only in hex case. Queries, alternate
resources and foreign containers do not establish ownership. Stored responsibility is distinct
from the acting PP identity; JWT names do not prove the mapped SAP user.

Function readback needs a proven FUNCTION/signature/ENDFUNCTION frame. Only ASCII identifier tokens
in that frame compare case-insensitively. Parameters, literals, comments and body stay significant;
the returned hash describes actual stored bytes. This does not permit arbitrary source equivalence
or function-group main replacement. [Frame evidence and limits](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-02-pinned-function-source-proof.md).

## Activation and text pools

A group activation returned native activation/generation success while its structural include
remained inactive. Select the exact group-owned include URI; only explicit FUGR selection submits
the group. Regeneration can still affect siblings. [Native routing observation](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-03-pinned-structural-include-activation.md).

Preaudit binds the selected native owner and permitted expansion, including parent/type/name and
deletion markers. Confirmation rechecks draft and recording evidence; success needs native active
state and matching source. A version query alone does not prove the returned representation.
Text-pool state is independent: part writes and whole-pool activation need separate readback, and
activation can include pending edits to other parts. Program/group deletion retains its pool-lock
and active-state prerequisites in the owning session. Owner absence alone does not prove all pool
or generated resources absent. The native text-element GET reads the selector through GET_WB_VERSION; inactive reads can fall
back to active when no draft exists. Even an invalid selector returned identical bodies in the
capture, so equal bodies alone do not prove selection. [Text-pool evidence](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-01-text-pool-active-version.md).

## RAP and batches

RAP binds one behavior-pool class and MAIN/CCDEF/CCIMP to fresh BDEF identity/source/metadata. Its
class lock does not lock the BDEF or create an atomic snapshot. Apply plans again under the class
lock; include initialization needs typed absence and nested create permission. New definitions and
implementations belong together in CCIMP. Scaffold defaults to preview and never activates;
generation retains its existing apply/dry-run/activation choices. Whole-class activation can
activate other preexisting drafts. [RAP contract](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-02-pinned-rap-orchestration.md).

Batch caps apply before deduplication/reference normalization. Static checks cover all items before
creation; execution retains input/dependency order and distinct same-name DDLS/BDEF owners. No
deferred activation follows failed/uncertain creation or save. There is no rollback, implicit
publication or replay. Nested work shares deadlines and cumulative budgets; owning cleanup has its
bounded allowance. Exact supported combinations and limits stay in the
[write guide](../../../docs_page/multi-target-writes.md), rather than a duplicate capability table.
