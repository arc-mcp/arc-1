# Procedural qualification marker and dispatcher correction

The independent review of `80468edc979ce72f6df728d1e95c4683c9bfb682` was NO-GO.
Its [verbatim report](2026-11-03-native-procedural-review1-verbatim.md) has SHA256
`bcb5a5cdd50b69ede380764308b10ad195b9aae1d2ad9ad4adf7683aa4f1e626`.
The original commit, immutable review archive and failing synthetic dispatch records remain intact.
No native procedural phase has run under this correction.

F1/P2: the driver never enabled its post-create parent ownership check. The flag now becomes
true only after successful group creation and complete native group baseline capture. Later
POST/PUT operations therefore execute the existing exact native identity/package/author/marker
check. Drift is refused before the selected mutation; the marker is never refreshed from drifted
metadata. Own cleanup, parent baseline deletion proof and all production adapter gates are unchanged.

C1: the protocol tests now place MockAgent underneath the real composed dispatcher instead of
replacing that dispatcher at fetch. The real attempt accounting, no-replay and final synchronous
source/deadline checks remain active. A protocol-local helper confines the ordinary and long-operation
Agent and refuses unexpected Connectivity Client construction. The fixed Basic-native protocol
uses direct HTTP; this does not add Connectivity qualification.

Regression coverage retains the three unchanged independent marker cases (module create,
structural-include create and headings PUT), positive lifecycle and signature/literal controls,
and adds an explicit final synchronous 30-second expiry and native 421/no-replay control. These
are synthetic tests, not native observations. The separate author report preserves initial
formatting/mock-constructor failures, exact before/after results and the original review's guarded
synthetic TCP incident; no historical incident is relabeled as a native failure or erased.

The correction requires an independent exact-source re-review before the operator separately
assesses fresh source/runtime/prerequisite/SM12 controls. It grants no phase execution, PP,
public capability or merge approval. The fixture graph, fixed names/root, response/attempt limits,
source and text semantics, and the named remaining text variants are unchanged.
