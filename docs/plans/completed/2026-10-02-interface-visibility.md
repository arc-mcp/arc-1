# Interface redefinition visibility

The visibility action moved any method declaration, including qualified interface redefinitions, into protected/private sections. SAP rejects these on activation, leaving an invalid inactive draft. The add-method action already requires public visibility, consistent with [SAP's interface contract](https://help.sap.com/docs/ABAP_PLATFORM_NEW/7bfe8cdcfbb040dcb6702dada8c3e2f0/8e8b9c6bc4b94848b13f792966f02085.html).

Keep the same rule in the visibility action after locked source/structure lookup and before saving. Preserve public no-ops and normal method moves. Regression tests must prove both refusals, no PUT, and unlock, even with local lint disabled. Pin the complete-token body scans separately so `ZIF_SVC` is not confused with `ZIF_SVC~RUN`.

Validation and live evidence are recorded in the PR. No roadmap impact; this completes the existing class-edit contract.
