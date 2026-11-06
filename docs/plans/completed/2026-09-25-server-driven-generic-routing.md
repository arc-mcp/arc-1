# Generic server-driven object routing (ARCH-02)

## Root cause and plan

`objectBasePath` treats every registered server-driven type as an unknown program.
Transport check/history and single-object syntax/ATC therefore address a different
object family. Where-used and activation have separate registry branches masking
the same gap. Derive the generic base path directly from SDO_REGISTRY, preserve
name encoding and unknown/slash-type behavior, and remove redundant routing branches.
Keep activation's discovery and package gates and the dedicated write engine.
No new endpoint abstraction or registry copy is needed.

## Review boundaries

Current schemas already reject these types for ABAP Unit and ATC batches; the
roadmap's Unit example is stale after #838. Preserve those boundaries. A correct
URI does not imply an operation is supported by SAP. Generic source/API-state
callers also inherit the corrected path; preserve their own capability and package
gates. Test all registry paths including raw-vs-encoded names and representative
real dispatcher requests. Run read-only diagnostics/transport/navigation on 758
and 816, recording refused or incomplete operations as such.

Narrow ARCH-02 to source-state version verification after routing is verified. Unsupported operations
must remain documented limitations, not be silently treated as clean checks.

## Live verification (2026-09-25)

DSFD CALENDAR_OPERATION on 758/816: corrected syntax accepted the existing source;
main parsed the same DDL as ABAP and produced false errors. Transport history now
addresses the DSFD object and recovers assignment candidates; main returned an
empty result for a nonexistent program. Check(modify) and where-used also used the
correct object, with writes disabled. No repository/transport objects changed.

ATC at the corrected URI remained incomplete (758 reached the 20-second deadline;
816 completed with zero processed objects). This is not a clean quality result or
proof of general SDO support. Unit is schema-refused without any SAP call.

The generic source-state caller exposed a separate correctness limit: active and
inactive source requests both returned active content when no draft existed. Refuse
SDO object_state before SAP traffic until it verifies version identity; retain this
specific gap in ARCH-02. `SAPRead action="diff"` also refuses SDOs with guidance to read explicit
versions separately; this ARC-1 validation stays visible in minimal-error mode. Land #846 first
so these explicit reads verify version identity. Raw/encoded API-state URLs inherit the registry correction,
but no live API-release mutation was performed. Quickfix availability and AFF syntax
reporters remain SAP/type dependent; this change grants no new capability.
