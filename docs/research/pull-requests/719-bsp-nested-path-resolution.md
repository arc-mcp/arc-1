# PR #719 — BSP nested-path resolution

**PR:** https://github.com/arc-mcp/arc-1/pull/719

**Reviewed:** 2026-08-31

**Verdict:** REQUEST CHANGES / replace rather than merge
**Linked issue:** none; the PR body is the only bug report

## Executive finding

The reported bug is real, but PR #719 fixes only one symptom and introduces a regression for
namespace-style BSP application names. The correct fix is to separate the BSP application name from
the repository path with namespace-aware parsing, then identify file versus folder from SAP's response
`Content-Type`. The existing `include.includes('.')` filename heuristic is not valid.

A replacement branch was built from current `main` because #719 is a cross-repository contributor PR,
is 23 commits behind `main`, and its approach needs structural changes beyond the submitted patch.

## Independent reproduction

### Reported failure, before the PR

Checked out the PR parent (`1f29817e`) and called the real A4H SAP_BASIS 7.58 system:

```text
SAPRead {type:"BSP", name:"ZDEMOABAP_CH/WebContent"}
GET .../objects/ZDEMOABAP_CH%2FWEBCONTENT/content
404 The resource ZDEMOABAP_CH/WEBCONTENT does not exist
```

The same mixed-case path succeeds when sent as app name plus `include`. This confirms that
`getBspAppStructure()` uppercases its complete `appName` argument, so an unsplit combined input
silently changes the case-sensitive repository path.

### What #719 fixes

On the exact PR commit (`06aed507`), the same combined input requests
`ZDEMOABAP_CH%2FWebContent` and returns the expected folder listing. The submitted regression tests
also pass.

### What #719 misses or breaks

1. **Namespaced application regression — blocking.** `src/handlers/read.ts:760-763` splits on the
   first slash. Valid BSP applications include `/UI2/USHELL`, `/UI5/CNTEST`, and
   `/UIF/FLEX_KEYUSR_SRV`. For `/UI2/USHELL`, #719 derives an empty app name. The request happens to
   reach the same encoded path, but `parseBspFolderListing()` receives the empty prefix and returns
   paths such as `/UI2/USHELL/chips` instead of the established `/chips`.
2. **Dot heuristic remains wrong — blocking for a complete fix.** `src/handlers/read.ts:769-773`
   still treats every path containing `.` as a file. Live A4H has the real folder
   `ZDEMOABAP_CH/.settings`; #719 returns its 4,620-byte Atom feed as raw XML rather than a parsed
   folder listing. Conversely, extensionless files are treated as folders.
3. **Tests assert the constructed URL, not the SAP contract.** The new mocks omit response media
   types, do not cover `/namespace/app` names, dotted folders, extensionless files, or live behavior.
4. **The LLM-visible contract remains unclear.** `SAPRead.name` is generic and the `include`
   description never mentioned BSP, which is why callers reasonably put the whole path in `name`.

## Root cause

Three design assumptions combined:

1. `getBspAppStructure()` and `getBspFileContent()` correctly uppercase a clean BSP application name
   but must preserve the case of the path appended to it.
2. The handler required callers to know the undocumented `name` + `include` split.
3. The handler guessed resource kind from punctuation (`include.includes('.')`) even though SAP
   already returns the authoritative resource kind.

The ADT URI is one encoded segment:

```text
/sap/bc/adt/filestore/ui5-bsp/objects/{encodeURIComponent(app + "/" + path)}/content
```

The existing API research in `docs/plans/2026-04-09-fiori-deployment-api-reference.md`, sections
2.3–2.6, records the contract: folder responses are Atom feeds and file responses are raw content;
the response `Content-Type` distinguishes them.

## Contract and live verification

The Eclipse ADT discovery/reference material confirms the collection
`/sap/bc/adt/filestore/ui5-bsp/objects` with category `filestore-ui5-bsp`. More importantly, live
wire checks on both supported on-prem release families returned:

| System | Folder response | File response |
|---|---|---|
| A4H, SAP_BASIS 7.58 | `application/atom+xml;type=feed` | actual file MIME, e.g. `text/html` |
| NPL, NW 7.50 | `application/atom+xml;type=feed` | actual file MIME, e.g. `text/xml` |

The 8.16 system was intentionally offline per the infrastructure runbook. This path is not
release-specific, and the oldest supported 7.50 stack plus the primary 7.58 stack agree.

## Selected fix

The replacement implementation:

- parses `APP/path` while preserving `/namespace/app` as the complete application name;
- combines a path supplied in `name` with an explicit `include` when both are present;
- uppercases only the BSP application name and preserves path case;
- performs one GET with `Accept: */*`;
- parses `application/atom+xml` responses as folders and returns every other media type as raw file
  content;
- documents BSP path semantics on the LLM-visible `include` property and updates its frozen snapshots;
- adds unit coverage for mixed-case paths, namespaced roots and descendants, dotted folders,
  extensionless files, and media-type classification;
- adds a live integration test with the repository skip policy.

### Follow-up review resolution

A second review found one additional empty-prefix case: a single leading slash such as
`/ZAPP_BOOKING` was split at offset zero. A focused test reproduced the resulting
`/ZAPP_BOOKING/index.html` path, and the shared parser now keeps that slash in the application name.
The parser documents the unavoidable ambiguity between `/NS/APP` and an ordinary application/path
with a stray leading slash.

The same review proposed deleting `getBspAppStructure()` and `getBspFileContent()`. They are exposed
through plugin API v1, where deletion would be a breaking change requiring an API-version bump.
Instead, both methods remain as deprecated compatibility wrappers over `getBspPathContent()`. This
removes their duplicate URL builders and response assumptions while preserving existing extensions.
The explicit `Accept: */*` rationale and the text-only/binary ceiling are documented beside the new
method. The tool guide and `include` schema now describe both supported BSP path forms.

### Live results with the replacement

- A4H 7.58 `ZDEMOABAP_CH/WebContent` → structured folder entries with case preserved.
- A4H 7.58 `ZDEMOABAP_CH/.settings` → structured entries, not raw Atom XML.
- A4H 7.58 `/UI2/USHELL` → relative paths `/chips`, `/i18n`, `/manifest.json`, `/shells`.
- NPL 7.50 `/UI2/USHELL/chips` → structured folder entries.
- NPL 7.50 `/UI2/USHELL/chips/action.chip.xml` → raw XML file content.

## Security and architecture checklist

- [x] New ADT call begins with `checkOperation(this.safety, OperationType.Read, ...)`.
- [x] URI input remains inside one `encodeURIComponent()` segment; it cannot escape to another ADT
  endpoint.
- [x] No new mutation, package, transport, Git, auth, cache, or per-user credential path.
- [x] Existing `SAPRead` policy remains the correct `read` scope; no new action or scope surface.
- [x] No stdout logging, secrets, raw stack traces, or new error type.
- [x] Tool schema change is description-only and all seven standard snapshots were intentionally
  updated; Zod/handler keys are unchanged.
- [x] `withSafety()` needs no special handling because no client instance field was added.

## Verification record

Exact PR #719:

- `npm ci` — passed (engine warning: local Node 22.18 is below the declared 22.19 floor)
- `npm run typecheck` — passed
- `npm run lint` — passed with pre-existing Biome schema/deprecation info messages
- `npm test` — 171 files, 4,995 tests passed
- live A4H reproduction on the parent and success check on the PR commit

Replacement on current `main`:

- `npm ci` — passed; audit found 0 vulnerabilities
- `npm run typecheck` — passed
- `npm run lint` — passed with the same Biome info messages
- `npm test` — 178 files, 5,337 tests passed after follow-up hardening
- `npm run build` — passed
- `npm run validate:policy` — passed (125 entries / 14 schemas)
- `npm run check:sizes` — passed
- `git diff --check` — passed
- focused BSP/client regression tests — 28 passed
- targeted live integration test — passed again on A4H 7.58 and NPL 7.50

No `SAPActivate` is applicable: this is a read-only filestore change and creates no SAP object.

## Paste-able review for #719

```markdown
Thanks for identifying the mixed-case BSP path bug — I reproduced the 404 independently, and your
patch fixes that exact `APP/WebContent` call shape. I found two blocking cases in the broader input
contract, so I do not think this version should merge as-is:

1. **src/handlers/read.ts:760-763** — splitting on the first slash breaks namespace-style BSP app
names such as `/UI2/USHELL`. The request can still resolve by accident, but the empty `appName`
changes parsed result paths from `/chips` to `/UI2/USHELL/chips`. Split after the namespace object
name when `name` starts with `/`.
2. **src/handlers/read.ts:769-773** — `include.includes('.')` is not a valid file/folder test. Live
A4H has a `.settings` folder, which this branch returns as raw Atom XML; extensionless files fail in
the opposite direction. SAP already distinguishes them: folders return
`application/atom+xml;type=feed`, while files return their file MIME type. A single GET can branch on
that response header.

The replacement also needs tests for namespaced apps, dotted folders, extensionless files, response
media types, and an update to the LLM-visible BSP path guidance.
```

## Disposition

Create a replacement PR from current `main`, then close #719 with thanks and a reference to the new
PR. Do not push to the contributor's fork branch.
