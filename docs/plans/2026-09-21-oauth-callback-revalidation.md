# OAuth callback restriction — #678

## Root cause and correction

XSUAA redirects to ARC-1's `/oauth/callback`; ARC-1 then redirects to the MCP client carried in
signed state. Shared CF/BAS wildcards trusted unrelated tenants at both boundaries. Narrowing
only `xs-security.json` leaves ARC-1's manual-client policy open.

Supply fixed supported client patterns to the existing provider and register exact deployment
callbacks, including the optional AppRouter. Keep the existing matcher, signed-state checks and
exact DCR binding. The UI helper preserves operator routes and OAuth restrictions when adding
its callback. Operator `.mtaext` files are gitignored and the previous helper preserved arbitrary
routing parameters; absence from tracked examples does not establish that no operator uses them.

## Evidence — 2026-09-21

- Removing only `redirectUriPatterns` makes four production-route tests fail: foreign CF/BAS
  authorization and replayed signed callback state become accepted. Restoring it passes.
- A UI-enabled MTAR with isolated names created XSUAA, Destination and Connectivity through
  MultiApps 3.11.1 in `us10-001` / `abap-dev`. Application deployment stopped at the CF route quota.
  Against its XSUAA service, `prompt=none` accepted exact backend callbacks and AppRouter
  `/login/callback` (302 `login_required`); foreign CF/BAS hosts and path suffixes received 400
  without a redirect. No authorization code or user token was issued.
- Separate disposable XSUAA instances accepted the shipped localhost descriptor. Localhost
  callback/logout paths with varying ports returned 302 `login_required`; a suffix, `127.0.0.1`
  or an HTTPS host returned 400. With exact deployed callbacks, both paths were accepted and
  foreign hosts/path suffixes refused. Tested entries match exactly, without an implicit path
  wildcard; public-URL prefixes therefore require explicit registration.
- Service-parameter readback was unsupported. Grants/lifetimes have descriptor/build coverage,
  not live readback. Temporary resources and keys were removed; existing apps/services unchanged.
- Route generation tests cover custom hosts, routes, plural hosts/domains, path prefixes,
  no-hostname and no-route, plus default output, OAuth restriction preservation and idempotency.
- SAP's [descriptor reference](https://help.sap.com/docs/btp/sap-business-technology-platform/application-security-descriptor-configuration-syntax)
  documents redirect allowlists; its [MTA reference](https://help.sap.com/docs/SAP_HANA_PLATFORM/4505d0bdaf4948449b7f7379d24d0f0d/33548a721e6548688605049792d55295.html)
  describes deployment substitution. Live requests establish the effective callback policy.

Deployed ARC-1/AppRouter login, token exchange and installed IDE sessions remain unverified
because of route quota. No completed security-plugin scan is claimed. R20's critical impact is
conditional on code exchangeability; these callback checks did not establish token compromise.

## Integration with current main

- The #813 conflicts are resolved with #678's exact callback list and both guides' instructions:
  deployment, public prefixes and upgrades, plus the HTTP(S)-only warning and troubleshooting.
  The client gate is described as ARC-1's runtime policy. The exact-list test retains #812;
  #813's redundant scheme-only describe was removed even though the test file auto-merged.
- The pending release is 1.4.0. Its annotated notes include #678 and link to the upgrade table;
  `updating.md` identifies the same version while preserving the callback-hardening anchor.
  Recheck #811 after release-please regenerates it from the merged change.

Roadmap: no impact; SEC-15/SEC-16 and broader provider consent remain separate work.
