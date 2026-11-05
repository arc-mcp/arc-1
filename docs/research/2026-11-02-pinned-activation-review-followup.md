# Pinned activation diagnostics and function-creation review follow-up

Status: offline changes in draft PR #1142. This is neither a live freeze nor whole-PR acceptance.
FEAT-93 remains open. The original read-only application and temporary-access cleanup remain
restored; no new live mutations accompany this checkpoint.

## Seventh independent review

Actual Claude Code `claude-opus-5-5`, launched with `--effort max`, reviewed immutable
`7d24751e554e1988e9d685bec3f16eeb87bc0a18`. The [verbatim report](broader-pinned-pp-writes/claude-text-followup-review-20261101.md)
has SHA-256 `5e3e4df77ab2ac0a2a705cb06983c6ba336865f6e49dbbce170cd116674f01d2`.
Both reviewer verifier runs and the subsequent author verifier confirmed 4,343 unchanged files.
The reviewer confirmed all three preceding Medium findings closed offline and found **one Medium
and eight Low findings**. Its allowed commands ran sequentially and passed, including 446 files /
12,240 tests. It executed no failing reproductions. Two incorrectly rooted reads were refused,
then corrected. It made no source edits, SAP/CF/browser calls or external tool-network requests.
The launcher records max effort; the reviewer correctly says it cannot independently see that setting.

## Dispositions

| Finding | Change or remaining evidence requirement |
|---|---|
| M1: minimal-error bypass | Safe activation-evidence errors carry native diagnostics separately. Pinned text failures return only `nativeActivation.success` in minimal mode; detailed mode retains bounded messages/details. SAP text no longer enters the safe failure message. Native errors and unconfirmed-warning responses have sentinel tests in both modes. |
| L2: recovery replacing the original failure | The extracted post-unlock completion adapter attempts pool-state and active-part observations independently. It retains the activation error/status first, records failed observations without their SAP text, preserves `text-activation-unknown`, and warns that SAP may still finish. Three 503/recovery-failure combinations are tested. |
| L3: unverifiable input saved first | Pinned input rejects duplicate keys, incomplete/unsupported annotations and part separators before HTTP. The shared native entry repeats this check before locking. Legacy input behavior remains unchanged. |
| L4: arbitrary include names | A regression explicitly records that the exact include URI plus `CLAS/I` currently permits an arbitrary name. These are URI-bound references, not a qualified name allowlist. `CLAS/I` comes from metadata, and a composite name on an include URI is unobserved. Raw native preaudit capture remains required before tightening or qualifying this behavior. |
| L5: lost LOCK | Network/429/5xx LOCK outcomes now retain selected resources and report unknown lock state with ADT/SM12 recovery guidance. Both primary and additional locks use this tracking. No subsequent lock lifecycle starts after unresolved cleanup; failed closure remains sticky. Native cleanup qualification remains open. |
| L6: FUNC signature readback | **Open; blocks public admission.** Authored echo fixtures do not qualify SAP's signature normalization. Capture native source/save/readback and qualify semantic signature comparison with exact body preservation before exposing FUNC writes. |
| L7: FUGR main source | The private factory refuses FUGR main-source replacement and source-bearing creation before SAP. Metadata-only group creation, child profiles and guarded deletion remain candidates. Native main-source mutation/side-effect evidence is required before reconsidering replacement. |
| L8: dormant creation | Private creation tests now reach processing metadata under its child lock and verify values. Cleanup failures stop before later source/verification sessions; closure failure cannot be overwritten. The helper asserts its registered mutation context. Native metadata reads are uncached. Group-include prefix validation is shared with the legacy prologue. |
| L9: tests | Added minimal mode, recovery failures, HTML activation, cancellation during verified no-op cleanup, reserved text-profile hooks and raw group refusals. Older include/method/activation refusal rows now check phase and status/reason. Unexpected delete-fixture calls are asserted outside mocked fetch. Candidate source drift assertions identify their intended failure. |

The author first ran seven failing assertions: three diagnostic-message/redaction assertions and
four text-input preflight rows. These failures are author reproductions, not reviewer executions.
The corrected full unit suite passes **447 files / 12,277 tests**. All three TypeScript projects pass.
Build, lint (four existing informational diagnostics), the 135-entry policy check, strict docs, the 912-file size ratchet and all 12 schema scenarios also pass. All 59 historical harness simulations pass; they do not qualify these new profiles.

## Private creation candidate

Shared creation now supports metadata-only FUGR/FUNC/group-INCL and source-bearing FUNC/INCL
profiles internally. Parent metadata/package and CTS context are rechecked immediately before a
child POST. Metadata-only creation reads and hashes the generated source under the native lock
without claiming an inactive source save. Structural-INCL creation observes exactly one selected
INCLUDE statement in fresh parent source and records that source hash. It never inserts or repairs
the parent source. Missing/duplicate membership preserves a partial creation and stops child saves;
observed membership does not establish that this operation inserted the reference.

Processing-kind changes read native metadata under the child lock, preserve the negotiated media
type, and require matching readback. The rewrite currently supports the observed `fmodule` prefix;
other prefix shapes and native processing/creation side effects remain unqualified. Tests cover
metadata/source creation, parameters, parent drift, supplied-package mismatch, native processing
retention, CTS task-to-request selection, membership and cleanup failures. These are authored
HTTP fixtures. The public capability table still admits none of these function profiles.

GET-only inspection of A4H/758 activation framework source also shows that function-group conflict
handling can add source-mapped references and associated inactive objects through the native URI
mapper. This supports retaining explicit reference qualification; it does not establish exact wire
identities, names or the behavior of a write. Private source captures are excluded from this repo
and review snapshots. Native class-pool references, real post-delete UNLOCK responses, controlled
active/inactive text selection, function signatures, both PP writers and recording transports all
remain live evidence requirements. Other accepted object/management/CTS/trace/FLP families remain
unfinished. Git and custom plugins/extensions remain excluded.
