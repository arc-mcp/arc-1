# Independent V4 failure audit

The single V4 attempt at exact source `99a375a16efd8891adbff9d2995d2684c5e550fb` failed on native BDEF activation. The original attempt is consumed and must not be replayed. Three owners were verifiably deleted; the abstract DDLS and BDEF remain for fresh inspection. This audit does not authorize cleanup, another fixture, a recovery phase, or a subsequent lifecycle.

The preserved manifest binds Node v22.21.1, `/Users/marianzeis/.codex/worktrees/pinned-ddic-sdo/arc-1`, A4H/001, MARIAN, `$TMP`, and Basic-native-contract-only. It records the package-lock boundary without attesting installed dependency bytes. This audit used only saved evidence, without repository edits, SAP/browser/network access, credentials, or protocol execution.

## Evidence integrity

- Result SHA256: `3cb95d1620f6dfad4402d61eba1171d955e02f375c7f7cb434c392f161afb940`.
- Intent SHA256: `e105bf087249c3bc2542f57f324396db9ed78e05daf3748791b41977f6e92243`.
- Attempt manifest SHA256: `a420f38e24046a7673d6aae48c534d848444b1d1441e1ae46eea4c2f9dad68f0`.
- All 622 original protocol files were hashed and remained unchanged through final verification. The companion JSON retains the complete file ledger, operation/readback references, native source hashes and metadata observations.
- The 600 journal wrappers are consecutive `00001.json`–`00600.json`, each containing `time` and `value`, with monotonically ordered times from 02:19:39.956Z through 02:20:44.249Z on 2026-11-03. All 165 recorded requests have matching adjacent response/error rows.
- All 231 retained response/read/error bodies match their recorded UTF-8 byte counts and SHA256. Thirty-seven responses retain only byte counts/hashes, including lock handles and the inactive inventory; their omitted body bytes cannot independently be recomputed. No unrelated draft names are reproduced here.
- The manifest's intent binding, fixture definitions and all four prerequisite file hashes match the saved files. The first repository creation request is row00019 at 02:19:41.579Z, inside the approved baseline freshness interval ending 02:20:35.647Z. Later cleanup is not a new fixture or replay.

## Native failure and completed work

Row00492 sends the single BDEF activation POST to `/sap/bc/adt/activation?method=activate&preauditRequested=true`. The HTTP200 response in row00493 has SHA256 `dca9c5a50201a169d5b8589807a2819feadf7e3068aa2df2b2e8a29a6eecd79b` and explicitly reports `checkExecuted=true`, `activationExecuted=false`, `generationExecuted=false`. Its error is:

> "mandatory:execute" is only allowed in "abtract" entities "with hierarchy" and "with control"

The native spelling is preserved. The error points to BDEF source line7; the saved fixture has `with hierarchy;` and `field ( mandatory : execute ) Item;`, but no `with control`. SAP also reports activation cancellation/EU202. Row00494 reports `activation-not-confirmed`; row00495 records `activation-unconfirmed`. No forced activation, second BDEF activation request, BDEF update, or BDEF deletion follows. A native syntax/fixture incompatibility caused this failure; it is not a relative-link refusal or an HTTP failure converted into success. The evidence identifies the missing contract, but does not prove that an untested revised fixture will activate.

| Owner (suffix `013FECCE68663763`) | Observed lifecycle | Terminal evidence |
|---|---|---|
| DDLS `ZARC1_V4V_…` (view) | Create, activate, comment-only update, activate | DELETE200 row00592; typed absence rows00594/00598; complete row00600 |
| DDLS `ZARC1_V4A_…` (abstract) | Create, activate, comment-only update, activate | Retained; last active metadata/source rows00231/00233 |
| DCLS `ZARC1_V4D_…` | Create, activate, comment-only update, activate | DELETE200 row00553; typed absence rows00555/00559; complete row00561 |
| DDLX `ZARC1_V4X_…` | Create, activate, comment-only update, activate | DELETE200 row00520; typed absence rows00522/00526; complete row00528 |
| BDEF `ZARC1_V4A_…` | Create and source save; activation explicitly not executed | Retained; last metadata/source rows00487/00489 precede the rejected activation |
| SRVD `ZARC1_V4S_…` | No create request was sent | Native typed404 repeated in row00589 during the view's child-absence check |

The wire journal contains five creation POSTs returning201, nine source PUTs returning200, nine activation POSTs (eight explicitly executed successfully and the BDEF refusal), and exactly three DELETEs returning200. The three DELETE targets are precisely DDLX, DCLS and view DDLS, in that reverse order. Thirty-three CTS checks report `$TMP`, successful/local non-recording metadata and no returned request assignment. These are observed contract responses, not universal guarantees about all SAP recording effects.

All nine submitted source bodies equal the corresponding original or updated manifest fixture. Eight native source readbacks are byte-identical; BDEF drops only the final newline (169 requested bytes versus168 observed bytes). The audit initially required exact readback bytes, then identified and limited the comparison to this actual terminal-newline difference. The observed BDEF hash below is the native168-byte source hash; it must not be replaced by the169-byte submitted-payload hash. All successful activations include active metadata and active-source verification. The view's two activations have non-blocking warnings about Carrier/ConnectionId search-help inheritance.

All 98 retained successful owner metadata reads have the intended native name/type, marker description `ARC1 declarative v4 013FECCE68663763`, `$TMP`, and `createdBy=changedBy=MARIAN`. Actual native same-owner relative objectstate links now occur for DDLS, DCLS, DDLX and BDEF; this expands beyond the prior synthetic DCLS/DDLX/BDEF tests. No SRVD positive state-link behavior was observed. These facts do not establish Principal Propagation or public multi-target qualification.

## Retained owners and cleanup boundary

The two retained owners share a name but have distinct native identities and URIs:

- `/sap/bc/adt/ddic/ddl/sources/zarc1_v4a_013fecce68663763`: native `DDLS/DF`, last observed active. Metadata row00231 at02:20:07.712Z has2324bytes/SHA256 `cc3dddf912dbb8ae760b4b4fd966644d93f57f1a2ab275af0f0f84ea719ba10e`. Active source row00233 at02:20:07.804Z has209bytes/SHA256 `4b8b2e43dd62759a3a41215e6fc7b9cff36d010ca89ab3fcb5205bd60a3213b8`. The original, pre-comment source hash is `d663805403e5533fc103d7422e6ec501045daba0eeec6e7978aec209132a2342`. Last metadata contains no alternative-state link.
- `/sap/bc/adt/bo/behaviordefinitions/zarc1_v4a_013fecce68663763`: native `BDEF/BDO`, last observed inactive before the rejected activation. Metadata row00487 at02:20:34.789Z has2613bytes/SHA256 `2ecbdf84c6d8fe9f526e696082cd3def3f40c6dcdbd1cc9abb6d5100a0d4fb00`. Explicit inactive source row00489 at02:20:34.974Z has168bytes/SHA256 `8f34e7d608334e42ab6eaf4d10cf662928461c4898746a46582ccf16d083effb`. Metadata advertises `./zarc1_v4a_013fecce68663763?version=active`; that link alone does not prove an active version exists, and the failed activation does not prove one is absent. No post-failure explicit-active BDEF read is in this journal.

The result truthfully reports these two owners in `remaining` and `inspectionRequired`, `cleanupUnconfirmed=true`, `finalAbsenceConfirmed=false`, and `independentAbsence=not-run`. No final all-six-owner absence or clean final inactive inventory was established. Its empty `createNeverSent` array does not by itself prove SRVD absence; the absence conclusion comes from the actual unissued create and typed native GET. The abstract DDLS dependency was preserved with BDEF rather than deleting underneath an unresolved child.

All twelve recorded owning LOCKs and twelve UNLOCKs returned200. Each of the five creates, four updates and three deletes records `unlockFailed=false, sessionClosed=true`. These owning-session cleanup facts coexist with incomplete repository-object cleanup; they do not turn the failed lifecycle into success. The DELETE absence responses are entity-specific native `ExceptionResourceNotFound` errors, not bare service-level404 guesses, and were confirmed again outside each write session.

Any later recovery needs separately reviewed source and a new permanent, once-only recovery claim bound to this consumed intent/manifest/result/journal. Fresh GETs must determine the actual current/default and explicit active/inactive states of the two exact owners, validate their native identity/package/author/marker and exact observed source versions, and re-establish the other four absences. A BDEF counterpart link must be handled as evidence to inspect, never as proof of counterpart existence or absence. A scoped recovery would have to preserve dependency order (BDEF before abstract DDLS), recheck under its owning lock, keep no-replay behavior and report each partial outcome honestly. This paragraph describes unresolved review requirements; it grants no cleanup permission and authors no recovery implementation.

## Post-run lock evidence

Independently viewed both actual saved JPEGs under `/Users/marianzeis/.local/state/arc1-qualification/pr1142-native-declarative-v4-post-20261103T022044`:

- `sm12-user.jpg`, operator-observed02:28:07.100Z: visible A4H(001), client001, userMARIAN, table*, argument*, `Lock Table (0)`, green `0 locks have been displayed`, no error. SHA256 `796669c9a6ff7610b9f041cbbee2b7ce737b9d634176fad2162aa33f1e2a78dc`.
- `sm12-suffix.jpg`, operator-observed02:28:59.445Z: visible A4H(001), client001, user*, table*, argument*013FECCE68663763*, the same complete zero-lock result, no error. SHA256 `15419fb7981c8d6f0f6cf1ef8b1995ebf565947bc2a4d6fb1726d358cd571e6c`.

Both files have JPEG signatures and matching receipt hashes; `sm12-post.json` binds this failed result and exact source revision. The earlier `sm12-expired-not-evidence.jpg` is explicitly excluded. Identical pixels/hashes to earlier empty views do not establish reuse or freshness; the new search/capture chronology is the operator's attestation, while this independent audit verifies the saved pixels and receipt bindings. Zero locks do not establish object absence.

No full six-owner lifecycle, PP, public admission, or whole-PR readiness is claimed. The original failed attempt and all raw evidence remain unchanged.
