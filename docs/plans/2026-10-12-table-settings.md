# Technical table settings — #938

## Reproduction and scope

Transparent-table source writes leave data class APPL0 and size category 0; technical
settings are a separate ADT object. Native lock → inactive-preferred XML read → PUT → activation
passed on 758, 816 and BTP 920. The settings collection is absent on tested 750.
A second partial save must read `version=inactive` under lock: an unversioned GET can hide another user's draft; reading active loses
an earlier unactivated edit. No existing PR implements this contract.

## Plan

1. Expose native `TABL/DTT` in SAPRead, SAPWrite(update only) and SAPActivate. Retain
   its identity; no alias to TABL, automatic table creation, or combined activation.
2. Use a small settings module for discovery, inactive-preferred native metadata reads, patch validation
   and lock/read/PUT/unlock. Read a JSON envelope with identity/version and the native
   settings. Update `source` is a nonempty partial JSON object: dataClass,
   sizeCategory and buffering. Validate known keys and values; preserve omitted,
   unknown and read-only native XML fields. Reject missing/duplicate edited elements.
3. Resolve package permission from the actual parent table before update/activation.
   Preserve transport selection and lock-provided corrNr. Keep normal write/scope/
   deny gates, report a saved inactive draft, and disclose pre-existing inactive state.
4. Test XML preservation, malformed/unknown patches, namespace encoding, safety gates,
   lock/transport/failure paths and separate single/batch activation. Qualify supported
   edits on 758/816/BTP, unavailable discovery on 750, and the normal activation
   preaudit handshake. Check settings before the table's first activation, invalid
   native values and recording transports/two-user behavior where available.

## Plan review

Use targeted native XML edits rather than reconstructing the document. A new generic
DDIC transaction or source format framework is unnecessary. The independently locked
settings resource is the mutation target; its parent is the package authority. No
SQL fallback, auto-activation, draft ownership inference, or automatic retry after
an uncertain save/activation. Additional settings need independent qualification.
Secondary indexes are a separate PR. FEAT-70 will retain only unimplemented fields.

Live feasibility and independent Opus review evidence are saved locally in
`arc1-feasibility-20261011/02-table-settings-indexes.md`; the implementation PR must
include reproducible tests and its own final validation record.

## Review adjustment from live two-user testing

The initial unversioned GET was unsafe: 758 returned active settings to the second
user and hid the first user's pending fields. Explicit `version=inactive` under lock
preserves the shared draft; SAP falls back to active/new when none exists. Default
reads and post-activation checks use the same view. This replaces the earlier
assumption that omitting `version` always returns the pending document.
