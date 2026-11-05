# Fresh structure/TTYP/MSAG qualification after audited cleanup

The original `pr1142-native-ddic-collections-v1` claim remains failed and consumed. Its first
structure create/PUT stored a valid 203-byte source with native blank-line framing; the old
strict observer refused readback. No TTYP or MSAG was created. The separate fixed cleanup at
`798936069fd314a63e06fcce9978456ac37b2432` deleted that exact new-version structure once on
3 November 2026, with native typed absence, owning cleanup and fresh zero-lock SM12 controls.

The private execution audit is SHA-256
`84c9d16df4d3f5e30c9e2196817867be0ec302f0e1e3eabe7747fd1de950fea0`; its complete ledger is
`6147d373599beeafa3e4b1e94932b529475e56d12f7421e830c1f299fd3dfd0e`.
Cleanup result: `5f326a724afcf6b6438aee94c4be6604603a952ced9ec9b1a727b2e135a82ef7`.
The cleanup source author audited the preserved execution but did not operate it; the source had
separate independent review. This is one Basic-native cleanup, not a full collections success.

## Fixed fresh graph

`native-ddic-collections-v2.ts` owns a separate permanent
`pr1142-native-ddic-collections-v2` root and fresh 48-bit suffix. It explicitly refuses the consumed
suffix `0B9644EAD7A6`. It reuses the unchanged [three-owner graph and seventeen stages](2026-11-03-native-ddic-collections.md):
local `$TMP` structure `ZSCC<suffix>`, table type `ZTCC<suffix>` and message class `ZMCC<suffix>`,
all owned by MARIAN on A4H/001. The TTYP moves from a built-in row type to the owned structure;
MSAG update preserves one message, changes one, removes one and adds one. Cleanup remains
MSAG → TTYP → structure, with fresh dependency absence before parent deletion.

The [reviewed DDL readback proof](2026-11-03-ddic-ddl-source-readback.md) permits only empty
code-line normalization outside literals/comments for TABL/DS and TABL/DT. Expected hashes,
observed stored hashes, cross-view equality and activation proof remain exact. V2 adds no new
adapter, mutation shape, public route, permission, semantic source normalization or compensation.

Every source proof also rehashes the original failed protocol/operator packet (96 files) and
successful cleanup/operator packet (167 files), their controlling audit hashes, exact result and
intent, directory membership and private permissions. Neither history nor an old claim is rewritten.
Preparation remains offline; check is offline and does not claim execution. Preflight requires fresh typed absence of all
three new owners. Execute claims once before validation, uses current identity/package/CTS/source
proof, exact owning locks, final direct/proxy deadlines and bounded owning cleanup, and retains
historical confirmations separately from current present/unknown residuals.

## Operator sequence after independent source review

Use Node22.21.1 and the exact clean reviewed checkout/runtime required by the shared harness:

```text
native-ddic-collections-v2.ts --prepare-reviewed-ddic-collections-v2 <full-reviewed-revision>
native-ddic-collections-v2.ts --preflight-reviewed-ddic-collections-v2 <full-reviewed-revision>
native-ddic-collections-v2.ts --check-reviewed-ddic-collections-v2 <full-reviewed-revision> <sample>
native-ddic-collections-v2.ts --execute-reviewed-ddic-collections-v2 <full-reviewed-revision> <sample>
```

After preflight and preparation, root must perform fresh real SM12 searches: client001/table `*`,
user `*`/argument `*<new suffix>*` and user MARIAN/argument `*`, both complete zero-lock views.
Save untouched JPEG captures and `sm12-baseline.json` in the fresh sample directory with protocol,
revision, intentHash, preflightId, observedAt, exact filters, lockCount and image SHA-256. Check is
read-only and grants no execution permission; execute rereads all evidence within the original
five-minute freshness bound. Current CI/native nonoverlap, an awake host and final independent
receipt/SM12 audit remain operator requirements. Failure consumes the new claim permanently;
inspect named current residuals and arrange separately reviewed recovery, never replay a mutation.

FEAT-93 remains open. Source review and a successful fresh full graph remain pending; independent
current-build PP and recording, table/settings/index, ENQU and the other accepted families are
separate requirements. No ABAP execution, RFC/helper or native activity occurred in this authoring.
