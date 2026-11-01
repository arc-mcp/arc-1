# PR 1142 live qualification harness

This is the reviewable harness for the next CLAS/INTF deletion and formatter run. It has not yet
produced live qualification evidence. The historical class and formatter records use earlier
harnesses and revisions; this source does not retroactively attest them.

The live command `{"command":"qualify","plan":"delete-two-user-v1"}` creates four disposable
`$TMP` owners through two independently verified PP sessions, checks create/update/stale-hash,
method-edit or interface-update and activation, then captures native A4H author/source receipts.
The same frozen tokens feed the formatter phase. Its native source-hash sentinels bind the routes
to those receipts, and direct native reads as the primary SAP user check preferences before,
during both users' differing patches and after restoration. Upper/lower keyword behavior is tested.
Read-token, destination, aggregate and compatibility-route refusals precede positive owner deletion.
Native absence and guarded fixture cleanup finish the run.

All native access is pinned to the owner's A4H/001 test system over HTTPS port 443. Cloud deployment,
destination/IAM changes and SAP role assignments are separate operator steps with their own rollback
ledger. They are not performed by these scripts. Do not run against an unprepared deployment.

Set these environment values before starting the harness or any native helper:

- `ARC1_QUALIFICATION_STATE_DIR`: a fresh, persistent directory outside this repository and `/tmp`.
- `ARC1_TEST_PRIMARY_EMAIL` / `ARC1_TEST_SECONDARY_EMAIL`: the two expected XSUAA users.
- `ARC1_TEST_PRIMARY_SAP_USER` / `ARC1_TEST_SECONDARY_SAP_USER`: their distinct expected SAP users.
- `TEST_SAP_URL=https://a4h.marianzeis.de`, `TEST_SAP_CLIENT=001`, `TEST_SAP_INSECURE=false`;
  native integration-helper credentials must resolve to the primary SAP user.

After committing the clean source and building it, run `node scripts/qualification/pr1142/run-manifest.mjs`.
It exclusively creates the private run directory, source/harness hashes and random fixture manifest.
Save the actual deployment artifact manifest and CF droplet/package identity separately. A current
Git SHA, MCP package version or environment label alone is not proof of the deployed build.
Our executable module closure is archived here; the installed `@arc-mcp/xsuaa-auth` JavaScript closure and package lock are hashed; other installed
third-party dependency bytes are not independently attested.

`live-harness.mjs` takes `--base-url`, `--credentials-file`, `--auth-module` and optional `--port`.
Use the existing isolated test app, owner-only XSUAA credential JSON, and the installed
`node_modules/@arc-mcp/xsuaa-auth/dist/index.js` (the path must match the resolved package entry). Obtain sessions interactively through its login commands; no token-import
command is provided. The qualifier freezes and verifies all three sessions before SAP requests.
The expected session labels are `writerA`, `writerB`, `readerA`; request only `read write`, `read write`
and `read`, respectively. Both writers need exact write grants for `PR1142/001` and `A4H/001`, while
the latter destination remains read-only. Keep the source and deployment unchanged during the run.

Restore-only recovery is `{"command":"qualify","plan":"formatter-two-user-v2","restoreOnly":true}`.
It requires fresh verified sessions and the same private run/harness binding. It validates the saved
two-field baseline, journals attempts, sends only fields changed by this run, and checks both users.
Visible foreign changes are preserved. Native unconditional PUTs still cannot protect an intervening
same-user edit; the recorded concurrency mode makes that limitation explicit. Secondary formatter
restoration is checked through MCP for the two exposed fields; only the primary has native XML
byte-level evidence. No claim of repository absence is made for the formatter's source-only probe.

Deletion cleanup requires a successful native ownership receipt and identical source/metadata before
and under lock. Missing receipts, foreign edits and unknown/service 404s fail closed and remain
explicitly incomplete for operator inspection. An interrupted create may therefore leave a fixture.
The native receipt requires active version and expected creator/changer; no TADIR cross-check is made.
Do not clear attempt journals or retry a whole run blindly. Directory and file fsyncs provide local
durability, not a guarantee against disk failure. Check the separate cloud/access rollback ledger too.

Local fault simulations (no SAP, CF or credential access):

```sh
npm run test:qualification:pr1142
```

These simulate oracles, replay, token freezing, raw-field loss, foreign edits, uncertain results,
cleanup isolation and actual restore-only recovery. They are not substitutes for native/PP evidence.
