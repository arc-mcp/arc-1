# PR 1142 live qualification harness

This harness produced [revision-bound live evidence](../../../docs/research/2026-11-01-broader-pinned-pp-writes-combined-qualification.md)
at `1b234d3a4`: 482 deletion/write assertions and 262 formatter assertions passed. Later recovery
journal corrections are covered offline; they do not relabel that run as a newer revision.
The native formatter reader requires the complete v5
representation; historical v2 checks cannot establish preservation of newer preferences.
The historical class and formatter records use earlier
harnesses and revisions; this source does not retroactively attest them.

The live command `{"command":"qualify","plan":"delete-two-user-v1"}` creates four disposable
`$TMP` owners through two independently verified PP sessions, checks create/update/stale-hash,
method-edit or interface-update and activation, then captures native A4H author/source receipts.
The same frozen tokens feed the formatter phase. Its native source-hash sentinels bind the routes
to those receipts, and direct native reads as the primary SAP user check preferences before,
during both users' differing patches and after restoration. Native setup first saves the primary's
complete v5 XML, then sets all five optional preferences to nondefault sentinel values. The before
check requires all five; an empty-field comparison cannot pass. After the two-field PP restoration,
a separate guarded native step restores and verifies the complete pre-seed XML. Upper/lower keyword behavior is tested.
The primary's baseline and patch both use `keywordUpper`, so its independent native proof covers an
indentation change, preservation and restoration. The style change to `keywordLower` uses the secondary's
MCP session, without a separate native preference reader for that user.
Read-token, destination, aggregate and compatibility-route refusals precede positive owner deletion.
Native absence and guarded fixture cleanup finish the run.

All native access is pinned to the owner's A4H/001 test system over HTTPS port 443. Cloud deployment,
destination/IAM changes and SAP role assignments are separate operator steps with their own rollback
ledger. They are not performed by these scripts. Do not run against an unprepared deployment.

Set these environment values before starting the harness or any native helper:

- `ARC1_QUALIFICATION_STATE_DIR`: a fresh, persistent directory outside this repository, the OS
  temporary directory, `/tmp` and `/var/tmp` (including their realpath aliases).
- `ARC1_TEST_PRIMARY_EMAIL` / `ARC1_TEST_SECONDARY_EMAIL`: the two expected XSUAA users.
- `ARC1_TEST_PRIMARY_SAP_USER` / `ARC1_TEST_SECONDARY_SAP_USER`: their distinct expected SAP users.
- `TEST_SAP_URL=https://a4h.marianzeis.de`, `TEST_SAP_CLIENT=001`, `TEST_SAP_INSECURE=false`;
  native integration-helper credentials must resolve to the primary SAP user.

Disabled TLS verification (`NODE_TLS_REJECT_UNAUTHORIZED=0`), including a value loaded by dotenv,
is refused before bearer/native access. The native helpers also require `TEST_SAP_INSECURE=false`.

Use the real Git checkout root; a source snapshot nested under an ignored directory is refused.
After committing the clean source and building it, run `node scripts/qualification/pr1142/run-manifest.mjs`.
It exclusively creates the private run directory, source/harness hashes and random fixture manifest.
Save the actual deployment artifact manifest and CF droplet/package identity separately. A current
Git SHA, MCP package version or environment label alone is not proof of the deployed build.
That deployment record is a mandatory operator precondition; the harness itself does not refuse a
missing record or verify the running droplet. Do not treat a green harness result alone as build provenance.
Our executable module closure is archived here; the installed `@arc-mcp/xsuaa-auth` JavaScript closure and package lock are hashed; other installed
third-party dependency bytes are not independently attested.

`live-harness.mjs` takes `--base-url`, `--credentials-file`, `--auth-module` and optional `--port`.
Use the existing isolated test app, owner-only XSUAA credential JSON, and the installed
`node_modules/@arc-mcp/xsuaa-auth/dist/index.js` (the path must match the resolved package entry). Obtain sessions interactively through its login commands; no token-import
command is provided. The qualifier freezes and verifies all three sessions before SAP requests.
The expected session labels are `writerA`, `writerB`, `readerA`; request only `read write`, `read write`
and `read`, respectively. Both writers need exact write grants for `PR1142/001` and `A4H/001`, while
the latter destination remains read-only. Keep the source and deployment unchanged during the run.
Both SAP users need development access for `$TMP` CLAS/INTF fixtures named `ZARC1*`, including
create/change/display/delete/activate (`S_DEVELOP` activities 01/02/03/06/07), standard ABAP language
access (`S_ABPLNGVS` 01/02/03/07), and the required ADT paths (`S_ADT_RES`). The secondary's original
display-only role is insufficient. Preserve the before-state and restore temporary assignments afterward.

Run in a detached OS session with stdout/stderr redirected to regular private files. Stop only with
`kill -TERM <harness-pid>`, targeting that PID rather than its process group. Do not use terminal
Ctrl-C, pipe output through `tee`, or close an attached terminal: group signals can kill native workers,
stdout errors can terminate the harness, and SIGHUP is not handled. These are operating constraints,
not tested crash recovery guarantees. With PID-only SIGTERM, forward qualification stops at the next
cooperative boundary and existing restoration/cleanup continue with the frozen tokens.
`stopping` is not completion. Wait for `stopped` with
zero active operations, inspect cleanup results, and only then begin cloud/SAP-access rollback.
Completion events include their plan: the formatter event can occur while repository fixtures remain.

Restore-only recovery is `{"command":"qualify","plan":"formatter-two-user-v2","restoreOnly":true}`.
It requires fresh verified sessions and the same private run/harness binding. It validates the saved
two-field baseline, journals attempts, sends only fields changed by this run, and checks both users.
Visible foreign changes are preserved. Native unconditional PUTs still cannot protect an intervening
same-user edit; the recorded concurrency mode makes that limitation explicit. Secondary formatter
restoration is checked through MCP for the two exposed fields; only the primary has native XML
byte-level evidence. Recovery also restores the saved pre-seed document. The deletion journal's
current restoration fields are updated without erasing the original failed qualification. If a crash
left only `formatterAttempted`, `formatterRecovery` records the outcome without manufacturing a
completed formatter or deletion result. Separate
`restorationStatus` values distinguish not-required, verified and incomplete work. No claim of
repository absence is made for the formatter's source-only probe.

If a lossy native PUT drops a sentinel field, automatic recovery preserves that apparent foreign
state and refuses to overwrite it. Keep the saved `originalXml` in `native-formatter-seed.json`.
The operator must inspect a fresh v5 GET, establish whether another session changed the preferences,
and coordinate a restoration with that SAP user. After resolving any foreign edits, restore the
saved full v5 document through the primary user's native session, capture the PUT outcome and a
fresh GET, and verify byte equality. Keep this manual receipt and the original failed qualification;
do not edit journals to make the run pass or replay the whole qualification. This intervention was
not needed in the recorded successful run.

Deletion cleanup requires a successful native ownership receipt and identical source/metadata before
and under lock. Missing receipts, foreign edits and unknown/service 404s fail closed and remain
explicitly incomplete for operator inspection. An interrupted create may therefore leave a fixture.
The native receipt requires active version and expected creator/changer; no TADIR cross-check is made.
Native reads run as the primary user. The draft guard covers drafts visible to that reader; whether
SAP hides another user's inactive draft has not been qualified. Cleanup retries get new UUID receipt
filenames and repeat the same ownership checks; failed receipts are retained. Direct invocation of
the native cleanup worker requires a fresh lowercase UUID as its third argument.
Do not clear attempt journals or retry a whole run blindly. Directory and file fsyncs provide local
durability, not a guarantee against disk failure. Check the separate cloud/access rollback ledger too.

Local fault simulations (no SAP, CF or credential access):

```sh
npm run test:qualification:pr1142
```

These simulate oracles, replay, token freezing, raw-field loss, foreign edits, uncertain results,
shutdown, cleanup isolation and actual restore-only recovery. `npm test` additionally executes the
real native identity/cleanup and formatter fixture functions with mocked I/O, boots both native
workers through `tsx` to check the TLS refusal, and tests the shutdown/drain and Git-root guards.
They are not substitutes for native/PP evidence.

Refusal probes on the read-only destination, aggregate and compatibility routes use the primary
identity; the read-token probe is also primary. Forward formatter patches send both exposed fields;
restoration sends only fields this run changed. The deleting SAP actor is inferred from the same
frozen creator token and strict-PP route, not independently observed for DELETE. One generic refusal
code covers multiple gates, so it does not identify which gate fired. Actual read-grant values are
recorded, including wildcard grants. RPC receipts include initialization, catalogs and malformed
bodies before protocol validation; known access tokens and JWT-shaped strings are redacted.
