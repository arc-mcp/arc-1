# Modernize UI5 freestyle JS app ➜ UI5 TypeScript app

Convert a legacy UI5 freestyle JavaScript app (typical 2018–2021 era — sync bootstrap, JS
controllers, `jQuery.sap.*`, global formatter, ES5 patterns, no types, `sap_belize`) into a
modern UI5 TypeScript app on a recent 1.x release with async loading, manifest-driven
configuration, a proper `BaseController`, sap_horizon theme, ES modules, typed event handlers,
and clean `ui5-linter` + `tsc --noEmit` output. Runs side-by-side: the legacy app stays
untouched at `<source_app>/`; the modern app lands in `<modern_app>/`.

This skill is **one of two parallel UI paths** after the RAP backend lands. Pick this one if
the target architecture is a **freestyle TypeScript** app (custom controllers, manual binding,
explicit i18n). Pick `convert-ui5-to-fiori-elements.md` instead if the target is a
**Fiori Elements V4** app (annotation-driven; minimal custom code). Both start from the same
legacy JS app + the same V4 RAP service produced by `migrate-segw-to-rap`.

```
                  migrate-segw-to-rap.md  (backend: SEGW V2 → RAP V4)
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
    modernize-ui5-app.md      convert-ui5-to-fiori-elements.md
        (freestyle TS)               (Fiori Elements V4)
```

> **Path/namespace placeholders.** `<source_app>/`, `<modern_app>/`, `<source_namespace>`,
> `<modern_namespace>` are user-provided. Defaults: source is `legacy-*-app/` (sibling of the
> target); modern app namespace is derived from source by appending `.modern`.

---

## Which MCPs this skill uses (and which it doesn't)

| MCP | Used for | When |
|---|---|---|
| **UI5 MCP** (`mcp__SAPUI5_MCP_Server__*`) | Authoritative TS conversion guidelines, general UI5 guidelines, app scaffolding, API reference lookups, linter, manifest validator, version info | Throughout — this is the primary MCP for this skill |
| **sap-docs MCP** (`mcp__sap-docs__*`) | OData V4 binding patterns, draft handling, control documentation | When V2→V4 binding behaviour is non-obvious (e.g. composite key on draft, `$expand=_Tasks`, action invocation) |
| **arc-1 MCP** | OPTIONAL — service binding URL lookup, status-code semantics | Only if the V4 URL isn't readily available (e.g. you can't read the FE app's manifest); skip otherwise |
| **fiori-mcp** | NOT USED | This is a freestyle TS app, not Fiori Elements — no annotations to generate |

**There is no "convert to TS" tool** in the UI5 MCP. Conversion is mechanical and driven by
`mcp__SAPUI5_MCP_Server__get_typescript_conversion_guidelines`, which returns the authoritative
playbook. You call it once at the start and follow it verbatim.

**Also use `mcp__sap-docs__search` during the run** whenever a UI5 best-practice is non-obvious
or contested (FCL routing, V4 binding semantics, draft handling, accessibility, theming). The
SAP help portal indexed there is authoritative and version-specific — quote it rather than
guessing.

---

## Critical traps — read these BEFORE writing any code

Past runs of this skill tripped on three issues that took multiple iterations to diagnose. They
are easy to avoid if you know about them up front; brutal if you don't. Even a strong LLM lost
~15-20 minutes debugging "blank page, no console error" because of Traps 1 + 2.

### Trap 1: FCL stays at "OneColumn" — only one column visible

**Symptom:** Both views are routed correctly, console is clean, accessibility tree shows
content for both columns — but visually only the left column renders.

**Root cause:** `sap.f.routing.Router` only changes the FCL `layout` property when the matched
route **explicitly declares** one. A route with no `layout` leaves FCL at its initial value
(`OneColumn`), so the mid / end columns stay hidden even though the router placed targets in
them.

**Fix:** **Every** FCL route MUST have a `layout` property. Not just detail/drill-down — also
the home / main / not-found route, every route that targets anything other than the
`beginColumnPages` aggregation alone.

```jsonc
"routes": [
  {
    "pattern": "",
    "name": "main",
    "target": ["main", "welcome"],
    "layout": "TwoColumnsMidExpanded"   // ← REQUIRED — Welcome lives in mid column
  },
  {
    "pattern": "Project/{projectId}",
    "name": "detail",
    "target": ["main", "detail"],
    "layout": "TwoColumnsMidExpanded"   // ← REQUIRED
  }
]
```

### Trap 2: Blank page — DOM populated but every element has height: 0

**Symptom:** Console is clean, accessibility tree shows all content, but visually the page is
blank. DevTools confirms every nested element has `height: 0` cascading from the body's
component div.

**Root cause:** UI5's `ComponentSupport` module **strips the `data-sap-ui-component` attribute**
from the body's container div during processing. CSS selectors that match against that
attribute (`body > div[data-sap-ui-component] { height: 100% }`) stop matching after
ComponentSupport runs, so the wrapper div has no height and `data-height="100%"` resolves to
100% of 0.

**Fix:** Put `style="height: 100%"` **inline** on the component div in `index.html`. CSS
selectors keyed on `data-sap-ui-component` are not reliable here.

```html
<body class="sapUiBody" id="content">
    <div
        data-sap-ui-component
        data-name="<source_namespace>.modern"
        data-id="container"
        data-height="100%"
        style="height: 100%"></div>     <!-- ← REQUIRED inline, not in <style> -->
</body>
```

### Trap 3: `import Event from "sap/ui/base/Event"` is a code smell

**Symptom:** Strange casts like `(event.getParameters() as { listItem?: ListItemBase }).listItem`
appear in the controller. TypeScript can't see event parameters; you compensate with `as` casts
on `getParameter` or `getParameters` return values.

**Root cause:** Importing the generic `Event` type from `sap/ui/base/Event` forfeits the strong
typing UI5 ≥ 1.115 provides. UI5 generates `<Control>$<Event>Event` and
`<Control>$<Event>EventParameters` types for every control event — those are what to import.

**Fix:** If you find yourself writing `import Event from "sap/ui/base/Event"`, **stop and find
the right specific type**. Common ones for this skill's surface:

| Event source | Specific type | Module |
|---|---|---|
| `sap.m.List` / `sap.m.Table` `selectionChange` | **`ListBase$SelectionChangeEvent`** | **`sap/m/ListBase`** |
| `sap.m.List` / `sap.m.Table` `itemPress` | `ListBase$ItemPressEvent` | `sap/m/ListBase` |
| `sap.m.List` / `sap.m.Table` `updateFinished` | `ListBase$UpdateFinishedEvent` | `sap/m/ListBase` |
| `sap.m.List` / `sap.m.Table` `delete` | `ListBase$DeleteEvent` | `sap/m/ListBase` |
| `sap.m.ListItemBase` `press` | `ListItemBase$PressEvent` | `sap/m/ListItemBase` |
| `sap.m.SearchField` `liveChange` | `SearchField$LiveChangeEvent` | `sap/m/SearchField` |
| `sap.m.Button` `press` | `Button$PressEvent` | `sap/m/Button` |
| `sap.ui.core.routing.Route` `patternMatched` | `Route$PatternMatchedEvent` | `sap/ui/core/routing/Route` |

> **Important — ListBase inheritance:** `sap.m.List` and `sap.m.Table` **inherit** their
> selection / item-press / update / delete / swipe events from `sap.m.ListBase`. The TS event
> types live on `sap/m/ListBase`, not on `sap/m/List` or `sap/m/Table`. Confirmed in the SAP
> Help portal: "Both sap.m.List and sap.m.Table offer the same events, inheriting them from
> sap.m.ListBase." Don't go looking for `Table$SelectionChangeEvent` — it doesn't exist;
> use `ListBase$SelectionChangeEvent` from `sap/m/ListBase` and TypeScript accepts it for
> both controls' `selectionChange` events without casts.

If you can't find a specific event type for a UI5 ≥ 1.115 control, call
`mcp__SAPUI5_MCP_Server__get_api_reference(query="sap.m.<Control>#<eventName>")` to confirm
the typed name exists. Do not fall back to the generic `Event`.

### Trap 4: `onApprove(event: Button$PressEvent)` — declare with no parameter

**Symptom:** ESLint flags `_event` (or `event`) as `no-unused-vars`. You drop the parameter,
then ESLint flags the now-orphaned `import { Button$PressEvent }` as `no-unused-imports`. Two
edits, two re-lint cycles, one minute lost.

**Root cause:** UI5 button-press handlers typically don't use the event payload — `oCtx`,
`projectId`, etc. all come from `this.getView()` or from class fields populated by route
matching. Declaring `event: Button$PressEvent` is a knee-jerk reflex from the typed-events
rule that doesn't apply here.

**Fix:** declare press handlers with **no parameters** when you don't read the event:

```ts
// CORRECT:
public async onApprove(): Promise<void> {
    const projectId = this.projectId;
    // ...
}

// WRONG — generates two lint errors that need two edits to fix:
public async onApprove(_event: Button$PressEvent): Promise<void> {
    void _event;  // dead code
    const projectId = this.projectId;
}
```

The same applies to `onNavBack`, `onItemPress` (when you derive the source from `this.byId`
not the event), and any other handler where the event payload is unused.

### Trap 5: Manifest v2 + missing `"type": "View"` — routes match but nothing renders

**Symptom:** Page is blank. FCL columns exist with the right widths but each NavContainer is
empty. Console is otherwise clean except for one easily-missed warning a millisecond after
each route match:

```
page stack is empty but should have been initialized -
application failed to provide a page to display
```

Routing logs show the route matches correctly (`"The route named 'main' did match"`), but no
view ever gets placed in any column.

**Root cause:** With `"_version": "2.0.0"` or higher (introduced in UI5 1.136 — the same
version we're targeting in this skill), the older routing keys `viewName`, `viewPath`,
`viewLevel` are **removed** and replaced by `name`, `path`, `level` — and a routing **target
no longer has an implicit `"type": "View"` default**. Without an explicit type, target
resolution silently produces nothing.

Source: SAP Help, *"Migration Information for Upgrading the Manifest File"*, the 2.0.0
(1.136) "Deprecated Manifest Entries" row: *"The routing properties ViewId, viewName,
viewPath and viewLevel can no longer be used. Please use the documented alternatives by
replacing them with the properties id, name, path and level, respectively along with adding
the `type: "view"`."*

**Fix:** in the `routing` block of `manifest.json`:

1. Add `"type": "View"` to `routing.config` (so it's the default for all targets in the
   block — saves repeating it).
2. Use `path` (NOT `viewPath`) for the view-folder namespace.
3. Use `name` (NOT `viewName`) on each target — and add `"type": "View"` per target too
   (belt + braces; some UI5 versions don't propagate the config default reliably).
4. Use `level` (NOT `viewLevel`) on each target.

```jsonc
"routing": {
    "config": {
        "routerClass": "sap.f.routing.Router",
        "type": "View",                 // ← REQUIRED in manifest v2
        "viewType": "XML",
        "path": "<ns>.view",            // ← NOT "viewPath"
        "async": true,
        "controlId": "flexibleColumnLayout",
        "controlAggregation": "beginColumnPages",
        "bypassed": { "target": "notFound" }
    },
    "routes": [ /* ... layout property per Trap 1 ... */ ],
    "targets": {
        "main": {
            "type": "View",             // ← REQUIRED per target
            "id": "main",
            "name": "Main",             // ← NOT "viewName"
            "level": 1,                 // ← NOT "viewLevel"
            "controlAggregation": "beginColumnPages"
        },
        // ... other targets
    }
}
```

This shape works in both manifest v1.x and v2.x — adding `type: "View"` is backwards-compatible
(it became available in 1.14.0 / UI5 1.62). The new key names (`name`/`path`/`level`) are also
backwards-compatible. So always emit the v2 shape, even if you're not sure whether the
project ends up on v1 or v2 — there's no downside.

**Quick diagnostic when you see this:** open the browser console, search for "page stack is
empty". If you find it: you have Trap 5. If you don't, you're probably looking at Trap 1
(missing `layout`) or Trap 2 (height cascade).

**Why the validators DON'T catch this** (verified empirically against `@ui5/linter@1.19.0`
and `@ui5/manifest@1.86.0`, the same versions wrapped by the UI5 MCP):

| Tool | Catches Trap 5? | Why |
|---|---|---|
| `run_ui5_linter` (`@ui5/linter`) | **No** | The `no-removed-manifest-property` rule exists but only checks `resources/js`, `rootView/async`, `routing/config/async`. Does NOT check routing targets for `viewName`/`viewPath`/`viewLevel`. The linter source reads `target.name ?? target.viewName` — it gracefully accepts either, without warning. |
| `run_manifest_validation` (`@ui5/manifest` schema + Ajv) | **No** | The schema marks `viewName`/`viewPath`/`viewLevel` as `"deprecated": true` with a description pointing to the v2 replacement, but Ajv with the MCP's `strict: false` config ignores the `deprecated` flag. The schema also has both `legacyTargetAddition` AND `actualTargetAdditionStandard` as alternatives side-by-side (no `_version`-conditional `if/then` branch), so a manifest with `viewName` validates as `isValid: true`. |
| `npm run ts-typecheck` | **No** | Manifest is JSON — TypeScript doesn't see it. |
| `eslint webapp` | **No** | ESLint doesn't model UI5 manifest semantics. |
| Browser runtime | **Indirectly** | The `"page stack is empty but should have been initialized"` console warning is the ONLY automated signal, and it only fires at runtime, not at lint time. |

**Implication for the skill:** the Phase 7 acceptance gates (linter / manifest validation /
ts-typecheck) WILL all report green for a v2 manifest with the deprecated routing keys. The
ONLY honest gate for this trap is the **Phase 8d browser-render verification** — that's why
Phase 8d is mandatory, not optional. Don't believe a "clean lint + clean validation" report
means the routing config is correct.

If you have the cycles to file an upstream issue, this is a clear gap in `@ui5/linter`'s
`no-removed-manifest-property` rule — adding `routing.targets[].viewName/viewPath/viewLevel`
to the checked-property list would close it.

---

## Self-help: when the skill doesn't have the answer

The skill captures common patterns, but every project has its own quirks. When you hit
something the skill doesn't cover, **investigate before guessing**. UI5 has a fragmented
middleware ecosystem and a deep type system; an educated guess often gets the wrong key name
or the wrong inheritance branch. The investigations below cost 30 seconds and save iterations.

### Pattern A — Middleware / proxy / build-tool config option

**Trigger:** you're setting a config key on a UI5 middleware (`ui5-middleware-simpleproxy`,
`ui5-middleware-livereload`, `fiori-tools-proxy`, `ui5-tooling-transpile`, anything in
`ui5.yaml`'s `customMiddleware` or `customTasks`).

**Why investigate:** UI5 middlewares silently ignore unknown configuration keys — no error, no
warning, but they do the wrong thing. The naming conventions differ across packages: TLS-skip
is `strictSSL: false` in `ui5-middleware-simpleproxy`, `ignoreCertErrors: true` in
`fiori-tools-proxy`, and other names elsewhere. Don't extrapolate from one to another.

**Recipe:**

```text
Bash: cat <target>/node_modules/<package-name>/README.md
# or:
WebFetch: https://www.npmjs.com/package/<package-name>
WebFetch: https://github.com/<owner>/<package-name>
```

If the README isn't local yet (pre-`npm install`), use WebFetch or `gh api` against the GitHub
mirror.

### Pattern B — UI5 control event TypeScript type

**Trigger:** you're typing an event handler parameter and you're not sure what the specific
`<Control>$<Event>Event` type is called or where it lives.

**Why investigate:** events are inherited — they're defined on a parent class and reused by
subclasses. Looking for `Table$SelectionChangeEvent` returns nothing because `selectionChange`
is defined on `ListBase`, not `Table`. The Trap 3 table covers the events this skill commonly
hits; for anything else, ask the UI5 MCP.

**Recipe:**

```text
mcp__SAPUI5_MCP_Server__get_api_reference(
  projectDir="<absolute target>",
  query="sap.m.<Control>#<eventName>"
)
```

Read the result for: (a) which class actually defines the event (= which module to import
from), (b) the canonical event type name. If `query` returns nothing, search broader
(`query="sap.m.<Control>"`) and inspect the event list; the type name is `<DefiningClass>$<EventName>Event`.

### Pattern C — OData V4 binding / draft / action semantic

**Trigger:** you're writing V4-specific code (composite keys, `$expand=_X` navigation, action
invocation, draft handling, batched updates) and you're not sure of the canonical pattern.

**Why investigate:** V4 differs from V2 in non-obvious ways, and the difference is
version-specific. Guessing usually costs a `tsc` cycle or a runtime "no metadata" error.

**Recipe:**

```text
mcp__sap-docs__search(
  query="<feature> OData V4 model UI5",
  sources=["sapui5","sap-help"],
  includeOnline=true
)
mcp__sap-docs__fetch(id="<best result id>")
```

Useful starting topics (search these terms verbatim):

- "Draft Handling with the OData V4 Model"
- "Operations" (V4 actions/functions)
- "Auto-`$expand` / `$select`"
- "Reducing the Number of Requests Required to Get the Properties of a Single Entity"
- "Reducing Roundtrips"
- "Filtering" + "Sorting"

### Pattern D — FCL routing behaviour surprise

**Trigger:** FCL renders the wrong column count, columns flicker, deep-link doesn't restore
layout, "Close" button absent.

**Why investigate:** `sap.f.routing.Router` is layout-driven. Almost every FCL surprise is a
missing or wrong `layout` value on the route — not a view-XML bug.

**Recipe:** open `manifest.json`, audit every entry under `routing.routes[]` for a `layout`
property. The home/main route needs one too (Trap 1). If you're not sure which `LayoutType`
enum value to use, search:

```text
mcp__sap-docs__search(query="sap.f.LayoutType FCL three-column")
```

### Pattern E — Page renders blank but DOM is populated

**Trigger:** accessibility tree shows content, console is clean, viewport is empty.

**Why investigate:** height cascading. Some ancestor element resolves to `height: 0` and
collapses every descendant. The trap is usually a `data-` attribute selector that doesn't
match because `ComponentSupport` stripped it (Trap 2), but other height-cascade variants exist
(e.g. `<body>` without `height: 100%`, a `Page` with implicit container width but no height).

**Recipe:** in browser DevTools, click the body, walk the descendant tree in the Elements
panel, watch the computed `height`. The first element with `0` is where the chain breaks.
Apply `style="height: 100%"` inline (preferred) or a CSS selector keyed on a non-stripped
attribute (`id`, `class` — never `data-sap-ui-*`).

### Pattern F — TypeScript compiles but ui5-linter fails

**Trigger:** `npm run ts-typecheck` is clean, but `ui5lint` flags issues — and `tsc` won't help
diagnose them.

**Why investigate:** ts-typecheck checks types; ui5-linter checks UI5-runtime concerns
(deprecated APIs, framework conventions, manifest cross-references, XML view binding
correctness). They're orthogonal. The right order is `eslint --fix` first (cleans mechanical
TS-level noise), then `ui5-linter` (catches the UI5-specific issues), then `tsc` (any
remaining type errors).

If `ui5-linter` complains about a finding you don't understand, request context:

```text
mcp__SAPUI5_MCP_Server__run_ui5_linter(
  projectDir="<absolute target>",
  filePatterns=["<the file>"],
  provideContextInformation=true
)
```

The `provideContextInformation: true` flag returns API-reference excerpts and documentation
links explaining each finding.

### Pattern G — UI5 best-practice you're not sure about

**Trigger:** "should I use Form or SimpleForm?", "should this be a JSONModel or a path?",
"is `core:require` the right way to load this formatter?", "should the manifest declare a
specific theme?"

**Why investigate:** SAPUI5 has version-specific guidelines. The MCP returns the authoritative
list for the project's version.

**Recipe — start with the two pinned guideline tools:**

```text
mcp__SAPUI5_MCP_Server__get_guidelines              # general UI5 dev rules
mcp__SAPUI5_MCP_Server__get_typescript_conversion_guidelines   # TS-specific rules
```

If the answer isn't in those, escalate to sap-docs:

```text
mcp__sap-docs__search(query="<your question>")
```

### Pattern H — You've debugged the same problem twice this run

**Trigger:** you've written code, hit an error, fixed it, and the same shape of error
recurred on a different file or step. That's a signal the skill is missing a
generally-applicable pattern.

**Action:** capture it as a Run-Notes entry with: symptom, root cause, fix, and a one-line
"generic rule" extracted. After the run, propose adding it to the Critical Traps section if
it's likely to recur in future projects.

---

## Naming overrides for this project (deviation from older SAPUI5 JS conventions)

These two conventions **override** the older SAPUI5 JS Coding Guidelines. Apply silently — do
not preserve the legacy style during conversion.

| Convention | Older SAPUI5 JS Guidelines | This skill's rule |
|---|---|---|
| Variable prefixes | Hungarian recommended (`oModel`, `sQuery`, `iTotal`, `aFilters`, `mArgs`, `fHours`, `bFlag`) | **No Hungarian notation.** Use plain names: `model`, `query`, `total`, `filters`, `args`, `hours`, `flag`. TypeScript types make the prefix redundant. |
| "Main" entity name | "master" (e.g. `Master.view.xml`, i18n key `masterTitle`) | **"main"** everywhere — controller / view / route / target / file / i18n keys. Aligns with SAP's own [Inclusive Language guide](https://help.sap.com/docs/TERMINOLOGY/25cbeaaad3c24eba8ea10b579ce81aa1/83a23df24013403ea4c1fdd0107cc0fd.html) ("master branch → main branch"). |

Rename map for the typical SEGW-to-RAP demo surface:

| Legacy | Modern |
|---|---|
| `Master.controller.js` | `Main.controller.ts` |
| `Master.view.xml` | `Main.view.xml` |
| `controllerName="...controller.Master"` | `controllerName="...modern.controller.Main"` |
| route `"name": "master"` | route `"name": "main"` |
| target `"master"` | target `"main"` |
| i18n key `masterTitle` | `mainTitle` |
| i18n key `masterSearchPlaceholder` | `mainSearchPlaceholder` |
| i18n key `masterCount` | `mainCount` |
| `var oModel = ...` | `const model = ...` |
| `var sQuery = ...` | `const query = ...` |
| `var iTotal = ...` | `const total = ...` |
| `var aFilters = ...` | `const filters = ...` |
| `var oCtx = ...` | `const ctx = ...` (or `const context = ...` if clearer) |
| `var oList = ...` | `const list = ...` |
| `var oRouter = ...` | `const router = ...` |
| `var oEvent = ...` (parameter) | `event` |
| `var that = this;` | drop entirely; use arrow function |

**Exception:** keep a prefix only when dropping it would collide with a reserved word, a
same-named import, or a UI5 control name (e.g. local `const event = ...` collides with no
common UI5 import, so it's fine; but `const Date = ...` would shadow the global, so call it
`oDate` or rename it `workDate`).

Include a "Naming overrides:" line in the Phase 2 plan output so the user can confirm them for
this run.

**Atomic-rename tip:** the master → main rename touches at minimum 7 locations: file name, view
`controllerName` attribute, manifest route name, manifest target name + key + viewName, i18n
keys × 2 locale files, `BaseController.onNavBack` fallback, every `navTo("master", ...)` call
in any controller. To avoid re-edits, **grep up-front** to enumerate all hits, then edit in
one batch:

```text
Bash: grep -rn -E "master|Master" <target>/webapp
```

Review the output, decide which hits are renames (not, e.g., the word "master" inside a
sentence in the legacy German comments — those should be dropped anyway). Edit all in one
pass, then verify with a second grep that returns empty.

---

## Smart defaults (apply silently — do NOT ask before research)

| Setting | Default | Rationale |
|---|---|---|
| Source app | `<source_app>/` | The freestyle JS app under the workspace |
| Target app | `<modern_app>/` | Empty folder reserved for this skill's output |
| Target UI5 version | `1.147.2` | Latest 1.x at writing; matches the FE app in the demo; aligned with 2.0-API |
| Framework | `SAPUI5` | Matches the legacy app's ui5.yaml and the FE app's runtime |
| Language | TypeScript | Per `get_typescript_conversion_guidelines` |
| Types package | `@sapui5/types@1.147.2` | Required by UI5 MCP TS guidelines (NOT the older `sap-ui5-types` typo) |
| App namespace | Source namespace + `.modern` (e.g. `<source_namespace>.modern`) | Distinguishes from legacy in routing; keeps grep continuity |
| Theme | `sap_horizon` | UI5 1.108+ default; legacy `sap_belize` is deprecated |
| Layout | Translate `sap.m.SplitApp` ➜ `sap.f.FlexibleColumnLayout` (FCL) | Modern responsive default for main + detail |
| Naming | No Hungarian prefixes; "main" not "master" — see "Naming overrides" section above | Aligned with TS-idiomatic names + SAP Inclusive Language |
| Bootstrap | `data-sap-ui-async="true"` + `data-sap-ui-on-init="module:sap/ui/core/ComponentSupport"` | Per UI5 guidelines; sync is deprecated and breaks 2.x |
| Manifest version | `_version: 1.60.0` or later | Required for `sap.app.dataSources` + declarative models |
| OData model | The V4 service produced by `migrate-segw-to-rap` (or any V4 service the user names), via dev-server proxy. Pattern: `/sap/opu/odata4/sap/<service_binding>/srvd/sap/<service_binding>/0001/` for SRVD-direct, or check `$metadata` of a sibling reference app if one exists | V4 demonstrates the modern pattern; same backend as any FE app you've already built |
| Routing | `sap.m.routing.Router` ➜ `sap.f.routing.Router` with per-FCL-column targets | FCL needs the f-router |
| BaseController | Required | Single source of truth for `getRouter`, `getModel`, `getResourceBundle`, `getOwnerComponent` |
| Event types | Use `<Control>$<Event>Event` (e.g. `Button$PressEvent`) | UI5 ≥ 1.115 supports them; UI5 guideline says **MUST** use |
| Formatters | OData types (`sap.ui.model.odata.type.*`) first; custom only for unique business logic | Per UI5 guideline §1 |
| Forms | `sap.ui.layout.form.Form` + `ColumnLayout` if any | Never `SimpleForm` (UI5 guideline §4) |
| Casts | Real control types (`as Button`), never `as any` / `as unknown as ...` | Per TS conversion §General Rules |
| Tests | OPA5 + QUnit skipped from first cut | Promoted to follow-up if Run 1 is green |
| Linter | `mcp__SAPUI5_MCP_Server__run_ui5_linter` → 0 findings | Hard acceptance criterion |
| Manifest validation | `mcp__SAPUI5_MCP_Server__run_manifest_validation` → 0 errors | Hard acceptance criterion |
| Type check | `npm run ts-typecheck` (script added to package.json) → 0 errors | Hard acceptance criterion |

## Input

The user provides **one of**:

- A relative path to the legacy app, e.g. `<source_app>/`
- A target folder name, e.g. `<modern_app>/` (skill infers source as the sibling `legacy-*`)
- Nothing — assume defaults (`<source_app>/` ➜ `<modern_app>/`)

If both folders exist and the target is non-empty, ask: **"`<target>/` already has content.
Wipe it and start over, or migrate into the existing structure?"** Default to wipe-and-rewrite
for the demo.

---

## Phase 0 — Preflight

### 0a. Legacy app readable

```text
Bash: cat <legacy>/webapp/manifest.json
Bash: ls <legacy>/webapp/{controller,view,model,fragment,i18n}
```

Assert: `manifest.json` parses; `webapp/controller/` and `webapp/view/` both exist; at least
one `*.controller.js` and one `*.view.xml` are present. If any of these fail, stop with
*"`<legacy>` does not look like a UI5 app — check the path."*

### 0b. UI5 MCP server reachable

```text
mcp__SAPUI5_MCP_Server__get_version_info(frameworkName="SAPUI5")
```

Assert: returns at least `1.147.x` in the version map. If the tool errors, stop with *"UI5
MCP server is not configured; configure it in `.cursor/mcp.json` before running this skill."*

### 0c. Pull the authoritative guidelines (do this BEFORE writing any code)

```text
mcp__SAPUI5_MCP_Server__get_typescript_conversion_guidelines
mcp__SAPUI5_MCP_Server__get_guidelines
```

Read both responses fully. They are the source of truth for:

- dev-dependency versions (`@ui5/cli`, `typescript`, `ui5-tooling-transpile`, `ui5-middleware-livereload`, `typescript-eslint`)
- `tsconfig.json` shape (`target: es2023`, `module: es2022`, `types: ["@sapui5/types"]`, paths map)
- `ui5.yaml` shape (`ui5-tooling-transpile-task` + `ui5-tooling-transpile-middleware`)
- The **5-step code conversion sequence**: (1) class syntax, (2) ES modules, (3) type annotations, (4) casts for generic getters, (5) remaining issues
- The **`@namespace` JSDoc rule**: required immediately before each exported class for the back-transformation to re-add the UI5 class name
- The casts to avoid: never `any`, never `unknown as ...` — use real control types
- The control-event-type rule: import `Button$PressEvent` from `sap/m/Button`, not `Event` from `sap/ui/base/Event`

These tool responses are large and version-specific — do not paraphrase from memory; quote them
when you need to.

### 0d. npm + node available

```text
Bash: node --version && npm --version
```

Assert: Node 22+ (CLAUDE.md requirement) and npm 10+.

---

## Phase 1 — Discover the legacy app

Read every relevant file in `<legacy>/webapp/`. Classify findings as **blocker** (must fix for
modern UI5), **cleanup** (worst-practice but works), or **cosmetic** (style).

### 1a. Manifest scan

Pull `_version`, `sap.ui5.dependencies.minUI5Version`, `sap.ui5.rootView`,
`sap.ui5.dependencies.libs`, `sap.ui5.routing`, `sap.ui5.models`, `sap.ui5.contentDensities`,
`sap.ui5.resources`, theme references.

Common legacy patterns:

- `_version: 1.40.0` ➜ blocker (target 1.60+)
- `minUI5Version` < 1.108 ➜ blocker (no async guarantees)
- `routerClass: "sap.m.routing.Router"` with FCL target ➜ blocker
- Hard-coded service URLs in `sap.ui5.models` ➜ cleanup (move to `sap.app.dataSources`)
- `contentDensities: { compact: true, cozy: true }` ➜ cleanup (still supported, just move to manifest)
- `supportedThemes: ["sap_belize"]` ➜ cleanup (drop; sap_horizon is default)

### 1b. Component.js scan

Read `<legacy>/webapp/Component.js`. Look for:

- `jQuery.sap.require("...")` ➜ blocker (delete; use ES imports)
- Hardcoded service URL constant + `new sap.ui.model.odata.v2.ODataModel(...)` in `init` ➜ blocker (move model to manifest `sap.ui5.models[""]`)
- Manual `device` model creation ➜ keep (it's normal, but typed in TS)
- `sap.ui.model.BindingMode.TwoWay` for OData V4 ➜ blocker (V4 prefers `OneWay` reads + explicit edits)
- `useBatch: false` ➜ N/A for V4 (V4 always batches differently)
- Mixed concerns (formatter loaded via `jQuery.sap.require` in Component) ➜ blocker

### 1c. Controller scan (per controller)

For each `<legacy>/webapp/controller/<X>.controller.js`:

```text
Read: <legacy>/webapp/controller/<X>.controller.js
```

Flag:

- `var that = this;` followed by closures ➜ cleanup (arrow functions)
- `oCtx.getPath()` regex parsing (`.replace(/^\/Set\('/, "")`) ➜ blocker (use `oCtx.getProperty("Key")`)
- `sap.ui.getCore().byId(...)` ➜ cleanup (`this.byId(...)`)
- `sap.ui.getCore().getModel(...)` ➜ blocker (`this.getOwnerComponent()!.getModel(...)` with cast)
- `sap.ui.core.UIComponent.getRouterFor(this)` ➜ cleanup (move to BaseController)
- `sap.m.MessageBox` accessed as global ➜ blocker (`import MessageBox from "sap/m/MessageBox"`)
- `jQuery.sap.require(...)` ➜ blocker (ES import)
- Global formatter calls (`window.com.demo.formatter.X`) ➜ blocker (consolidate into formatter module, import in views via `core:require`)
- `oModel.callFunction("/X", {method:"POST", urlParameters: {...}})` (OData V2 function-import) ➜ blocker (translate to V4 action: `model.bindContext("/Action(...)").execute()`)
- `setTimeout(..., 500)` for "refresh after data arrives" ➜ blocker (use binding events, e.g. `dataReceived`)
- No JSDoc on parameters ➜ cosmetic (TS rewrite handles it)

### 1d. View scan (per view)

For each `<legacy>/webapp/view/<X>.view.xml`:

```text
Read: <legacy>/webapp/view/<X>.view.xml
```

Flag:

- Inline event handlers (`press="onSomething"`) referencing methods that don't exist ➜ blocker (will throw)
- `<core:Fragment fragmentName="...">` without async ➜ cleanup
- Deprecated controls (`sap.ui.commons.*`) ➜ blocker
- `sap.m.SplitApp` root ➜ blocker (translate to FCL per smart-defaults)
- Hardcoded strings instead of i18n keys ➜ cleanup
- Path-based formatters (`formatter: 'window.com.demo.X.statusText'`) ➜ blocker (convert to `core:require` of formatter module + `formatter: '.formatter.statusText'`)
- `enabled="{= ${Status} === 'D' }"` (expression binding) ➜ keep but adapt to V4 key (no `Status` ➜ `OverallStatus` etc., depending on the V4 model)

### 1e. Formatter scan

For `<legacy>/webapp/model/formatter.js`:

- `jQuery.sap.declare(...)` + `window.com.demo...` global namespace ➜ blocker (rewrite as ES module with `export function`)
- `sap.ui.core.format.DateFormat.getDateInstance(...)` instantiated per call ➜ cleanup (memoize once at module top-level)
- Per-call format object instantiation ➜ cleanup (instantiate once)
- Status / priority mapping switches ➜ keep but type as `string | undefined` ➜ `string`

### 1f. Build the findings report

Output a structured summary to the user:

```text
Discovery — legacy app: <legacy>
  Manifest version: 1.40.0 (target 1.60+)
  UI5 version: 1.84.x (target 1.147.2)
  Controllers: 3 (App, Master, Detail)
  Views: 5 (App, Master, Detail, Welcome, NotFound)
  Layout: sap.m.SplitApp (target sap.f.FlexibleColumnLayout)
  Theme: sap_belize (target sap_horizon)
  OData: V2 hardcoded in Component.init (target V4 via manifest dataSources)

Blockers (<n>):
  - Component.js: hardcoded service URL + manual ODataModel construction
  - Component.js: jQuery.sap.require(...)
  - formatter.js: window.com.* global namespace
  - Master.controller.js: getPath() regex parsing of V2 entity key
  - Detail.controller.js: oModel.callFunction("/ApproveProject", ...) for V2 function-import
  - Detail.controller.js: setTimeout(..., 500) for counter refresh
  - *.view.xml: window.com.* formatter paths
  - App.view.xml: SplitApp root
  - ...

Cleanups (<n>):
  - Master.controller.js: `var that = this;` pattern (4×)
  - All controllers: `sap.ui.core.UIComponent.getRouterFor(this)` direct calls
  - ...

Cosmetic (<n>):
  - Missing JSDoc across controllers
  - ...
```

---

## Phase 2 — Design plan + user approval

Print the migration plan in this exact format and STOP for `ok` / `edit` / question:

```text
Plan — modernize <legacy> ➜ <target>:

UI5 version:       1.147.2 SAPUI5 (TypeScript)
Types:             @sapui5/types@1.147.2
Namespace:         <source_namespace>.modern
Theme:             sap_horizon
Layout:            sap.f.FlexibleColumnLayout (translated from SplitApp)
OData:             V4 — <v4_service_url>
Proxy:             ui5-middleware-simpleproxy → <sap_baseuri>
                   (auth via .env: UI5_MIDDLEWARE_SIMPLE_PROXY_{USERNAME,PASSWORD})

Naming overrides:  - No Hungarian prefixes (TS types replace the hint)
                   - "main" instead of "master" for controller / view / route / i18n keys
                   (legacy Master.controller.js ➜ Main.controller.ts, etc.)

Files to generate in <target>/webapp:
  Component.ts
  manifest.json (v1.60.0)
  index.html (ComponentSupport bootstrap, async, inline height fix)
  controller/BaseController.ts
  controller/App.controller.ts
  controller/Main.controller.ts        ← renamed from Master per naming overrides
  controller/Detail.controller.ts
  view/App.view.xml (FCL root)
  view/Main.view.xml                   ← renamed from Master
  view/Detail.view.xml
  view/Welcome.view.xml
  view/NotFound.view.xml
  i18n/i18n.properties (translated keys: masterX → mainX) + i18n_en.properties
  css/style.css (copied from legacy if non-empty)
  model/models.ts (device-model helper only)
  model/formatter.ts (consolidated; ES module export)

Files at <target>/ root:
  package.json (with @ui5/cli, typescript, ui5-tooling-transpile, ui5-middleware-livereload,
                ui5-middleware-simpleproxy, @sapui5/types)
  ui5.yaml (specVersion 4.0; transpile + livereload + simpleproxy middleware)
  tsconfig.json (target es2023, module es2022, strict, allowJs)
  .env.example
  .gitignore

V2 ➜ V4 binding migrations (generic — adapt to your service's entity names):
  /<EntitySet>                  ➜ /<Entity>             (drop "Set" suffix)
  /<EntitySet>('K')             ➜ /<Entity>(<Key>='K')  (named-key style)
  expand: '<Nav>'               ➜ $expand=_<Nav>        (V4 RAP prefixes assocs with _)
  oModel.callFunction(...)      ➜ model.bindContext("/<Action>(...)").execute()
  fieldName remapping           ➜ inspect $metadata; RAP often renames fields between V2/V4

Blockers being fixed: <count>
Cleanups applied:     <count>
Cosmetic skipped:     <count> (separate prettier pass if desired)

Tests in this skill: none (OPA5/QUnit follow-up)
Acceptance:          ui5-linter clean + manifest validation clean + tsc clean + npm start
                     renders Master list

Type `ok` to proceed, `edit` to revise, or ask any question.
```

Wait for `ok` before mutating anything in `<target>/`.

---

## Phase 3 — Scaffold the modern TS app

### 3a. Wipe target if non-empty

If the user confirmed wipe-and-rewrite:

```text
Bash: rm -rf <target>/* <target>/.[!.]*  # safely empty <target>/ while keeping the folder
```

### 3b. Scaffold via UI5 MCP

Call `create_ui5_app` directly into `<target>/` (NOT into a sub-folder):

```text
mcp__SAPUI5_MCP_Server__create_ui5_app(
  appNamespace = "<source_namespace>.modern",
  basePath = "<absolute path to target>",
  createAppDirectory = false,
  framework = "SAPUI5",
  frameworkVersion = "1.147.2",
  typescript = true,
  initializeGitRepository = false,
  runNpmInstall = true
)
```

> `oDataV4Url` is intentionally **omitted** here — the V4 service is behind a proxy with
> credentials, so URL validation will fail. The data source is added manually in Phase 4.

### 3c. Verify the structure

```text
Bash: ls -la <target>/ && ls <target>/webapp/
```

Expected at root: `package.json`, `ui5.yaml`, `tsconfig.json`, `webapp/` with at minimum
`Component.ts`, `manifest.json`, `view/App.view.xml`, `controller/App.controller.ts`,
`index.html`, `i18n/i18n.properties`.

If `create_ui5_app` produces JS files instead of TS, fail loud — do NOT silently fall back to
manual scaffolding.

### 3d. Confirm dependencies match UI5 MCP guidelines

```text
Read: <target>/package.json
```

Cross-check against `get_typescript_conversion_guidelines` output. The expected dev-deps include
at minimum:

- `@ui5/cli`
- `typescript`
- `ui5-tooling-transpile`
- `ui5-middleware-livereload`
- `@sapui5/types` matching framework version

Add anything missing (e.g. add `ui5-middleware-simpleproxy` for OData proxying). Update versions
**only if** they're below the floor the guidelines specify; never downgrade.

Then run `npm install` again if the dep list changed.

Also confirm `"ts-typecheck": "tsc --noEmit"` exists in `scripts` (UI5 MCP guideline). Add if
missing.

### 3e. Warning — the scaffold itself uses Hungarian notation

The UI5 MCP scaffold templates (`Component.ts`, `BaseController.ts`, the default
`*.controller.ts`, `models.ts`) ship with Hungarian-prefixed parameter and local-variable
names (`sName`, `oModel`, `oParameters`, etc.). The Naming overrides section above applies to
the scaffold too — rename them as you read each scaffolded file, not just when porting from
the legacy controllers.

The fastest workflow: scaffold first, then do **one batch grep+rename pass** over the
scaffolded `webapp/` for the half-dozen common prefixes (`oModel`, `sName`, `oEvent`,
`oParameters`, etc.) BEFORE writing any new per-view controllers. This way the BaseController
you're about to extend is already in modern style.

---

## Phase 4 — Configure manifest.json + ui5.yaml + proxy

### 4a. Translate manifest.json

Read `<target>/webapp/manifest.json`, then **merge in** the legacy specifics:

1. Set `sap.app.id` = `<source_namespace>.modern`.
2. Set `sap.app.title` / `sap.app.description` from `i18n` (already templated as `{{appTitle}}`).
3. Copy `sap.app.icons` from legacy if non-empty.
4. Add `sap.app.dataSources` with the V4 service URL the user names (or, if uncertain, run
   `mcp__sap-docs__search` for the V4 binding pattern your backend uses; SRVD-direct on ABAP
   on-prem is typically `/sap/opu/odata4/sap/<service_binding>/srvd/sap/<service_binding>/0001/`):

   ```json
   "dataSources": {
     "mainService": {
       "uri": "<v4_service_url>",
       "type": "OData",
       "settings": {
         "odataVersion": "4.0",
         "localUri": "localService/metadata.xml"
       }
     }
   }
   ```

5. Set `sap.ui5.dependencies.minUI5Version` = `"1.147.0"`; libs: `sap.ui.core`, `sap.m`, `sap.f`,
   `sap.ui.layout`.

6. Set `sap.ui5.models[""]`:

   ```json
   "": {
     "type": "sap.ui.model.odata.v4.ODataModel",
     "dataSource": "mainService",
     "settings": {
       "operationMode": "Server",
       "autoExpandSelect": true,
       "earlyRequests": true
     }
   }
   ```

7. Set `sap.ui5.rootView` to `{ "viewName": "<ns>.view.App", "type": "XML", "id": "app" }`.

8. Routing — **every route MUST have a `layout` property** (Trap 1) **and every target MUST
   have `type: "View"` + use `name`/`path`/`level` (NOT `viewName`/`viewPath`/`viewLevel`)**
   (Trap 5):

   ```jsonc
   "routing": {
     "config": {
       "routerClass": "sap.f.routing.Router",
       "type": "View",                       // ← REQUIRED in manifest v2 (Trap 5)
       "viewType": "XML",
       "path": "<ns>.view",                  // ← NOT "viewPath"
       "async": true,
       "controlId": "flexibleColumnLayout",
       "controlAggregation": "beginColumnPages",
       "bypassed": { "target": "notFound" }
     },
     "routes": [
       {
         "pattern": "",
         "name": "main",
         "target": ["main", "welcome"],
         "layout": "TwoColumnsMidExpanded"   // ← REQUIRED (Trap 1)
       },
       {
         "pattern": "<EntityRoute>/{<keyParam>}",
         "name": "detail",
         "target": ["main", "detail"],
         "layout": "TwoColumnsMidExpanded"   // ← REQUIRED (Trap 1)
       }
     ],
     "targets": {
       "main":     { "type": "View", "id": "main",     "name": "Main",     "level": 1, "controlAggregation": "beginColumnPages" },
       "welcome":  { "type": "View", "id": "welcome",  "name": "Welcome",  "level": 2, "controlAggregation": "midColumnPages" },
       "detail":   { "type": "View", "id": "detail",   "name": "Detail",   "level": 2, "controlAggregation": "midColumnPages" },
       "notFound": { "type": "View", "id": "notFound", "name": "NotFound", "level": 3, "controlAggregation": "midColumnPages" }
     }
   }
   ```

   Note: `type: "View"` appears both on `config` AND on each target. The config-level default
   should propagate, but per-target redundancy is belt+braces against UI5-version differences
   in how the default is resolved.

9. `sap.ui5.contentDensities` = `{ "compact": true, "cozy": true }` (declarative — fine).

10. Drop `supportedThemes` (sap_horizon is the default; no need to pin).

Write the merged manifest:

```text
Write: <target>/webapp/manifest.json
```

Validate:

```text
mcp__SAPUI5_MCP_Server__run_manifest_validation(manifestPath="<absolute path>/webapp/manifest.json")
```

Fix anything it flags before moving on.

### 4b. ui5.yaml — add proxy + ensure transpile middleware

Open `<target>/ui5.yaml`. It already has `ui5-tooling-transpile-task` and
`ui5-tooling-transpile-middleware` after Phase 3 (verify). Add the simpleproxy and livereload:

```yaml
specVersion: "4.0"
metadata:
  name: <source_namespace>.modern
type: application
framework:
  name: SAPUI5
  version: "1.147.2"
  libraries:
    - name: sap.m
    - name: sap.ui.core
    - name: sap.f
    - name: sap.ui.layout
    - name: themelib_sap_horizon
builder:
  customTasks:
    - name: ui5-tooling-transpile-task
      afterTask: replaceVersion
server:
  customMiddleware:
    - name: ui5-tooling-transpile-middleware
      afterMiddleware: compression
    - name: ui5-middleware-livereload
      afterMiddleware: compression
    - name: ui5-middleware-simpleproxy
      afterMiddleware: compression
      mountPath: /sap
      configuration:
        baseUri: "<sap_baseuri>/sap"   # e.g. https://abap-host:50001/sap or https://my-cf-host
        strictSSL: false               # only if upstream uses a self-signed cert (dev trials)
        query:
          sap-client: "<client>"       # e.g. "001"; omit if your service doesn't need it
```

> **Config-key trap:** the key is `strictSSL: false` — not `skipCertificateCheck` or
> `ignoreCertErrors`. Those names exist for *other* proxy middlewares (`fiori-tools-proxy`
> uses `ignoreCertErrors`), but `ui5-middleware-simpleproxy` silently ignores unknown keys, so
> a wrong key fails the HTTPS handshake without any error message. Verified against the
> middleware's README and confirmed working in the demo workspace.

Add `ui5-middleware-simpleproxy` to `package.json`'s `ui5.dependencies` so ui5 tooling
auto-loads it:

```json
"ui5": { "dependencies": ["ui5-middleware-simpleproxy"] }
```

### 4c. .env scaffolding

```text
Write: <target>/.env.example
```

```
UI5_MIDDLEWARE_SIMPLE_PROXY_USERNAME=
UI5_MIDDLEWARE_SIMPLE_PROXY_PASSWORD=
```

Ask the user once (interactive) to copy values into `<target>/.env`. Don't commit `.env`.

### 4d. index.html — ComponentSupport bootstrap + inline height (verify after scaffold)

The scaffolded `index.html` should already use `ComponentSupport`. Fix the height handling per
Trap 2 above — the component `<div>` MUST have `style="height: 100%"` inline:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>{{appTitle}}</title>
    <style>html,body,#content { height: 100%; margin: 0; }</style>
    <script
        id="sap-ui-bootstrap"
        src="resources/sap-ui-core.js"
        data-sap-ui-theme="sap_horizon"
        data-sap-ui-resource-roots='{ "<source_namespace>.modern": "./" }'
        data-sap-ui-on-init="module:sap/ui/core/ComponentSupport"
        data-sap-ui-compat-version="edge"
        data-sap-ui-async="true"
        data-sap-ui-frame-options="trusted">
    </script>
</head>
<body class="sapUiBody" id="content">
    <div
        data-sap-ui-component
        data-name="<source_namespace>.modern"
        data-id="container"
        data-height="100%"
        style="height: 100%"></div>
</body>
</html>
```

Notes:

- The `style="height: 100%"` is **mandatory** — a CSS selector against `[data-sap-ui-component]`
  would seem cleaner but does NOT work because ComponentSupport strips that attribute during
  processing (Trap 2).
- `data-height="100%"` alone is not enough — it's a `ComponentContainer` setting that resolves
  against the parent's height, which is why we also need the inline style on the wrapping div.
- No inline `<script>` other than the bootstrap (CSP rule, UI5 guideline §1).

---

## Phase 5 — BaseController + Component.ts + App.view.xml

### 5a. BaseController.ts

```text
Write: <target>/webapp/controller/BaseController.ts
```

```typescript
import Controller from "sap/ui/core/mvc/Controller";
import UIComponent from "sap/ui/core/UIComponent";
import Router from "sap/f/routing/Router";
import Model from "sap/ui/model/Model";
import ResourceModel from "sap/ui/model/resource/ResourceModel";
import ResourceBundle from "sap/base/i18n/ResourceBundle";
import History from "sap/ui/core/routing/History";

/**
 * @namespace <source_namespace>.modern.controller
 */
export default class BaseController extends Controller {
    public getRouter(): Router {
        return UIComponent.getRouterFor(this) as Router;
    }

    public getModel<T extends Model = Model>(name?: string): T {
        return this.getView()!.getModel(name) as T;
    }

    public setModel(model: Model, name?: string): void {
        this.getView()!.setModel(model, name);
    }

    public async getResourceBundle(): Promise<ResourceBundle> {
        const i18n = this.getOwnerComponent()!.getModel("i18n") as ResourceModel;
        return (await i18n.getResourceBundle()) as ResourceBundle;
    }

    public onNavBack(): void {
        const previousHash = History.getInstance().getPreviousHash();
        if (previousHash !== undefined) {
            window.history.go(-1);
        } else {
            this.getRouter().navTo("master", {}, true);
        }
    }
}
```

### 5b. Component.ts

The template gives you something like this; ensure:

```typescript
import UIComponent from "sap/ui/core/UIComponent";
import Device from "sap/ui/Device";
import JSONModel from "sap/ui/model/json/JSONModel";

/**
 * @namespace <source_namespace>.modern
 */
export default class Component extends UIComponent {
    public static metadata = {
        manifest: "json",
        interfaces: ["sap.ui.core.IAsyncContentCreation"]
    };

    public init(): void {
        super.init();
        const deviceModel = new JSONModel(Device);
        deviceModel.setDefaultBindingMode("OneWay");
        this.setModel(deviceModel, "device");
        this.getRouter().initialize();
    }

    public getContentDensityClass(): string {
        return Device.support.touch ? "sapUiSizeCozy" : "sapUiSizeCompact";
    }
}
```

(Carry the `getContentDensityClass` over from the legacy component since `App.controller`
uses it.)

### 5c. App.view.xml (FCL root)

```xml
<mvc:View
    xmlns:mvc="sap.ui.core.mvc"
    xmlns="sap.f"
    controllerName="<source_namespace>.modern.controller.App"
    displayBlock="true"
    height="100%">
    <FlexibleColumnLayout id="flexibleColumnLayout"
        backgroundDesign="Solid"
        layout="OneColumn"/>
</mvc:View>
```

### 5d. App.controller.ts

```typescript
import BaseController from "./BaseController";
import Component from "../Component";

/**
 * @namespace <source_namespace>.modern.controller
 */
export default class App extends BaseController {
    public onInit(): void {
        const oOwner = this.getOwnerComponent() as Component;
        this.getView()!.addStyleClass(oOwner.getContentDensityClass());
    }
}
```

---

## Phase 6 — Per-view conversion

For each legacy `<View>.view.xml` + `<View>.controller.js`, generate the modern equivalent.
Process in order: **Main (was Master) ➜ Detail ➜ Welcome ➜ NotFound**.

> **Reminder before writing any controller:** apply the naming overrides from the top of this
> skill — no Hungarian prefixes (`const list = ...`, not `const oList = ...`); rename
> `Master.controller.js` ➜ `Main.controller.ts`; use specific event types (Trap 3), never
> `Event` from `sap/ui/base/Event`.

For every controller, follow the **5-step TS conversion** from
`get_typescript_conversion_guidelines`:

1. `Class.extend()` ➜ `class extends ...` with `@namespace` JSDoc immediately preceding it.
2. `sap.ui.define([...], function(...))` ➜ ES `import` + `export default class`.
3. Add type annotations to method parameters / class properties; use specific event types like
   `Button$PressEvent`, never bare `Event` from `sap/ui/base/Event`.
4. Cast return values of generic getters: `this.byId("x") as Table`, `this.getView()!.getModel() as ODataModel`, `event.getSource() as ColumnListItem`.
5. Fix remaining type errors. Prefer real types over `any` / `unknown as ...`.

### 6a. View translation pattern

- `<SplitApp>` root ➜ replaced by `App.view.xml` (FCL) — already done in 5c.
- Master goes into FCL `beginColumnPages` via routing; Detail goes into `midColumnPages`.
- Keep `<Page>` wrappers inside each view — they're fine.
- Replace `controllerName="<source_namespace>.<X>"` ➜ `controllerName="<source_namespace>.modern.controller.<X>"`.
- For formatters: legacy uses `formatter: 'window.com.demo.../statusText'` (global path).
  Modern uses `core:require` + relative formatter:

  ```xml
  <List
      core:require="{ formatter: '<source_namespace>/modern/model/formatter' }"
      ...>
      <ObjectListItem
          title="{Title}"
          number="{ path: 'OverallStatus', formatter: 'formatter.statusText' }"
          numberState="{ path: 'OverallStatus', formatter: 'formatter.statusState' }"
          .../>
  </List>
  ```

  Note the namespace path uses `/` (slash notation) inside `core:require`. The legacy "dot"
  property name still works in the formatter binding because `formatter.statusText` is
  resolved relative to the `core:require` map.

- For V2 ➜ V4 entity/path translation, see 6c below.
- Drop `sap.ui.commons.*` references.
- Drop deprecated `numberUnit`, `firstStatus`, `responsive`, `condensed`, `backgroundDesign` if
  the linter flags them (they may or may not be deprecated depending on the control).

### 6b. Controller translation pattern (the 5 steps in detail)

For each `<X>.controller.js`:

#### Step 1: Class syntax

Before:
```js
sap.ui.define(["sap/ui/core/mvc/Controller"], function (Controller) {
    "use strict";
    return Controller.extend("com.demo.X.controller.Master", {
        onInit: function() { /* ... */ }
    });
});
```

After (NB the `@namespace` annotation — it is required):
```ts
import Controller from "sap/ui/core/mvc/Controller";

/**
 * @namespace com.demo.X.modern.controller
 */
export default class Master extends Controller {
    public onInit(): void { /* ... */ }
}
```

(In practice you extend `BaseController`, not `Controller` directly — see 6d.)

#### Step 2: ES imports

Replace every `sap.ui.define`/`sap.ui.require` with ES `import`. Replace dynamic
`sap.ui.require(["sap/m/MessageBox"], cb)` with `import("sap/m/MessageBox").then(...)` — never
`jQuery.sap.require`.

#### Step 3: Typed event handlers (Trap 3 again — please read)

Before:
```js
onPress: function (oEvent) {
    var oItem = oEvent.getParameter("listItem");
    var oCtx = oItem.getBindingContext();
}
```

After (note: no Hungarian; specific event type):
```ts
import { List$SelectionChangeEvent } from "sap/m/List";
import ColumnListItem from "sap/m/ColumnListItem";

public onPress(event: List$SelectionChangeEvent): void {
    const item = event.getParameter("listItem") as ColumnListItem;
    const ctx = item.getBindingContext();
}
```

**Do NOT** fall back to `import Event from "sap/ui/base/Event"` because the generic type
forces `as` casts on every `getParameter` / `getParameters` call. If a specific event type
doesn't seem to exist, search for it first:

```text
mcp__SAPUI5_MCP_Server__get_api_reference(
  projectDir="<target>",
  query="sap.m.SearchField#liveChange"
)
```

For OData V4 context-aware events, use `sap.ui.model.odata.v4.Context`:

```ts
import V4Context from "sap/ui/model/odata/v4/Context";
const ctx = item.getBindingContext() as V4Context;
```

#### Step 4: Casts for generic getters

```ts
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
const model = this.getOwnerComponent()!.getModel() as ODataModel;
```

```ts
import Table from "sap/m/Table";
const tasksTable = this.byId("tasksTable") as Table;
```

(Note: variable names are `model` / `tasksTable`, NOT `oModel` / `oTable`.)

#### Step 5: V2 ➜ V4 binding migrations

This is the largest non-mechanical chunk. Three patterns to know:

##### (i) Entity key in path

V2 path: `/<EntitySet>('K')` — single-quoted string key, `Set` suffix.
V4 path: `/<Entity>(<KeyField>='K')` — no `Set` suffix, named-key style.

If the V4 service is **draft-enabled** (most RAP-managed scenarios are), the key is
**composite**: `/<Entity>(<KeyField>='K',IsActiveEntity=true)`. Reading active rows is the
default for a read-only freestyle TS app, so `IsActiveEntity=true` is usually right.

Reverse-derivation from a binding context — read the property, don't parse the path:

```ts
// V2: var sKey = oCtx.getPath().replace(/^\/Set\('/, "").replace(/'\)$/, "");
// V4: just read the property
const key = ctx.getProperty("<KeyField>") as string;
```

If you don't know whether the service is draft-enabled, search:

```text
mcp__sap-docs__search(query="Draft Handling with the OData V4 Model")
```

##### (ii) Expand

V2: `parameters: { expand: "<Nav>" }` (in `bindElement`).
V4: pass via `parameters: { $expand: "_<Nav>" }` (note the underscore — RAP V4 services typically
prefix association names with `_`) OR rely on `autoExpandSelect: true` in the manifest model
config and let UI5 figure it out from the view bindings.

**Recommended:** rely on `autoExpandSelect: true` + path-based bindings (`items="{_<Nav>}"`).
Don't hand-author `$expand` unless you have a specific reason. To confirm the navigation name
for your service, fetch its `$metadata` and look for `<NavigationProperty Name="_X">`.

##### (iii) Function-imports ➜ actions

V2:
```js
oModel.callFunction("/<Function>", {
    method: "POST",
    urlParameters: { <Key>: sKey },
    success: function(oData) { /* ... */ },
    error: function(oErr) { /* ... */ }
});
```

V4 (bound action — the typical RAP pattern):
```ts
import V4Context from "sap/ui/model/odata/v4/Context";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";

const ctx = this.getView()!.getBindingContext() as V4Context;
const model = ctx.getModel() as ODataModel;
// Bound action: invoke relative to the entity context
const operation = model.bindContext("<Action.FQN>(...)", ctx);
try {
    await operation.invoke("$auto");          // newer V4 API; older: .execute()
    MessageToast.show("Action succeeded.");
    ctx.refresh();                             // pick up state changes
} catch (err) {
    MessageBox.error((err as Error).message);
}
```

The **fully-qualified action name** (`<Action.FQN>`) is service-specific. For RAP V4 it looks
like `com.sap.gateway.srvd.<service_name>.v0001.<action_name>`. To find it for your service,
inspect `$metadata` and look for `<Action Name="X" IsBound="true">` — the parent `<Schema Namespace>`
attribute plus `.X` is the FQN. Use `mcp__sap-docs__search(query="OData V4 Operations action invocation UI5")`
if uncertain about the API shape.

#### Step 6: Move private fields to class properties

Before (legacy):
```js
onInit: function () {
    this._sProjectId = undefined;  // implicit, later
}
```

After:
```ts
export default class Detail extends BaseController {
    private projectId?: string;     // no Hungarian; plain field name

    public onInit(): void { /* ... */ }
}
```

### 6b.1 V4 path-relative binding lives in the XML view, not the controller

When a parent-row selection should refresh a child-table binding (e.g. "select a task →
time entries reload"), the **V4 idiomatic pattern** is:

1. Declare the items binding **in the XML view**, relative to the parent context's
   navigation association (`_<Nav>`):

   ```xml
   <Table id="<childTable>"
       items="{
           path: '_<Nav>',
           parameters: { $filter: 'IsActiveEntity eq true' }
       }">
       <columns>
           <Column><Text text="{i18n>colA}" /></Column>
           <!-- ... -->
       </columns>
       <items>
           <ColumnListItem>
               <cells>
                   <Text text="{<FieldA>}" />
                   <!-- ... -->
               </cells>
           </ColumnListItem>
       </items>
   </Table>
   ```

2. In the controller, set the **binding context** when the parent row is selected — UI5 picks
   up the `_<Nav>` association relative to the new context:

   ```ts
   const childTable = this.byId("<childTable>") as Table;
   childTable.setBindingContext(parentContext);
   ```

**Do NOT** construct `ColumnListItem` template rows in the controller via `new ColumnListItem({ cells: [...] })`
followed by `bindItems({ path, template, templateShareable })`. That works but it's the
imperative V2 pattern; in V4 the XML+context approach is shorter, declarative, and what UI5
expects. Every controller method allocating template rows is a smell.

### 6c. Formatter consolidation

Pull the legacy globals (`window.com.demo...formatter.statusText` etc.) into a single ES module:

```text
Write: <target>/webapp/model/formatter.ts
```

```ts
import DateFormat from "sap/ui/core/format/DateFormat";

// instantiate once — not per call
const oDateMedium = DateFormat.getDateInstance({ style: "medium" });

/**
 * @namespace <source_namespace>.modern.model
 */
const formatter = {
    statusText(sStatus?: string): string {
        switch (sStatus) {
            case "A": return "Approved";
            case "D": return "Draft";
            case "X": return "Cancelled";
            default:  return sStatus ?? "";
        }
    },
    statusState(sStatus?: string): "Success" | "Warning" | "Error" | "None" {
        if (sStatus === "A") return "Success";
        if (sStatus === "X") return "Error";
        if (sStatus === "D") return "Warning";
        return "None";
    },
    // ...taskStatusText, taskStatusState, priorityText, priorityState, dateShort, hoursDecimal
    dateShort(oDate?: Date): string {
        return oDate ? oDateMedium.format(oDate) : "";
    },
};

export default formatter;
```

Views reference via `core:require="{ formatter: '<source_namespace>/modern/model/formatter' }"`
then use `formatter: 'formatter.statusText'` in the binding (or `formatter: '.formatter.statusText'`
when controller-relative — both work; the `core:require` form is cleaner and doesn't need a
controller field).

### 6d. Write each pair

```text
Write: <target>/webapp/view/<X>.view.xml
Write: <target>/webapp/controller/<X>.controller.ts
```

After each pair, run the linter against just the new file:

```text
mcp__SAPUI5_MCP_Server__run_ui5_linter(
  projectDir="<absolute target>",
  filePatterns=["webapp/controller/<X>.controller.ts", "webapp/view/<X>.view.xml"],
  provideContextInformation=true
)
```

Fix findings before advancing. **Do not** accumulate lint debt across views.

### 6e. i18n migration (with rename: masterX → mainX)

Copy `<legacy>/webapp/i18n/i18n.properties` to `<target>/webapp/i18n/i18n.properties`, but
apply the naming-override rename:

| Legacy key | Modern key |
|---|---|
| `masterTitle` | `mainTitle` |
| `masterSearchPlaceholder` | `mainSearchPlaceholder` |
| `masterCount` | `mainCount` |

Update the corresponding `{i18n>X}` references in the modern XML views.

Also write `<target>/webapp/i18n/i18n_en.properties` with the same content (UI5 guideline:
**when adding keys, propagate to all locale files**). If the legacy app shipped German or
other locales, copy those too — with the same rename applied.

### 6f. Welcome + NotFound views

These are simple — just MessagePages. Translate XML 1:1, drop `xmlns:core` if not used, ensure
i18n keys are reused from legacy.

---

## Phase 7 — Validation pass

Run all four gates in this order. **All four must pass** before declaring the conversion done.

> **Important — what these gates don't catch:** clean reports here do NOT mean the app
> renders. In particular, Trap 5 (manifest v2 + deprecated routing keys / missing
> `type: "View"`) passes ALL of the gates below but produces a blank page at runtime.
> The Phase 8d browser-render check is the only honest acceptance gate. See the table
> in Trap 5 for the empirical tool-coverage breakdown.

### 7a. ESLint auto-fix (FIRST — before manual review)

```text
Bash: cd <target> && npx eslint webapp --fix
```

This pass resolves the bulk of `@typescript-eslint/no-unnecessary-type-assertion`,
`no-unused-vars`, and `no-unused-imports` findings automatically. Doing it BEFORE manual
review skips one full iteration cycle (otherwise: tsc passes → manual lint review → fix
mechanical issues → re-lint).

After auto-fix, re-read any file with remaining manual findings (usually 1-2).

### 7b. UI5 linter

```text
mcp__SAPUI5_MCP_Server__run_ui5_linter(
  projectDir="<absolute target>",
  provideContextInformation=false   # avoid bloating output on the full-project run
)
```

Expected: zero findings. Common false-positives are rare; most findings have a real fix
suggested in the tool output. Use the `fix=true` argument **only** after the user confirms the
suggested fixes look correct.

### 7c. Manifest validation

```text
mcp__SAPUI5_MCP_Server__run_manifest_validation(
  manifestPath="<absolute target>/webapp/manifest.json"
)
```

Expected: zero errors. Warnings about unused i18n keys are OK.

### 7d. TypeScript type check

```text
Bash: cd <target> && npm run ts-typecheck
```

Expected: zero errors. Fix all errors before declaring done — don't suppress with `// @ts-ignore`.

---

## Phase 8 — Smoke test

### 8a. Install + serve

```text
Bash: cd <target> && npm install
Bash: cd <target> && (npm start &)
```

Wait ~5 seconds for the dev server.

### 8b. HTTP probe (necessary but NOT sufficient)

```text
Bash: curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/index.html
Bash: curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/manifest.json
```

Expected: both return 200.

> **Server caveat (UI5 guideline §2):** the UI5 dev server does **NOT** serve a default index
> file. Always probe `http://localhost:8080/index.html`, never `http://localhost:8080/`.

> **Important:** HTTP 200 does NOT prove the UI renders. Both Trap 1 (FCL stuck at OneColumn)
> and Trap 2 (zero-height blank page) return 200 OK. The browser-render check in 8d is the
> only honest acceptance gate.

### 8c. OData probe via proxy

```text
Bash: curl -s "http://localhost:8080<v4_service_url>\$metadata" | head -5
# where <v4_service_url> is the path from sap.app.dataSources.mainService.uri
```

Expected: valid `<edmx:Edmx ...>` XML. If 401, the `.env` proxy creds are missing or wrong. If
404, the service binding name in the manifest is wrong (re-check the FE app's manifest for
the canonical URL).

### 8d. Browser-render verification (CRITICAL — this is the real acceptance gate)

Run one of the following depending on which MCP is available. If none are, ask the user to
verify manually.

**Option A — Chrome MCP** (preferred):

```text
mcp__Claude_in_Chrome__navigate(url="http://localhost:8080/index.html")
mcp__Claude_in_Chrome__get_page_text       # must include project titles from V4
mcp__Claude_in_Chrome__javascript_tool(
  code="document.querySelector('.sapFFCL').clientHeight"
)
# Expected: a number > 400 (a normal dev viewport is ~600-1000 tall)
```

**Option B — Claude_Preview MCP**:

```text
mcp__Claude_Preview__preview_start(url="http://localhost:8080/index.html")
mcp__Claude_Preview__preview_screenshot    # confirm two columns visible
mcp__Claude_Preview__preview_eval(
  expression="document.querySelector('.sapFFCL').clientHeight"
)
```

**Option C — manual** (if neither MCP is available): ask the user to open the URL and confirm
the two-column rendering before declaring the skill done.

Verification targets:

- A **two-column** FCL layout, not one-column. If you see one column, you tripped Trap 1.
- The `.sapFFCL` element's `clientHeight` is > 400 px. If it's 0 or near-0, you tripped Trap 2.
- Left column: main list with rows from the V4 backend (count + fields match what the
  legacy app shows on the same data).
- Right column: Welcome `IllustratedMessage` placeholder.
- Clicking a row switches FCL to two-columns (or stays there, depending on initial layout)
  with Detail view in the mid column.
- Detail view shows the entity header + whatever tabs/sections the legacy app had.
- Action buttons (e.g. an approve / submit / cancel button) behave per the legacy app's
  expression-binding rules — enabled only when the entity is in the appropriate state.

### 8e. Final report

Print:

```text
Modernization complete — <target>

UI5 version:    1.147.2 SAPUI5 (TypeScript)
Theme:          sap_horizon
Layout:         sap.f.FlexibleColumnLayout
OData:          V4 — <v4_service_url>
Views:          <count> (all under FCL columns)
Controllers:    <count> (all extend BaseController)
Linter:         clean
Manifest:       valid
TypeCheck:      clean
Smoke:          200 OK on index.html + manifest.json + $metadata; UI renders Master list

UI5 MCP calls:  <count> (get_typescript_conversion_guidelines, get_guidelines,
                create_ui5_app, run_ui5_linter ×N, run_manifest_validation,
                get_api_reference ×M where needed)
sap-docs:       <count> (only when V2 ➜ V4 patterns needed lookup)
arc-1:          <0 unless you needed to look up a V4 service binding URL>

What's next:
  - Open http://localhost:8080/index.html. Master list should render with projects.
  - Compare side-by-side with legacy app on its port and FE app on its port — three UIs,
    one backend.
  - Optional follow-up: add OPA5 page-object journey + QUnit formatter tests (see TS-conversion
    guidelines §Test Conversion for the modern OPA pattern).
  - Optional follow-up: add German i18n locale (i18n_de.properties).
```

---

## Error handling — known modes

| Symptom | Cause | Fix |
|---|---|---|
| **Page renders blank; console clean; DOM populated but every element has height: 0** | UI5 ComponentSupport stripped `data-sap-ui-component` attribute, so any CSS height selector tied to that attribute fails to match (Trap 2) | Add `style="height: 100%"` inline directly on the component `<div>` in `index.html`. CSS selectors won't work. |
| **Page blank, columns empty, console warning "page stack is empty but should have been initialized"** | Manifest `_version` is 2.0.0+ (UI5 1.136+) and routing targets miss explicit `"type": "View"` and/or still use deprecated `viewName`/`viewPath`/`viewLevel` keys (Trap 5). NEITHER `@ui5/linter` NOR `run_manifest_validation` flags this — both report clean. | Add `"type": "View"` to `routing.config` AND each target; rename `viewName` → `name`, `viewPath` → `path`, `viewLevel` → `level`. Verify via browser-render (Phase 8d), not via lint/validation gates. |
| **Only one FCL column visible; routing places content in mid/end column but it's hidden** | Matched route is missing the `layout` property (Trap 1) | Add `"layout": "TwoColumnsMidExpanded"` (or appropriate value) to **every** route, including the home/main route. The router only updates FCL layout from the matched route's `layout` value. |
| **TypeScript forces casts like `(event.getParameters() as {listItem: ListItem}).listItem`** | Generic `Event` from `sap/ui/base/Event` was imported instead of the specific `<Control>$<Event>Event` (Trap 3) | Replace with the specific event type, e.g. `import { List$SelectionChangeEvent } from "sap/m/List"`. Use `get_api_reference` if uncertain. |
| `create_ui5_app` returns no error but `<target>/webapp/Component.ts` is a `.js` file | UI5 MCP fell back to a JS template | Re-call with `typescript: true` explicit; verify `frameworkVersion` is supported (must be >= 1.96) |
| `run_ui5_linter` finds 100s of issues on a fresh scaffold | Template language mismatch (JS scaffold, TS expected) | Same as above — re-scaffold |
| `tsc --noEmit` complains about missing types from `sap/m/...` | `@sapui5/types` not installed or wrong version | `cd <target> && npm install --save-dev @sapui5/types@1.147.2` |
| `tsc --noEmit` errors on `event.getParameter("X")` returning `unknown` | Generic `Event` type from `sap/ui/base/Event` | Replace with control-specific event type: `import { Button$PressEvent } from "sap/m/Button"`. UI5 ≥ 1.115 is required (guideline §1 sub-bullet) |
| `npm start` fails with "port 8080 in use" | Legacy app's `npm start` already running on 8080 | Stop legacy first, or run modern on a different port: `ui5 serve -p 8081` |
| Browser shows blank page; console: "failed to load Component.js" | `data-sap-ui-resource-roots` mismatch with `sap.app.id` | Both must use the same fully-qualified namespace (`<source_namespace>.modern`) |
| OData proxy returns 401 | `.env` missing or wrong creds | `cp .env.example .env`, set `UI5_MIDDLEWARE_SIMPLE_PROXY_USERNAME` and `..._PASSWORD` |
| OData proxy returns 502 / cert error | TLS handshake fails against an upstream with a self-signed certificate | For `ui5-middleware-simpleproxy`, set `strictSSL: false` (NOT `skipCertificateCheck` — that key is silently ignored). For `fiori-tools-proxy`, the key is `ignoreCertErrors: true`. Read the middleware's README — see Self-help Pattern A. |
| FCL doesn't switch layouts on navigation | Per-route `layout` property missing, or `controlAggregation` set wrong | Master ➜ `beginColumnPages`, Detail ➜ `midColumnPages`; route should set `"layout": "TwoColumnsMidExpanded"` |
| `MessageBox.show(...)` runtime error: "not a function" | Wrong import path | `import MessageBox from "sap/m/MessageBox";` — the legacy `sap.ui.commons` path is gone |
| Lint flags formatter functions as "unused" | Formatter imported in TS but the view uses `core:require` (the linter doesn't always cross-check) | Either suppress with a JSDoc `@public` on the export OR add a controller-level reference (`public formatter = formatter;`) |
| V4 `bindContext("/Action").execute()` rejects with "no metadata" | Service metadata still loading | `await oModel.requestObject("/")` once before the first action; or `oModel.attachOnce("metadataLoaded", ...)` and gate the action button on that |
| V4 binding silently returns empty list | Wrong association name (V2 `<Nav>` vs V4 `_<Nav>`) | RAP V4 services prefix associations with `_`. Inspect `$metadata` `<NavigationProperty Name=...>` for the canonical name. |
| V4 list bound to `/<EntitySet>` returns 404 | V2 collection name carried over | Drop the `Set` suffix: `/<Entity>` (named after the entity type, not the entity set) |
| `npx tsc --noEmit` complains about `JQuery` types | `@types/jquery` missing | `npm install --save-dev @types/jquery`; verify `tsconfig.types` includes `@types/jquery` |

---

## What this skill explicitly does NOT cover

- **Adding new features.** This is a translation skill — feature-parity with the legacy app
  only. If the legacy app didn't have search/filter, the modern app doesn't get it.
- **Tests.** OPA5 + QUnit scaffolding is a follow-up — keeps Run 1 small. The TS conversion
  guidelines §Test Conversion has the modern OPA5 pattern when you're ready.
- **Custom controls.** The legacy app has none. If yours does, see the TS conversion
  guidelines §UI5 Control TypeScript Conversion (it's an extra step with `@ui5/ts-interface-generator`
  + manual constructor signature copy).
- **Accessibility audit.** UI5 1.147 controls are a11y-clean by default, but axe + manual
  screen-reader testing is its own deliverable.
- **Fiori Launchpad integration.** The modern app stands alone. FLP tile work belongs in the
  FE skill or a separate FLP skill.
- **Theme customization** beyond `sap_horizon`. Custom themes need `themelib_*` builds.
- **Build-time bundling** beyond what `ui5 build` does. Webpack/Vite are not used.

---

## Notes for the LLM running this skill

- **Read the Critical Traps section above before writing any code.** Three issues account for
  most of the lost debugging time in past runs: FCL routes without `layout`, missing inline
  `style="height: 100%"`, and generic `Event` imports. Skipping past those, even with the
  rest of the skill perfect, will cost you 15-30 minutes.
- **Apply the naming overrides silently.** "main" not "master"; no Hungarian prefixes. Don't
  preserve the legacy naming for "consistency" — the legacy naming is part of what we're
  modernizing.
- **Always call `get_typescript_conversion_guidelines` and `get_guidelines` first.** Their
  content is large and version-specific; do not paraphrase from memory.
- **Use sap-docs MCP for ad-hoc best-practice lookups during the run.** When uncertain about
  routing config, V4 binding behaviour, draft semantics, FCL layout values, etc., search
  `mcp__sap-docs__search` and fetch the specific topic. Don't guess.
- **Per-view granularity matters:** do one view fully (XML + controller + formatter + lint)
  before moving to the next. Don't accumulate technical debt across views.
- **Reach for `get_api_reference`** whenever a legacy API name disappears in the modern target
  (e.g. when a control is renamed or a method is replaced). Don't guess.
- **Never silently downgrade dependency versions** the guideline specifies — only upgrade.
- **Don't use `any` or `unknown as ...` casts.** Use real control types. `any` casts hide
  V2-vs-V4 binding bugs that surface at runtime as "undefined.replace is not a function"
  errors.
- **OData V4 path semantics differ from V2.** Don't carry `getPath().replace(/^\/Set/, "")`
  patterns forward — `ctx.getProperty("Key")` is the correct approach.
- **Drop `console.log` debugging statements** before the final lint pass. The legacy app has
  many `console.log("[X] ...")` lines — these are appropriate for legacy worst-practice
  showcase but NOT for the modernized version.
- **Drop "var that = this;" + later .bind(that) patterns entirely** — arrow functions handle
  `this` correctly in TS.
- **Drop legacy non-English JSDoc comments** verbatim ("Worst-practice 2020-Mix...",
  "manuell, weil immer schon so gemacht", etc.). They describe the legacy state and
  contradict the modernized code. Replace with terse English descriptions of the modern
  controller's purpose.
- **Run `npx eslint webapp --fix` BEFORE the UI5 linter.** It auto-resolves
  `no-unnecessary-type-assertion`, `no-unused-vars`, and `no-unused-imports` — the three
  classes of finding that account for the bulk of post-conversion lint debt. Skipping this
  step adds one full iteration cycle (tsc clean → ui5lint fail → fix mechanical issues).
- **Press-event handlers usually have no parameters.** `onApprove`, `onNavBack`,
  `onItemPress` (when you use `this.byId` not the event source) — declare with `()`, not with
  `_event: Button$PressEvent`. The latter creates an unused-import that needs a second edit.
  See Trap 4 above.
- **ARC-1 is optional for this skill.** Use it only if you need to look up a V4 service
  binding URL (e.g. `SAPRead type=SRVB name=<service_binding>`) or confirm a status-code /
  enum mapping from the backing CDS / behaviour definition. Skip otherwise.
- **fiori-mcp is NOT used here** — that's for Fiori Elements with annotations, not for
  freestyle TS apps with manual controls.
- **If a sibling reference app exists for the same backend** (e.g. a Fiori Elements app you've
  already built against the same V4 service), read its `manifest.json` and `ui5.yaml` first.
  Those files are a known-working reference for the V4 URL, the proxy config, the navigation
  associations, and any auth quirks — copying those values is faster than rediscovering them.
- **Server caveat:** UI5's dev server has no default index. Always probe `/index.html`.
- **`SimpleForm` is forbidden** by the UI5 guideline §4. Use `Form` + `ColumnLayout` if any
  form is needed (the legacy app here has none, so this is a freebie).
- **Use OData types** (`sap.ui.model.odata.type.*`) for built-in formatting (numbers, dates,
  currency) before reaching for custom formatters. Custom formatters are for unique business
  logic only (e.g. status-code → text mapping that has no built-in equivalent).
