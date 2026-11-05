# Fixed private structure / TTYP / MSAG qualification candidate

The original once-only run at `757a7cef0e3a4bec73f08fb59ab29c964572bc05` stopped after the
structure create/source PUT because SAP inserted two internal blank lines in its readback. The
original result and claim remain failed and consumed; no activation, TTYP/MSAG create or deletion
ran. Fresh native metadata reports the retained structure as **new**, including when active was
requested. The two source fields, their values and all other nonempty lines were preserved. Both
post-run SM12 controls showed zero locks. This is partial Basic-native evidence, separate from
current-code PP, recording, public acceptance and completion of this graph.

The [narrow DDL readback proof](2026-11-03-ddic-ddl-source-readback.md) corrects this production
compatibility issue without weakening optimistic hashes. The updated snapshot uses the same proof;
no new protocol root, continuation or replay is introduced. The separate [one-owner cleanup candidate](2026-11-03-native-ddic-structure-cleanup.md) binds the
audited retained state and permits only its exact DELETE after new controls. It must be independently
reviewed and audited before a fresh three-owner graph; the original CREATE/initial PUT never repeats.

## One three-owner graph

The fixed entry `scripts/qualification/pr1142/native-ddic-collections.ts` owns the new protocol/root
`pr1142-native-ddic-collections-v1`. Preparation draws six random bytes: the 12 uppercase hex digits
appear in each 16-character owner name and the actual SM12 suffix filter. There are exactly three
`$TMP` owners on A4H/001:

1. `ZSCC<suffix>` (`TABL/DS`): create a structure with CHAR(4) and CHAR(20) fields through the actual
   source-backed production path; activate, refuse a stale source hash without a PUT, change only
   the second field to CHAR(30), then reactivate.
2. `ZTCC<suffix>` (`TTYP`): create a plain standard table type with builtin CHAR(4), including the
   mandatory locked post-create metadata PUT. Activate, refuse a stale metadata hash, then change
   the row type to the owned active structure and reactivate. Standard key/access behavior and all
   unselected metadata must survive the partial rebuild. The structure remains a guarded dependency
   throughout, even before the row-kind transition.
3. `ZMCC<suffix>` (`MSAG`): independently create three EN messages, including the mandatory locked
   post-create PUT, then activate. Replace the message list explicitly: update 001, preserve 002,
   remove 003 and add 004. Verify master-language agreement and the native documentation flags,
   then reactivate. This exercises replacement semantics, not an invented merge-by-number API.

The structure completes before its dependent is introduced. Cleanup deletes MSAG, then TTYP, then
structure. Every DELETE rechecks the exact creator/package/state, recorded metadata and source
in the owning session. Structure deletion additionally requires fresh typed TTYP absence. The
runner uses `createPinnedDdicContext`, `executePinnedSourceWrite` and private production activation,
not an alternative native write implementation. It never executes ABAP or installs helpers.

## Retained facts and actual gaps

The fixed 46-GET A4H/001 packet supplied default, active and inactive-request metadata for these
representative standard readable objects. Each triplet returned the same explicitly active body:

| Family / standard owner | Bytes | SHA-256 |
| --- | ---: | --- |
| TABL/DS `/BOBF/S_FRW_ACTION` | 2319 | `d750c4b1e58b89ca369f40add60119ae64deaa7d462a824a60318705b55b3ecd` |
| TTYP `/BOBF/T_FRW_CHANGE` | 6003 | `3f278c666fca4a0f7cdab169bd63b64ceed6a6200f8f11466682772295d6b162` |
| MSAG `/BOBF/COM_GEN_MODEL` | 28614 | `daf692c8519fcdef7a5fbecf776a322be50fd72b6fcda23b27eb9f2f314fffa8` |

These exact bodies were rehashed offline and remain private and unchanged. They establish native
metadata namespaces, identity/state shapes and active fallback on an inactive request, not draft,
create, update, activation or delete success. The existing SYST source fixture and builder contracts
supply the structure DDL shape; no fresh structure source was present in the 46-GET packet. This new
run must observe its own saved and active source. It neither follows native alternate-state links
nor infers state merely from the requested version.

Production structure update/delete/activation resolves the exact native subtype through bounded
`searchObject(name, 5)`. The guard admits only that exact existing query for the selected owner and
appropriate stage. Immediate discoverability of a newly created structure is a remaining native
assumption: absent or ambiguous evidence stops the run; no retry, invented preflight for a nonexistent
owner, or bypass is added. TTYP row-kind transition and message replacement are likewise native
contracts still to observe. Table/settings/index and ENQU form a separate remaining graph; AFF/DDL/
immediate-active and ENHO/SKTD families remain separate. No Cartesian variant matrix is proposed.

## Fixed phases and bounds

Only the reviewed full SHA and generated preflight sample ID are arguments. Use Node 22.21.1 with
only `--import tsx`, the exact clean checkout and existing dependencies. The source/runtime gate
rejects injected module/Git settings. A minimal `env -i HOME="$HOME" PATH="<node-bin>:/opt/homebrew/bin:/usr/bin:/bin"`
can precede the reviewed command. This document does not authorize any invocation.

- `--prepare-reviewed-ddic-collections-v1 FULL_SHA`: local intent only, no credentials/client.
- `--preflight-reviewed-ddic-collections-v1 FULL_SHA`: exactly three typed owner-absence GETs and
  one valid inactive-inventory GET without the common suffix; no mutation/retry.
- Capture genuinely fresh post-prepare/post-preflight SM12 suffix and all-MARIAN zero-lock searches.
  Preserve raw JPEG bytes as `sm12-suffix.jpg` / `sm12-user.jpg` and their bound baseline receipt in
  the sample directory. Image signatures/hashes/freshness are checked; an operator/reviewer must
  inspect the real filters/results. Names, client, identity, root and graph are not caller-selectable.
- `--check-reviewed-ddic-collections-v1 FULL_SHA SAMPLE_ID`: read-only prerequisite validation;
  no claim, directory creation, credential read or native dependency import.
- `--execute-reviewed-ddic-collections-v1 FULL_SHA SAMPLE_ID`: consumes the one permanent claim
  before prerequisites/credentials; independently repeats all proofs even after check succeeds.

The shared engine retains the original absolute evidence deadline, a four-minute execution cap,
2 MiB aggregate response budget and final-dispatch source/intent/receipt/policy/stop checks after
queue/CSRF/token waits and synchronous proof work. This three-owner profile has a fixed 384-attempt
aggregate cap; the two-owner profile remains at 256. The first complete offline composition hit 256
at TTYP cleanup, so the increase is specific to the observed larger bounded graph. Per-request
allowances from production source activation are narrowed to 2 MiB before observer admission; the
inner shared budget still counts the complete run. No byte limit, deadline or production gate grows.
Owning UNLOCK/session closure retain their separate bounded allowance after stop/expiry.

Failure retains the current graph; there is no catch cleanup, replay or reset. Historical confirmed
deletions stay recorded, but any subsequent present or uncertain absence puts the owner in current
`remaining`/`inspectionRequired`; failed final inventory marks all three uncertain. Unknown mutation
outcomes remain unknown. Session closure is the production cleanup predicate, not a purported saved
raw close response. Lock and inventory response bodies are omitted while status/size/digest remain.
The original failed execution has fresh post-run SM12 controls and an independent evidence audit;
the separate cleanup requires its own controls and audit.

Offline validation uses an independent Git archive, guarded startup/workers and `.invalid` HTTP
mocks for every dispatcher. Tests exercise actual entry→factory→client→driver composition, unchanged
DOMA/DTEL behavior, source/metadata receipts, post-create PUTs, stale refusal, merge/preservation,
dependency/final-read failures, immutable JPEG/no-replay controls and send-boundary cancellation.
The original exact-source review and failed native attempt remain preserved. The corrected proof
is independently reviewed; the separate retained cleanup still needs independent review. This change grants no
public, PP, recording or whole-PR approval, and does not reopen any historical claim or fixture.
