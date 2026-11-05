# Fixed retained RAP document tail v2

The `9748d084` retained attempt remains failed and consumed. Its root/approve edit and
document activation completed; its create-node PUT200 stored the requested content but
readback was refused because native SKTD returned a relative same-owner state link.
The [parser correction](2026-11-04-sktd-relative-state-link.md) accepts that exact native
alias without weakening inactive-state, identity, opaque content or hash checks.

This separate compiled profile adopts the same six existing resources and no new
initial graph. It binds the earlier1,230-file evidence chain and the new837-file packet,
including every saved request/outcome, both permanent claims, fresh38-view inspection,
post-lock controls and source assessment. Thirty-five views are byte-identical to the
previous retained state. The three SKTD views now bind the inactive/default7,911-byte
document and its distinct active7,864-byte counterpart. Fresh proof uses the actual
native state, author, package, parent, node obligations, content and full raw hashes.

The first new stage is `update-document-update`: preserve root/approve/create content,
write the remaining update-node text and selected create/update short texts, then use
the existing document activation, service-definition/binding, publication/status,
unpublication and reverse-cleanup stages. No previous CREATE, root/create-node edit,
generation, batch activation or completed document activation can replay. Results
separate `previousCompleted` from `observedRetainedWrites`; the observed create-node
save does not turn the previous failed result into success. The independently read
active counterpart seeds the existing active-content preservation check.

The entry is `scripts/qualification/pr1142/native-rap-retained-v2-entry.ts`, with flags
`--prepare-reviewed-rap-documents-retained-v2`, `--preflight-reviewed-rap-documents-retained-v2`,
`--check-reviewed-rap-documents-retained-v2` and `--execute-reviewed-rap-documents-retained-v2`.
Each takes the exact reviewed revision; check/execute also take the returned preflight
sample. The permanent root is `pr1142-native-rap-documents-retained-v2`. Preparation is
offline; preflight is GET-only; check does not claim or load credentials. Execution
consumes its one new permanent claim. There is no operator-selected root, graph, stage
offset or arbitrary continuation mode.

Existing source/history checks, budgets, earlier baseline expiry, final-send guards,
owning cleanup and current residual reporting are reused. Fresh post-preflight JPEG
SM12 suffix and MARIAN controls, inspection of their actual filters/zero-lock results,
no overlapping SAP CI/native work and an awake host remain operator prerequisites.
Publication/generated cleanup keeps its separately scoped wildcard policies and
native-governed/unverified downstream limits. No app, destination, role or PP policy is
changed. Only root may execute after independent exact-source review. FEAT-93's final
native/PP/integration acceptance remains open.
