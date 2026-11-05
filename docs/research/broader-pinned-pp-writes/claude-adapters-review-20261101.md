Actual Claude Code review; model `claude-opus-5-5`, effort `max`, read-only frozen snapshot.

# Review of PR #1142 delta at `96dfc4e6b`: not accepted yet

I found two High defects, one Medium and three Low. None lets an unauthorized caller mutate: the route, scope, grant and destination gates all held. Fix the High and Medium items before accepting this delta; this review doesn't approve the PR.

All findings come from reading and tracing the code. I didn't run anything, so the regression tests below are also what will confirm them.

## Defects

### High: single-target `/mcp` loses all `SAPWrite` actions on overlap deployments
**Where:** `source/src/handlers/write.ts:65`

- **Cause:** the check changed from `multiTargetEndpoints && targetId` to `multiTargetEndpoints || ...`, but `multiTargetEndpoints` is set for the whole instance. `/mcp` runs on that same base config (`source/src/server/server.ts:1389`).
- **Effect:** every `/mcp` write goes to `handlePinnedWrite`, and `pinnedWriteEnabled` is false there, so each call returns `PINNED_WRITE_REFUSED`. The catalog still advertises those actions.
- **Reach:** standard authorization mode with `SAP_BTP_DESTINATION` set. Target-filtered mode refuses to start with single-target settings (`source/src/server/multi-target-authorization-startup.ts:39`).
- **Contract broken:** `source/docs_page/multi-target-writes.md:13` promises existing single-target rules are unchanged.

**Repair:** use the same check as `source/src/handlers/lint.ts:33`: `config.targetId || config.multiTargetWrite || client.safety.multiTargetWrite`. Per-call configs always set the first two (`source/src/server/multi-target-runtime.ts:96`, `:122`), so the guard isn't weakened. Add a test with `multiTargetEndpoints: true`, no target and no policy that reaches the legacy handler.

### High: `delete` with `include` removes the whole class
**Where:** `source/src/server/multi-target-server.ts:609`, `source/src/handlers/object-types.ts:304-306`

- **Cause:** normalization runs before the raw-field check and silently drops `include` on `delete`.
- **Effect:** `{action:"delete", type:"CLAS", name:"ZCL_X", include:"testclasses"}` passes admission and reaches `deletePinnedOwner`. That is irreversible, and the request named only a part of the class. It takes an authorized writer sending an off-schema field, but direct calls are part of the contract.
- **Contract broken:**
  - `source/docs/adr/0011-broader-pinned-pp-mutations.md:33` says raw fields are validated before stripping.
  - `source/docs/research/2026-11-01-broader-pinned-pp-writes-deletion.md:44` says `include` is refused.
  - The comment at `source/src/handlers/write/pinned.ts:39` makes the same claim.
- **Why tests miss it:**
  - `source/tests/unit/handlers/pinned-delete.test.ts:152` calls `handleSAPWrite` directly and skips normalization.
  - `source/tests/unit/server/multi-target-writes.test.ts:406` uses `edit_method`, where `include` survives.

**Repair:** check fields on the cleaned raw arguments, and keep legacy normalization as it is:
```ts
// before line 609
const rawFields = Object.keys(stripLlmEmptyValues(callArgs));
// after `action` is computed at line 615
const capability = pinnedMutationCapability(toolName, action) ?? pinnedCompanionCapability(toolName, action);
// if rawFields contains a key outside capability.fields, return MULTI_TARGET_OPERATION_FORBIDDEN
```
This also closes the same silent drop on `create`, on INTF `update`, and for `processingType`/`updateTaskKind`. Add tests through both `prepareMultiTargetCall` and `handleToolCall`.

### Medium: the catalog requires `source`, but `delete` refuses it
**Where:** `source/src/server/multi-target-tools.ts:186`

- **Effect:** `required` lists `source` for every `SAPWrite` action, while the delete row excludes that field (`source/src/server/pinned-mutation-capabilities.ts:55`). A client or model that fills in a real value gets a generic `MULTI_TARGET_OPERATION_FORBIDDEN`. Only omitting it, or sending `""` or `null` (both stripped by `object-types.ts:224`), works.
- **Contract broken:** `source/docs_page/multi-target-writes.md:132` says to omit it, and `source/tests/unit/server/pinned-mutation-capabilities.test.ts:175` pins the wrong contract.

**Repair:** set `required` to `['action','type','name']`; `write/pinned.ts:54` already enforces `source` at runtime. Update that test, say "omit for delete" in the `source` description, and add a test that a catalog-valid delete payload is admitted.

### Low
1. **Any 404 counts as proof of absence** (`source/src/adt/pinned-delete.ts:89`). The repo's own classifier says an ICF "Service cannot be reached" 404 isn't an object-not-found (`source/src/adt/errors.ts:834-838`). The trigger is narrow, since DELETE must already have returned 2xx. Keep those categories as `delete-unconfirmed`, and capture the real 404 body during the PP run.
2. **Deletion results lose the cause and guidance** (`source/src/adt/pinned-delete.ts:99`, `:110`).
   - Network, 5xx and plain-error failures such as `source/src/adt/transport.ts:1234` return no message. `pinned-result.ts:19-26` and the formatter both give "inspect first" text.
   - Cleanup failure overwrites `phase`, so `{state:"delete-rejected", phase:"unlock", statusCode:403}` reads as if the unlock got the 403. Keep the real phase, and use `unlock` only when the state is `deleted` with no earlier error.
3. **No documented opt-out for deletion** (`source/docs_page/multi-target-writes.md:149`). Formatter changes and activation each name their `SAP_DENY_ACTIONS` setting. Add `SAP_DENY_ACTIONS=SAPWrite.delete`.

## Checked, no other defect found
- **Routing and gates:** pinned, strict PP, global, destination, raw `write` scope and exact write grant are all required (`source/src/server/multi-target-runtime.ts:107-116`). `*` is rejected as a write grant.
- **Aggregate and Basic routes:** both stay free of mutations.
- **Deny rules:** enforced in the catalog, in call preparation and in dispatch. Annotations are recomputed after pruning.
- **Target identity:** the selected target is checked against both policies, and the context is bound to the policy object (`source/src/handlers/pinned-operation.ts:24-27`, `source/src/adt/mutation-context.ts:77`).
- **Owner, package and CTS:** the real package and recording are checked before the lock and again under it, against both lists.
- **Lock and session cleanup:** unlock uses the owning session with its own budget, even after cancellation.
- **Cancellation and replay:** one finite deadline applies. 401, CSRF, 429, 503, DB-error and negotiation replays are all off with `noReplay`.
- **Deletion outcomes:** rejected, unconfirmed and cleanup-failure states are kept separate, apart from the Low items above.
- **Formatter:** XML handling, single decoding, attribute whitespace, strong and weak ETags, and read-back all behave as documented. The no-ETag overwrite risk is disclosed and accepted, so I don't count it as a defect.
- **Admitted surface:** exactly six mutations are registered, and Git and plugins stay refused.
- **Legacy compatibility:** the single-target formatter and catalog changed only in wording. The first High is the only legacy regression I found.

## Outstanding qualification after the fixes
1. **Deletion on PP:** run the two-user test for CLAS and INTF, plus the negative routes, on the fixed revision. Live deletion evidence so far is direct-auth and `$TMP` only.
2. **Transportable deletion:** no live evidence exists, including empty `OPERATION` in the transport check (`source/src/adt/transport.ts:1211`) and `corrNr` on DELETE.
3. **Unlock after delete on other releases:** legacy code treats that failure as expected (`source/src/handlers/write/update-delete.ts:241-245`), while the pinned path returns `ok:false`. A4H's unlock succeeded; decide once there is evidence from another release.
4. **Formatter PP rerun:** the recorded hashes show the evidence at `69b28b22e` predates later changes, so rerun on the fixed revision.

   | Recorded hash vs PP record | Files |
   |---|---|
   | Differs | `handlers/pinned-formatter.ts`, `pinned-mutation-capabilities.ts`, `multi-target-tools.ts`, `multi-target-server.ts` |
   | Matches | `adt/pinned-formatter.ts`, `handlers/lint.ts`, `multi-target-write-surface.ts` |

5. **Other SAP releases:** live evidence covers only the A4H system. With negotiation replay off, older systems may refuse rather than adapt; that fails closed but is untested.

## Limits of this review
- I only read and searched the snapshot, with no edits or network.
- I didn't run tests, the build or any live check. The 10,819 passing tests in `validation.json` are reported, not reproduced.
- I didn't compute any hashes. The comparison above is text matching between `source-manifest.json` and the evidence records, so it doesn't prove those values match the actual file bytes.
