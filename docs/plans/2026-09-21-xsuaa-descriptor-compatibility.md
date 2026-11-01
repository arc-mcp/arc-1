# XSUAA descriptor compatibility — #812 / #813

## Root cause and correction

`xs-security.json` registered three IDE deep-link patterns (`cursor://…`, `vscode://…`).
XSUAA rejects the whole descriptor with `Malformed redirect URIs detected`, preventing service
creation or update. Removing those entries repairs the descriptor.

Since the `/oauth/callback` proxy (#325), ARC-1 supplies its own callback to XSUAA for both
authorization and token exchange. The IDE callback travels in signed state and is checked by
ARC-1's provider separately. The descriptor entries did not control that second redirect.
#678 narrows both callback policies; this fix only removes the rejected schemes.

MTA operators rebuild and redeploy. Operators managing XSUAA manually remove the entries from
their complete landscape descriptor, preserving other settings; see `docs_page/xsuaa-setup.md`.

## Evidence and limits

- On 2026-09-21, disposable unbound XSUAA `application` instances in CF `us10-001` / `abap-dev`
  reproduced `create failed` with the original descriptor and `create succeeded` with the fix.
  Only `xsappname` differed from the tested descriptors. Both instances were deleted; no existing
  app, binding, key, role or destination was changed. The reporter's eu10-004 evidence agrees.
- The descriptor regression fails against the original list and passes after removing the schemes.
  Dependency-default assertions were removed: they did not exercise ARC-1's provider wiring.
- SAP's [descriptor reference](https://help.sap.com/docs/btp/sap-business-technology-platform/application-security-descriptor-configuration-syntax)
  and [redirect troubleshooting](https://help.sap.com/docs/authorization-and-trust-management-service/authorization-and-trust-management/invalid-redirect-uri?version=Cloud)
  describe the upstream configuration, but do not date the scheme-validation change. The broker
  result is the evidence; the doc/contract mismatch is tracked in `arc-mcp/xsuaa-auth#72`.
- Installed Cursor/VS Code login, token exchange and full MTA deployment were not verified here.

## Merge and release constraints

Keep the HTTP(S)-scheme regression until #678's exact-list assertion lands; that assertion then
subsumes it. `tests/unit/server/mta-descriptor.test.ts` auto-merges and keeps both describes;
delete `shipped xs-security.json redirect schemes (#812)` deliberately when combining. Resolve
`xs-security.json` and `xsuaa-setup.md` without losing #813's scheme warning or #678's exact-callback and upgrade guidance.

This main-bound PR carries the annotated release notes and the
[release hold](2026-09-21-release-readiness.md), which must survive release-please regeneration.

Roadmap: no impact; SEC-15 and SEC-16 remain separate OAuth lifecycle/client-identification work.
