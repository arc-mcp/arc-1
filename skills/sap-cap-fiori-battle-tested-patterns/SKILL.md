---
name: sap-cap-fiori-battle-tested-patterns
description: Knowledge base of battle-tested patterns and gotchas for SAP CAP + Fiori Elements V4 + BTP (Cloud Foundry / Kyma) projects — distilled from production deployments. Eight categories covering UI5/FE V4 traps, CAP/TypeScript pitfalls, Kyma deployment lessons, security defense-in-depth, customizing-driven patterns, lifecycle/process discipline, post-commit events/messaging, and the companion-plugin ecosystem landscape. Use when asked to "review CAP best practices", "diagnose Fiori Elements bug", "fix CAP runtime issue", "harden deployment", "review draft behavior", "audit my CAP project", or as a knowledge reference linked from other skills. Not a runnable skill — it is a curated reference catalog.
---

# SAP CAP + Fiori Elements V4 — Battle-Tested Patterns

A reference catalog of patterns and gotchas that have surfaced repeatedly across production SAP CAP + Fiori Elements V4 + BTP deployments. Each entry distills a real-world failure mode into a generic pattern: **symptom** observed by users or operators, **root cause** in the framework / runtime / deployment layer, and a **remedy** that is portable across CAP projects.

This skill is **not a runner** — it never executes commands. It is a curated reference invoked either directly (when the user asks for best practices) or cross-linked from operational skills like [`../sap-cap-stack-audit-full/SKILL.md`](../sap-cap-stack-audit-full/SKILL.md), [`../sap-fiori-app-audit/SKILL.md`](../sap-fiori-app-audit/SKILL.md), [`../sap-cap-security-rbac-matrix/SKILL.md`](../sap-cap-security-rbac-matrix/SKILL.md), and similar.

Patterns are organized into **eight categories**. Each category lists the most load-bearing patterns first; lighter-weight items follow. Where multiple frameworks expose the same gotcha (e.g. `@UI.Hidden` interaction with `@Core.OperationAvailable`), the entry points to the framework documentation rather than reproducing it.

## How to read this skill

- **As a checklist**: skim the section titles, identify any pattern that matches the current bug / question, jump to the remedy.
- **As a reference linked from another skill**: each pattern is internally addressable (anchor links work). Other skills cite specific patterns by anchor.
- **As a teaching aid**: patterns are written so a developer new to CAP + Fiori Elements V4 can read them as a sequence and absorb the institutional knowledge.

The catalog is opinionated about defaults. Where SAP documentation lists multiple options, this skill picks one **proven in production** and notes the alternative briefly.

---

## Category 1 — UI5 / Fiori Elements V4 Traps

### 1.1 — Pin the UI5 minor version explicitly

**Symptom.** A Fiori Elements V4 app that worked yesterday now renders a blank shell or throws `Component-preload.js 404` after the public CDN rolled forward.

**Root cause.** Loader URL `https://ui5.sap.com/resources/sap-ui-core.js` (no version) follows the upstream LTS pointer; minor version bumps occasionally break MDC controls (1.136.x MDC Table requires `webapp/changes/{flexibility-bundle,changes-bundle}.json` files; absent → 404 cascade).

**Remedy.** Pin a specific minor in `manifest.json` and the bootstrap script:
```html
<script id="sap-ui-bootstrap" src="https://ui5.sap.com/1.136.16/resources/sap-ui-core.js" …></script>
```
Bump only after a smoke test in a non-prod environment. If MDC Table is used, ship empty `flexibility-bundle.json` and `changes-bundle.json` under `webapp/changes/` to prevent 404 cascades.

### 1.2 — `@UI.Hidden` on a `@Core.OperationAvailable` operand silently disables the button

**Symptom.** A header action button is permanently disabled even though the role grants it and the user is in the right state.

**Root cause.** FE V4 with `autoExpandSelect: true` (the default) skips `@UI.Hidden` properties from the `$select` projection. If `@Core.OperationAvailable: SomeFlag` references a `Can*` flag that is also annotated `@UI.Hidden`, the property arrives `undefined` and the action evaluator falls back to "disabled".

**Remedy.** On computed flags backing `OperationAvailable`, use only `@Core.Computed` — **never** `@UI.Hidden`. Expose them as regular fields (FE V4 won't render them in any UI because no annotation references them as visible).

### 1.3 — Actions returning `Entity` must NOT use `.columns(...)`

**Symptom.** After invoking a bound action that creates / promotes / completes a draft, the ObjectPage exits edit mode unexpectedly or shows stale data.

**Root cause.** When a draft-aware bound action returns the entity but with a projection like `.columns('field1', 'field2')`, the resulting partial entity confuses the FE V4 client cache — it thinks the row was replaced by a thinner version and bails on the edit flow.

**Remedy.** Return the **full** entity from draft-aware actions:
```javascript
return cds.tx(req).run(SELECT.one.from(EntityName).where({ id }));
```
Use `@Common.SideEffects: { TargetProperties: […], TargetEntities: […] }` to scope the refresh client-side; don't shrink the action's return shape.

### 1.4 — `liveMode: true` triggers a `$batch` per keystroke on large entities

**Symptom.** The filter bar lags or the backend gets hammered when a user types in a filter field on a List Report.

**Root cause.** `liveMode: true` on a SmartFilterBar / FilterField fires the filter on every keystroke. Acceptable for CodeLists / master data (~tens of rows); catastrophic for transactional entities (~millions).

**Remedy.** Default to `liveMode: false` on transactional entities. Reserve `liveMode: true` for CodeList-backed dropdowns and small master-data lookups.

### 1.5 — Composition vs Association for audit / log child entities

**Symptom.** Saving a draft of a transactional entity fails with `*_drafts_pkey` unique-key violation on an audit / log child entity (`AuditLogEntry`, `ProcessStepExecution`, `BPResolutionCheck`, etc.).

**Root cause.** CAP copies **Composition** children into the draft. When the parent already has many audit rows, the draft copy duplicates their primary keys → `_drafts_pkey` collision. Compositions also impose cascade-delete semantics, which audit / log tables should never inherit (legal retention).

**Remedy.** Model audit / log children as **Association**, not Composition. They are not part of the editable graph; they are read-only references with their own retention rules.

### 1.6 — `i18n>{model>keyPath}` dynamic binding does not work

**Symptom.** A label or text appears blank or shows the raw key path (`{i18n>some.dynamic.key}`).

**Root cause.** Double binding (`{i18n>{model>x}}`) is not resolvable at compile time and most UI5 binding parsers refuse it.

**Remedy.** Resolve the key in the controller `onInit()` and populate the model with literal strings:
```typescript
const i18n = this.getView().getModel('i18n').getResourceBundle();
this.getView().getModel('view').setProperty('/computedLabel', i18n.getText(keyFromModel));
```

### 1.7 — Custom Facets must not collide with HeaderInfo auto-Facet IDs

**Symptom.** ObjectPage edit mode shows an unexpected section called "Header" or "General", or your custom Facet is replaced by an auto-generated one.

**Root cause.** FE V4 edit mode auto-generates a Facet from `UI.HeaderInfo`. Giving a custom Facet the same `ID` causes a silent merge.

**Remedy.** Prefix custom Facet IDs with the entity name and the section purpose, e.g. `Invoices_Workflow_Timeline`. Never reuse `Header`, `General`, `Main`.

### 1.8 — `@Common.ValueListWithFixedValues` duplicated crashes MDC

**Symptom.** Filter bar refuses to render with "Invalid property definition" in MDC.

**Root cause.** Annotating the same field with `@Common.ValueListWithFixedValues: true` from two sources (e.g. the schema and an annotation file) registers two value lists; MDC chokes on the duplicate.

**Remedy.** Single source of truth. Decide whether the value list lives on the schema (`db/schema.cds`) or in the annotations layer (`app/annotations/*.cds`) — and stick to it.

### 1.9 — `manifest.json` must declare the i18n model explicitly

**Symptom.** Texts annotated `{i18n>label_*}` in CDS render blank in the UI.

**Root cause.** FE V4 doesn't infer the i18n bundle path. The `manifest.json` must declare:
```json
"sap.ui5": {
  "models": {
    "i18n": {
      "type": "sap.ui.model.resource.ResourceModel",
      "settings": { "bundleName": "<namespace>.i18n.i18n" }
    }
  }
}
```

**Remedy.** Verify `bundleName` matches the actual file path under `webapp/i18n/`. Misaligned bundle paths → silent blank texts.

### 1.10 — `@odata.draft.enabled` master data: choose per case, not per default

**Symptom.** `lock_drafts` pollution and ETag conflicts on a CodeList that is rarely edited.

**Root cause.** Blanket `@odata.draft.enabled: true` on pure read-mostly CodeLists adds friction without UX benefit. Conversely, transactional master data with multiple fields under governance benefits from the draft activate/cancel pattern.

**Remedy.** Per-entity decision:
- **No draft** for read-mostly CodeLists / DocumentTypes (admin edits are rare, single-field).
- **Draft** for transactional master data with multi-field edits under governance.

### 1.11 — Status fields: use `sap.common.CodeList`, not `String enum`

**Symptom.** A status column in a table displays raw codes (`'PENDING_APPROVAL'`) instead of friendly labels.

**Root cause.** `String(N) @assert.range enum { … }` does not generate a value list; FE V4 has no source to map code → label.

**Remedy.** Model status as a `CodeList` entity:
```cds
entity ProcessingStatuses : sap.common.CodeList {
  key code : String(20);
}
```
Seed it via CSV. For tables, expose a `CASE`-derived computed field with `@Common.Text` + `@Common.TextArrangement: #TextOnly`.

### 1.12 — Italian "Edit" appears as "Elabora" — never name custom actions "Edit"

**Symptom.** The standard FE V4 Edit button conflicts with a custom action also called "Edit", or appears in unexpected positions.

**Root cause.** FE V4 reserves the verb "Edit" for the draft-edit transition. Adding a custom action with the same label confuses the rendering pipeline.

**Remedy.** Name custom actions explicitly: `Approve`, `Reject`, `Resolve`, `Cancel`. Never `Edit`, `Submit` (reserved by draft semantics), `Activate` (FE V4 internal).

---

## Category 2 — CAP / TypeScript Pitfalls

### 2.1 — `cds.tx(async tx => …)` autonomous deadlocks SQLite single-writer

**Symptom.** Lifecycle E2E tests time out non-deterministically on SQLite; production rarely sees it but staging on a small Postgres might.

**Root cause.** `cds.tx(async tx => …)` opens a separate transaction. On SQLite (single-writer) or under high contention, if the outer handler already holds a write lock, the inner autonomous tx waits forever.

**Remedy.** Inside a handler, reuse the request tx: `cds.tx(req)`. Reserve autonomous tx (`cds.tx(async tx => …)`) for truly independent work (background jobs, post-commit side effects). For audit on Postgres / HANA where deadlock cost is lower, use `cds.connect.to('db')` and direct `db.run(INSERT…)`.

### 2.2 — `forUpdate()` before lifecycle UPDATE

**Symptom.** Concurrent lifecycle actions race; one of them silently overwrites the other's transition.

**Root cause.** A `SELECT` that precedes an `UPDATE` in a lifecycle action does not lock the row. Under concurrent requests, both reads see `state=A`, both decide to advance to `state=B`, both write.

**Remedy.** When the read informs the write, use `.forUpdate()`:
```javascript
const row = await tx.run(SELECT.one.from(Entity).where({ id }).forUpdate());
// decide state transition based on `row`
await tx.run(UPDATE(Entity).set({ status: 'B' }).where({ id }));
```

### 2.3 — Side effects in `req.on('succeeded', …)`, not in the request handler

**Symptom.** Action fails near the end, but the outbound notification / S/4 push has already fired.

**Root cause.** A successful Cloud Application Programming handler may still roll back if a downstream handler errors. Side effects performed inside the handler get partially committed.

**Remedy.** Use the request's lifecycle hook:
```javascript
req.on('succeeded', () => emitEvent(…));
req.on('succeeded', () => sendNotification(…));
```
Inside the hook, the tx is already committed. Side effects are fire-and-forget; failure should `LOG.warn` only, never escalate to the user.

### 2.4 — `cds.log('module-name')` everywhere; never `console.*`

**Symptom.** Logs in production are noisy and unfilterable; correlation IDs are missing.

**Root cause.** `console.log` bypasses the CAP logging facade. No log level, no module tag, no correlation.

**Remedy.** Every module:
```typescript
const LOG = cds.log('module-name');
LOG.info({ correlationId, action: 'foo' }, 'descriptive message');
```
Enables filtering by module, integrates with Cloud Logging / Loki, supports structured metadata.

### 2.5 — Centralized reject helper (`rejectSafe`) — never expose `err.message`

**Symptom.** A 500 response leaks internal error text including SQL fragments or stack traces.

**Root cause.** `req.reject(500, err.message)` propagates the raw exception. SQL injection details, internal hostnames, table names all reach the client.

**Remedy.** Build one helper:
```typescript
export function rejectSafe(req: cds.Request, code: number, userMsg: string, err: unknown, log: cds.Log) {
  log.error({ err, code }, userMsg);
  req.reject(code, userMsg); // userMsg is curated, no `err.message`
}
```
All handlers route errors through this helper. Internal detail goes to the log; user gets a sanitized message.

### 2.6 — TypeScript strict rolled out folder-by-folder, not repo-wide

**Symptom.** A "strictify the project" PR explodes into thousands of type errors and never lands.

**Root cause.** Strict mode is binary in `tsconfig.json`. Flipping it for the whole repo dumps decades of legacy types at once.

**Remedy.** Per-folder strict tsconfig:
```json
// srv/tsconfig.strict.json
{
  "extends": "../tsconfig.json",
  "compilerOptions": { "strict": true },
  "include": ["handlers/**/*.ts", "utils/**/*.ts"]
}
```
Add `npm run typecheck:strict`. Promote folders one at a time, lock them in CI when ready.

### 2.7 — `xs-security.json` tenant-mode: `dedicated` is the default; switch to shared deliberately

**Symptom.** A multi-customer audit reveals tenant data crossing customer boundaries.

**Root cause.** `"tenant-mode": "shared"` opens multi-tenancy at the XSUAA layer but doesn't automatically enforce tenant isolation in the data layer. Audit log writes, autonomous tx, and `cds.tx({tenant})` calls each need review.

**Remedy.** Default to `"tenant-mode": "dedicated"` (single-tenant). Multi-customer = multi-deployment. Migration to shared multi-tenancy is a deliberate, planned exercise: schema-routed audit log, tenant-aware autonomous tx, separate review.

### 2.8 — `cap-js` plugin matrix discipline

**Symptom.** New plugins drift into `package.json` without ADR / matrix discussion; the runtime acquires unaudited side effects.

**Root cause.** `cap-js/*` plugins are powerful but each one extends the runtime (e.g. `@cap-js/audit-logging` registers a BTP-emit layer; `@cap-js/change-tracking` hooks every update). Adding them silently leaves the team unaware of the new coupling.

**Remedy.** Maintain a matrix doc (an ADR is sufficient) listing every `@cap-js/*` plugin: `Adopted` / `Deferred` / `Not-applicable`. CI gate verifies that `package.json` ↔ matrix doc match (see [`../sap-cap-ci-gates-pattern/SKILL.md`](../sap-cap-ci-gates-pattern/SKILL.md#pattern-4--convention--matrix-drift-detection) Pattern 4).

---

## Category 3 — BTP / Kyma / On-Premise Deployment Lessons

CAP + Fiori Elements V4 projects deploy across **four canonical target environments**, each with distinct constraints around authentication, persistence, UI delivery, remote service binding, and operational tooling. Patterns 3.A.* are target-specific; patterns 3.1-3.10 are cross-cutting (apply regardless of target).

> **Always ask the deployment target first.** The auditor / orchestrator / generator skill **MUST** ask the user (or detect from project state) which of the four targets is in scope before generating manifests, recommending CDS profiles, or producing deployment artifacts. The wrong target produces unsalvageable advice (e.g. `html5-apps-repo` binding on Kyma → 401; `cds run` on a project expecting `cds watch` → blank UIs).

### 3.0 — Deployment target decision matrix

| Target | When to choose | CDS profile | Auth | DB | UI delivery | Remote services |
|---|---|---|---|---|---|---|
| **BTP Cloud Foundry** | Customer is fully BTP-managed, has CF entitlements, accepts BTP-managed services (Free or pay) | `production` (HANA HDI) or `production-pg` (PostgreSQL, deprecated 2026-Q4) | XSUAA | HANA HDI or BTP PostgreSQL service | `@sap/html5-app-repo` (Free plan OK) + approuter | BTP Destination service + Cloud Connector |
| **BTP Kyma** | Customer wants Kubernetes operational model, BTP-hosted but more flexible than CF, uses pay-tier or in-cluster services | `k8s` | OIDC (XSUAA or IAS via OAuth2) | PostgreSQL in-cluster (Bitnami Helm) or HANA Cloud | UI ZIPs embedded in approuter Docker image | `S4_BASE_URL` + Destination via Kyma BTP Operator |
| **On-Premise Kyma** | Customer-managed cluster (k3d local, Rancher, Gardener, OpenShift), uses customer IdP (Keycloak), needs full data sovereignty | `k8s-onprem` (Keycloak + HANA/PG) or `k8s-hana` (Kyma + HANA on-prem) | OIDC via customer IdP (Keycloak, Active Directory) | HANA on-prem or PostgreSQL on-prem | UI ZIPs embedded; ingress via NGINX or cluster-native | `*.svc.cluster.local` for in-cluster S/4 proxies + Cloud Connector for SaaS bridges |

> **Not supported**: On-Premise Cloud Foundry. SAP Cloud Foundry On-Premise reached end of maintenance; the skill does not propose deployment plans against an EOL runtime. Customers with existing CF on-prem investment should be advised to migrate to **BTP CF** (managed) or **BTP Kyma**, not to extend the EOL footprint.

The default recommendation for a new project is **BTP Cloud Foundry** — it is the most widely-adopted SAP-managed runtime, has the broadest service ecosystem (Free + paid tiers for `xsuaa`, `html5-apps-repo`, `destination`, `connectivity`, `event-mesh`, `audit-log`, `job-scheduling`, …), the most mature operational tooling (`mta.yaml` + `mbt build` + `cf deploy`), and the lowest operational ceremony for teams without dedicated Kubernetes expertise. Choose **BTP Kyma** when the customer wants the Kubernetes operational model (pay-tier services, more runtime flexibility, container-native eventing, CronJob CRDs). Choose **On-Premise Kyma** when the customer mandates data sovereignty or has existing Kubernetes infrastructure.

### 3.A — BTP Cloud Foundry patterns

#### 3.A.1 — Use `mta.yaml` for atomic deployment

**Symptom.** Half-deployed state when a component fails: db deployer succeeded, srv failed, html5-apps-repo not yet wired.

**Root cause.** Manual `cf push` per component doesn't atomically roll back on failure.

**Remedy.** Wrap everything in `mta.yaml`: db deployer, srv module, approuter, destinations, XSUAA service binding. Use `mbt build` + `cf deploy <archive>.mtar`. Failures roll back the whole MTA.

#### 3.A.2 — XSUAA scope wiring via `xs-security.json`

**Symptom.** Role assignments work in dev but production users get 403 on actions that worked in test.

**Root cause.** `xs-security.json` declares scopes; CAP handlers must `@(restrict: [{grant: '...', to: '<scope-or-role>'}])` to enforce. Mismatch between xs-security and `services-auth.cds` is silent.

**Remedy.** Treat `xs-security.json` as the single source of truth for scope names. Match every `services-auth.cds` `to:` clause to a declared scope. Add a CI gate (see [`../sap-cap-ci-gates-pattern/SKILL.md#pattern-4--convention--matrix-drift-detection`](../sap-cap-ci-gates-pattern/SKILL.md) Pattern 4) that catches drift.

#### 3.A.3 — Destination service for S/4HANA Tier-2 proxies

**Symptom.** S/4 proxy calls fail with 401 in production despite working in dev with `.cdsrc-private.json`.

**Root cause.** Dev profile uses inline credentials; production must use a Destination configured in BTP cockpit + bound to the srv module via destination service.

**Remedy.** Define one BTP Destination per S/4 system. Bind the destination service to srv. Use principal propagation (SAML / JWT bearer) when end-user identity must reach S/4; use system user (BasicAuthentication or OAuth2ClientCredentials) for batch / job calls.

#### 3.A.4 — html5-apps-repo for UI delivery (Free plan acceptable)

**Symptom.** Approuter image is 600 MB because it ships every UI app embedded.

**Root cause.** On CF, you can use the managed UI repo instead of embedding.

**Remedy.** Use `@sap/html5-app-repo` Free or pay-tier. Build UI bundles via `ui5 build`, upload via `npm run upload-html5-apps`. Approuter routes `/<app-id>/*` to the repo. Free plan has limits (5 apps, 50 MB total) — verify against your project size before committing.

#### 3.A.5 — Cloud Foundry health checks

**Symptom.** App restarts often even when running fine.

**Root cause.** Default CF health check is HTTP `/`. Many CAP services return 404 on `/` (no homepage).

**Remedy.** In `manifest.yml`: `health-check-type: http`, `health-check-http-endpoint: /health/Live`. Pair with the `/health/Ready` endpoint for the proper liveness/readiness split (cross-cutting pattern 3.7).

### 3.B — BTP Kyma patterns

#### 3.B.1 — APIRule (CRD) for ingress, not Ingress YAML

**Symptom.** Direct Ingress YAML works in dev but doesn't integrate with BTP IAM / Kyma identity.

**Root cause.** Kyma's networking pipeline uses `APIRule` (custom CRD) that wires JWT validation, CORS, rate limiting natively.

**Remedy.** For each public service, declare an `APIRule`:
```yaml
apiVersion: gateway.kyma-project.io/v1beta1
kind: APIRule
metadata:
  name: srv
spec:
  host: srv.${KYMA_APP_URL}
  service:
    name: srv
    port: 4004
  gateway: kyma-system/kyma-gateway
  rules:
    - path: /.*
      methods: [GET, POST, PUT, PATCH, DELETE]
      accessStrategies:
        - handler: jwt
          config:
            jwks_urls:
              - https://${XSUAA_HOST}/token_keys
            trusted_issuers:
              - https://${XSUAA_HOST}
```
For approuter, add `noAuth` accessStrategy on the OAuth2 callback paths.

#### 3.B.2 — Service Manager bindings via secrets (not env)

**Symptom.** Refactoring credentials breaks the running pod because env vars don't reload.

**Root cause.** Kyma's BTP Service Operator creates `Secret` resources on `ServiceBinding` apply; pod mounts them as volume + env.

**Remedy.** Use `ServiceInstance` + `ServiceBinding` CRDs. Don't hardcode credentials in `Deployment.env`; reference the Secret by name. Pod restart picks up rotated credentials automatically (with proper `restartPolicy`).

#### 3.B.3 — CronJob CRD for scheduled jobs, not BTP Job Scheduler

**Symptom.** BTP Job Scheduler binding fails (or costs extra) on Kyma.

**Root cause.** BTP Job Scheduler is a CF-friendly service; Kyma-native is `CronJob` CRD.

**Remedy.** Declare every scheduled job as a Kyma `CronJob` pointing at a job-runner endpoint:
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: <job-name>
spec:
  schedule: "0 */6 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: trigger
              image: curlimages/curl:8.5.0
              command: ["sh", "-c", "curl -fsS -X POST -H 'X-Job-Token: $(JOB_TOKEN)' http://srv:4004/api/jobs/<job-name>"]
              env: [{name: JOB_TOKEN, valueFrom: {secretKeyRef: {name: job-token, key: token}}}]
          restartPolicy: OnFailure
```
The srv module exposes job endpoints (token-protected). Cron triggers via HTTP.

#### 3.B.4 — Bitnami PostgreSQL Helm chart for in-cluster persistence

**Symptom.** BTP PostgreSQL Free plan refuses Kyma binding (CF-only).

**Root cause.** Free-tier BTP services don't route into Kyma.

**Remedy.** Install Bitnami PostgreSQL via Helm: `helm install pg bitnami/postgresql -n <ns> -f values-pg.yaml`. PVC-backed, single-instance OK for non-critical workloads; for production use Patroni Helm chart for HA. Connection details via Secret.

#### 3.B.5 — `KYMA_APP_URL` + `KYMA_KUBECONFIG` GitHub Actions secrets for multi-region

**Symptom.** Deploying to a second region requires forking the CI pipeline.

**Root cause.** Hardcoded hostnames in workflow YAML and Kubernetes manifests.

**Remedy.** Parameterize via 2 GitHub Actions secrets: `KYMA_APP_URL` (cluster-specific subdomain) + `KYMA_KUBECONFIG`. Use `envsubst` in the deployment workflow:
```yaml
- run: kubectl apply -f <(envsubst < k8s/deployment-srv.yaml)
```
Region switch = rotate the two secrets + update DNS CNAME. Zero code change.

#### 3.B.6 — HorizontalPodAutoscaler + PodDisruptionBudget for production

**Symptom.** Pod evictions during cluster upgrades cause unavailability spikes.

**Root cause.** Default `Deployment` has no HPA / PDB; cluster upgrades evict pods in parallel.

**Remedy.** Pair every production `Deployment` with:
- `HorizontalPodAutoscaler` (min: 2, max: N, targetCPU: 70%) for capacity.
- `PodDisruptionBudget` (minAvailable: 1) so cluster upgrades drain pods serially.
- `NetworkPolicy` to restrict in-cluster traffic (default-deny + explicit allow).

#### 3.B.7 — Approuter session stickiness via nginx cookie affinity

**Symptom.** FE V4 batch requests fail intermittently with CSRF token mismatch (403 / 419).

**Root cause.** Kyma's default load balancer round-robins across approuter pods; CSRF tokens are pod-local.

**Remedy.** Cookie-based affinity on the Kyma `APIRule`:
```yaml
metadata:
  annotations:
    nginx.ingress.kubernetes.io/affinity: "cookie"
    nginx.ingress.kubernetes.io/session-cookie-name: "route"
    nginx.ingress.kubernetes.io/session-cookie-max-age: "172800"
```
Never disable CSRF (`csrfProtection: false`) — UI5 + FE V4 depend on it. This is the same as cross-cutting Pattern 3.3 but worth re-stating in the Kyma section.

### 3.C — On-Premise Kyma patterns

#### 3.C.1 — Cluster flavor matters: k3d / Rancher / Gardener / OpenShift

**Symptom.** Manifests that work on BTP Kyma fail on the customer's on-prem cluster.

**Root cause.** Kyma CRDs (APIRule, ServiceInstance) may not be present; cluster may use Istio differently; storage class names differ.

**Remedy.** Detect the flavor upfront:
- **k3d** (local dev): no APIRule CRD; use plain `Ingress` + nginx-ingress controller.
- **Rancher**: usually has Istio; APIRule may need install of Kyma networking module.
- **Gardener** (SAP-managed customer): Kyma module typically installed; treat like BTP Kyma.
- **OpenShift**: Routes instead of Ingress; SCC (Security Context Constraints) may block non-root containers.

Provide two manifest sets: a "Kyma-native" (APIRule + ServiceInstance) and a "Kubernetes-vanilla" (Ingress + Secret).

#### 3.C.2 — Customer IdP via Keycloak realm

**Symptom.** BTP IAM (XSUAA / IAS) doesn't reach the customer's on-prem network.

**Root cause.** On-prem deployment cannot consume BTP-managed auth services.

**Remedy.** Provide a Keycloak realm definition (`keycloak-realm.json`) with:
- Roles matching the CAP `services-auth.cds` scopes (Viewer, Admin, etc.).
- Groups mapping to roles.
- OAuth2 client for the approuter with redirect URI = `https://<app-host>/login/callback`.
- Optional: federate with customer's Active Directory / LDAP / SAML2 IdP.

In CAP, use `OIDCAuthStrategy` (the project's custom strategy that validates JWTs from a configurable issuer):
```yaml
# k8s-onprem profile
cds.requires.auth:
  kind: jwt-auth
  issuer: https://keycloak.${CUSTOMER_DOMAIN}/realms/<realm>
  jwks_uri: https://keycloak.${CUSTOMER_DOMAIN}/realms/<realm>/protocol/openid-connect/certs
```

#### 3.C.3 — `secrets.env` + `envsubst` pattern for per-customer config

**Symptom.** Each customer needs different DB endpoint / IdP URL / S/4 hostname; copy-paste manifests are error-prone.

**Root cause.** Kubernetes ConfigMaps / Secrets don't templatize across deployments.

**Remedy.** Per-customer `secrets.env` file (one source of truth), checked into customer-specific repo only. Installer script does:
```bash
set -a
source secrets.env
set +a
envsubst < k8s/onprem/configmap.yaml | kubectl apply -f -
envsubst < k8s/onprem/deployment-srv.yaml | kubectl apply -f -
```
`secrets.env` contains: `DB_HOST`, `DB_USER`, `S4_BASE_URL`, `KEYCLOAK_REALM_URL`, `CUSTOMER_DOMAIN`, etc.

#### 3.C.4 — Sizing wizard: customer hardware tier (xs / s / m / l)

**Symptom.** Customer with 2 GB cluster RAM crashes the pod on first request.

**Root cause.** Default resource requests/limits sized for cloud (4-8 GB pod RAM); on-prem dev clusters may have far less.

**Remedy.** Document four sizing tiers in the deployment manifests with `kustomize` or Helm overlay:
| Tier | Pod RAM request | Pod CPU request | Replicas | Use case |
|---|---|---|---|---|
| **xs** | 512 Mi | 250 m | 1 | dev / proof-of-concept, ≤10 concurrent users |
| **s** | 1 Gi | 500 m | 2 | small customer, ≤50 concurrent users |
| **m** | 2 Gi | 1000 m | 3 | medium customer, ≤200 concurrent users |
| **l** | 4 Gi | 2000 m | 4+ HPA | large customer, ≤1000 concurrent users |

For dev clusters (`xs` tier) optionally enable `LOW_MEM_MODE=true` env var that disables expensive features (less aggressive caching, smaller worker pools). **Document as DEV-ONLY** — customers in production must use the appropriate tier from the wizard.

#### 3.C.5 — Pre-flight check before install

**Symptom.** Installer halfway in fails because Docker / RAM / DNS / kubectl version is insufficient.

**Root cause.** Cluster pre-conditions not verified upfront.

**Remedy.** First step of the installer script does a comprehensive pre-flight:
```bash
# Pre-flight
check_docker_running || die "Docker not running"
check_docker_ram_gb 4 || die "Need ≥4 GB Docker RAM"
check_kubectl_version "1.28" || die "Need kubectl ≥1.28"
check_dns_resolve "$KEYCLOAK_HOST" || die "Cannot resolve Keycloak host"
check_curl_works "$S4_BASE_URL" || warn "S/4 hostname unreachable (Cloud Connector down?)"
check_storage_class_exists "$STORAGE_CLASS" || die "Storage class missing"
```
Exit cleanly with actionable error before consuming time / state.

#### 3.C.6 — In-cluster service URLs (`*.svc.cluster.local`)

**Symptom.** S/4 proxy host hardcoded as a public hostname doesn't reach in-cluster S/4 proxy.

**Root cause.** On-prem clusters may run their own S/4 OData proxy as a sidecar service.

**Remedy.** Configure `S4_BASE_URL` (or equivalent) to use Kubernetes service DNS: `http://s4-proxy.s4-namespace.svc.cluster.local:8080`. The CAP runtime resolves it cluster-internally without exiting to public DNS. Faster, more secure, no Cloud Connector needed for in-cluster paths.

### 3.1 — `cds run` does NOT mount UI5 apps

**Symptom.** Production deployment serves the OData service but the UI5 apps return 404.

**Root cause.** `cds-plugin-ui5` (which mounts apps under `cds watch`) is dev-only. `cds run` (production) doesn't include it.

**Remedy.** In production, serve UI bundles via the approuter:
- Build UI ZIPs (`ui5 build --all`).
- Embed under `approuter/static/<app>/` in the Docker image.
- Approuter routes `/<app>/*` → static files.
- OR use `@sap/html5-app-repo` (BTP CF only; not Kyma if free-tier).

### 3.2 — BTP Free Plan is CF-only

**Symptom.** Trying to bind `html5-apps-repo` or `postgresql-db` (free) from a Kyma deployment returns 401 or refuses to provision.

**Root cause.** Free-tier service brokers expose private endpoints reachable only from BTP CF, not from Kyma's cluster network.

**Remedy.** For Kyma deployments, pay-tier or in-cluster equivalents:
- UI ZIPs embedded in approuter image (instead of `html5-apps-repo`).
- Bitnami PostgreSQL Helm chart in-cluster (instead of `postgresql-db` free).
- HANA Cloud has a public endpoint, usable from Kyma directly.

### 3.3 — Approuter on Kyma needs session stickiness

**Symptom.** FE V4 batch requests fail intermittently with CSRF token mismatch (403 / 419).

**Root cause.** Kyma's default load balancer round-robins requests across approuter pods. The CSRF token issued by pod A is rejected by pod B.

**Remedy.** Cookie-based affinity on the Kyma APIRule:
```yaml
metadata:
  annotations:
    nginx.ingress.kubernetes.io/affinity: "cookie"
    nginx.ingress.kubernetes.io/session-cookie-name: "route"
```
Never disable CSRF (`csrfProtection: false`) — UI5 + FE V4 depend on it.

### 3.4 — Multi-stage Dockerfile: build needs native toolchain, runtime stays slim

**Symptom.** Build fails on `tree-sitter-java` native compilation or runtime image is bloated with 800 MB of build dependencies.

**Root cause.** Some `@sap/eslint-plugin-cds` transitive deps need `python3 make g++` to build native modules; the production image doesn't need them.

**Remedy.** Multi-stage build:
```Dockerfile
FROM node:22 AS builder
RUN apk add python3 make g++   # build-only tools
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npx cds build --production
WORKDIR /app/gen/srv
RUN npm ci --production && npm install @cap-js/sqlite @sap/cds-dk tsx

FROM node:22-slim AS runtime
COPY --from=builder /app/gen /app/gen
WORKDIR /app/gen/srv
ENV NODE_OPTIONS='--import tsx'
CMD ["node_modules/.bin/cds-serve"]
```

### 3.5 — `NODE_OPTIONS='--import tsx'` for TypeScript in production

**Symptom.** Production container starts but fails on first TypeScript handler load: "Unknown file extension: .ts".

**Root cause.** Standard Node 22 can't load `.ts` files; the project's CAP handlers are TypeScript.

**Remedy.** Bundle `tsx` in the runtime image and load it via `NODE_OPTIONS='--import tsx'`. The `cds-serve` binary handles the rest.

### 3.6 — `npm prune` after `npm ci --production` is harmful

**Symptom.** Production image is missing `@cap-js/sqlite` (test profile) or `tsx` (TypeScript loader); runtime fails.

**Root cause.** `npm prune --production` removes anything marked `devDependencies`, but the CAP runtime needs some `devDependencies` even in production (test driver to fallback, TS loader).

**Remedy.** Do **not** run `npm prune`. Use `npm ci --production` in the runtime stage and add back what you specifically need: `npm install @cap-js/sqlite @sap/cds-dk tsx`.

### 3.7 — Health probes: separate `/health/Live` (no-DB) from `/health/Ready` (DB check)

**Symptom.** Kyma keeps restarting the pod even though the app is up because the DB is briefly unreachable.

**Root cause.** A liveness probe that hits the DB conflates "app is alive" with "DB is reachable". A flapping DB → restart loop.

**Remedy.** Two endpoints:
- `/health/Live` → always 200 if the process is responsive. No DB.
- `/health/Ready` → 200 only if DB is reachable AND model loaded.
Map `livenessProbe` → `/health/Live`, `readinessProbe` → `/health/Ready`.

### 3.8 — Multi-region readiness via secret rotation

**Symptom.** Deploying to a second region requires forking the CI pipeline.

**Root cause.** Hardcoded hostnames in workflow YAML and manifests.

**Remedy.** Parameterize the Kyma hostname via 2 GitHub Actions secrets: `KYMA_APP_URL` (e.g. `myapp.c-xxx.kyma.ondemand.com`) + `KYMA_KUBECONFIG`. Region switch = rotate the two secrets + update DNS. Zero code change.

### 3.9 — Image registry: prefer public GHCR for OSS, private for IP

**Symptom.** Kyma can't pull the image; private registry credentials are rotating constantly.

**Root cause.** Mixing the image-pull-secret rotation with the deployment rhythm.

**Remedy.** For open-source / non-sensitive code, public GHCR. For sensitive: dedicate a service account, rotate the PAT separately from deployment, surface the rotation as a runbook item.

### 3.10 — `cds-plugin-ui5` is dev-only; ship UI separately

**Symptom.** "UI works in `cds watch` but breaks in `cds run`."

**Root cause.** `cds-plugin-ui5` registers a custom UI5 sandbox under `cds watch`. `cds run` (production) doesn't load plugins of that class.

**Remedy.** Two distinct delivery paths:
- Local dev → `cds watch` + `cds-plugin-ui5` serves apps from `app/<app>/webapp/`.
- Production → approuter serves apps from `dist/` (post-`ui5 build`) bundled into the Docker image.

### 3.11 — Clean Core Level A as **deployment gate**, not just an audit

**Symptom.** Production deployment succeeds; weeks later a consumed S/4HANA Communication Scenario is deprecated; the next quarterly upgrade window breaks the app silently.

**Root cause.** Clean Core compliance was audited once at design time and not re-verified pre-deployment. The audit's findings live in a markdown report that nobody reads on the day of deploy.

**Remedy.** Make Clean Core Level A verification a **CI gate that blocks deployment**, not a passive report. Three authoritative sources MUST be consulted:

1. **The ABAP API Release State repository** (`SAP/abap-atc-cr-cv-s4hc`): https://github.com/SAP/abap-atc-cr-cv-s4hc/blob/main/README.md. This repo's `*.json` files are the **source of truth** for whether an ABAP object (CDS view, BAPI, RFC FM) is released — and for which edition (Public Cloud / Private Cloud / On-Premise). Pin a `git submodule` or scheduled-clone snapshot of this repo into the project; re-pull weekly via cron.

2. **The SAP API Hub** (https://api.sap.com/): authoritative for **OData service availability per edition** (Communication Scenarios, packages, lifecycle states). Cross-check every `cds.connect.to(<remote-service>)` against the API Hub; record the edition matrix in the project's compatibility catalog.

3. **The project's compatibility catalog** (e.g. `srv/integration/s4CompatibilityPolicy.js`): the project's *declared* edition × service matrix with `availability[]` and `probeObject` fields. The CI gate verifies this catalog matches sources 1 + 2; any drift is a HARD FAIL (cannot ship).

Use [`../sap-cap-clean-core-enforce/SKILL.md`](../sap-cap-clean-core-enforce/SKILL.md) to discover consumption, build the matrix, detect drift. Use [`../sap-cap-ci-gates-pattern/SKILL.md#pattern-3--released-state--api-availability-drift-detection`](../sap-cap-ci-gates-pattern/SKILL.md) Pattern 3 to enforce the gate on every PR.

Compliance contract:
- **Level A** (Released APIs only): every consumed Tier-2 S/4 service is in the released catalog for ALL deployment-target editions. Zero RFC/BAPI/SQL-direct usage. Zero modifications to standard tables. Zero user-exits.
- **Drift detected** ⇒ CI fails. Choices: (a) remove the consumption, (b) replace with the released equivalent, (c) accept and document a Level B/C/D exception (rare, needs sign-off).

This is the **single most important** deployment gate for CAP + S/4 projects. A non-released service that lands in production becomes a multi-quarter migration debt the next time SAP revises the API surface.

---

## Category 4 — Security Defense-in-Depth

### 4.1 — Audit log append-only — three layers

**Symptom.** A SOX / GDPR auditor demands proof that AuditLogEntry cannot be tampered with.

**Root cause.** Single-layer enforcement (CDS `@restrict: READ only`) is bypassable by anyone with DB access.

**Remedy.** Three layers, none of which can be the only one:
1. **CDS layer**: `grant: 'READ'` only; no `WRITE` / `UPDATE` / `DELETE` for any role except a specific anonymization job.
2. **Handler layer**: a before-handler on `AuditLogEntry` rejects any non-INSERT verb with 403 explicitly.
3. **Database layer**: DB trigger (Postgres / HANA) raises an exception on `UPDATE` or `DELETE` of `AuditLogEntry` rows, except from a designated retention process.

Layer 1 is the contract; layer 2 enforces in the runtime; layer 3 is the safety net if a privileged code path slips past layers 1-2.

### 4.2 — PII sanitization before audit log

**Symptom.** A leaked DB dump exposes IBANs, fiscal codes, emails because they ended up in the audit log.

**Root cause.** Audit log writes pass through every textual field as-is.

**Remedy.** A central `_sanitizePII(text)` helper applied at the audit-log entry boundary. Mask IBANs (preserve last 4), fiscal codes, VAT numbers, full email addresses. Wire it into the audit logger:
```typescript
async function logAuditEntry(tx, entry) {
  for (const field of TEXTUAL_FIELDS) {
    entry[field] = _sanitizePII(entry[field]);
  }
  await tx.run(INSERT.into(AuditLogEntry).entries(entry));
}
```

### 4.3 — Magic bytes verification on upload — never trust MIME header

**Symptom.** A user uploads `evil.pdf` whose body is actually an HTML / SVG with a script payload.

**Root cause.** The `Content-Type` header is set by the client; PDF readers / image previewers in the UI render based on the body bytes, not the header.

**Remedy.** Read the first 8 bytes of the upload and verify the magic bytes match the claimed MIME type. For PDF: `%PDF-`. For PNG: `\x89PNG`. For JPEG: `\xFF\xD8\xFF`. Reject mismatches with 415. The check belongs in the upload handler before any persistence call.

### 4.4 — Rate limiters per endpoint class, not global

**Symptom.** Auth endpoint is blocked by a global rate limit while file upload is wide open.

**Root cause.** A single global rate limit can't reflect the different risk / traffic profiles of different endpoint classes.

**Remedy.** Per-class limits (typical baseline):
- Global: 200/min/IP.
- Write OData: 60/min/IP.
- File upload: 10/min/IP.
- Job endpoints: 30/min/IP.
- MCP / external integration: 60/min per consumer (key from token claim).
All env-tunable. Use Redis backing in multi-pod deployments so limits are global, not per-pod.

### 4.5 — Token rotation: quarterly default; immediate on compromise

**Symptom.** A bot token leaked into a public log six months ago is still valid.

**Root cause.** No rotation policy means tokens live until manually rotated.

**Remedy.** Document a quarterly rotation runbook for every long-lived token (job invocation token, MCP service token, integration token). Immediate rotation triggers: token in logs, contributor leaves the project, secret scanner alert.

### 4.6 — OData `$expand` depth cap + per-entity `$top` cap

**Symptom.** A malicious / careless client expands six levels deep with `$top=10000`; the DB shudders.

**Root cause.** OData V4 defaults are permissive.

**Remedy.**
- Enforce a global `$expand` depth limit (2-3) in a request preprocessing handler.
- Enforce per-entity `$top` defaults and caps (e.g. AuditLog: default 200, max 1000).

### 4.7 — Multi-doc XML / multi-batch attack surface

**Symptom.** Uploaded multi-document XML (e.g. FatturaPA lotto) brings the parser to its knees with thousands of bodies.

**Root cause.** XML parsers happily walk every body; absent a cap, an attacker can DoS the service with a single-byte-per-body archive of millions.

**Remedy.** Hard cap on documents per upload (`MAX_BODIES = 50` is reasonable for batch-invoice patterns). Reject excess with 413.

---

## Category 5 — Customizing-Driven Patterns

### 5.1 — SystemParameter single-source-of-truth with bounded cache

**Symptom.** A parameter change in the admin UI takes 5-30 minutes to propagate; users complain.

**Root cause.** Naive caching with no TTL or no invalidation bus.

**Remedy.** Wrap reads through a `SystemParamReader.get(category, companyCode)`. Cache for 60-300 seconds (TTL). Publish an `InvalidationBus.publish(category)` event on writes that other pods listen to (Redis pub/sub or NATS). Cross-pod invalidation arrives in <1 s.

### 5.2 — Adapter factory dual-source fallback chain

**Symptom.** A change in the customizing UI doesn't take effect; the code is still reading from `cds.env`.

**Root cause.** Adapter wiring reads `cds.env.X` only, bypassing the SystemParameter layer.

**Remedy.** Canonical fallback chain inside the adapter factory:
```typescript
const params = await getSystemParamReader().get(CATEGORY, companyCode);
const value = params.MY_KEY                    // canonical
           || cds.env.adapter?.my_key          // cds.env fallback
           || process.env.MY_KEY                // env var fallback
           || DEFAULT_VALUE;                    // hardcoded last-resort
```
Mark the order in code comments. Audit ensures every adapter uses this chain (see [`../sap-cap-customizing-honor/SKILL.md`](../sap-cap-customizing-honor/SKILL.md)).

### 5.3 — Per-tenant override pattern (catalog → company override)

**Symptom.** A check must be active for company A and disabled for company B without forking the codebase.

**Root cause.** Single-layer config (`ProcessStepCheck` catalog) can't express per-tenant variation.

**Remedy.** Two-level table:
1. **Catalog** (`ProcessStepCheck`): ships with the product. Read-only at runtime.
2. **Override** (`CompanyCheckOverride`): one row per `(CompanyCode, CheckCode)`. Fields override catalog defaults (`IsDisabled`, `Severity`, `min`, `max`).
Runtime resolution: override → catalog → hardcoded default.

### 5.4 — Master-data references must be value-list-bound

**Symptom.** A user typed `1001 ` (trailing space) in a free-text CompanyCode field; downstream lookups fail.

**Root cause.** Free-text input on a foreign-key field bypasses referential integrity.

**Remedy.** Every FK field that points to a master-data entity (CompanyCode, GLAccount, BusinessPartner, etc.) must have `@Common.ValueList` annotation. On the filter bar AND on the edit form. Combined with `@Common.Text` + `@Common.TextArrangement: #TextOnly` for human-readable display.

### 5.5 — Bidirectional CSV ↔ code consistency

**Symptom.** Admin UI surfaces a parameter that does nothing; or a code path reads from a parameter the admin doesn't know exists.

**Root cause.** No enforced contract between CSV seed and code consumer.

**Remedy.** A CI gate (see [`../sap-cap-ci-gates-pattern/SKILL.md`](../sap-cap-ci-gates-pattern/SKILL.md#pattern-1--bidirectional-csv--code-consistency)) that fails the build on **inverse orphans** (code reads, CSV missing) or **forward orphans** (CSV seeds, no consumer). Allowlist for legitimate external consumers.

---

## Category 6 — Lifecycle / Process Discipline

### 6.1 — Centralized phase boundary map

**Symptom.** Three different handlers compute "what's the next status after PENDING_APPROVAL" independently and disagree.

**Root cause.** Status transitions implicit in each handler's logic.

**Remedy.** Single map module (`srv/process/statusTransitions.ts`):
```typescript
export const PHASE_BOUNDARIES: Record<Status, Status> = {
  NEW: 'RECEIVED',
  RECEIVED: 'VALIDATED',
  // …
};
```
Every action queries the map; tests verify exhaustiveness.

### 6.2 — CAS marker for idempotent state advance

**Symptom.** A user double-clicks "Post Invoice"; two S/4 posts happen.

**Root cause.** Handler isn't idempotent.

**Remedy.** Compare-And-Swap on a marker column:
```javascript
const updated = await tx.run(
  UPDATE(Invoices).set({ PostedAt: new Date() })
    .where({ id, PostedAt: { '=': null } })  // only if not yet posted
);
if (updated === 0) {
  return { alreadyPosted: true };  // someone else already did it
}
// proceed with actual post-to-S4 call
```

### 6.3 — Touchless handler idempotency

**Symptom.** A scheduled job runs the same automatic step twice on retry; downstream side effects duplicate.

**Root cause.** Steps marked `IsAutomatic=true` are invoked by a job runner that may retry on transient failure.

**Remedy.** Every touchless handler (resolveBP, checkDuplicate, validateFiscal, matchPO, etc.) must be idempotent: no double INSERT, no double S/4 call, no double notification. Use CAS markers (`6.2`) or guard with explicit "already processed" checks at the top.

### 6.4 — Exception auto-dispatch ordering

**Symptom.** Audit log shows the dispatch event before the raise event, confusing forensic review.

**Root cause.** Auto-dispatcher fires before the audit logger commits.

**Remedy.** Strict order in the raise handler:
1. `logAuditEntry(…)` — write audit row.
2. `autoDispatch(…)` — only after audit.
3. Return.
This way the audit log captures the pre-dispatch state.

### 6.5 — Orphan workflow cleanup when exception closes via reclassify

**Symptom.** A workflow item is still PENDING for an exception that the system already closed via reclassification.

**Root cause.** Exception closure path doesn't cascade to dependent workflow items.

**Remedy.** Helper `cancelOrphanWorkflows(tx, closedExceptionIds)` that:
1. Holds the lock acquired upstream (`forUpdate`).
2. UPDATE InvoiceWorkflowItem SET state='CANCELLED' WHERE exception_id IN closedExceptionIds AND state='PENDING'.
3. Logs each cancellation to the audit log.

### 6.6 — Auto-release pattern (no `forUpdate`, reuses caller tx)

**Symptom.** Auto-release of a payment block triggers a SELECT that races with the user's release.

**Root cause.** Naive implementation opens its own tx + forUpdate, contending with the caller.

**Remedy.** Reuse the caller's tx. Use a CAS marker (`SYSTEM_AUTO`) to ensure the auto-release fires only once. Document the exception clearly — this pattern is the **only** safe place to skip `forUpdate`, and it relies on CAS idempotency.

---

## Category 7 — Events / Messaging Post-Commit Patterns

### 7.1 — Declarative event service with typed payloads

**Symptom.** Six different files emit "InvoiceApproved" with three different payload shapes.

**Root cause.** No declarative contract for events.

**Remedy.** Declare events in a service:
```cds
service NOVAEvents @(path: '/odata/v4/events') {
  event InvoiceApproved : { eDocumentGuid: UUID; companyCode: String; approver: String; approvedAt: Timestamp };
  // …
}
```
Emit via `cds.connect.to('NOVAEvents').emit('InvoiceApproved', payload)`. AsyncAPI auto-generated from the declaration.

### 7.2 — Post-commit fire-and-forget emit

**Symptom.** A successful approve action gets blocked because the event broker is slow.

**Root cause.** Synchronous emit inside the handler couples user-facing latency to broker SLA.

**Remedy.** Emit from `req.on('succeeded')`:
```javascript
req.on('succeeded', async () => {
  try { await emitNovaEvent('InvoiceApproved', payload); }
  catch (err) { LOG.warn({ err }, 'emit failed'); }
});
```
The user-facing tx commits; emit failure logs but doesn't propagate.

### 7.3 — Connection cache as `Promise<Service>`, not `Service`

**Symptom.** First concurrent requests race; the service connects N times.

**Root cause.** Cache pattern `let cached: Service | null; if (!cached) cached = await cds.connect.to('X')` allows multiple awaits to all see `null` and initialize.

**Remedy.** Cache the promise:
```typescript
let cached: Promise<Service> | null = null;
function getEvents(): Promise<Service> {
  if (!cached) cached = cds.connect.to('NOVAEvents');
  return cached;
}
```
First call starts the connect; all concurrent calls await the same promise.

### 7.4 — Idempotency key cross-emit

**Symptom.** A retry emit during a transient broker outage produces a duplicate event downstream.

**Root cause.** Consumer can't tell "this is a retry of the same event" from "this is a new event".

**Remedy.** Compose a deterministic `idempotencyKey` per (eventType, entityId, companyCode) and include it in the payload metadata. Consumers dedupe on the key. Replay paths (e.g. outbox redelivery) reuse the same key.

### 7.5 — Outbox replay mirror as detective control

**Symptom.** Broker was down for 4 hours; some events never made it.

**Root cause.** No replay path for emissions that failed silently.

**Remedy.** Mirror emit events into `cds.outbox.Messages` (or a project-specific table). A periodic job re-emits unacknowledged entries. Distinguish first-emit from replay-emit in the metrics (`nova_events_emit_total` vs `nova_events_replay_total`).

---

## Category 8 — Ecosystem Plugin Landscape

This category is not gotchas — it's the map of **companion plugins / skills** that a CAP + Fiori Elements + BTP project benefits from. Each entry lists what it provides; the consuming skill's "Recommended Companion Plugins" section will reference these by name.

### 8.1 — SAP CAP Capire (`sap-cap-capire`)

CAP runtime knowledge base. Covers CDS modeling, service handlers, draft semantics, authentication / authorization, deployment profiles, multitenancy. Reference for any CAP-side question that goes deeper than this skill's snapshot.

### 8.2 — SAP UI5 (`sapui5`, `sap-fiori-tools`)

UI5 API explorer, control library reference, Fiori Tools scaffolding. Look up control APIs, manifest schema, annotation reference. Mandatory companion when working on Fiori Elements V4 apps.

### 8.3 — SAP BTP Cloud Platform (`sap-btp-cloud-platform`)

BTP service map (auth, persistence, connectivity, eventing). Use when designing a new BTP-side deployment or troubleshooting service bindings.

### 8.4 — SAP BTP Connectivity (`sap-btp-connectivity`)

Destination service, Cloud Connector, on-prem connectivity, principal propagation. Use when configuring S/4HANA destinations (BTP CF) or troubleshooting Tier-2 proxy auth.

### 8.5 — SAP BTP Integration Suite (`sap-btp-integration-suite`)

iFlow design, Open Connectors, API Management. Use when the project consumes Integration Suite iFlows or exposes APIs via API Management.

### 8.6 — SAP BTP Cloud Logging (`sap-btp-cloud-logging`)

OpenTelemetry integration, Kibana / Cloud Logging dashboards. Use when wiring up production observability.

### 8.7 — SAP BTP Job Scheduling (`sap-btp-job-scheduling`)

BTP Job Scheduler service for cron-style jobs. Alternative / complement to Kyma CronJob CRDs.

### 8.8 — SAP BTP Audit Log (`sap-btp-audit-log`)

BTP Audit Log Service. Adopt as a destination for the local AuditLogEntry events; never replace the local audit log (defense-in-depth Category 4.1).

### 8.9 — SAP BTP Master Data Integration (`sap-btp-master-data-integration`)

MDI for BP / Product / Cost-Object distribution across systems. Use when the project needs master-data sync to S/4 / SuccessFactors / etc.

### 8.10 — SAP CAP Best Practices (`sap-cap-best-practices`)

Curated CAP patterns from SAP engineering. Use as a cross-check for Category 2 patterns when in doubt.

### 8.11 — SAP PCE Expert (`sap-pce-expert`)

S/4HANA Private Cloud Edition / RISE specifics. Use when the project consumes S/4HANA PCE / RISE (Tier-2 proxies have different host patterns and Communication Scenarios).

### 8.12 — SAP Fiori Tools (`sap-fiori-tools`)

Fiori Tools MCP: manifest validation, Fiori app discovery, page-template scaffolding. Use during Fiori Elements V4 setup or migration.

### 8.13 — SAP CAP MCP (`sap-cap-capire` MCP server / `@sap/cds-mcp`)

CDS model search, doc lookup. Use during exploration of an unfamiliar CAP project.

### 8.14 — SAP Docs / SAP Notes (`sap-docs`, `sap-note-search`)

Help portal, Notes search, `sap_search_objects` for Clean Core checks. Mandatory companion for any S/4HANA Tier-2 proxy work.

### 8.15 — Context7 (`context7`)

Generic library documentation lookup. Use for non-SAP dependencies (Node libraries, npm packages).

### 8.16 — Playwright MCP (`playwright`)

Browser automation for UI tests. Use during Fiori app smoke tests or visual regression checks.

---

## How to Use This Skill

### As a direct reference

When the user asks "what's the best practice for X in CAP / Fiori Elements?", search this catalog for the pattern, cite it by anchor, and reference the companion skill if a deeper / operational answer is needed.

### As a cross-link target

Other skills in this repository cross-link to specific patterns by anchor:
- [`../sap-fiori-app-audit/SKILL.md`](../sap-fiori-app-audit/SKILL.md) refers to Category 1 for FE V4 traps.
- [`../sap-cap-security-rbac-matrix/SKILL.md`](../sap-cap-security-rbac-matrix/SKILL.md) refers to Category 4 for defense-in-depth.
- [`../sap-cap-customizing-honor/SKILL.md`](../sap-cap-customizing-honor/SKILL.md) refers to Category 5 for customizing patterns.
- [`../sap-cap-clean-core-enforce/SKILL.md`](../sap-cap-clean-core-enforce/SKILL.md) refers to Category 3.8 for multi-region deployment.
- [`../sap-cap-stack-audit-full/SKILL.md`](../sap-cap-stack-audit-full/SKILL.md) acts as orchestrator and consults this catalog when consolidating findings.

### As a teaching index

A developer new to CAP + Fiori Elements V4 can read Categories 1 → 8 in order. The categories progress from frontend → backend → deployment → cross-cutting concerns, mirroring the layers of a typical CAP project.

## When NOT to use

- For project-specific advice that depends on domain semantics (the patterns here are deliberately generic).
- For runnable diagnostics (use the operational skills like [`../sap-cap-stack-audit-full/SKILL.md`](../sap-cap-stack-audit-full/SKILL.md)).
- As a replacement for SAP official documentation — this catalog distills production lessons, but the authoritative spec lives in the SAP help portal.

## Recommended Companion Plugins

Install whichever of these are available in your environment. Each is referenced by Category 8 above; consult the relevant entry when working in that area.

| Plugin / Skill | npm / vercel-labs install | Domain |
|---|---|---|
| `sap-cap-capire` | `npx skills add SAP/sap-cap-capire` | CAP runtime knowledge base |
| `sapui5` | `npx skills add SAP/sap-ui5` | UI5 API explorer |
| `sap-fiori-tools` | `npx skills add SAP/sap-fiori-tools` | Fiori Elements scaffolding & validation |
| `sap-btp-cloud-platform` | `npx skills add SAP/sap-btp-cloud-platform` | BTP services map |
| `sap-btp-connectivity` | `npx skills add SAP/sap-btp-connectivity` | Destinations, Cloud Connector |
| `sap-btp-integration-suite` | `npx skills add SAP/sap-btp-integration-suite` | iFlow, API Management |
| `sap-btp-cloud-logging` | `npx skills add SAP/sap-btp-cloud-logging` | Observability |
| `sap-btp-job-scheduling` | `npx skills add SAP/sap-btp-job-scheduling` | Job Scheduler |
| `sap-btp-audit-log` | `npx skills add SAP/sap-btp-audit-log` | BTP Audit Log Service |
| `sap-btp-master-data-integration` | `npx skills add SAP/sap-btp-mdi` | MDI |
| `sap-cap-best-practices` | `npx skills add SAP/sap-cap-best-practices` | CAP curated patterns |
| `sap-pce-expert` | `npx skills add SAP/sap-pce-expert` | S/4 PCE / RISE specifics |
| `sap-docs` | `npx skills add SAP/sap-docs` | Help portal, Notes search |

The exact plugin namespace (`SAP/...` vs `vercel-labs/...` vs `<community>/...`) depends on the package registry your tooling uses. Adapt the install commands to your environment.

## References

- [SAP CAP — Capire (Official Docs)](https://cap.cloud.sap/docs/)
- [SAP Fiori Elements V4 — Guidance](https://sapui5.hana.ondemand.com/sdk/#/topic/03265b0408e2432c9571d6b3feb6b1fd)
- [SAP BTP — Reference Architectures](https://help.sap.com/docs/btp/sap-business-technology-platform/reference-architectures)
- [SAP API Release State Repository](https://github.com/SAP/abap-atc-cr-cv-s4hc)
- [OWASP — Application Security Verification Standard (ASVS)](https://owasp.org/www-project-application-security-verification-standard/)
- [Kyma — Runtime Documentation](https://kyma-project.io/docs/)
- [SAP UI5 — `flexEnabled` and Variant Management](https://sapui5.hana.ondemand.com/sdk/#/topic/465f01dcf1cd49b08230e7d3b53b29ed)
