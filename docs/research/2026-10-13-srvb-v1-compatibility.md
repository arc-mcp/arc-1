# Service-binding read compatibility (#991)

The reporter's SAP_BASIS 755 SP03 accepts service-binding v1 XML and returns 406
for v2. ARC-1 requests v2 in `getSrvb`, publish/unpublish package resolution, and
publish-failure inspection. The existing generic XML retry cannot select v1.

Use the existing bounded HTTP negotiation retry: when an individual binding GET
rejects the exact v2 Accept without advertising another type, retry v1 once.
Keep v2 preferred and keep write Content-Type unchanged. This covers all consumers
without separate retry wrappers or a release probe. Package resolution still fails
closed on missing/disallowed metadata or a failed retry.

Validation from `origin/main` e0c33892 plus this patch (2026-10-13):

- A v1-only mock reproduces the original read/package failures and checks reads,
  publish, unpublish, explicit active readback, denied/missing packages, and retry
  failure. Ordinary metadata/write paths retain their negotiation behavior.
- SAP_BASIS 758 SP02 and 816 SP01: disposable OData V2 UI bindings referencing
  `/DMO/FLIGHT_R` were created, activated, read, published, read back as published,
  unpublished, read back as unpublished, and deleted. Route: local handler calls
  over direct HTTPS Basic authentication, `$TMP` package ceiling. Both systems
  reject an explicit v1 GET; their successful v2 path remains intact.
- No 755 system is available: the legacy-success path is based on the reporter's
  wire evidence and regression tests, not a local 755 run.
- BTP ABAP 920 SP05, after startup: the same lifecycle passed through named-user
  OAuth in package `ZARC1_PRSP_260916`, using a disposable SRVD exposing
  `I_Language`. Publish/unpublish readback confirmed each state; the binding and
  definition were deleted. BTP also rejects explicit v1 and uses v2 successfully.
  Candidate runtime: `9fc06e08`; no deployed CF/PP route was tested.
- NW 7.50 has no service bindings.

No roadmap impact. ARCH-01's broader discovery-driven routing remains separate.
