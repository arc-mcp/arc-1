---
name: sap-cap-customizing-honor
description: Bidirectional CSV ↔ code customizing audit for SAP CAP applications that use a SystemParameter / settings-table pattern. Detects forward orphans (CSV seeded but never consumed in code), inverse orphans (code reads parameter but no CSV seed), hardcoded business decisions that bypass the customizing mechanism (thresholds, timeouts, retry policies, severity mappings), and master-data foreign-key fields missing `@Common.ValueList` annotation. Use when asked to "audit customizing coverage", "verify SystemParameter consumption is 100%", "find hardcoded business decisions", "check that customizing is honored end-to-end", or "is admin config actually being read by the code?".
---

# SAP CAP Customizing Honor Audit

Exhaustive audit that **enforces customizing is honored at 100%** in a SAP CAP application — both forward (every SystemParameter seed in CSV has a code consumer) and inverse (every `params.X` read in code has a CSV seed). Additionally, sweeps for **hardcoded business decisions** that bypass the customizing mechanism, and verifies that every **foreign-key field to master data** is bound to `@Common.ValueList` on filter bars and edit forms — no free-text where customizing exists.

Read-only audit, idempotent, ~3 minute run, zero side-effects (unless `--apply` mode auto-fixes safe cases).

## Smart Defaults (apply silently, do NOT ask)

| Setting | Default | Rationale |
|---|---|---|
| Scope | `all` — entire `srv/` + `app/` codebase | Default to full sweep; user narrows if needed |
| SystemParameter source | `db/data/*-SystemParameters.csv` (CAP convention) | CAP CSV seed pattern is conventional |
| Code consumer pattern | `getSystemParamReader().get(...)` + `params.X` / `cfg.X` / `paramReader.X` | Common CAP customizing reader patterns |
| Inverse orphan severity | ERROR (admin sees param in Setup UI but code ignores it) | Customer-facing problem |
| Forward orphan severity | WARNING | Internal cleanliness, less urgent |
| Hardcoded business decision severity | HIGH for thresholds in lifecycle handlers, MEDIUM otherwise | Production impact-aware |
| Master-data unreferenced fields severity | P1 (filter bar) / P2 (edit form) / P3 (display only) | UX-first priority |
| Report output | `docs/audit/<yyyy-mm-dd>-customizing-honor.md` | Committed for traceability |
| Mode | `report` (read-only) | Safe by default |
| Auto-fix scope | Add missing seed CSV rows for inverse orphans + add `@Common.ValueList` annotations for master-data filter bars | Reversible, contained |

## Input

Optional flags:

- **scope** — `all` (default) | `<app-name>` (focus single Fiori app) | `srv-only` | `app-only` | `<subfolder>` (e.g., `srv/handlers`)
- **mode** — `report` (default) | `fix` (auto-apply safe fixes on a dedicated branch)
- **csv pattern** — override default `db/data/*-SystemParameters.csv` glob
- **reader pattern** — override regex for code-side consumer detection
- **skip checks** — comma list of check categories to skip (e.g., `--skip hardcoded,master-data`)

## Step 1: Pre-flight + Project Detection

### 1a. Verify project type

```bash
test -f package.json && grep -q '"@sap/cds"' package.json && test -d srv
```

If not a CAP project, stop and inform user this skill targets CAP apps.

### 1b. Detect SystemParameter CSV files

```bash
find db/data -name "*-SystemParameter*.csv" -maxdepth 2 2>/dev/null
```

Expected pattern: `db/data/<namespace>-SystemParameters.csv` with columns `ParamKey,CompanyCode,ParamValue,Description,Category,IsSecret`.

If multiple files found → process all; if none → warn user and proceed with inverse-orphan check only.

### 1c. Detect code-side consumer pattern

```bash
grep -rohE "(getSystemParamReader|paramReader|params\.|cfg\.)[A-Z][A-Z0-9_]+\(" srv/ \
  --include="*.ts" --include="*.js" 2>/dev/null | head -10
```

If matches are found, the reader pattern is confirmed. Otherwise the project may not use the customizing pattern at all; ask user to confirm.

### 1d. Resolve scope

| scope value | Folder paths to audit |
|---|---|
| `all` | `srv/` + `app/` |
| `<app-name>` | `app/<app-name>/` only |
| `srv-only` | `srv/` only |
| `app-only` | `app/` only |
| `<subfolder>` | exact path |

### 1e. Branch creation (if mode=fix)

```bash
git checkout -b codex/customizing-honor-<scope>-$(date +%Y-%m-%d)
```

## Step 2: Bidirectional CSV ↔ Code Check (Forward + Inverse Orphans)

### 2a. Extract CSV-seeded parameter keys

```bash
awk -F',' 'NR>1 {print $1}' db/data/*-SystemParameters.csv 2>/dev/null \
  | sort -u > /tmp/csv-keys.txt
```

Result: deduplicated `ParamKey` list (header `ParamKey,...`).

### 2b. Extract code-consumed parameter keys

```bash
grep -rohE "(p|params|cfg|wfParams|matchingParams|techParams|aiParams|monitoringParams|envCfg|dbCfg|slaParams|apprParams)(\?\.\|\[['\"]|\.)([A-Z][A-Z0-9_]+)" "$SCOPE" \
  --include="*.ts" --include="*.js" 2>/dev/null \
  | grep -oE "[A-Z][A-Z0-9_]+\b" \
  | sort -u > /tmp/code-keys.txt
```

This greps common reader variable names (`params.X`, `cfg.X`, `wfParams.X`, etc.) and extracts the parameter key.

### 2c. Compute orphans

```bash
# Inverse orphan: code reads but CSV doesn't seed
comm -23 /tmp/code-keys.txt /tmp/csv-keys.txt > /tmp/inverse-orphans.txt

# Forward orphan: CSV seeds but code never reads
comm -13 /tmp/code-keys.txt /tmp/csv-keys.txt > /tmp/forward-orphans.txt
```

### 2d. Classify orphans

For each inverse orphan, find the source file + line:

```bash
while IFS= read -r key; do
  grep -rn "\.${key}\b\|\['${key}'\]\|\[\"${key}\"\]" srv/ app/ \
    --include="*.ts" --include="*.js" 2>/dev/null | head -3
done < /tmp/inverse-orphans.txt
```

For each forward orphan, find the CSV line:

```bash
while IFS= read -r key; do
  grep -n "^${key}," db/data/*-SystemParameters.csv 2>/dev/null
done < /tmp/forward-orphans.txt
```

### 2e. Compile per-category counts

Group orphans by `Category` (from CSV column 5):

```
SystemParameter category    Forward    Inverse
INTEGRATION                  3          7
TECHNICAL                    1          12
APPROVAL                     0          4
...
```

## Step 3: Hardcoded Business Decisions Sweep

For each file in scope (`*.ts`, `*.js`), search for patterns that represent **business decisions** but are NOT routed through `getSystemParamReader()`.

### 3a. Numeric thresholds

```bash
grep -rnE ">=\s*[0-9]+|>\s*[0-9]+|<=\s*[0-9]+|<\s*[0-9]+|=\s*[0-9]{2,}\b" "$SCOPE" \
  --include="*.ts" --include="*.js" 2>/dev/null \
  | grep -vE "//|^.*\*|\.test\.|HTTP|status:|\.length|substring|setTimeout|process\.env|throw|>=\s*0\b|>\s*0\b|<=\s*100\b" \
  | head -50
```

For each match, classify:

- **TRUE positive (business threshold)** — e.g., `if (riskScore >= 80) markHighRisk()` — should be `params.HIGH_RISK_THRESHOLD`
- **FALSE positive** — HTTP status codes (`200`, `400`, `500`), array index, `.length`, `setTimeout` ms — ignore

### 3b. Hardcoded fragment XML thresholds (Fiori app)

```bash
grep -rnE ">=\s*[0-9]+|>\s*[0-9]+|<\s*[0-9]+" "$SCOPE" \
  --include="*.xml" 2>/dev/null \
  | grep -vE "//|^.*\*|ErrorCount|currentStep|>= ?\$\{|> ?\$\{|>= 0\b|> 0\b|>= 1\b" \
  | head -30
```

### 3c. `cds.env` reads not dual-source

```bash
grep -rn "cds\.env\." "$SCOPE" --include="*.ts" 2>/dev/null \
  | grep -vE "//|^.*\*|cds\.env\.(profile|profiles|requires|features|build|sql|hana|odata|telemetry|i18n|log|app|server|effective)" \
  | grep -v "_resolveArchiverConfig\|fallback\|legacy" \
  | head -20
```

The **dual-source pattern** is: SystemParameter first, fallback to `cds.env`, fallback to `process.env`, fallback to hardcoded. Direct `cds.env.X` reads without going through SystemParamReader are findings (admin can't override).

### 3d. UX timing / delay hardcoded

```bash
grep -rnE "setTimeout.*[0-9]{3,}|DELAY|INTERVAL_MS|TTL\s*=\s*[0-9]" "$SCOPE" \
  --include="*.ts" 2>/dev/null \
  | grep -vE "//|^.*\*|\.test\." | head -10
```

### 3e. i18n hardcoded inline (user-facing strings)

```bash
grep -rnE "MessageBox\.|MessageToast\.show\(|req\.notify\(" "$SCOPE" \
  --include="*.ts" 2>/dev/null \
  | grep -vE "_t\(|i18n>|getText\(|bundle\.|//|^.*\*" \
  | head -10
```

User-visible text should be i18n keys, not inline strings. Hardcoded inline strings are findings (no localization).

### 3f. Per-finding triage

For each match, decide:

- **TRUE positive** → business decision tunable → add to findings list with file:line + suggested fix
- **FALSE positive** → security boundary / HTTP code / internal cache TTL / `.length` → ignore

## Step 4: Catalog Raise Coverage (if applicable)

For CAP apps with a `ProcessStepCheck` catalog (a common pattern for workflow-driven apps):

```bash
test -f db/data/*-ProcessStepCheck.csv && \
  bash scripts/ci/check-catalog-raise-coverage.sh 2>/dev/null
```

This verifies every CSV-seeded check code has a runtime `raiseCatalogException(...)` call in the codebase.

If the CI script is not present, run an equivalent check inline:

```bash
# Extract active check codes
awk -F',' 'NR>1 && $X=="true" {print $Y}' db/data/*-ProcessStepCheck.csv | sort -u

# Find raise sites
grep -rhE "raiseCatalogException\(.*['\"]([A-Z][A-Z0-9_]+)['\"]" srv/ \
  --include="*.ts" | grep -oE "['\"][A-Z][A-Z0-9_]+['\"]" | tr -d "'\"" | sort -u

# Diff
comm -23 <(active_codes) <(raise_sites)
```

Active checks without a raise site = code-coverage gap.

## Step 5: Adapter Factory Dual-Source Verification

For CAP apps using adapter factory patterns (`srv/{notifications,messaging,monitoring,...}/`):

```bash
find srv -path "*/Factory*.ts" -o -name "*AdapterFactory*.ts" 2>/dev/null
```

For each factory, verify the canonical pattern:

```typescript
// Expected pattern (4-layer fallback):
const adapterName =
  params['<KEY>_ADAPTER'] ||     // 1. SystemParameter (admin-configurable)
  env.adapter ||                  // 2. cds.env fallback
  process.env.ADAPTER_OVERRIDE || // 3. env var fallback
  'default-adapter';              // 4. hardcoded last resort
```

If a factory reads only from `cds.env` or `process.env` without going through SystemParameter, that's a finding — "adapter not customizing-driven".

## Step 6: Master-Data Reference Audit (Filter + Edit Form)

For CAP+Fiori projects, verify that every field referencing master data has `@Common.ValueList` annotation.

### 6a. Master data catalog (target entities)

Common SAP master-data CodeList patterns in CAP:

| Pattern | Master data target |
|---|---|
| `*CompanyCode*` | `CompanyCodeMappings` |
| `*BusinessPartner*` | `BusinessPartner` / `Suppliers` |
| `*Currency*` | `Currencies` (CodeList) |
| `*PaymentMethod*`, `*PaymentBlock*` | `PaymentMethods` / `PaymentBlockCodes` |
| `*Status*` | Status CodeList (domain-specific) |
| `step_ID`, `check_ID` (process workflow) | `ProcessSteps` / `ProcessStepChecks` |
| `*Severity*` | `Severities` CodeList |
| `*GLAccount*`, `*CostCenter*`, `*WBSElement*` | cost-object master data |

### 6b. Filter bar (SelectionFields) check

For each `UI.SelectionFields: [...]` in `app/annotations/*.cds`:

```bash
grep -rnE "UI\.SelectionFields:\s*\[" app/annotations/ app/*.cds 2>/dev/null
```

For each field listed, verify a `@Common.ValueList` annotation exists, either:

1. **Direct annotation** on the field
2. **Indirect via Association** — e.g., `step` (Association) has the ValueList, and `step_ID` (foreign-key column) is the actual SelectionField

Pattern verification:

```bash
for FIELD in CompanyCode SupplierBP Currency PaymentMethod ...; do
  # Pattern 1: direct annotation on field
  DIRECT=$(grep -rnE "$FIELD\s*@Common\.ValueList" app/annotations/ srv/ 2>/dev/null | wc -l)
  # Pattern 2: annotation on Association (FK column ends with _ID)
  ASSOC=$(echo "$FIELD" | sed 's/_ID$//')
  if [ "$ASSOC" != "$FIELD" ]; then
    INDIRECT=$(grep -rnE "$ASSOC\s+@Common\.ValueList" app/annotations/ srv/ 2>/dev/null \
               | grep -E "LocalDataProperty:\s*$FIELD\b" | wc -l)
  else
    INDIRECT=0
  fi
  TOTAL=$((DIRECT + INDIRECT))
  if [ $TOTAL -eq 0 ]; then
    echo "❌ $FIELD: missing ValueList in filter bar"
  fi
done
```

### 6c. Edit form (FieldGroup / LineItem) check

For each `@odata.draft.enabled` entity, check editable fields against master-data patterns. Edit-form ValueList is **strongly recommended** but can require context-dependent filtering (e.g., `step` filter on active template) — flag for manual review when filter cardinality is non-trivial.

### 6d. TextArrangement check

For each FK field with `ValueList`, verify the display-name cascade is configured:

```cds
@Common.Text: <X>.Name
@Common.TextArrangement: #TextOnly
```

Without TextArrangement, the UI displays the raw ID — bad UX.

### 6e. False-positive whitelist

These fields are legitimately free-text (NOT findings):

- Descriptive: `Description`, `Name`, `Notes`, `Comment`, `Justification`, `RejectReason`
- Natural external identifiers: `eDocumentGuid`, `InvoiceNumber`, `IBAN`, `TaxCode`, `VATIdNumber` (input via parsing, not catalog-pick)
- Amounts / quantities: `Amount`, `Percentage`, `Quantity`, `Price`, `Score`, `Confidence`
- Timestamps: `*At`, `*Date`, `*Timestamp`
- Technical: `ID`, `UUID`, `*_ID` (internal keys handled by framework)
- File-system: `FileName`, `FilePath`, `Url`

## Step 7: Output Report

Save markdown to `docs/audit/<yyyy-mm-dd>-customizing-honor.md`:

```markdown
# Customizing Honor Audit — <scope> — <yyyy-mm-dd>

## Summary
- Forward orphans: N (CSV seeded, code doesn't read)
- Inverse orphans: N (code reads, CSV doesn't seed)
- Hardcoded business decisions: N
- Master-data unreferenced fields: filter=N1, edit=N2, missing TextArrangement=N3
- Catalog coverage: ✅ PASS / ❌ N CheckCode without raise site
- Adapter dual-source: ✅ M/N OK / ❌ N missing

## Inverse Orphans
| ParamKey | File:line | Default used | Suggested category |

## Forward Orphans
| ParamKey | CSV line | Verification grep | Action (remove seed or wire consumer) |

## Hardcoded Business Decisions
| File:line | Pattern | Type | Severity | Suggested fix |

## Master Data Unreferenced
| Entity.Field | Position (filter/edit/header) | File:line | Master data target | Severity | Suggested fix |

## Fix Plan
1. [P1] hardcoded threshold — suggested diff:
```diff
- const HIGH_RISK_THRESHOLD = 80;
+ async function _resolveHighRiskThreshold(cc) {
+   const params = await getSystemParamReader().get('RISK', cc);
+   const n = parseInt(params.HIGH_RISK_THRESHOLD, 10);
+   return Number.isFinite(n) && n > 0 ? n : 80;
+ }
```

2. [P1] master-data unreferenced (filter bar) — suggested diff:
```diff
+ annotate service.MyEntity with {
+   companyCode @Common.ValueListWithFixedValues: true
+               @Common.ValueList: { ... };
+   companyCode @Common.Text: companyCode.CompanyName @Common.TextArrangement: #TextOnly;
+ };
```

## Verifications
- bash scripts/ci/check-systemparams-bidirectional.sh: PASS / FAIL
- bash scripts/ci/check-catalog-raise-coverage.sh: PASS / FAIL
- npm run lint:csv: PASS / FAIL
- npx cds compile srv app: PASS / FAIL

## Residual Risk
- <list of items requiring manual review>
```

## Step 8: Apply Fixes (only when `--apply` / `mode=fix`)

### Safe auto-applicable fixes

1. **Add missing CSV seed rows** for inverse orphans:
   ```csv
   <PARAM_KEY>,,<detected_default>,<placeholder description>,<inferred category>,false
   ```
   One commit per seed: `chore(seed): add <PARAM_KEY> for inverse-orphan fix`.

2. **Add `@Common.ValueList` annotation** on filter bar fields for master-data references (SAFE — non-breaking, additive):
   ```cds
   annotate service.<Entity> with {
     <field> @Common.ValueListWithFixedValues: true
             @Common.ValueList: {
               CollectionPath: '<TargetEntity>',
               Parameters: [
                 { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: <field>, ValueListProperty: '<key>' },
                 { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: '<displayName>' }
               ]
             };
     <field> @Common.Text: <field>.<displayName> @Common.TextArrangement: #TextOnly;
   };
   ```
   One commit per annotation: `feat(masterdata): add ValueList on <Entity>.<field>`.

### NOT auto-applied (manual decision required)

- **Removing forward-orphan CSV seeds** — could break customer environments that currently rely on the param (even if unused in code), and a future PR may add a consumer. Surface as finding only.
- **Refactoring hardcoded business decisions** — code refactor involves logic changes; risk too high for auto-apply. Surface as finding with suggested diff.
- **Adding ValueList on edit-form fields** — can require filter context (cascading dropdowns); test manually before applying.

### Post-fix verification

Re-run Step 2 + Step 6 and confirm orphan/unreferenced counts decrease as expected.

## BTP vs On-Premise Differences

This skill is target-edition-neutral — the same audit applies for CAP apps deployed to BTP Cloud Foundry, Kyma, or on-premise. The only consideration:

| Aspect | BTP | On-Premise |
|---|---|---|
| SystemParameter storage | HANA Cloud / HDI | HANA or PostgreSQL |
| CSV seed loading | `cds deploy` at boot | Same |
| Per-tenant customizing | Single-tenant per service (multi-customer = multi-deployment) | Same |

## Error Handling

| Error | Cause | Fix |
|---|---|---|
| No `db/data/*-SystemParameters.csv` found | Project doesn't use the SystemParameter pattern | Skip Steps 2 and 5; run hardcoded sweep + master-data check only |
| `getSystemParamReader` not found in codebase | Project uses different reader pattern | Ask user for the reader function name + adjust grep pattern |
| Grep returns thousands of "matches" in hardcoded check | Permissive regex catches FP | Tighten patterns in Step 3a/3b; user can override with `--strict-thresholds` flag |
| Annotations folder doesn't exist | Project uses inline annotations or non-standard structure | Skip Step 6 or ask user to point to annotation locations |
| Multiple SystemParameter CSV files | Multi-namespace project | Audit all CSVs in scope; deduplicate keys |
| `forward orphan` is in user-known allowlist (e.g., NATS_URL only used in NATS adapter) | False positive | User can extend `FORWARD_ALLOWLIST` in the CSV's frontmatter comment or `--allowlist` flag |

## What This Skill Does NOT Do

- **No refactoring** — hardcoded business decisions are flagged with suggested fix, not auto-refactored
- **No CSV seed removal** — never deletes seeded parameters (breaking risk for customer envs)
- **No CDS schema validation** — assumes the schema compiles; audits the customizing coverage, not entity structure
- **No semantic verification** — doesn't check if the param value chosen by admin is a sensible default
- **No fallback chain testing** — verifies dual-source pattern is present, doesn't test runtime fallback behavior
- **No i18n translation generation** — flags hardcoded user-facing strings; user translates manually
- **No master-data CodeList generation** — references existing master data; doesn't create new CodeList entities

## When to Use This Skill

- **Pre-release audit** — verify admin Setup UI parameters are all wired to code consumers
- **Quarterly compliance check** — customizing drift over time (params added/removed)
- **Onboarding new developer** — understand which parameters drive runtime behavior
- **Customer escalation** — "admin changed param X but nothing happened" → run this skill to verify code reads it
- **Pre-acquisition audit** — when assessing a 3rd-party CAP app, verify customizing surface area is honest
- **Before refactor / cleanup** — identify which "dead" parameters can safely be removed (forward orphans)

## When NOT to Use This Skill

- **Project doesn't use SystemParameter pattern** — skill loses its core value; only hardcoded sweep applies
- **Pure greenfield project** — too early; come back after first iteration when params accumulate
- **Single-tenant fixed-config deployment** — customizing is less relevant; UX-level master-data check is still useful

## Follow-up

After this skill produces the audit report:

- **Inverse orphans**: with `--apply` mode, the skill auto-adds CSV rows. Manually verify the inferred default + category, then commit.
- **Forward orphans**: manually decide for each: (a) remove from CSV (truly unused) or (b) wire consumer (currently TODO).
- **Hardcoded business decisions**: refactor each to `getSystemParamReader()` pattern, one parameter per commit, tested individually.
- **Master-data unreferenced fields**: with `--apply` mode, the skill auto-adds filter-bar ValueList. Manually verify edit-form bindings (context-dependent filters).

Related skills:

- [sap-cap-clean-core-enforce](../sap-cap-clean-core-enforce/SKILL.md) — verifies the S/4 API destinations consumed are Clean Core L-A (complementary audit)
- [sap-clean-core-atc](../sap-clean-core-atc/SKILL.md) — ABAP-side compliance (companion, source-side)

## References

- [CAP `cds.env` profile-aware configuration](https://cap.cloud.sap/docs/node.js/cds-env)
- [CAP CSV seed pattern](https://cap.cloud.sap/docs/guides/databases#providing-initial-data)
- [CAP `@Common.ValueList` annotation](https://cap.cloud.sap/docs/advanced/odata#valuehelp-annotations)
- [Fiori Elements V4 value-help integration](https://experience.sap.com/fiori-design-web/value-helper/)
