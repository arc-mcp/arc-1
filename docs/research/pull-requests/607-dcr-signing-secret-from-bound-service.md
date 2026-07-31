# PR #607 — source DCR signing secret from a bound service

- **PR**: https://github.com/arc-mcp/arc-1/pull/607 (`MarcusSchoelzel:feat/dcr-signing-secret-from-service`, cross-repository fork)
- **Reviewed**: 2026-07-24 at head `d9f02c52f9d8878a787d31117f6685abc6415436`, base `cc7ad92c4475e0c35dd4d5342947d9b82c99ad30`
- **Linked issue**: none
- **Verdict**: **REQUEST CHANGES** — the happy path works, but the current discovery algorithm can silently select an unintended service as the DCR trust anchor, and a blank explicit override prevents the new bound-service fallback from being used.
- **Disposition (2026-07-31)**: **Closed pending architecture work.** The implementation-first PR
  is superseded by [durable DCR signing-key lifecycle research](../2026-07-31-durable-dcr-signing-key-lifecycle.md)
  and roadmap item [SEC-15](../../../docs_page/roadmap.md#sec-15). Its service-binding direction
  remains an evaluated option, not a rejected requirement.

## Scope and claims checked

The PR adds a fourth DCR signing-secret source:

`CLI flag > ARC1_DCR_SIGNING_SECRET > bound service > XSUAA clientsecret`

It reads a `signing-secret` credential from `VCAP_SERVICES`, adds a `{ service: string }`
configuration-source variant, documents CLI/Terraform provisioning, and adds four resolver tests.
There is no SAP/ADT endpoint or object-write change, so SAP release/activation verification is not
applicable.

Primary external contracts checked:

- [Cloud Foundry environment variables](https://docs.cloudfoundry.org/devguide/deploy-apps/environment-variable.html): `VCAP_SERVICES` is the default binding-delivery mechanism; each top-level key is the service `label`, and each binding exposes `name` plus `credentials`.
- [Cloud Foundry user-provided services](https://docs.cloudfoundry.org/devguide/services/user-provided.html): a UPS is the supported way to deliver custom credentials to an app.
- [Cloud Foundry Terraform provider — `cloudfoundry_service_instance`](https://registry.terraform.io/providers/cloudfoundry/cloudfoundry/latest/docs/resources/service_instance): `type = "user-provided"` with JSON `credentials` is valid; the PR's Terraform resource shape is correct.
- `@arc-mcp/xsuaa-auth` installed contract: `createXsuaaOAuthProvider` trims a supplied override, warns and falls back to XSUAA for an empty/whitespace override, and logs only `dcrSigningSource: override|xsuaa`.

## Gates run on the isolated PR checkout

- `npm ci` ✓ — Node engine warning only: runner `22.18.0`, package requires `>=22.19`; install also reported six dependency advisories, but the PR does not change dependencies.
- `npm run typecheck` ✓
- `npm run lint` ✓ — 541 files, no fixes; one pre-existing Biome deprecation info.
- `npm run build` ✓
- `npm test` ✓ — **144 files, 4,341 tests**; `tests/unit/server/config.test.ts` **199/199**.
- `git diff --check` ✓
- GitHub reports the PR mergeable but `UNSTABLE`, with no checks reported for the fork branch.

## Independent runtime reproduction

Executed the built resolver with realistic `VCAP_SERVICES` payloads, then passed the result to the
installed XSUAA provider where relevant:

| Case | Observed result |
|---|---|
| One `user-provided` binding with `signing-secret` | bound value selected; source `{service: "arc1-dcr-secret"}` ✓ |
| Non-empty env plus binding | env wins ✓ |
| Flag plus env plus binding | flag wins ✓ |
| Whitespace-only bound credential | ignored ✓ |
| Malformed `VCAP_SERVICES` | default/XSUAA fallback ✓ |
| Managed `xsuaa` binding with a `signing-secret` key | **accepted as the DCR secret** ✗ |
| Two matching UPS bindings | **whichever array entry appears first wins** ✗ |
| Empty/whitespace `ARC1_DCR_SIGNING_SECRET` plus valid UPS | **blank explicit value blocks UPS lookup; auth library falls back to XSUAA** ✗ |
| `arc1 config show` table with UPS | DCR field/source absent; JSON output contains the raw source object only |
| `logEffectivePolicy` with UPS source | source map contains only safety fields; DCR service source absent |

No live Cloud Foundry binding was created because that would mutate external infrastructure during
a review. The CF payload shape and Terraform example were checked against the primary contracts
above; the resolver and downstream auth-provider behavior were executed locally.

## Findings

### 1. Blocking — signing-key lookup is not restricted to the advertised user-provided service and is ambiguous

**`src/server/config.ts:50`**

`Object.values(parsed)` scans every service label even though Cloud Foundry defines the top-level
keys as service labels and a UPS appears under `user-provided`. Any managed binding that happens to
expose `credentials.signing-secret` therefore becomes eligible. Within a label, the first matching
array entry silently wins; Cloud Foundry does not document array order as a stable selection
contract.

This value is the trust anchor for all stateless DCR client IDs. Binding/reordering an unrelated
service can therefore rotate the effective key, invalidate every cached registration, and—if the
unintended credential is weaker or known to another operator—lower the integrity of minted client
IDs. The source comment says there should be one shared UPS per deployment, but the code does not
enforce that assumption.

**Required change:** inspect only the `user-provided` label (and ideally verify the entry label),
then either require a configured binding name or fail clearly when more than one non-empty
`signing-secret` candidate exists. Add negative tests for managed bindings and ambiguous UPS
bindings.

### 2. Blocking — blank explicit overrides bypass the new bound-service fallback

**`src/server/config.ts:593`**

`resolveOptionalStr` returns `""` and whitespace strings as defined values, while the new fallback
runs only for `undefined`. Reproduction with `ARC1_DCR_SIGNING_SECRET="   "` plus a valid UPS left
the config source as the env var. The downstream auth package then trimmed the blank value and
logged `dcrSigningSource: "xsuaa"`, ignoring the stable bound secret.

That contradicts the documentation at `docs_page/xsuaa-setup.md:253`, which says empty/whitespace
values are treated as unset, and defeats this PR's purpose in deployments that retain a cleared env
entry from an install dialog, manifest, or prior `cf set-env`.

**Required change:** normalize blank flag/env values to absent before consulting the binding (while
retaining a warning), and add empty plus whitespace explicit-override tests that assert the UPS is
selected.

### 3. Non-blocking — the claimed startup/config-show source attribution is unreachable

**`src/server/effective-policy-log.ts:52`**, **`src/cli.ts:269`**

The PR adds `service` cases to both formatters, but neither output path includes
`dcrSigningSecret`. `logEffectivePolicy` iterates only eight safety fields, and the human-readable
`config show` table lists only safety fields. Runtime verification showed no DCR service source in
either output. Only `config show --format json` exposes the unformatted source object.

Either include a safe DCR source/status field (never the secret) and test both renderers, or remove
the unreachable formatter changes and narrow the PR's observability claim.

## Security and architecture invariants

- [x] ADT safety guard: N/A — no ADT endpoint or HTTP operation added.
- [x] Scope policy: N/A — no MCP tool/action added.
- [x] Package gating: N/A — no mutation path changed.
- [x] Three-file tool schema sync: N/A — no tool schema changed.
- [x] Per-user SAP auth: untouched.
- [x] stdout: server logging unchanged; CLI stdout remains intentional.
- [x] Secret exposure: raw DCR secret is not logged or returned; only a service/binding name is attributed.
- [ ] Trust-anchor selection: fails closed only after the two blocking findings above are addressed.
- [x] Typed ADT errors and `withSafety()` clone: N/A.

## Test adequacy

The four new tests cover one UPS, non-empty env precedence, blank bound credentials, and raw source
attribution. They do not cover:

- rejecting/ignoring matching credentials on non-UPS bindings;
- deterministic handling of multiple UPS candidates;
- empty/whitespace flag or env precedence against a valid UPS;
- actual CLI/effective-policy rendering of the new source variant.

Also add `VCAP_SERVICES` to the suite's environment cleanup (`tests/unit/server/config.test.ts:15`)
so a Cloud Foundry-hosted test runner cannot contaminate the existing "undefined by default" test.

## Paste-able GitHub review

```markdown
Thanks for adding a service-binding path for the DCR key. The core Cloud Foundry/Terraform shape is valid, and I independently confirmed the happy path plus `flag > env > service` precedence. I also ran `npm ci`, typecheck, lint, build, and the full suite (4,341 tests), all successfully.

I found two edge cases that should be fixed before merge because this value is the trust anchor for all stateless DCR registrations:

**`src/server/config.ts:50` — restrict and disambiguate the signing-secret binding.** `Object.values(parsed)` searches every `VCAP_SERVICES` label, so a managed service with a `credentials.signing-secret` field is accepted even though the feature/documentation says user-provided service. If multiple bindings match, array order silently chooses the key. Please inspect only the `user-provided` label and either select an explicitly named binding or fail clearly when multiple non-empty candidates exist. Add negative tests for a managed binding and multiple matching UPS bindings.

**`src/server/config.ts:593` — let blank explicit values fall through to the bound service.** `resolveOptionalStr` preserves `""`/whitespace, and the fallback only checks `=== undefined`. With a valid UPS plus `ARC1_DCR_SIGNING_SECRET="   "`, ARC-1 skips the UPS and `@arc-mcp/xsuaa-auth` falls back to the rotating XSUAA `clientsecret`. That contradicts `xsuaa-setup.md`'s "treated as unset" behavior and defeats the feature for cleared-but-present env values. Please normalize blank flag/env values before the service lookup and cover both empty and whitespace cases.

Non-blocking: **`src/server/effective-policy-log.ts:52` / `src/cli.ts:269`** add a `service` formatter branch, but neither output iterates `dcrSigningSecret`; the service source therefore never appears in the startup effective-policy log or the table-form `config show`. Please either surface a safe source/status field and test it, or remove/narrow the observability claim. (`config show --format json` currently exposes the source object.)
```

## Tooling limitation

The optional Codex Security MCP App could not render its setup UI: the client requested
`ui://codex-security/0.1.63/workspace.html`, and the MCP server returned `-32602 Resource ... not
found`. The security/invariant review above was therefore completed directly from the exact diff,
runtime reproduction, and primary contracts; no Codex Security scan artifact was generated.
