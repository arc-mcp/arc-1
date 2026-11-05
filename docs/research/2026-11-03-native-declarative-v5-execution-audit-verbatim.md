# Independent audit of the consumed V5 native attempt

The saved evidence supports **five completed forward lifecycles, four confirmed owner deletions, and two retained owners**. The V5 attempt remains **failed and permanently consumed**. This audit grants no cleanup, continuation, retry, public/PP admission or merge approval.

- Exact executed source: `59eab1d09c331e605593284700bc180423aa74fe`, Node `v22.21.1`, `/Users/marianzeis/.codex/worktrees/pinned-ddic-sdo/arc-1`. A final read-only Git check independently confirmed that checkout still clean at that exact revision.
- Target/identity/recording scope: **A4H/001, MARIAN, Basic-native, `$TMP`**. Source metadata identifies A4H/MARIAN and `$TMP`; the saved SM12 views show A4H (001). This is not principal-propagation evidence.
- Intent SHA-256: `84eb9ccf0466d48d1c4072aa7190ea85ea1c9950e86cf455655b6d4a64374e93`.
- Failed result SHA-256: `36da5677a1a68a509941a0fc6c2ed613b78b036228f41be6d307273abbe6732b`.
- Journal: **956 sequential rows**, `2026-11-03T08:40:12.267Z`–`08:41:36.991Z`. One retained attempt directory/manifest and one preflight ID; six distinct CREATEs, no replay of a failed mutation.

## Native facts retained

All names below end in `_3481C958A6CA5AC1`.

| Owner | Confirmed forward operations | End state supported by evidence |
|---|---|---|
| DDLS `ZARC1_V5V` | Create/save, activate, update/save, activate | Retained active, exact updated source |
| Abstract DDLS `ZARC1_V5A` | Create/save, activate, update/save, activate | Deleted fourth; later typed absence |
| DCLS `ZARC1_V5D` | Create/save, activate, update/save, activate | Deleted third; later typed absence |
| DDLX `ZARC1_V5X` | Create/save, activate, update/save, activate | Deleted second; later typed absence |
| BDEF `ZARC1_V5A` | Create/save, activate, update/save, activate | Deleted first; later typed absence |
| SRVD `ZARC1_V5S` | Create/save only; first activation cancelled | Retained inactive; no update or DELETE submitted |

The journal has **six CREATE POSTs (all 201), eleven source PUTs (six initial saves plus five updates, all 200), eleven activation POSTs (ten successful native activations and one cancellation), and four DELETEs**. Each source PUT matches either the exact intent source or its exact intended update; each is between successful LOCK/UNLOCK responses for that same owned URI. The ten successful activation results have active native metadata and matching active-source readbacks. Native view warnings about search-help inheritance were preserved, not silently treated as failures.

There are 205 observed request→dispatch→response/error triples and additional independent evidence GET rows; this is not an assertion of a complete wire-level count including internal CSRF/session operations. All 41 saved CTS checks identify `$TMP`, `LOCAL`, successful result and empty recording for the exact selected owner. They do not qualify transportable recording or CTS administration.

The abstract BDEF now completed both activations and the update. This proves that exact abstract fixture/native contract, **not** high-level RAP handler generation or arbitrary BDEF forms. The default `ZBP_ARC1_V5A_3481C958A6CA5AC1` class remained a read-only reference: no request mutated or locked it, and its final inspection returned typed resource-not-found.

## Exact failure and retained objects

Row `00786.json` is the actual HTTP 200 native checklist, not success merely inferred from status. It reports `activationExecuted="false"`, warning `Editing canceled (EU 202)`, and an error on the SRVD's first source line: **“Comments are not supported and will be deleted on save.”** Row `00787.json` truthfully reports `activation-not-confirmed`, `activeSourceVerified:false`, and `nativeStateVerified:false`; row 00788 stops the forward lifecycle. The source was already saved with its leading fixture marker comment. No automatic rewrite, repeat activation, compensating DELETE of the uncertain SRVD, or full-fixture replay followed.

The subsequent independent GET-only inspection ran `08:48:55.765Z`–`08:48:58.809Z`; all 18 saved responses and its script hash match the manifest. It confirms:

| Retained owner | Native metadata SHA-256 | Observed source SHA-256 | Interpretation |
|---|---|---|---|
| DDLS `/sap/bc/adt/ddic/ddl/sources/zarc1_v5v_3481c958a6ca5ac1` | `ffeaf6face9401d283dfc5143c24bcd7fc178abfe4b7455e4935c36859fc3111` | `20800608b7cb47ae19e944191bf5c3ba906cf8cab478c4a18535549535c67398` | Default, requested-active and requested-inactive reads all return native **active** metadata and the exact updated source. Do not present the requested inactive read as a distinct draft. |
| SRVD `/sap/bc/adt/ddic/srvd/sources/zarc1_v5s_3481c958a6ca5ac1` | `d11a9f95d8fb4bb441125e2141a42ce4ee75c178f360e7949088534bb727cecf` | `fb29a9b67fceb26e82ce701b003c860f82075d09d0ddf21e03875439c386ef6a` | All three views return native **inactive** metadata and the exact initial source. `?version=active` does not prove an active SRVD exists. |

Both retained metadata documents identify the exact names/types, MARIAN as responsible/creator and `$TMP`. Four cleaned owners plus the separate class reference return HTTP 404 with the retained native `ExceptionResourceNotFound` type. This is typed native absence for those exact URIs, not an inference from generic 404. The later inactive-inventory XML is valid and contains the one SRVD fixture entry; other users' draft names remain private. The original attempt did **not** claim a clean final inventory or independent absence for all owners.

## Cleanup, prerequisites and controls

The four DELETEs occur in the recorded dependency-safe order: BDEF, DDLX, DCLS, abstract DDLS. No DELETE targets the retained view or SRVD. All **15 owner locks** (six creates, five updates, four deletes) have successful matching same-owner UNLOCK responses; all fifteen corresponding results report `unlockFailed:false, sessionClosed:true`. Lock response bodies are intentionally hash-only, and session closure is retained as callback/result evidence rather than a separate raw close response. The audit therefore does not claim independent replay of lock-handle/cookie matching from omitted data.

Intent preparation was recorded at 08:30:16.097Z; GET-only preflight ID `69AB8B973A884CE6` completed at 08:36:34.194Z with all six owners and the read-only class absent and inventory valid without the suffix. New baseline controls follow at 08:38:57.910Z (suffix) and 08:39:20.627Z (MARIAN). First actual CREATE dispatch is 08:40:14.651Z, within the approved initial freshness window. The already-started attempt then uses its owning operation/cleanup bounds; later cleanup is not a new initial mutation grant.

I independently viewed **all four valid raw JPEGs**: both baseline and both post-failure images. Each shows A4H (001), client `001`, table `*`, either user `MARIAN`/argument `*` or user `*`/argument `*3481C958A6CA5AC1*`, an empty lock table and the explicit zero-lock success status, without an error. Post observations are 08:44:52.329Z (user) and 08:45:07.506Z (suffix). Their receipt binds the exact failed result. The 08:44:23.276Z SessionTimedOut image is separately preserved and **excluded** from lock evidence. JPEG signatures and receipt hashes match. Identical baseline/post pixels can naturally hash identically; the saved receipts and operator account establish separate capture chronology, while visual review establishes the displayed filters/results.

The 08:40:00.727Z CI receipt records no active runs before execution. The operator reports caffeinate held, no concurrent native work and normal refreshed sessions without permission changes. Those operator controls are distinguished from independently decoded SAP responses; screenshots and CI receipts do not provide an OS-wide process audit.

## Evidence integrity and limits

- **980 original protocol files and 31 operator-packet files** were fully hashed and reverified unchanged. JSON includes the complete file ledgers for later exact binding.
- **1,088 distinct historical files** rehashed successfully: all intent-listed prior file/journal bindings, the 622-file failed V4 root, its 172-file recovery root, post-controls, 21 retained-inspection bindings and referenced reports. Prior failed claims/results remain preserved. The intentionally absent V2 manifest remains absent.
- **315 retained native bodies** independently match byte lengths and SHA-256: 7 preflight, 290 attempt and 18 later inspection. The attempt additionally has 46 hash-only body records; nonempty omitted bodies cannot be reconstructed independently. The later inspection inventory was retained privately by the operator; the original protocol inventory remains hash-only.
- **66 snapshot/phase receipt references** were checked against native source hashes and independently reconstructed namespace-aware canonical metadata hashes, including active metadata where applicable. Raw-body hashes are distinct from canonical metadata hashes. The audit builder initially assumed they were equal; its preserved diagnostic log records that audit-code error, corrected after reading the two exact committed pure evidence/canonicalization source blobs. BDEF's explicit `_package` query was also accounted for when classifying its CREATE. Neither was a native failure or a source change.
- Exact clean source was independently rechecked read-only at audit completion. The recorded package-lock hash does not attest every installed third-party dependency byte. No new source execution, client, native phase, SAP/cloud/browser call, credential/environment-file read, mutation or permission change occurred in this audit. The two source blobs were read as committed text; no native module was imported or executed.

The appropriate next work is a separately reviewed, narrowly bound continuation/recovery for the **two retained exact owners and observed hashes**, with fresh prerequisites. This audit supplies evidence for that review and does not itself authorize it. Existing five-family successes remain valid bounded facts; the original six-owner V5 attempt remains failed, and public/current-build PP acceptance remains separate.
