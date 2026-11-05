# Current PP recording fixture preparation

One native Workbench request and task were created on A4H/001 at 2026-11-03 11:54:54 UTC. The fixed preparation script stopped during readback because its optional task-type check assumed codes `Q`/`S`; SAP returned the descriptive value `Unclassified`. That failed result and its exclusive claim remain permanent. There was no retry, second request, task modification or compensating deletion.

The separately audited native tree establishes request **A4HK906605** and task **A4HK906606**, both owned by MARIAN and modifiable (`D`). The parent is type `K`, its native target is explicitly empty, the task belongs to that exact parent, and both inventories are empty. `ZARC1_DEMO` was freshly verified as active, recording changes, software component HOME and empty transport layer. Its `isAddingObjectsAllowed=false` field is retained without interpreting it as an insertion prohibition or grant.

The [independent outcome audit](2026-11-03-current-pp-recording-audit-verbatim.md) replayed the real response through the unchanged production `getTransport` and `resolvePinnedRequest` readers. Those readers accept the actual organizer representation; the narrow task-type assumption belongs to the external preparation validator. The pair meets structural preconditions for a later PP attempt. Actual object insertion, per-object recording, fresh eligibility and deployed two-writer PP remain unqualified.

## Evidence

- Fixed archived helper source: `55d599bbe698e29583e463026640ab0976d33fb1`; external artifact binding SHA256 `a4d4b777e7afe68d835f668f07a3d6c6fa877d5680dfa79d04424f4ca6710dfd`.
- Independent source verdict SHA256: `975229bf34d69008d6f816f014e6042ef5ca848599c5c137b01c6c9761bce55b`; 25 supplied tests and six independent probes passed before the actual native attempt. Passing those checks did not establish the native task label.
- Actual result SHA256: `11645450e78d7dd82d5ed0dc3c9ce62f157833670eae2a48f13918e90390b1e1`.
- Native organizer body SHA256: `3ce3d1bc7d74313250fb27cde7fcb7bdc944b0e7d1bdace37ef9bc9d60bf12d5`.
- Outcome audit SHA256: `b801e2099bfec1c1610b1bcc063d294bf48fb0a9a1bfbe7852f287e6fbc35dc2`; audit JSON `a7ededecfb4cf81b818be1c8f00d28bc94eebb39384e5d25db88723c7587760b`.

Exactly four sends occurred: package GET, discovery/CSRF GET, one request-create POST and one organizer GET. All 11 native files retained their bytes, modes and owners through independent audit. No request was released, no repository object was created, and the deployed app and SAP/BTP permissions were unchanged. The temporary credential copy was removed after the attempt; it is not part of the retained evidence.

The current-workflow operator bindings select this existing pair and require fresh native preflight. This is preparation evidence, not qualification of pinned CTS management or completion of FEAT-93.
