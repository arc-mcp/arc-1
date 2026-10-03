# Multi-target pinned writes (ADR-0008) — implementation plan
> Execute with sap:subagent-driven-development. Each task fits ~60 agent turns.

Customer: personal · Project: arc-1 · Design: docs/plans/2026-10-03-multi-target-pinned-writes-design.md
Target env: local unit tests; live check on a user-provided BTP CF test subaccount with one PrincipalPropagation destination (never prod)
Transport / branch: n/a / feat/multi-target-pinned-writes
Clean core level: n/a (server code)

## Goal (from the approved design)

Effective write permission for one call =
`ARC1_MULTI_TARGET_ALLOW_WRITES` (instance) ∧ `arc1.allow_writes` (destination) ∧ PrincipalPropagation
identity ∧ pinned route `/<SYSTEM-OR-ALIAS>/<CLIENT>/mcp` ∧ XSUAA scope ∧ SAP authorization.
`/multi/mcp` and every BasicAuthentication target stay mutation-free, enforced in the safety ceiling
(required `route` parameter) **and** in the tool surface.

## Preflight (main session, before Task 1)

```bash
cd /Users/wouterlemaire/projects/claude-code-setup/customers/personal/projects/arc-1
git switch main && git pull --ff-only
git switch -c feat/multi-target-pinned-writes
npm ci && npm test 2>&1 | tail -5     # baseline must be green before any task starts
wc -l src/server/server.ts             # expect 1494 == its BUDGET (see Plan risks R1)
```

## Seams verified in the current code (2026-10-03, main @ 1f00c7ac)

| Seam | Location | What it does today |
|---|---|---|
| Supported destination keys | `src/server/multi-target-destination-config.ts:8-21` | `MULTI_TARGET_ARC_PROPERTIES` (4 keys) + `WRITE_ARC_PROPERTIES` (4 write keys) |
| Value retention | `src/server/destination-discovery.ts:86-95`, `src/server/multi-target-destination-runtime.ts:99-104` | Values of keys **not** in `MULTI_TARGET_ARC_PROPERTIES` are blanked to `''` at discovery and at runtime drift projection |
| Write quarantine | `src/server/destination-registry.ts:253-274` | any write key → `UNSUPPORTED_V1_WRITE_CONFIG` (before authentication is known) |
| Policy + fingerprint | `destination-registry.ts:159-176` (`targetFingerprint`), `:455-462` (requested/effective), `:502-505` (`limitedByInstance`) | data/SQL only; fingerprint built from `requestedPolicy` |
| Safety ceiling | `destination-registry.ts:779-804` | `multiTargetSafety(policy, blockedDataSources)` hardcodes writes false, `['$TMP']` |
| Runtime config | `src/server/multi-target-runtime.ts:20-116` | `buildReadOnlyRuntimeConfig` (no `...base` spread), `buildMultiTargetConfig(base, target)`, `buildAggregateToolSurfaceConfig` |
| Per-call config (both routes) | `src/server/multi-target-server.ts:458-481` | `buildMultiTargetConfig(options.instanceConfig, selectedTarget)` + `multiTargetInvocationDecision` — **one** function serves pinned and aggregate; `options.mode` is the route |
| Pinned factory | `src/server/server.ts:1463-1471` | `buildMultiTargetConfig(config, target)` → `createServer(targetConfig, { multiTarget: { mode: 'pinned', … } })` |
| Aggregate factory | `src/server/server.ts:1386-1397` | `buildAggregateToolSurfaceConfig(config, registry.targets)` |
| tools/list seam | `src/server/server.ts:734-747` | `getConfiguredToolDefinitions(config, …)` then **always** `multiTargetToolDefinitions(tools, config)` (v1 allowlist, forces `readOnlyHint`) |
| Read-only surface | `src/server/multi-target-tools.ts:11-151` | `MULTI_TARGET_TOOLS`, `MULTI_TARGET_ACTION_RULES`, `ALLOWED_OPS`, `pruneDefinition` |
| Instructions | `src/server/multi-target-server.ts:22-54` | aggregate / pinned-shared / pinned-PP texts, all read-only |
| Pinned OAuth PRM | `src/server/http.ts:285`, `:695-703` | `MULTI_TARGET_SCOPES_SUPPORTED = ['read','data','sql','admin']` for **every** pinned route (registry-independent) |
| Instance flags | `src/server/config.ts:134-139` (CLI registry), `:814-825` (parse), `:1037-1082` (validate); `src/server/types.ts:135-139`, `:299-300` | pattern to copy for the three new keys |
| File-size ratchet | `scripts/ci/check-file-sizes.mjs:86` | `src/server/server.ts` budget **1494 = current size**; others default 1500 (src) / 3000 (tests) |

## Task overview

| # | Task | Agent | Kind | Risk | Depends | Parallel-safe |
|---|------|-------|------|------|---------|---------------|
| 1 | Write ADR-0008 and governance docs | sap:doc-writer | judgement | high | — | yes (docs only) with 2, 3 |
| 2 | Freeze the multi-target tool surface as fixtures | general-purpose (TypeScript) | mechanical | normal | — | yes with 1, 3 |
| 3 | Add the instance write ceilings | general-purpose (TypeScript) | mechanical | normal | — | yes with 1, 2 |
| 4 | Extract a shared allowed-packages parser + validator | general-purpose (TypeScript) | mechanical | normal | 3 | no (touches config.ts) |
| 5 | Parse destination write policy in the registry | general-purpose (TypeScript) | judgement | high | 3, 4 | no |
| 6 | Bind the safety ceiling to a required route | general-purpose (TypeScript) | judgement | high | 5 | no |
| 7 | Route the tool surface, invocation gate and instructions | general-purpose (TypeScript) | judgement | high | 2, 6 | no |
| 8 | Advertise write scopes on pinned PRM | general-purpose (TypeScript) | judgement | high | 3 | yes with 5–7 (http.ts only) |
| 9 | Add end-to-end unit coverage for the five keys | general-purpose (TypeScript) | judgement | normal | 7, 8 | no |
| 10 | Update user and operator docs | sap:doc-writer | judgement | normal | 1, 7, 8 | yes with 9 |
| 11 | Run the full gate and the live checklist | general-purpose (TypeScript) + user | mechanical | high | 1–10 | no |
| 12 | Release: PR to arc-mcp/arc-1 | main session (sap:finishing-work) | mechanical | normal | 11 | no |

All tasks commit to `feat/multi-target-pinned-writes`. "Parallel-safe" means no file overlap; run
parallel tasks in separate worktrees and rebase before committing, or run them sequentially.

---

### Task 1: Write ADR-0008 and governance docs
Agent: sap:doc-writer
Depends on: — · Parallel-safe: yes (docs only) · Kind: judgement · Risk: high

Objects/files:
- Create: `docs/adr/0008-opt-in-writes-on-pinned-multi-target-routes.md`
- Modify: `docs/adr/0006-experimental-read-only-multi-target.md` (header lines 3-9)
- Modify: `docs/adr/0007-shared-basic-identity-for-read-only-multi-target.md` (header lines 3-8)
- Modify: `docs/plans/destination-discovered-multi-target-v1.md` (Status block, lines 3-12)
- Modify: `docs/plans/multi-target-v2-roadmap.md` (Status block lines 3-8; V2-02B/V2-08 rows lines 48-55)
- Modify: `docs/security-model.md` (§4 table lines 185-189; §5 register — append R22 after R20 row at line 249, before `### R21`)
- Modify: `AGENTS.md` (principle 7 lines 23-26; config table after line 124; Key-files row "Multi-target ADR-0006/0007 work"; invariant at line 372)
- Modify: `docs_page/roadmap.md` (FEAT-59 lines 151-156; OPS-06 lines 736-742)

Steps:
1. ADR-0008 sections (same layout as ADR-0006/0007): Status `Accepted — Experimental and default-off`,
   Date 2026-10-03, **Amends** ADR-0006 (pinned PP routes only), **Leaves unchanged** ADR-0007.
   Context: why v1 was mutation-free (PR #543 confused-deputy). Decision: the six-key conjunction from
   the Goal above; the instance keys `ARC1_MULTI_TARGET_ALLOW_WRITES` / `_TRANSPORT_WRITES` / `_GIT_WRITES`;
   destination keys `arc1.allow_writes`, `arc1.allowed_packages` (required, no implicit `$TMP`),
   `arc1.allow_transport_writes`, `arc1.allow_git_writes`; quarantine codes
   `WRITE_REQUIRES_PRINCIPAL_PROPAGATION`, `INVALID_WRITE_POLICY`; narrowing (requested vs effective);
   fingerprint/drift (`TARGET_CONFIG_CHANGED`); aggregate always mutation-free (safety ceiling `route`
   parameter + tool surface); pinned PRM advertises `write`/`transports`/`git` only when the instance
   ceiling is on (Task 8). Rejected alternatives: destination-only, shared Basic writes, aggregate writes
   (one line each, from the design). **Explicit deviation section**: this ADR does not implement the
   v2 roadmap prerequisites V2-02B (per-target grants) and V2-05 (OAuth client spike); scopes remain
   instance-wide and `admin` still implies `write` (see Open questions Q1). Consequences + residual risk R22.
2. ADR-0006 header: add after line 9
   ```markdown
   **Amended by:** [ADR-0008](0008-opt-in-writes-on-pinned-multi-target-routes.md) — opt-in writes on
   pinned Principal Propagation routes only; `/multi/mcp` stays mutation-free
   ```
   ADR-0007 header: add after line 8
   ```markdown
   **Unchanged by:** [ADR-0008](0008-opt-in-writes-on-pinned-multi-target-routes.md) — shared Basic
   targets remain mutation-free; any write property quarantines them
   ```
3. v1 plan Status: add bullet `- **Amended:** ADR-0008 (2026-10-03) permits opt-in pinned PP writes; the
   v1 contract below stays normative for the aggregate route and Basic targets.` v2 roadmap: add
   Status bullet noting V2-08 was delivered by ADR-0008 without V2-02B/V2-05, and why (user decision
   2026-10-03).
4. security-model.md §5: append
   ```markdown
   | R22 | **Pinned connector against the wrong system (ADR-0008).** A user configures a writable pinned route (`/<SID>/<CLIENT>/mcp`) believing it is a sandbox. Mitigations: write needs instance ceiling ∧ destination opt-in ∧ PP ∧ pinned route ∧ XSUAA scope ∧ SAP auth; the route and server instructions name SID/client and allowed packages; `arc1.allowed_packages` is mandatory; production destinations omit `arc1.allow_writes`; `/multi/mcp` can never mutate. | Med | multi-target + `ARC1_MULTI_TARGET_ALLOW_WRITES` | [`destination-registry.ts`](../src/server/destination-registry.ts), [`multi-target-tools.ts`](../src/server/multi-target-tools.ts) | by design / documented |
   ```
   §4 table: add row `| **HTTP multi-target pinned writes (ADR-0008)** | per-user PP only | I1 now applies on pinned routes: package gate on the object's real package, per destination |`.
5. AGENTS.md principle 7 — replace lines 23-26 text
   `**Single target by default; one experimental read-only BTP exception** — ADR-0005 remains the rule … without a new ADR/security review.`
   so that it names ADR-0008: "ADR-0008 permits default-off, two-key, PP-only writes on pinned
   routes; `/multi/mcp` and Basic targets stay mutation-free." Add three config rows after line 124:
   ```markdown
   | `ARC1_MULTI_TARGET_ALLOW_WRITES` | Default false. ADR-0008 instance ceiling for writes on pinned PrincipalPropagation routes; destination must also set `arc1.allow_writes=true` + `arc1.allowed_packages`. `/multi/mcp` never mutates. |
   | `ARC1_MULTI_TARGET_ALLOW_TRANSPORT_WRITES` / `ARC1_MULTI_TARGET_ALLOW_GIT_WRITES` | Default false. Sub-ceilings for transport / Git mutations on writable pinned targets; startup fails unless `ARC1_MULTI_TARGET_ALLOW_WRITES=true`. |
   ```
   Invariant at line 372 ("Multi-system boundary"): add ADR-0008 as the only sanctioned write exception.
   Key-files row: append `docs/adr/0008-opt-in-writes-on-pinned-multi-target-routes.md` and
   `docs/plans/2026-10-03-multi-target-pinned-writes.md`; keep the row ≤1 gotcha.
6. roadmap.md FEAT-59 line 156: replace
   `and upgrade requirements. Do not widen the mutation-free multi-target contract as a shortcut.` with
   `and upgrade requirements. ADR-0008 opened writes only on pinned Principal Propagation routes; do not widen it to aggregate, shared Basic, or embedded tenants as a shortcut.`
   and line 151-152 `Experimental read-only multi-target HTTP routing is implemented` →
   `Experimental multi-target HTTP routing (read-only aggregate, opt-in writable pinned PP routes) is implemented`.
   OPS-06: append one sentence — writable pinned targets add stateful lock sessions per call, which raises
   the relevance of this item. No item is removed (none tracked pinned writes).
7. Commit: `docs: add ADR-0008 for opt-in writes on pinned multi-target routes`

Verify:
- `grep -n "ADR-0008" AGENTS.md docs/adr/0006-experimental-read-only-multi-target.md docs/adr/0007-shared-basic-identity-for-read-only-multi-target.md docs/security-model.md docs_page/roadmap.md` → ≥1 hit per file.
- `npx vitest run tests/unit/server/btp-docs-contract.test.ts tests/unit/server/release-notes.test.ts` → all pass (docs contracts untouched).

---

### Task 2: Freeze the multi-target tool surface as fixtures
Agent: general-purpose (TypeScript)
Depends on: — · Parallel-safe: yes · Kind: mechanical · Risk: normal

Why: there is **no** multi-target fixture in `tests/fixtures/tool-definitions/` today (only assertion
tests in `tests/unit/server/multi-target-tools.test.ts`). Playbook rule 1: freeze the observable surface
before changing it, so Task 7 can prove aggregate and read-only-pinned bytes are unchanged.

Objects/files:
- Modify: `tests/unit/handlers/tool-definitions-snapshot.test.ts` (append a describe block after line 129)
- Create (generated): `tests/fixtures/tool-definitions/multi-target-readonly.json`,
  `tests/fixtures/tool-definitions/multi-target-data-sql.json`,
  `tests/fixtures/tool-definitions/multi-target-aggregate-one-target.json`

Steps:
1. Append (test-first is N/A: this is a characterization test; it must pass on current main):
   ```ts
   describe('multi-target tool surface snapshot (LLM-visible, ADR-0006/0008)', () => {
     const multiTargetTarget = {
       target: 'A4H/100', sid: 'A4H', client: '100', description: 'A4H development', language: 'EN',
       destinationName: 'ARC1_A4H_100_PP', authentication: 'PrincipalPropagation' as const,
       identity: 'per-user' as const, proxyType: 'OnPremise' as const, hasCloudConnectorLocationId: false,
       requestedPolicy: { allowDataPreview: false, allowFreeSQL: false },
       effectivePolicy: { allowDataPreview: false, allowFreeSQL: false },
       connectionFingerprint: 'connection', fingerprint: 'fingerprint',
     };
     const surfaces: Array<[string, ServerConfig]> = [
       ['multi-target-readonly', { ...DEFAULT_CONFIG, multiTargetEndpoints: true }],
       ['multi-target-data-sql', { ...DEFAULT_CONFIG, multiTargetEndpoints: true, allowDataPreview: true, allowFreeSQL: true }],
     ];
     for (const [name, config] of surfaces) {
       it(`is stable: ${name}`, async () => {
         const tools = multiTargetToolDefinitions(getToolDefinitions(config), config);
         await expect(JSON.stringify(tools, null, 2)).toMatchFileSnapshot(`../../fixtures/tool-definitions/${name}.json`);
       });
     }
     it('is stable: multi-target-aggregate-one-target', async () => {
       const config = { ...DEFAULT_CONFIG, multiTargetEndpoints: true };
       const tools = multiTargetToolDefinitions(getToolDefinitions(config), config).map((tool) =>
         injectTargetSchema(tool, [multiTargetTarget]),
       );
       await expect(JSON.stringify(tools, null, 2)).toMatchFileSnapshot(
         '../../fixtures/tool-definitions/multi-target-aggregate-one-target.json',
       );
     });
   });
   ```
   Add imports `DEFAULT_CONFIG` (`../../../src/server/types.js`) and `injectTargetSchema, multiTargetToolDefinitions` (`../../../src/server/multi-target-tools.js`).
   When Task 5 adds fields to `TargetPolicy`, Task 5 updates this literal (`...READ_ONLY_WRITE_POLICY`) — the JSON output does not contain the policy, so the fixture bytes stay identical.
2. Run `npx vitest run tests/unit/handlers/tool-definitions-snapshot.test.ts -u` once to write the three fixtures; then run without `-u` → pass.
3. Commit: `test: freeze multi-target tool-definition fixtures`

Verify: `npx vitest run tests/unit/handlers/tool-definitions-snapshot.test.ts` → all pass; `git status --short tests/fixtures/tool-definitions` → exactly the 3 new files.

---

### Task 3: Add the instance write ceilings
Agent: general-purpose (TypeScript)
Depends on: — · Parallel-safe: yes · Kind: mechanical · Risk: normal

Objects/files:
- Modify: `src/server/types.ts` (interface lines 135-139; defaults lines 299-300)
- Modify: `src/server/config.ts` (CLI registry lines 134-139; parse lines 814-825; `validateConfig` lines 1076-1082)
- Modify: `.env.example` (next to line 44 `# ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH=false`)
- Modify: `mta.yaml` (commented block lines 181-188)
- Modify: `examples/btp/multi-pp/profile.mtaext` (after line 10)
- Test: `tests/unit/server/config.test.ts`, `tests/unit/server/mta-descriptor.test.ts`

Steps:
1. Failing tests in `config.test.ts` (inside `describe('parseArgs')`, which already clears `ARC1_*` env):
   ```ts
   it('parses the default-off multi-target write ceilings', () => {
     process.env.ARC1_MULTI_TARGET_ENDPOINTS = 'true';
     process.env.SAP_TRANSPORT = 'http-streamable';
     process.env.SAP_XSUAA_AUTH = 'true';
     process.env.ARC1_CACHE = 'none';
     process.env.ARC1_MULTI_TARGET_ALLOW_WRITES = 'true';
     process.env.ARC1_MULTI_TARGET_ALLOW_TRANSPORT_WRITES = 'true';
     const { config, sources } = resolveConfig([]);
     expect(config.multiTargetAllowWrites).toBe(true);
     expect(config.multiTargetAllowTransportWrites).toBe(true);
     expect(config.multiTargetAllowGitWrites).toBe(false);
     expect(sources.multiTargetAllowWrites).toEqual({ env: 'ARC1_MULTI_TARGET_ALLOW_WRITES' });
     // The single-target ceilings stay independent (design: no leakage either way).
     expect(config.allowWrites).toBe(false);
   });

   it.each(['ARC1_MULTI_TARGET_ALLOW_TRANSPORT_WRITES', 'ARC1_MULTI_TARGET_ALLOW_GIT_WRITES'])(
     'rejects %s without the master multi-target write ceiling',
     (key) => {
       process.env[key] = 'true';
       expect(() => parseArgs([])).toThrow(/require ARC1_MULTI_TARGET_ALLOW_WRITES=true/);
     },
   );

   it('warns when the multi-target write ceiling is set without multi-target mode', () => {
     const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
     try {
       process.env.ARC1_MULTI_TARGET_ALLOW_WRITES = 'true';
       parseArgs([]);
       expect(stderrSpy).toHaveBeenCalledWith(
         expect.stringContaining('ARC1_MULTI_TARGET_ALLOW_WRITES=true has no effect without ARC1_MULTI_TARGET_ENDPOINTS=true'),
       );
     } finally {
       stderrSpy.mockRestore();
     }
   });
   ```
   Also extend the defaults test (line ~44 `expect(config.multiTargetAllowBasicAuth).toBe(false);`) with the three new fields `toBe(false)`.
   If the first test needs more multi-target prerequisites, copy them from the existing passing
   multi-target test in this file (`grep -n "ARC1_MULTI_TARGET_ENDPOINTS" tests/unit/server/config.test.ts`).
2. Run `npx vitest run tests/unit/server/config.test.ts` → fails (TS: property does not exist / `undefined`).
3. `types.ts` — after line 139 (`multiTargetAllowBasicAuth: boolean;`) add:
   ```ts
   /** ADR-0008 master ceiling: writes on pinned PrincipalPropagation routes. Default false. */
   multiTargetAllowWrites: boolean;
   /** ADR-0008 transport-mutation ceiling; requires multiTargetAllowWrites. Default false. */
   multiTargetAllowTransportWrites: boolean;
   /** ADR-0008 abapGit/gCTS-mutation ceiling; requires multiTargetAllowWrites. Default false. */
   multiTargetAllowGitWrites: boolean;
   ```
   and after line 300 (`multiTargetAllowBasicAuth: false,`): `multiTargetAllowWrites: false, multiTargetAllowTransportWrites: false, multiTargetAllowGitWrites: false,` (one per line).
4. `config.ts` CLI registry — after lines 135-139 (the `multi-target-allow-basic-auth` entry) add three
   entries in the same shape: `multi-target-allow-writes` ("Allow writes on pinned PP multi-target routes (true/false)"),
   `multi-target-allow-transport-writes`, `multi-target-allow-git-writes`.
   Parse — after line 825 (end of the `multiTargetAllowBasicAuth = resolveBool(…)` call):
   ```ts
   config.multiTargetAllowWrites = resolveBool(
     'multi-target-allow-writes', 'ARC1_MULTI_TARGET_ALLOW_WRITES', false, 'multiTargetAllowWrites',
   );
   config.multiTargetAllowTransportWrites = resolveBool(
     'multi-target-allow-transport-writes', 'ARC1_MULTI_TARGET_ALLOW_TRANSPORT_WRITES', false, 'multiTargetAllowTransportWrites',
   );
   config.multiTargetAllowGitWrites = resolveBool(
     'multi-target-allow-git-writes', 'ARC1_MULTI_TARGET_ALLOW_GIT_WRITES', false, 'multiTargetAllowGitWrites',
   );
   ```
   Validate — after the existing block at lines 1076-1082:
   ```ts
     // This opt-in is evaluated only by the multi-target runtime. …
     if (config.multiTargetAllowBasicAuth && !config.multiTargetEndpoints) {
       console.error(
         '[warn] ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH=true has no effect without ARC1_MULTI_TARGET_ENDPOINTS=true — ignoring the shared Basic opt-in.',
       );
     }
   ```
   insert:
   ```ts
   if ((config.multiTargetAllowTransportWrites || config.multiTargetAllowGitWrites) && !config.multiTargetAllowWrites) {
     throw new Error(
       'ARC1_MULTI_TARGET_ALLOW_TRANSPORT_WRITES and ARC1_MULTI_TARGET_ALLOW_GIT_WRITES require ARC1_MULTI_TARGET_ALLOW_WRITES=true.',
     );
   }
   if (config.multiTargetAllowWrites && !config.multiTargetEndpoints) {
     console.error(
       '[warn] ARC1_MULTI_TARGET_ALLOW_WRITES=true has no effect without ARC1_MULTI_TARGET_ENDPOINTS=true — ignoring the multi-target write ceiling.',
     );
   }
   ```
5. `.env.example`: add commented `# ARC1_MULTI_TARGET_ALLOW_WRITES=false`, `# ARC1_MULTI_TARGET_ALLOW_TRANSPORT_WRITES=false`,
   `# ARC1_MULTI_TARGET_ALLOW_GIT_WRITES=false` with a one-line ADR-0008 comment (agent tooling may block
   reading `.env*`; edit with `Edit` after `Read`, or ask the lead).
   `mta.yaml`: after line 188 add a commented block (keep shipped defaults off — no active key, so
   `mta-descriptor.test.ts` base env is unchanged):
   ```yaml
         # Optional ADR-0008 writes on pinned PrincipalPropagation routes only. Each
         # destination must also opt in with arc1.allow_writes=true and
         # arc1.allowed_packages. /multi/mcp and Basic targets never mutate.
         # ARC1_MULTI_TARGET_ALLOW_WRITES: "true"
         # ARC1_MULTI_TARGET_ALLOW_TRANSPORT_WRITES: "true"
         # ARC1_MULTI_TARGET_ALLOW_GIT_WRITES: "true"
   ```
   `examples/btp/multi-pp/profile.mtaext`: after line 10 add `ARC1_MULTI_TARGET_ALLOW_WRITES: "false"` (explicit off, same pattern as line 10).
6. `mta-descriptor.test.ts`: add after the Basic test (line 167):
   ```ts
   it('ships multi-target writes off and boots with the explicit pinned-write opt-in', () => {
     expect(resolveWithOverrides({ ARC1_MULTI_TARGET_ENDPOINTS: 'true', ARC1_CACHE: 'none', ARC1_TOOL_MODE: 'standard', ARC1_UI: 'off' }).multiTargetAllowWrites).toBe(false);
     const config = resolveWithOverrides({
       ARC1_MULTI_TARGET_ENDPOINTS: 'true', ARC1_MULTI_TARGET_ALLOW_WRITES: 'true',
       ARC1_CACHE: 'none', ARC1_TOOL_MODE: 'standard', ARC1_UI: 'off',
     });
     expect(config.multiTargetAllowWrites).toBe(true);
     expect(config.allowWrites).toBe(false);
   });
   ```
7. Run → pass. Commit: `feat: add ARC1_MULTI_TARGET_ALLOW_*WRITES instance ceilings`

Verify:
- `npx vitest run tests/unit/server/config.test.ts tests/unit/server/mta-descriptor.test.ts tests/unit/server/btp-pp-profiles.test.ts` → all pass.
- `npm run typecheck` → exit 0.

---

### Task 4: Extract a shared allowed-packages parser + validator
Agent: general-purpose (TypeScript)
Depends on: 3 · Parallel-safe: no (config.ts) · Kind: mechanical · Risk: normal

There is **no** reusable allowed-packages parser today: `config.ts:667-693` splits inline and
`safety.ts` only evaluates (`decidePackageAllowed`, lines 167-196). Extract the split (move-only for
`SAP_ALLOWED_PACKAGES` behaviour) and add a strict validator used only by destinations.

Objects/files:
- Modify: `src/adt/safety.ts` (add after `SUBTREE_SUFFIX`, line 27)
- Modify: `src/server/config.ts` lines 667-690
- Test: `tests/unit/adt/safety.test.ts` (create the describe block; `ls tests/unit/adt/safety*.test.ts` first and append to the existing file if present)

Steps:
1. Failing test:
   ```ts
   import { isValidAllowedPackagePattern, splitAllowedPackageList } from '../../../src/adt/safety.js';

   describe('allowed-package list parsing', () => {
     it('splits, trims and reports empty entries without inventing defaults', () => {
       expect(splitAllowedPackageList('$TMP, Z*')).toEqual({ entries: ['$TMP', 'Z*'], hadEmptyEntries: false });
       expect(splitAllowedPackageList('$TMP,,Z*')).toEqual({ entries: ['$TMP', 'Z*'], hadEmptyEntries: true });
       expect(splitAllowedPackageList(' , ')).toEqual({ entries: [], hadEmptyEntries: true });
     });
     it.each(['$TMP', 'Z*', 'ZFOO/**', '*', '/ABC/ZPKG', '/ABC/Z*', 'zlower'])('accepts %s', (entry) => {
       expect(isValidAllowedPackagePattern(entry)).toBe(true);
     });
     it.each(['', '**', '/**', 'Z**', 'Z*X', 'Z FOO', '__ARC1_DENY_ALL__X;', 'A'.repeat(31), 'ZFOO/**/X'])('rejects %s', (entry) => {
       expect(isValidAllowedPackagePattern(entry)).toBe(false);
     });
   });
   ```
2. Run `npx vitest run tests/unit/adt/safety.test.ts` → fails (exports missing).
3. Implement in `safety.ts` after line 27:
   ```ts
   /** Split a comma-separated allowedPackages value. Never substitutes a default — callers decide. */
   export function splitAllowedPackageList(raw: string): { entries: string[]; hadEmptyEntries: boolean } {
     const parts = raw.split(',').map((part) => part.trim());
     const entries = parts.filter((part) => part.length > 0);
     return { entries, hadEmptyEntries: entries.length !== parts.length };
   }

   // `*`, exact name, `PREFIX*`, or `ROOT/**`; SAP package names are ≤30 chars incl. /NAMESPACE/.
   const PACKAGE_NAME = '(?:/[A-Z0-9_]{1,10}/)?[A-Z0-9_$]{1,30}';
   const ALLOWED_PACKAGE_PATTERN = new RegExp(`^(?:\\*|${PACKAGE_NAME}\\*?|${PACKAGE_NAME}/\\*\\*)$`, 'i');

   /** Strict syntax check for destination-supplied allowedPackages entries (ADR-0008). */
   export function isValidAllowedPackagePattern(entry: string): boolean {
     return entry.length <= 34 && ALLOWED_PACKAGE_PATTERN.test(entry);
   }
   ```
   (Implementer: adjust the regex until the test table passes; keep the length bound. `'/ABC/Z*'`
   must pass, `'A'.repeat(31)` must fail.)
4. Replace in `config.ts` lines 669-670
   ```ts
       const raw = pkgs.split(',').map((p) => p.trim());
       const filtered = raw.filter((p) => p.length > 0);
   ```
   with `const { entries: filtered, hadEmptyEntries } = splitAllowedPackageList(pkgs);` and line 681
   `if (raw.length !== filtered.length) {` with `if (hadEmptyEntries) {`. Do **not** apply the strict
   validator to `SAP_ALLOWED_PACKAGES` (behaviour-preserving; see Plan risks R7).
5. Run `npx vitest run tests/unit/adt/safety.test.ts tests/unit/server/config.test.ts` → pass.
6. Commit: `refactor: share the allowed-packages splitter and add a strict pattern validator`

Verify: `npx vitest run tests/unit/adt tests/unit/server/config.test.ts` → pass; `npm run typecheck` → exit 0.

---

### Task 5: Parse destination write policy in the registry
Agent: general-purpose (TypeScript)
Depends on: 3, 4 · Parallel-safe: no · Kind: judgement · Risk: high

Objects/files:
- Modify: `src/server/multi-target-destination-config.ts` (whole file, 38 lines)
- Modify: `src/server/destination-registry.ts` — `TargetExclusionCode` (lines 17-45), `TargetPolicy`
  (47-50), `TargetDiagnostic.arcConfig` (89-96), `targetFingerprint` (159-176), `immutableArcConfig`
  (178-191), `evaluate` loop (253-274), policy block (455-462), `limitedByInstance` (502-504)
- Modify (literal fixtures that must satisfy the grown `TargetPolicy`): `tests/unit/server/multi-target-tools.test.ts:27-28`,
  `scripts/ci/check-tool-schema-budget.ts:149-150`, `tests/unit/handlers/tool-definitions-snapshot.test.ts` (Task 2 literal),
  `tests/unit/server/btp-pp-profiles.test.ts:161`
- Test: `tests/unit/server/multi-target-destination-config.test.ts`, `tests/unit/server/destination-registry.test.ts`,
  `tests/unit/server/multi-target-runtime.test.ts` (drift)

Steps:
1. Failing tests.
   `multi-target-destination-config.test.ts`: change the list expectation (line 11-16) to include
   `'arc1.allow_writes', 'arc1.allowed_packages', 'arc1.allow_transport_writes', 'arc1.allow_git_writes'`, and add:
   ```ts
   describe('parseDestinationWritePolicy', () => {
     const pp = 'PrincipalPropagation' as const;
     it('returns the read-only policy when no write key is present', () => {
       expect(parseDestinationWritePolicy({ 'arc1.enabled': 'true' }, pp)).toEqual({ ok: true, policy: READ_ONLY_WRITE_POLICY });
     });
     it('accepts a complete PP write opt-in', () => {
       expect(parseDestinationWritePolicy({ 'arc1.allow_writes': 'true', 'arc1.allowed_packages': '$TMP, ZTEAM*', 'arc1.allow_transport_writes': 'true' }, pp))
         .toEqual({ ok: true, policy: { allowWrites: true, allowedPackages: ['$TMP', 'ZTEAM*'], allowTransportWrites: true, allowGitWrites: false } });
     });
     it.each([
       [{ 'arc1.allow_writes': 'true', 'arc1.allowed_packages': '$TMP' }, 'BasicAuthentication', 'WRITE_REQUIRES_PRINCIPAL_PROPAGATION'],
       [{ 'arc1.allowed_packages': '$TMP' }, 'BasicAuthentication', 'WRITE_REQUIRES_PRINCIPAL_PROPAGATION'],
       [{ 'arc1.allow_git_writes': 'yes' }, 'BasicAuthentication', 'WRITE_REQUIRES_PRINCIPAL_PROPAGATION'],
       [{ 'arc1.allow_writes': 'yes', 'arc1.allowed_packages': '$TMP' }, pp, 'INVALID_WRITE_POLICY'],
       [{ 'arc1.allow_writes': 'true' }, pp, 'INVALID_WRITE_POLICY'],
       [{ 'arc1.allow_writes': 'true', 'arc1.allowed_packages': '' }, pp, 'INVALID_WRITE_POLICY'],
       [{ 'arc1.allow_writes': 'true', 'arc1.allowed_packages': '$TMP,,Z*' }, pp, 'INVALID_WRITE_POLICY'],
       [{ 'arc1.allow_writes': 'true', 'arc1.allowed_packages': 'Z**' }, pp, 'INVALID_WRITE_POLICY'],
       [{ 'arc1.allow_transport_writes': 'true' }, pp, 'INVALID_WRITE_POLICY'],
       [{ 'arc1.allow_writes': 'false', 'arc1.allow_git_writes': 'true' }, pp, 'INVALID_WRITE_POLICY'],
     ] as const)('rejects %o on %s with %s', (properties, auth, code) => {
       expect(parseDestinationWritePolicy(properties, auth)).toMatchObject({ ok: false, code });
     });
     it('keeps a Basic destination with only explicit false write keys as a read target (Q3)', () => {
       expect(parseDestinationWritePolicy({ 'arc1.allow_writes': 'false', 'arc1.allow_git_writes': 'false' }, 'BasicAuthentication'))
         .toEqual({ ok: true, policy: READ_ONLY_WRITE_POLICY });
     });
     it('keeps allow_writes=false read-only even when packages are listed', () => {
       expect(parseDestinationWritePolicy({ 'arc1.allow_writes': 'false', 'arc1.allowed_packages': 'Z*' }, pp))
         .toEqual({ ok: true, policy: READ_ONLY_WRITE_POLICY });
     });
   });
   ```
   `destination-registry.test.ts`: replace line 132
   `[{ arcProperties: { 'arc1.enabled': 'true', 'arc1.allow_writes': 'true' } }, 'UNSUPPORTED_V1_WRITE_CONFIG'],`
   with `[{ arcProperties: { 'arc1.enabled': 'true', 'arc1.allow_writes': 'true' } }, 'INVALID_WRITE_POLICY'],` and add:
   ```ts
   const writeProps = { 'arc1.enabled': 'true', 'arc1.allow_writes': 'true', 'arc1.allowed_packages': '$TMP,Z*' };

   it('enables a requested PP write policy only under the instance ceiling', () => {
     const narrowed = DestinationRegistry.fromDiscovery(discovery([destination({ arcProperties: writeProps })]), DEFAULT_CONFIG);
     expect(narrowed.targets[0]).toMatchObject({
       requestedPolicy: { allowWrites: true, allowedPackages: ['$TMP', 'Z*'] },
       effectivePolicy: { allowWrites: false, allowedPackages: ['$TMP'], allowTransportWrites: false, allowGitWrites: false },
     });
     expect(narrowed.diagnostics[0]).toMatchObject({ status: 'active', limitedByInstance: true });

     const enabled = DestinationRegistry.fromDiscovery(
       discovery([destination({ arcProperties: { ...writeProps, 'arc1.allow_transport_writes': 'true', 'arc1.allow_git_writes': 'true' } })]),
       { ...DEFAULT_CONFIG, multiTargetAllowWrites: true, multiTargetAllowTransportWrites: true },
     );
     expect(enabled.targets[0].effectivePolicy).toEqual({
       allowDataPreview: false, allowFreeSQL: false, allowWrites: true, allowedPackages: ['$TMP', 'Z*'],
       allowTransportWrites: true, allowGitWrites: false, // git ceiling off → narrowed
     });
   });

   it('quarantines write properties on shared Basic destinations', () => {
     const registry = DestinationRegistry.fromDiscovery(
       discovery([destination({ authentication: 'BasicAuthentication', arcProperties: writeProps })]),
       { ...DEFAULT_CONFIG, multiTargetAllowBasicAuth: true, multiTargetAllowWrites: true },
     );
     expect(registry.targets).toHaveLength(0);
     expect(registry.diagnostics[0]).toMatchObject({ status: 'quarantined', code: 'WRITE_REQUIRES_PRINCIPAL_PROPAGATION' });
   });

   it('changes the fingerprint when any write property changes', () => {
     const fp = (props: Record<string, string>) =>
       DestinationRegistry.fromDiscovery(discovery([destination({ arcProperties: props })]), DEFAULT_CONFIG).targets[0].fingerprint;
     const base = fp(writeProps);
     expect(fp({ ...writeProps, 'arc1.allow_writes': 'false' })).not.toBe(base);
     expect(fp({ ...writeProps, 'arc1.allowed_packages': '$TMP' })).not.toBe(base);
     expect(fp({ ...writeProps, 'arc1.allow_transport_writes': 'true' })).not.toBe(base);
   });
   ```
   `multi-target-runtime.test.ts` (uses its `destination()` helper at lines ~55-78): add
   ```ts
   it('reports TARGET_CONFIG_CHANGED when arc1.allow_writes changes after startup', () => {
     const startup = destination({ originalProperties: { 'arc1.allow_writes': 'true', 'arc1.allowed_packages': '$TMP' } });
     const projected = projectMultiTargetDestination(startup)!;
     const target = evaluateStandaloneTargetDescriptor(projected, DEFAULT_CONFIG)!;
     const changed = destination({ originalProperties: { 'arc1.allow_writes': 'false', 'arc1.allowed_packages': '$TMP' } });
     expect(validateTargetDrift(changed, target, DEFAULT_CONFIG)).toMatchObject({ ok: false, code: 'TARGET_CONFIG_CHANGED' });
     expect(validateTargetDrift(startup, target, DEFAULT_CONFIG)).toMatchObject({ ok: true });
   });
   ```
2. Run `npx vitest run tests/unit/server/multi-target-destination-config.test.ts tests/unit/server/destination-registry.test.ts tests/unit/server/multi-target-runtime.test.ts` → fails.
3. Implement `multi-target-destination-config.ts`. Replace lines 8-21
   ```ts
   export const MULTI_TARGET_ARC_PROPERTIES = Object.freeze([
     'arc1.enabled',
     'arc1.allow_data_preview',
     'arc1.allow_free_sql',
     'arc1.target_alias',
   ]);

   const SUPPORTED_ARC_PROPERTIES = new Set(MULTI_TARGET_ARC_PROPERTIES);
   const WRITE_ARC_PROPERTIES = new Set([
     'arc1.allow_writes',
     'arc1.allowed_packages',
     'arc1.allow_transport_writes',
     'arc1.allow_git_writes',
   ]);
   ```
   with
   ```ts
   const WRITE_ARC_PROPERTY_LIST = Object.freeze([
     'arc1.allow_writes',
     'arc1.allowed_packages',
     'arc1.allow_transport_writes',
     'arc1.allow_git_writes',
   ]);

   // Write keys are supported (ADR-0008) so discovery and runtime drift projection retain their values.
   export const MULTI_TARGET_ARC_PROPERTIES = Object.freeze([
     'arc1.enabled',
     'arc1.allow_data_preview',
     'arc1.allow_free_sql',
     'arc1.target_alias',
     ...WRITE_ARC_PROPERTY_LIST,
   ]);

   const SUPPORTED_ARC_PROPERTIES = new Set(MULTI_TARGET_ARC_PROPERTIES);
   const WRITE_ARC_PROPERTIES = new Set(WRITE_ARC_PROPERTY_LIST);
   const MAX_DESTINATION_PACKAGE_PATTERNS = 64;

   export interface DestinationWritePolicy {
     readonly allowWrites: boolean;
     /** Never empty — `[]` means "all packages" to safety.ts. Read-only policies carry ['$TMP']. */
     readonly allowedPackages: readonly string[];
     readonly allowTransportWrites: boolean;
     readonly allowGitWrites: boolean;
   }

   export const READ_ONLY_WRITE_POLICY: DestinationWritePolicy = Object.freeze({
     allowWrites: false,
     allowedPackages: Object.freeze(['$TMP']),
     allowTransportWrites: false,
     allowGitWrites: false,
   });

   export type WritePolicyParseResult =
     | { ok: true; policy: DestinationWritePolicy }
     | { ok: false; code: 'WRITE_REQUIRES_PRINCIPAL_PROPAGATION' | 'INVALID_WRITE_POLICY'; message: string };
   ```
   and append `parseDestinationWritePolicy(properties, authentication)` implementing exactly the test
   table: no write key → `READ_ONLY_WRITE_POLICY`; on non-PP, any write key that is not an explicit valid `false` (so `true`, an invalid value, or any `arc1.allowed_packages`) → `WRITE_REQUIRES_PRINCIPAL_PROPAGATION`, while only-explicit-`false` keys → `READ_ONLY_WRITE_POLICY` (Q3);
   invalid booleans → `INVALID_WRITE_POLICY`; sub-flag `true` without `allow_writes=true` → invalid;
   `allow_writes` not `true` → read-only; `allow_writes=true` requires `splitAllowedPackageList` with
   ≥1 and ≤64 entries, `hadEmptyEntries === false`, and every entry `isValidAllowedPackagePattern`
   (import both from `../adt/safety.js`). Freeze the returned policy and package array.
4. `destination-registry.ts`:
   - `TargetExclusionCode` line 39: replace `| 'UNSUPPORTED_V1_WRITE_CONFIG'` with
     `| 'WRITE_REQUIRES_PRINCIPAL_PROPAGATION'` and `| 'INVALID_WRITE_POLICY'`.
   - `TargetPolicy` lines 47-50 → `export interface TargetPolicy extends DestinationWritePolicy { readonly allowDataPreview: boolean; readonly allowFreeSQL: boolean; }`
     (fields are **required**: a forgotten literal is a compile error — playbook rule 4).
   - `arcConfig` type (lines 89-96): add `allowWrites?: boolean; allowedPackages?: readonly string[]; allowTransportWrites?: boolean; allowGitWrites?: boolean;`;
     `immutableArcConfig` (lines 178-191) fills the booleans with `parseDestinationBoolean(...)` and
     `allowedPackages` only when `splitAllowedPackageList` yields entries that all pass the validator.
   - Loop lines 253-274: delete the `if (isWriteRelatedArcProperty(key)) { … 'UNSUPPORTED_V1_WRITE_CONFIG' … }`
     branch (lines 254-263); keep the unknown-property branch. Drop the now-unused import.
   - After the `INVALID_LANGUAGE` check (ends line 441) insert:
     ```ts
     const writeRequest = parseDestinationWritePolicy(source.arcProperties, authentication);
     if (!writeRequest.ok) {
       return excludedCandidate(source, diagnosticBase, true, 'quarantined', writeRequest.code, writeRequest.message);
     }
     ```
   - Replace lines 455-462
     ```ts
     const requestedPolicy = Object.freeze({
       allowDataPreview: dataRequested ?? false,
       allowFreeSQL: sqlRequested ?? false,
     });
     const effectivePolicy = Object.freeze({
       allowDataPreview: base.allowDataPreview && requestedPolicy.allowDataPreview,
       allowFreeSQL: base.allowFreeSQL && requestedPolicy.allowFreeSQL,
     });
     ```
     with
     ```ts
     const requestedPolicy: TargetPolicy = Object.freeze({
       allowDataPreview: dataRequested ?? false,
       allowFreeSQL: sqlRequested ?? false,
       ...writeRequest.policy,
     });
     // ADR-0008: instance ceiling ∧ destination opt-in (PP already guaranteed by the parser).
     const allowWrites = base.multiTargetAllowWrites && requestedPolicy.allowWrites;
     const effectivePolicy: TargetPolicy = Object.freeze({
       allowDataPreview: base.allowDataPreview && requestedPolicy.allowDataPreview,
       allowFreeSQL: base.allowFreeSQL && requestedPolicy.allowFreeSQL,
       allowWrites,
       allowedPackages: allowWrites ? requestedPolicy.allowedPackages : READ_ONLY_WRITE_POLICY.allowedPackages,
       allowTransportWrites: allowWrites && base.multiTargetAllowTransportWrites && requestedPolicy.allowTransportWrites,
       allowGitWrites: allowWrites && base.multiTargetAllowGitWrites && requestedPolicy.allowGitWrites,
     });
     ```
   - `limitedByInstance` lines 502-504 → add `|| requestedPolicy.allowWrites !== effectivePolicy.allowWrites || requestedPolicy.allowTransportWrites !== effectivePolicy.allowTransportWrites || requestedPolicy.allowGitWrites !== effectivePolicy.allowGitWrites`.
   - `targetFingerprint` lines 172-173: after `allowFreeSQL: value.requestedPolicy.allowFreeSQL,` add
     `allowWrites`, `allowedPackages`, `allowTransportWrites`, `allowGitWrites` from `value.requestedPolicy`.
5. Fix literal fixtures with the spread `...READ_ONLY_WRITE_POLICY` (import from
   `src/server/multi-target-destination-config.js`): `multi-target-tools.test.ts:27-28`,
   `check-tool-schema-budget.ts:149-150`, the Task 2 literal; `btp-pp-profiles.test.ts:161` →
   `toEqual({ allowDataPreview: false, allowFreeSQL: false, ...READ_ONLY_WRITE_POLICY })`.
   `multi-target-runtime.ts:108-112` builds a `TargetPolicy` literal for the aggregate union — add
   `...READ_ONLY_WRITE_POLICY` there now (Task 6 rewrites the call).
6. Run the step-2 command → pass; then `npm test 2>&1 | tail -5` → all pass (fixtures from Task 2 unchanged).
7. Commit: `feat: accept PP destination write policy behind the instance ceiling`

Verify:
- `npx vitest run tests/unit/server` → pass.
- `git diff --stat tests/fixtures/tool-definitions` → empty.
- `npm run typecheck` → exit 0.

---

### Task 6: Bind the safety ceiling to a required route
Agent: general-purpose (TypeScript)
Depends on: 5 · Parallel-safe: no · Kind: judgement · Risk: high

Objects/files:
- Modify: `src/server/destination-registry.ts:779-804` (`multiTargetSafety`, `targetSafety`)
- Modify: `src/server/multi-target-runtime.ts:20-23` (doc + param type), `:93-96` (`buildMultiTargetConfig`), `:102-116` (`buildAggregateToolSurfaceConfig`)
- Modify call sites: `src/server/server.ts:1464`, `src/server/multi-target-server.ts:458`
- Modify test call sites (mechanical): `tests/unit/server/multi-target-basic-auth.test.ts` (25 calls), `tests/unit/server/multi-target-server.test.ts:364`,
  `tests/unit/server/multi-target-runtime.test.ts:82,152,168`, `tests/unit/server/destination-registry.test.ts:63,80,84`
- Test: `tests/unit/server/multi-target-runtime.test.ts`, `tests/unit/server/destination-registry.test.ts`

Steps:
1. Failing tests (`multi-target-runtime.test.ts`):
   ```ts
   describe('ADR-0008 route-bound write ceiling', () => {
     const writable = (identity: 'per-user' | 'shared' = 'per-user') => ({
       ...registryTarget(),
       identity,
       authentication: identity === 'per-user' ? ('PrincipalPropagation' as const) : ('BasicAuthentication' as const),
       effectivePolicy: { allowDataPreview: false, allowFreeSQL: false, allowWrites: true, allowedPackages: ['ZTEAM*'], allowTransportWrites: true, allowGitWrites: true },
     });

     it('maps the effective policy only on the pinned route', () => {
       expect(buildMultiTargetConfig(DEFAULT_CONFIG, writable(), 'pinned')).toMatchObject({
         allowWrites: true, allowTransportWrites: true, allowGitWrites: true, allowedPackages: ['ZTEAM*'],
       });
     });

     it('keeps the aggregate route mutation-free even for a writable target', () => {
       expect(buildMultiTargetConfig(DEFAULT_CONFIG, writable(), 'aggregate')).toMatchObject({
         allowWrites: false, allowTransportWrites: false, allowGitWrites: false, allowedPackages: ['$TMP'],
       });
     });

     it('never grants writes to a shared identity, even if a descriptor claims it', () => {
       expect(buildMultiTargetConfig(DEFAULT_CONFIG, writable('shared'), 'pinned').allowWrites).toBe(false);
     });

     it('never maps an empty package list to "all packages"', () => {
       const target = { ...writable(), effectivePolicy: { ...writable().effectivePolicy, allowedPackages: [] } };
       expect(() => buildMultiTargetConfig(DEFAULT_CONFIG, target, 'pinned')).toThrow(/allowedPackages/);
     });

     it('keeps the aggregate tools/list union mutation-free', () => {
       expect(buildAggregateToolSurfaceConfig({ ...DEFAULT_CONFIG, multiTargetAllowWrites: true }, [writable()]).allowWrites).toBe(false);
     });
   });
   ```
   (`registryTarget()` is the existing helper used at line 152; reuse it.)
2. Run `npx vitest run tests/unit/server/multi-target-runtime.test.ts` → fails (3rd argument / expected `true`).
3. Implement. Replace `destination-registry.ts` lines 788-804
   ```ts
   export function multiTargetSafety(policy: TargetPolicy, blockedDataSources: readonly string[]): SafetyConfig {
     return {
       allowWrites: false,
       allowDataPreview: policy.allowDataPreview,
       allowFreeSQL: policy.allowFreeSQL,
       allowTransportWrites: false,
       allowGitWrites: false,
       blockedDataSources: [...blockedDataSources],
       allowedPackages: ['$TMP'],
       allowedTransports: [],
       denyActions: [],
     };
   }

   export function targetSafety(target: TargetDescriptor, blockedDataSources: readonly string[]): SafetyConfig {
     return multiTargetSafety(target.effectivePolicy, blockedDataSources);
   }
   ```
   with
   ```ts
   export type MultiTargetRoute = 'pinned' | 'aggregate';

   /**
    * `route` is REQUIRED (playbook rule 4): forgetting it must be a compile error, never a silent
    * write grant. The aggregate route is mutation-free by construction (ADR-0006/0008).
    */
   export function multiTargetSafety(
     policy: TargetPolicy,
     blockedDataSources: readonly string[],
     route: MultiTargetRoute,
   ): SafetyConfig {
     const writable = route === 'pinned' && policy.allowWrites;
     if (writable && policy.allowedPackages.length === 0) {
       // safety.ts treats [] as "all packages"; a writable target must always carry an explicit list.
       throw new Error('Writable multi-target policy has no allowedPackages; refusing to build an unrestricted ceiling.');
     }
     return {
       allowWrites: writable,
       allowDataPreview: policy.allowDataPreview,
       allowFreeSQL: policy.allowFreeSQL,
       allowTransportWrites: writable && policy.allowTransportWrites,
       allowGitWrites: writable && policy.allowGitWrites,
       blockedDataSources: [...blockedDataSources],
       allowedPackages: writable ? [...policy.allowedPackages] : ['$TMP'],
       allowedTransports: [],
       denyActions: [],
     };
   }

   export function targetSafety(
     target: TargetDescriptor,
     blockedDataSources: readonly string[],
     route: MultiTargetRoute,
   ): SafetyConfig {
     // Only a per-user (PP) identity may ever receive a write ceiling, whatever the descriptor says.
     return multiTargetSafety(target.effectivePolicy, blockedDataSources, target.identity === 'per-user' ? route : 'aggregate');
   }
   ```
   `multi-target-runtime.ts`: line 94-95
   ```ts
   export function buildMultiTargetConfig(base: ServerConfig, target: TargetDescriptor): ServerConfig {
     return buildReadOnlyRuntimeConfig(base, targetSafety(target, base.blockedDataSources), target);
   ```
   →
   ```ts
   export function buildMultiTargetConfig(base: ServerConfig, target: TargetDescriptor, route: MultiTargetRoute): ServerConfig {
     return buildReadOnlyRuntimeConfig(base, targetSafety(target, base.blockedDataSources, route), target);
   ```
   lines 108-114: pass `'aggregate'` as the third `multiTargetSafety` argument. Update the doc comment
   on lines 14-19 to say the write fields come only from the route-bound ceiling (keep the function
   name — move-only discipline; rename is a follow-up).
4. Call sites: `server.ts:1464` → `buildMultiTargetConfig(config, target, 'pinned')` (same line count);
   `multi-target-server.ts:458` → `buildMultiTargetConfig(options.instanceConfig, selectedTarget, options.mode)`.
   Tests (behaviour-preserving, read-only targets): pinned servers get `'pinned'`, aggregate get `'aggregate'`:
   ```bash
   sed -i '' -E "s/buildMultiTargetConfig\((INSTANCE_CONFIG|DEFAULT_CONFIG|config), target\)/buildMultiTargetConfig(\1, target, 'pinned')/" \
     tests/unit/server/multi-target-basic-auth.test.ts tests/unit/server/multi-target-server.test.ts
   ```
   then fix the remaining hits by hand (`grep -n "buildMultiTargetConfig(\|targetSafety(" tests src`).
   `destination-registry.test.ts:63,80,84` → add `'pinned'` (assertions unchanged: read-only target).
5. Run → pass; `npm run typecheck` → exit 0 (any missed site is a compile error by design).
6. Commit: `feat: bind the multi-target safety ceiling to a required route`

Verify:
- `npx vitest run tests/unit/server` → pass.
- `grep -rn "buildMultiTargetConfig(\|targetSafety(\|multiTargetSafety(" src tests scripts | grep -v "'pinned'\|'aggregate'\|options.mode\|route" ` → no call without a route.
- `git diff --stat tests/fixtures/tool-definitions` → empty.

---

### Task 7: Route the tool surface, invocation gate and instructions
Agent: general-purpose (TypeScript)
Depends on: 2, 6 · Parallel-safe: no · Kind: judgement · Risk: high

**Exact seams.** tools/list: `server.ts:736-741` always calls `multiTargetToolDefinitions(tools, config)`,
where `config` is the per-route config passed to `createServer` (pinned: `buildMultiTargetConfig(…, 'pinned')`
from the factory at `server.ts:1464`; aggregate: `buildAggregateToolSurfaceConfig`). `tools` already comes
from `getConfiguredToolDefinitions(config, …)` = the single-target pruning (safety-aware: `tools.ts:561`,
`:1436`, `:1569`, `:1683`), and `filterToolsByAuthScope` (line 751) applies scopes + deny actions
afterwards. So the writable pinned surface = **skip** the v1 allowlist. tools/call: `multi-target-server.ts:458-481`.

Objects/files:
- Modify: `src/server/multi-target-tools.ts` (add after line 151)
- Modify: `src/server/multi-target-server.ts` (instructions lines 35-54; decision lines 458-481)
- Modify: `src/server/server.ts` (import line 69; lines 737-741)
- Modify: `scripts/ci/check-file-sizes.mjs:86` (lower the server.ts budget to the new `wc -l`)
- Modify: `tests/unit/handlers/tool-definitions-snapshot.test.ts` (add writable-pinned fixture)
- Create (generated): `tests/fixtures/tool-definitions/multi-target-pinned-writable.json`
- Test: `tests/unit/server/multi-target-tools.test.ts`

Steps:
1. Failing tests (`multi-target-tools.test.ts`):
   ```ts
   describe('ADR-0008 pinned writable surface', () => {
     const writableConfig = { ...DEFAULT_CONFIG, multiTargetEndpoints: true, allowWrites: true, allowedPackages: ['$TMP'] };

     it('uses single-target pruning only on a writable pinned route', () => {
       const tools = getToolDefinitions(writableConfig);
       const pinned = multiTargetSurfaceDefinitions(tools, 'pinned', { available: true, targets: [target(0)] }, writableConfig);
       expect(pinned.map((tool) => tool.name)).toEqual(expect.arrayContaining(['SAPWrite', 'SAPActivate', 'SAPManage']));
       expect(pinned.find((tool) => tool.name === 'SAPWrite')?.annotations?.readOnlyHint).not.toBe(true);
       const aggregate = multiTargetSurfaceDefinitions(tools, 'aggregate', { available: true, targets: [target(0)] }, writableConfig);
       expect(aggregate).toEqual(multiTargetToolDefinitions(tools, writableConfig));
       expect(aggregate.map((tool) => tool.name)).not.toContain('SAPWrite');
     });

     it('keeps a read-only pinned route on the reviewed v1 surface', () => {
       const tools = getToolDefinitions(DEFAULT_CONFIG);
       expect(multiTargetSurfaceDefinitions(tools, 'pinned', { available: true, targets: [target(0)] }, DEFAULT_CONFIG))
         .toEqual(multiTargetToolDefinitions(tools, DEFAULT_CONFIG));
     });

     it('decides writable pinned invocations by ACTION_POLICY + safety', () => {
       expect(routeInvocationDecision('pinned', 'SAPWrite', { action: 'create' }, writableConfig)).toBe('allowed');
       expect(routeInvocationDecision('aggregate', 'SAPWrite', { action: 'create' }, writableConfig)).toBe('forbidden');
       expect(routeInvocationDecision('pinned', 'SAPTransport', { action: 'create' }, writableConfig)).toBe('forbidden'); // transport ceiling off
       expect(routeInvocationDecision('pinned', 'SAPTargets', {}, writableConfig)).toBe('forbidden');
       expect(routeInvocationDecision('pinned', 'Custom_Tool', {}, writableConfig)).toBe('forbidden');
       expect(routeInvocationDecision('pinned', 'SAPQuery', {}, writableConfig)).toBe('target-policy-denied');
       expect(routeInvocationDecision('pinned', 'SAPWrite', { action: 'create' }, DEFAULT_CONFIG)).toBe('forbidden');
     });
   });
   ```
   Instructions test (append to `tests/unit/server/multi-target-server.test.ts` or the Task 9 file):
   `buildMultiTargetServerInstructions({ mode: 'pinned', registry, instanceConfig, target: writableTarget })`
   contains `read/write`, the SID/client, `ZTEAM*`; the same target with `mode: 'aggregate'` returns
   `MULTI_TARGET_SERVER_INSTRUCTIONS` unchanged.
2. Run `npx vitest run tests/unit/server/multi-target-tools.test.ts` → fails (exports missing).
3. Implement in `multi-target-tools.ts` after line 151:
   ```ts
   export type MultiTargetSurfaceMode = 'pinned' | 'aggregate';

   /** ADR-0008: only a pinned route whose route-bound ceiling grants writes leaves the v1 allowlist. */
   export function isWritablePinnedSurface(mode: MultiTargetSurfaceMode, config: ServerConfig): boolean {
     return mode === 'pinned' && config.allowWrites;
   }

   export function multiTargetSurfaceDefinitions(
     tools: ToolDefinition[],
     mode: MultiTargetSurfaceMode,
     registry: { readonly available: boolean; readonly targets: readonly unknown[] },
     config: ServerConfig,
   ): ToolDefinition[] {
     if (!registry.available || (mode === 'aggregate' && registry.targets.length === 0)) return [];
     // Writable pinned: single-target pruning already applied by getToolDefinitions(config);
     // scopes/deny actions follow in filterToolsByAuthScope. readOnlyHint is not forced here.
     return isWritablePinnedSurface(mode, config) ? tools : multiTargetToolDefinitions(tools, config);
   }

   export function routeInvocationDecision(
     mode: MultiTargetSurfaceMode,
     toolName: string,
     args: Record<string, unknown>,
     config: ServerConfig,
   ): 'allowed' | 'target-policy-denied' | 'forbidden' {
     if (!isWritablePinnedSurface(mode, config)) return multiTargetInvocationDecision(toolName, args, config);
     // Catalog, hyperfocused and plugin tools never exist on a pinned route.
     if (toolName === 'SAPTargets' || toolName === 'SAP' || !toolName.startsWith('SAP')) return 'forbidden';
     const policy = getActionPolicy(toolName, invocationPolicyKey(toolName, args));
     if (!policy) return 'forbidden';
     if (isOperationAllowed(config, policy.opType)) return 'allowed';
     if (policy.opType === OperationType.Query || policy.opType === OperationType.FreeSQL) return 'target-policy-denied';
     return 'forbidden';
   }
   ```
   Update the file header comment (line 1) to "Reviewed read-only surface, plus the ADR-0008 writable-pinned switch."
4. `server.ts`: line 69 import → `import { injectTargetSchema, multiTargetSurfaceDefinitions, sapTargetsDefinition } from './multi-target-tools.js';`
   Replace lines 737-741
   ```ts
         tools =
           !multiTarget.registry.available ||
           (multiTarget.mode === 'aggregate' && multiTarget.registry.targets.length === 0)
             ? []
             : multiTargetToolDefinitions(tools, config);
   ```
   with
   ```ts
         tools = multiTargetSurfaceDefinitions(tools, multiTarget.mode, multiTarget.registry, config);
   ```
   (net −4 lines; then set `'src/server/server.ts'` in `scripts/ci/check-file-sizes.mjs:86` to the new
   `wc -l` value — playbook rule 5).
5. `multi-target-server.ts`: import `isWritablePinnedSurface, routeInvocationDecision` (replace the
   `multiTargetInvocationDecision` import on line 19). Replace lines 460-481
   ```ts
     const invocationDecision = multiTargetInvocationDecision(toolName, callArgs, activeConfig);
     if (invocationDecision === 'forbidden') {
       …
         reason: 'Operation unavailable in read-only multi-target v1',
       …
         error(
           'MULTI_TARGET_OPERATION_FORBIDDEN',
           'This tool or operation is not available in read-only multi-target v1.',
         ),
   ```
   with the same block using
   `const writableSurface = isWritablePinnedSurface(options.mode, activeConfig);`,
   `const invocationDecision = routeInvocationDecision(options.mode, toolName, callArgs, activeConfig);`,
   audit `reason: writableSurface ? 'Operation not enabled for this pinned target' : 'Operation unavailable in read-only multi-target v1'`
   and message `writableSurface ? \`This tool or operation is not enabled for target ${selectedTarget.target}.\` : 'This tool or operation is not available in read-only multi-target v1.'`.
   The scope check (lines 482-504) and `isActionDenied` (505-522) stay unchanged and now also guard writes.
   Instructions: in `buildMultiTargetServerInstructions` (lines 35-54) insert before the final PP return:
   ```ts
   const policy = options.target?.effectivePolicy;
   if (options.target?.identity === 'per-user' && policy?.allowWrites) {
     return [
       `ARC-1 gives SAP target ${options.target.target} a read/write interface over SAP ADT.`,
       'This connection is pinned to that one system/client; there is no target selector. The aggregate /multi/mcp route stays read-only.',
       'Principal Propagation sends each authenticated caller to SAP as their mapped SAP user; locks, transports and object authorship carry that user.',
       `Writes are limited to packages ${policy.allowedPackages.join(', ')} and still require the ARC-1 write scope and SAP authorization.`,
       `Transport mutations are ${policy.allowTransportWrites ? 'enabled' : 'unavailable'}; Git mutations are ${policy.allowGitWrites ? 'enabled' : 'unavailable'}.`,
       'Data preview and SQL require instance, destination, XSUAA scope, and SAP authorization consent.',
       'Unavailable or failed syntax/ATC/test checks are not passes.',
     ].join('\n');
   }
   ```
   Note: `effectivePolicy.allowWrites` already includes the instance ceiling (Task 5), so the text
   matches what `buildMultiTargetConfig(…, 'pinned')` grants.
6. Snapshot: in the Task 2 describe block add
   ```ts
   it('is stable: multi-target-pinned-writable', async () => {
     const config = buildMultiTargetConfig(
       { ...DEFAULT_CONFIG, multiTargetEndpoints: true, multiTargetAllowWrites: true },
       { ...multiTargetTarget, effectivePolicy: { ...multiTargetTarget.effectivePolicy, allowWrites: true, allowedPackages: ['$TMP', 'ZTEAM*'] } },
       'pinned',
     );
     const tools = multiTargetSurfaceDefinitions(getToolDefinitions(config), 'pinned', { available: true, targets: [multiTargetTarget] }, config);
     await expect(JSON.stringify(tools, null, 2)).toMatchFileSnapshot('../../fixtures/tool-definitions/multi-target-pinned-writable.json');
   });
   ```
   Run once with `-u`; review that only `multi-target-pinned-writable.json` is new and the three Task 2
   fixtures are byte-identical.
7. Run → pass. Commit: `feat: expose the writable tool surface on opt-in pinned multi-target routes`

Verify:
- `npx vitest run tests/unit/server tests/unit/handlers/tool-definitions-snapshot.test.ts` → pass.
- `git diff main --stat -- tests/fixtures/tool-definitions` → only `multi-target-*.json` additions; the 11 pre-existing fixtures unchanged; `git diff HEAD~1 -- tests/fixtures/tool-definitions/multi-target-readonly.json tests/fixtures/tool-definitions/multi-target-data-sql.json tests/fixtures/tool-definitions/multi-target-aggregate-one-target.json` → empty.
- `npm run check:sizes` → pass (server.ts below its lowered budget; schema budget unchanged).

---

### Task 8: Advertise write scopes on pinned PRM
Agent: general-purpose (TypeScript)
Depends on: 3 · Parallel-safe: yes with 5–7 (only `http.ts` + its tests) · Kind: judgement · Risk: high

Why (not in the design — see Plan risks R4): every pinned route's OAuth Protected Resource Metadata
advertises `['read','data','sql','admin']` (`http.ts:285`, `:700`). MCP clients request the advertised
scopes, so a non-admin user's token would never carry `write`/`transports`/`git` and every pinned write
would end in `INSUFFICIENT_SCOPE`. The PRM is deliberately registry-independent (unknown targets get the
same metadata — no target enumeration oracle), so the advertisement follows the **instance** ceilings,
never a per-target policy.

Objects/files:
- Modify: `src/server/http.ts:285` (add function), `:700` (pinned PRM only; aggregate line 691 unchanged)
- Test: `tests/unit/server/http-destinations.test.ts` (near lines 73-76), `tests/unit/server/http-multi-target-routes.test.ts` (near line 191)

Steps:
1. Failing tests:
   ```ts
   it('advertises write scopes on pinned PRM only from the instance write ceilings', () => {
     expect(pinnedTargetScopesSupported(DEFAULT_CONFIG)).toEqual(['read', 'data', 'sql', 'admin']);
     expect(pinnedTargetScopesSupported({ ...DEFAULT_CONFIG, multiTargetAllowWrites: true })).toEqual(['read', 'write', 'data', 'sql', 'admin']);
     expect(pinnedTargetScopesSupported({ ...DEFAULT_CONFIG, multiTargetAllowWrites: true, multiTargetAllowTransportWrites: true, multiTargetAllowGitWrites: true }))
       .toEqual(['read', 'write', 'data', 'sql', 'transports', 'git', 'admin']);
     expect(MULTI_TARGET_SCOPES_SUPPORTED).not.toContain('write'); // aggregate unchanged
   });
   ```
   In `http-multi-target-routes.test.ts` next to the aggregate assertion at line 191, start the app with
   `multiTargetAllowWrites: true` and assert the pinned PRM body contains `write` while
   `/.well-known/oauth-protected-resource/multi/mcp` still equals `['read', 'data', 'sql', 'admin']`.
2. Run `npx vitest run tests/unit/server/http-destinations.test.ts tests/unit/server/http-multi-target-routes.test.ts` → fails.
3. Implement after line 285:
   ```ts
   /** ADR-0008: pinned PRM stays registry-independent; write scopes follow the instance ceilings only. */
   export function pinnedTargetScopesSupported(
     config: Pick<ServerConfig, 'multiTargetAllowWrites' | 'multiTargetAllowTransportWrites' | 'multiTargetAllowGitWrites'>,
   ): readonly string[] {
     if (!config.multiTargetAllowWrites) return MULTI_TARGET_SCOPES_SUPPORTED;
     return Object.freeze([
       'read',
       'write',
       'data',
       'sql',
       ...(config.multiTargetAllowTransportWrites ? ['transports'] : []),
       ...(config.multiTargetAllowGitWrites ? ['git'] : []),
       'admin',
     ]);
   }
   ```
   and line 700 `scopes_supported: MULTI_TARGET_SCOPES_SUPPORTED,` (inside the
   `PINNED_RESOURCE_METADATA_PATH_PATTERN` handler) → `scopes_supported: pinnedTargetScopesSupported(config),`.
   Leave the `/authorize` Copilot alias (lines 545-563, always aggregate) and the `read` route gate
   (lines 474-487) unchanged.
4. Run → pass. Commit: `feat: advertise write scopes on pinned PRM when multi-target writes are enabled`

Verify: `npx vitest run tests/unit/server/http-destinations.test.ts tests/unit/server/http-multi-target-routes.test.ts` → pass;
`grep -n "scopes_supported" src/server/http.ts` → line ~691 still `MULTI_TARGET_SCOPES_SUPPORTED`, pinned line uses the function.

---

### Task 9: Add end-to-end unit coverage for the five keys
Agent: general-purpose (TypeScript)
Depends on: 7, 8 · Parallel-safe: no · Kind: judgement · Risk: normal

Objects/files:
- Create: `tests/unit/server/multi-target-pinned-writes.test.ts` (MCP-handler level; copy the
  `requestHandler`/`registry` helper pattern from `tests/unit/server/multi-target-server.test.ts:19-105`,
  adding a `writeProps` option to `arcProperties`)
- Create: `tests/unit/handlers/multi-target-pinned-write-package.test.ts` (dispatch level with
  `./setup-undici-mock.js`, pattern from `tests/unit/handlers/write-create-batch.test.ts:1-12,505-525`)

Steps (tests only — every case must pass against Tasks 5-8; a failure is a bug to fix in the owning
task's file, not here):
1. `multi-target-pinned-writes.test.ts`, with
   `const instance = { ...DEFAULT_CONFIG, multiTargetAllowWrites: true };` and
   `const writeAuth = { ...readAuth, scopes: ['read', 'write'] };`:
   - **Aggregate refuses writes for a writable target:** aggregate server
     (`buildAggregateToolSurfaceConfig(instance, current.targets)`, `mode: 'aggregate'`); tools/list has no
     `SAPWrite`; `tools/call SAPWrite {action:'create', type:'CLAS', name:'ZCL_ARC1_X', package:'$TMP', target:'A00/000'}`
     with `writeAuth` → `{ error: 'MULTI_TARGET_OPERATION_FORBIDDEN' }`.
   - **Pinned writable lists write tools:** pinned server `createServer(buildMultiTargetConfig(instance, target, 'pinned'), { multiTarget: { mode: 'pinned', registry, instanceConfig: instance, target } })`;
     with `writeAuth` tools/list contains `SAPWrite`, `SAPActivate`, `SAPManage`; with `readAuth` it
     contains none of them (scope pruning); `SAPTargets` absent.
   - **Scope still required:** `readAuth` → `SAPWrite create` → `{ error: 'INSUFFICIENT_SCOPE' }`;
     transport `create` with `['read','write']` and transport ceiling on → `INSUFFICIENT_SCOPE` (needs `transports`);
     `SAPGit` mutation without `git` → `INSUFFICIENT_SCOPE`.
   - **Sub-ceilings:** with `arc1.allow_transport_writes=true` but `multiTargetAllowTransportWrites=false`
     → `SAPTransport create` → `MULTI_TARGET_OPERATION_FORBIDDEN` with message `not enabled for target A00/000`.
   - **Deny actions:** `instance.denyActions = ['SAPWrite.delete']` → pinned `SAPWrite delete` → `MULTI_TARGET_OPERATION_FORBIDDEN`
     (`This operation is disabled by the ARC-1 instance policy.`).
   - **Instance ceiling off:** same destination props with `DEFAULT_CONFIG` → pinned tools/list equals the
     read-only surface (no `SAPWrite`), instructions say `read-only interface`.
   - **Basic + write quarantined:** registry with `authentication: 'BasicAuthentication'`, `multiTargetAllowBasicAuth: true`
     and write props → `targets` empty, diagnostic `WRITE_REQUIRES_PRINCIPAL_PROPAGATION`; admin `SAPTargets`
     on the aggregate server shows the code.
   - **Drift:** covered at the runtime-unit level in Task 5 (`multi-target-runtime.test.ts`), because the
     per-user client path (`createPerUserClient`, `server.ts:305-338`) needs a BTP binding. Reference that
     test in this file's header comment; the live drift check is in Task 11.
2. `multi-target-pinned-write-package.test.ts`:
   ```ts
   import { describe, expect, it } from 'vitest';
   import { DEFAULT_CONFIG } from '../../../src/server/types.js';
   import { AdtClient, mockFetch } from './setup-undici-mock.js';

   const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
   const { buildMultiTargetConfig } = await import('../../../src/server/multi-target-runtime.js');
   const { targetSafety } = await import('../../../src/server/destination-registry.js');

   it('refuses a pinned write outside arc1.allowed_packages before contacting SAP', async () => {
     const target = writableTarget(['$TMP']); // local literal: PP, effectivePolicy.allowWrites=true
     const instance = { ...DEFAULT_CONFIG, multiTargetAllowWrites: true };
     const client = new AdtClient({ baseUrl: 'http://sap:8000', username: 'u', password: 'p', safety: targetSafety(target, [], 'pinned') });
     const result = await handleToolCall(client, buildMultiTargetConfig(instance, target, 'pinned'), 'SAPWrite', {
       action: 'create', type: 'CLAS', name: 'ZCL_ARC1_OTHER', package: 'ZOTHER',
       source: 'CLASS zcl_arc1_other DEFINITION PUBLIC. ENDCLASS. CLASS zcl_arc1_other IMPLEMENTATION. ENDCLASS.',
     });
     expect(result.isError).toBe(true);
     expect(result.content[0]?.text).toContain('blocked by safety configuration');
     expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining('/oo/classes'), expect.objectContaining({ method: 'POST' }));
   });

   it('refuses the same write on the aggregate ceiling', async () => {
     const target = writableTarget(['$TMP']);
     const client = new AdtClient({ baseUrl: 'http://sap:8000', username: 'u', password: 'p', safety: targetSafety(target, [], 'aggregate') });
     const result = await handleToolCall(client, buildMultiTargetConfig({ ...DEFAULT_CONFIG, multiTargetAllowWrites: true }, target, 'aggregate'), 'SAPWrite', {
       action: 'create', type: 'CLAS', name: 'ZCL_ARC1_TMP', package: '$TMP', source: 'CLASS zcl_arc1_tmp DEFINITION PUBLIC. ENDCLASS. CLASS zcl_arc1_tmp IMPLEMENTATION. ENDCLASS.',
     });
     expect(result.isError).toBe(true);
     expect(result.content[0]?.text).toMatch(/allowWrites|blocked/);
   });
   ```
   (Implementer: mirror the `mockFetch` reset/`beforeEach` of `write-create-batch.test.ts`; adapt the
   no-POST assertion to how that file inspects `mockFetch.mock.calls`.)
3. Run `npx vitest run tests/unit/server/multi-target-pinned-writes.test.ts tests/unit/handlers/multi-target-pinned-write-package.test.ts` → pass.
4. Commit: `test: cover pinned multi-target writes across route, scope, package and identity gates`

Verify: `npm test 2>&1 | tail -5` → all pass; `npm run check:sizes` → pass.

---

### Task 10: Update user and operator docs
Agent: sap:doc-writer
Depends on: 1, 7, 8 · Parallel-safe: yes with 9 · Kind: judgement · Risk: normal

Objects/files:
- Modify: `docs_page/multi-target-setup.md` — keep the maintained table between
  `<!-- multi-target-action-contract:start` (line 338) and `:end` (line 349) **unchanged** (it is the
  aggregate/read-only contract checked by `tests/unit/server/btp-docs-contract.test.ts:30-39`); rename
  heading line 332 "What multi-target v1 exposes" → "What the read-only routes expose"; add section
  "### Optional writes on pinned Principal Propagation routes (ADR-0008)" after "Optional data preview and
  SQL profile" (line 470): two keys, example destination properties, the six-key conjunction, PP-only,
  pinned-only, scopes (`write`/`transports`/`git` role collections), mandatory `arc1.allowed_packages`,
  restart after destination change, production guidance (omit `arc1.allow_writes`). Section
  "OAuth scopes on first sign-in" (line 562): pinned PRM advertises write scopes when
  `ARC1_MULTI_TARGET_ALLOW_WRITES=true`; users may need to reconnect to obtain them. Troubleshooting
  table (~line 707): add `WRITE_REQUIRES_PRINCIPAL_PROPAGATION`, `INVALID_WRITE_POLICY`, and
  `MULTI_TARGET_OPERATION_FORBIDDEN … not enabled for target`.
- Modify: `docs_page/multi-target-administration.md` — line 432 row `UNSUPPORTED_V1_WRITE_CONFIG` →
  replace with the two new codes; "Destination policy operations" (line 216) add write policy +
  narrowing (`limitedByInstance`); "Deferred from v1" (line 534) remove pinned PP writes, keep aggregate,
  Basic writes, per-target grants; "Operational checklist" (line 513) add a write-enable checklist.
- Modify: `docs_page/configuration-reference.md` — line 137 `exposes mutation-free /<SID>/<CLIENT>/mcp`
  → "exposes `/<SID>/<CLIENT>/mcp` (read-only unless ADR-0008 writes are enabled) plus mutation-free
  `/multi/mcp`"; add three rows after line 138 (wording as AGENTS.md, Task 1 step 5).
- Modify: `docs_page/enterprise-auth.md` (table near line 553; scope note near line 59),
  `docs_page/security-guide.md` (near line 220) — one sentence each pointing to ADR-0008.
- Check only: `docs_page/configuration-precedence.md` has no multi-target content (`grep -n -i multi` →
  none) → no change; record "checked, n/a" in the PR. MCP server instructions are code (Task 7) —
  `grep -rn "read-only interface to SAP target" docs_page` and update any quoted copy.

Steps:
1. Edit as listed; never add sample secrets; use fictional `A4H/100`.
2. Commit: `docs: document opt-in writes on pinned multi-target routes`

Verify:
- `npx vitest run tests/unit/server/btp-docs-contract.test.ts` → pass (action table untouched).
- `grep -rn "UNSUPPORTED_V1_WRITE_CONFIG" docs_page src tests` → no hits (historic mentions in `docs/plans/` may stay).
- `grep -n "ARC1_MULTI_TARGET_ALLOW_WRITES" docs_page/configuration-reference.md docs_page/multi-target-setup.md` → ≥1 hit each.

---

### Task 11: Run the full gate and the live checklist
Agent: general-purpose (TypeScript) for the gate; live part executed with the user (needs their BTP CF test subaccount — `BLOCKED: login needed cf|btp` if not logged in)
Depends on: 1–10 · Parallel-safe: no · Kind: mechanical · Risk: high

Steps:
1. Full gate (fresh output, all must exit 0):
   ```bash
   npm test && npm run typecheck && npm run lint && npm run validate:policy && npm run build && npm run check:sizes
   ```
2. Surface proof: `git diff main --stat -- tests/fixtures/tool-definitions` → only the four new
   `multi-target-*.json` files; no pre-existing fixture changed.
3. Roadmap check (AGENTS.md "Roadmap Discipline"): re-read `docs_page/roadmap.md` FEAT-59 + OPS-06 and
   confirm Task 1 edits are in the diff.
4. Live checklist (test subaccount only, never prod; record in the PR template "live test" section:
   ARC-1 build = `git rev-parse --short HEAD`, SAP_BASIS release, route, auth = XSUAA + PP, results, gaps):
   - Deploy with `.mtaext`: `ARC1_MULTI_TARGET_ENDPOINTS: "true"`, `ARC1_MULTI_TARGET_ALLOW_WRITES: "true"`,
     `ARC1_CACHE: none`; one PP destination `DEV_100` with `arc1.enabled=true`, `arc1.allow_writes=true`,
     `arc1.allowed_packages=$TMP`; `cf restart`. User has role collections with `read` + `write` only.
   - Connect a client to `https://<app>/DEV/100/mcp`; tools/list shows `SAPWrite`, `SAPActivate`.
   - `SAPWrite create CLAS ZCL_ARC1_MT_WRITE_SMOKE package $TMP` → success; `SAPActivate` → active.
   - Same `SAPWrite create` (name `ZCL_ARC1_MT_WRITE_SMOKE2`) on `/multi/mcp` with `target: "DEV/100"` →
     `MULTI_TARGET_OPERATION_FORBIDDEN`; tools/list there has no `SAPWrite`.
   - `SAPWrite create … package ZNOT_ALLOWED` on the pinned route → blocked by safety configuration.
   - SAP author = caller: in ADT/SE24 object properties (or `SAPQuery` on `TADIR` `AUTHOR` if data preview
     is enabled) the class author is the caller's mapped SAP user, not a technical user.
   - Drift: change `arc1.allowed_packages` in the cockpit, call any pinned tool → `TARGET_CONFIG_CHANGED`;
     `cf restart` → works again.
   - Session note: repeat create+activate 5× quickly; record any `400 Session not found` (OPS-06 / 816 research).
   - Cleanup: `SAPWrite delete` both classes on the pinned route.
5. No commit unless the gate forced a fix (then `fix:` commit in the owning file and rerun step 1).

Verify: step 1 prints no failure and exits 0; the live evidence block is filled in or explicitly marked
"not run — <reason>" (never present mocks as live coverage).

---

### Task 12: Release: PR to arc-mcp/arc-1
Agent: main session (sap:finishing-work)
Depends on: 11 · Parallel-safe: no · Kind: mechanical · Risk: normal

Steps:
1. `git log --oneline main..HEAD` → conventional commits from Tasks 1-10 (`feat:` present → minor release).
2. `git push -u origin feat/multi-target-pinned-writes`
3. `gh pr create --repo arc-mcp/arc-1 --base main --title "feat: opt-in writes on pinned multi-target routes (ADR-0008)" --body-file <scratch>/pr-body.md`
   using `.github/pull_request_template.md`; body includes: summary of the six-key conjunction, ADR-0008
   link, security notes (R22, aggregate/Basic unchanged), test evidence from Task 11 (live block),
   **Roadmap impact:** "FEAT-59 wording updated (writes now exist only on pinned PP routes); OPS-06 note on
   stateful write sessions; no item removed", and the PR-body attribution line from the session reminder.
4. Do not add a `docs_page/release-notes.md` entry here; annotate when the release-please PR opens (`/release-notes`).
5. Board card T-0087 → Review (main session); report MEMORY CANDIDATES.

Verify: `gh pr view --repo arc-mcp/arc-1 --json url,state,title` → `state: OPEN`, title as above; CI checks start.

---

## Plan risks (code vs design)

- **R1 — `server.ts` is at its exact size budget** (1494 lines = `check-file-sizes.mjs:86`). Any added line
  fails `check:sizes`. Task 7 therefore moves the tools/list branch into `multiTargetSurfaceDefinitions`
  (net −4 lines) and Task 6 only edits line 1464 in place; lower the budget in the same commit.
- **R2 — No multi-target fixture snapshots exist.** The design's "existing aggregate and read-only-pinned
  snapshots byte-identical" has nothing to compare against today; Task 2 freezes them first.
- **R3 — Discovery and runtime projection blank unsupported values** (`destination-discovery.ts:90`,
  `multi-target-destination-runtime.ts:103`). If write keys were only parsed in the registry,
  `arc1.allowed_packages` would always arrive as `''` and every write opt-in would quarantine. Task 5 adds
  the write keys to `MULTI_TARGET_ARC_PROPERTIES`.
- **R4 — Pinned PRM never advertises `write`/`transports`/`git`** (`http.ts:285,700`, locked by
  `http-destinations.test.ts:73-76`). Not covered by the design; without Task 8 only `admin` users could
  write. Task 8 keys the advertisement to instance ceilings to keep PRM registry-independent.
- **R5 — `admin` implies `write`/`transports`/`git`** (`safety.ts:358-365`, `authz/policy.ts`). Any admin
  token can write on a writable pinned route. The v2 roadmap (`docs/plans/multi-target-v2-roadmap.md:210-215`)
  required raw functional scopes for multi-target mutation. See Q1.
- **R6 — The approved design skips v2-roadmap prerequisites** V2-02B (per-target grants), V2-04
  (mutation hardening), V2-05 (OAuth client spike). ADR-0008 (Task 1) must state the deviation explicitly.
- **R7 — No reusable allowed-packages validator exists.** `SAP_ALLOWED_PACKAGES` accepts any string; Task 4
  adds a strict validator only for destinations (weaker trust boundary) and leaves the env var behaviour
  unchanged to avoid breaking deployments.
- **R8 — `TargetPolicy` growth touches literal fixtures** in tests and `scripts/ci/check-tool-schema-budget.ts`;
  fields are required on purpose. ~33 `buildMultiTargetConfig` test call sites need the new route argument
  (25 in `multi-target-basic-auth.test.ts`).
- **R9 — Pinned and aggregate share `createServer` and `prepareMultiTargetCall`**, but `multiTarget.mode`
  is already present at both seams, so the route parameter is not awkward: factory (`server.ts:1464`) passes
  `'pinned'`, per-call path passes `options.mode`.
- **R10 — Fingerprint values change for every target** after upgrade (new canonical fields). Harmless
  (startup recomputes; no persisted fingerprints found), but any test asserting a literal hash must be updated.
- **R11 — Copilot Studio `/authorize` alias always routes to the aggregate** (`http.ts:545-563`), so
  Copilot Studio cannot use writable pinned routes. Document; no change.
- **R12 — Per-request PP client + stateful lock sessions** (design risk; roadmap OPS-06, 816 session
  research) — only the live check in Task 11 can confirm.
- **R13 — `SAPManage` FLP/UI5-repository actions and Git pull/push are gated by `allowWrites`/`allowGitWrites`
  but FLP/UI5 are not package-bound** (accepted in the design, same as single-target).

## Decisions (plan gate, user, 2026-10-03)

- **Q1** — `admin` keeps implying `write`/`transports`/`git` for multi-target writes (single-target parity).
  ADR-0008 records the deviation from the v2 roadmap's raw-scope recommendation.
- **Q2** — `arc1.allow_writes=false` + `arc1.allowed_packages` is valid read-only.
- **Q3** — A Basic destination whose write keys are all explicit valid `false` stays an enabled read target;
  any key that requests writes (`true`, an invalid value, or `allowed_packages`) quarantines it with
  `WRITE_REQUIRES_PRINCIPAL_PROPAGATION`. Task 5 tests and rule updated accordingly.
- **Q4** — `arc1.allowed_transports` is out of scope for this PR.
- **Q5** — Design (`docs/plans/2026-10-03-multi-target-pinned-writes-design.md`) and this plan are committed
  with Task 1.
- **Q6** — Pinned OAuth metadata advertises write/transports/git whenever the instance ceilings are on, for
  every pinned route (metadata stays destination-independent). Document it in ADR-0008 and the setup docs.
