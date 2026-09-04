# KTD Short Texts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read and write the per-node short text of a Knowledge Transfer Document (SKTD) via `SAPRead` (read-only metadata trailer) and `SAPWrite` (`shortTexts=[{node,text}]`), fail-closed, without changing the Markdown-body semantics.

**Architecture:** All XML knowledge stays in `src/adt/ddic-xml.ts` as pure string functions over the `<sktd:docu>` envelope (byte-preserving splices, same style as the body write). `src/handlers/read.ts` composes the trailer; `src/handlers/write/{update-delete,create}.ts` pass `shortTexts` into one envelope rewrite and keep their single lock→PUT→unlock cycle. The node resolver (exact → case-insensitive → unique short name) is one function shared by heading parsing and `shortTexts[].node`.

**Tech Stack:** TypeScript strict / ESM (`.js` imports), Zod v4 (`src/handlers/schemas.ts`), JSON Schema tool definitions (`src/handlers/tools.ts`), vitest, Biome. Spec: `docs/superpowers/specs/2026-09-03-ktd-short-text-design.md`.

**Branch:** `feat/ktd-short-text` (based on `fix/sktd-multi-node-write`; rebase onto `main` once PR #2 merges).

**Gate to run before every commit:**

```bash
npx biome check --write <changed .ts files>
npm run typecheck
npx vitest run tests/unit/adt/ddic-xml.test.ts tests/unit/handlers/read.test.ts tests/unit/handlers/write-ddic.test.ts tests/unit/handlers/tool-definitions-snapshot.test.ts
npm run check:sizes
```

`npm test` has 9 pre-existing environment failures on this Windows/`--ignore-scripts` checkout (`cache/sqlite`, `server/sinks/file`, `server/deny-actions`, `helpers/skip-discipline`, `cli/runtime`); anything else failing is yours.

---

## File map

| File | Responsibility in this feature |
|------|-------------------------------|
| `src/adt/ddic-xml.ts` | `KTD_META_MARKER`, `stripKtdMetaTrailer`, `resolveKtdNode`, `elementShortText`, `elementShortTextObligation`, `setKtdElementShortText`, `applyKtdShortTexts`, `formatKtdShortTexts`, `rewriteKtdDocument` (body + short texts in one pass); heading parsing switches to `resolveKtdNode` |
| `src/handlers/read.ts` | SKTD branch builds the trailer: marker + short texts + undocumented index |
| `src/handlers/write/update-delete.ts` | SKTD update: `rewriteKtdDocument(envelope, source, shortTexts)`; `source` optional when `shortTexts` given |
| `src/handlers/write/create.ts` | SKTD create: same call after the POST; runs when `source` or `shortTexts` present |
| `src/handlers/schemas.ts` | `ktdShortTextSchema`; `shortTexts` on both SAPWrite schemas; cross-field: `shortTexts` only for `type SKTD/KTD` |
| `src/handlers/tools.ts` | `shortTexts` JSON Schema property on SAPWrite |
| `tests/unit/adt/ddic-xml.test.ts` | pure-function tests |
| `tests/unit/handlers/{read,write-ddic}.test.ts` | handler tests |
| `tests/fixtures/tool-definitions/*.json` | regenerated snapshot (reviewed diff) |
| `docs_page/tools.md`, `AGENTS.md`, `docs/research/2026-09-02-sktd-multi-node-write.md` | docs |

Existing helpers you will reuse (all in `src/adt/ddic-xml.ts`, private unless noted): `findKtdElements(envelopeXml): KtdElement[]` (`{ id, start, end, xml }`), `elementBase64(elementXml)`, `envelopeKtdName(envelopeXml)`, `unknownKtdNodeError(ids, knownIds)`, `splitKtdMarkdownByElementId`, `rewriteKtdElementTexts`, exported `decodeKtdText`, `formatKtdUndocumentedIndex`, `rewriteKtdText`.

---

### Task 1: Metadata trailer marker and writer-side strip

**Files:**
- Modify: `src/adt/ddic-xml.ts` (add after `formatKtdUndocumentedIndex`, ~line 700; change first lines of `rewriteKtdText`, ~line 702)
- Test: `tests/unit/adt/ddic-xml.test.ts` (inside `describe('rewriteKtdText')`, before the XML-injection test)

- [ ] **Step 1: Write the failing tests**

Add `KTD_META_MARKER, stripKtdMetaTrailer` to the import list at the top of the test file (alphabetical: after `decodeKtdText,` add `KTD_META_MARKER,` is uppercase — Biome sorts case-insensitively, put it between `formatKtdUndocumentedIndex,` and `normalizeAdtResponsible,`; `stripKtdMetaTrailer,` goes after `rewriteKtdText,`). Then add:

```ts
      it('ignores a pasted-back SAPRead metadata trailer instead of folding it into the last node', () => {
        const envelope = buildMultiEnvelope({ [ROOT_ID]: 'root', [BAT_ID]: 'bat' });
        const pasted = `## ${ROOT_ID}\n\nnew root\n\n## ${BAT_ID}\n\nnew bat\n\n${KTD_META_MARKER}\nShort texts:\n  BDEF/BAT %_OWN: whatever\nUndocumented nodes: 3. …`;
        const rewritten = rewriteKtdText(envelope, pasted);
        expect(rewritten).toContain(`<sktd:text>${b64('new bat')}</sktd:text>`);
        expect(rewritten).not.toContain(b64('new bat\n\n' + KTD_META_MARKER));
        expect(decodeKtdText(rewritten)).toBe(`## ${ROOT_ID}\n\nnew root\n\n## ${BAT_ID}\n\nnew bat`);
      });

      it('stripKtdMetaTrailer cuts at the marker line and trims, leaving other text alone', () => {
        expect(stripKtdMetaTrailer(`body\n\n${KTD_META_MARKER}\nanything`)).toBe('body');
        expect(stripKtdMetaTrailer('body with no trailer')).toBe('body with no trailer');
        // Only a line that STARTS with the marker counts; the text inside a body may mention it.
        expect(stripKtdMetaTrailer(`see ${KTD_META_MARKER} inline`)).toBe(`see ${KTD_META_MARKER} inline`);
      });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/adt/ddic-xml.test.ts -t "metadata trailer"`
Expected: FAIL — `KTD_META_MARKER`/`stripKtdMetaTrailer` are not exported.

- [ ] **Step 3: Implement**

In `src/adt/ddic-xml.ts`, after `formatKtdUndocumentedIndex`:

```ts
/** Stable prefix of `KTD_META_MARKER`; the strip matches on this, never on the prose. */
const KTD_META_MARKER_PREFIX = '<!-- arc1:ktd-meta';

/**
 * First line of the read-only metadata trailer `SAPRead` appends to a KTD (short texts,
 * undocumented-node index). An HTML comment: invisible when the Markdown renders, and the
 * writer cuts everything from this line on, so a whole SAPRead result pasted back into
 * SAPWrite never folds the trailer into the last node's body. The prefix is a wire contract
 * with SAPRead output — do not reword it once released.
 */
export const KTD_META_MARKER = `${KTD_META_MARKER_PREFIX} — read-only context below; SAPWrite ignores it -->`;

/**
 * Drop a SAPRead metadata trailer: everything from the first LINE that starts with the
 * marker prefix on. Slices the original string, so a body without a trailer is returned
 * untouched and a body with one keeps its own line endings (byte-preserving).
 */
export function stripKtdMetaTrailer(markdown: string): string {
  const at = markdown.search(/^<!-- arc1:ktd-meta/m);
  return at < 0 ? markdown : markdown.slice(0, at).trimEnd();
}
```

(Review outcome folded in: matching on the stable prefix survives an LLM retyping the prose or
normalizing the em dash; slicing instead of split/join keeps CRLF bodies byte-identical. Also add
three tests: a trailer-only body hits the existing `/empty body/` refusal; a retyped prose tail
still strips; CRLF input stays CRLF and a body without a trailer is returned untouched.)

In `rewriteKtdText`, make the body trailer-free before anything else. Replace:

```ts
export function rewriteKtdText(envelopeXml: string, markdown: string): string {
  if (!markdown.trim()) {
```

with:

```ts
export function rewriteKtdText(envelopeXml: string, rawMarkdown: string): string {
  const markdown = stripKtdMetaTrailer(rawMarkdown);
  if (!markdown.trim()) {
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/adt/ddic-xml.test.ts`
Expected: all pass (the existing 111 plus 2).

- [ ] **Step 5: Commit**

```bash
git add src/adt/ddic-xml.ts tests/unit/adt/ddic-xml.test.ts
git commit -m "fix(write): ignore a pasted-back SAPRead metadata trailer in KTD bodies

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: SAPRead emits the trailer behind the marker

**Files:**
- Modify: `src/handlers/read.ts` (SKTD branch, ~line 545–560; import line 8)
- Test: `tests/unit/handlers/read.test.ts` (the test `appends a compact index of the undocumented nodes …`)

- [ ] **Step 1: Update the failing assertion**

In the test `appends a compact index of the undocumented nodes SAP pre-created, after the decoded Markdown`, add after `expect(text).toContain('Undocumented nodes: 2');`:

```ts
      expect(text).toContain('<!-- arc1:ktd-meta');
      expect(text).not.toContain('\n---\n');
      // The trailer starts on its own line right after the body.
      expect(text.indexOf('<!-- arc1:ktd-meta')).toBeGreaterThan(text.indexOf('Root docs.'));
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/handlers/read.test.ts -t "compact index"`
Expected: FAIL on `toContain('<!-- arc1:ktd-meta')`.

- [ ] **Step 3: Implement**

`src/handlers/read.ts` line 8:

```ts
import { decodeKtdText, formatKtdUndocumentedIndex, KTD_META_MARKER } from '../adt/ddic-xml.js';
```

SKTD branch — replace:

```ts
        const index = formatKtdUndocumentedIndex(source);
        const text = index ? (markdown ? `${markdown}\n\n---\n${index}` : index) : markdown;
        return cachedTextResult(text, cacheHit, revalidated, versionWarning);
```

with:

```ts
        // Read-only trailer behind a marker the writer strips (see KTD_META_MARKER):
        // the nodes SAP pre-created without text, which decodeKtdText hides.
        const trailer = [formatKtdUndocumentedIndex(source)].filter(Boolean).join('\n');
        const text = trailer ? `${markdown}${markdown ? '\n\n' : ''}${KTD_META_MARKER}\n${trailer}` : markdown;
        return cachedTextResult(text, cacheHit, revalidated, versionWarning);
```

(The array form is deliberate: Task 5 adds the short-text block as a second entry.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/handlers/read.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/read.ts tests/unit/handlers/read.test.ts
git commit -m "fix(read): put the KTD undocumented-node index behind a writer-ignored marker

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Shared node resolver (exact → case-insensitive → unique short name)

**Files:**
- Modify: `src/adt/ddic-xml.ts` (`splitKtdMarkdownByElementId`, ~line 804; add `resolveKtdNode` next to `unknownKtdNodeError`)
- Test: `tests/unit/adt/ddic-xml.test.ts`

Resolution result type and errors are shared with `shortTexts` in Task 6, so the resolver must not know about headings.

- [ ] **Step 1: Write the failing tests**

Import `resolveKtdNode` in the test file. Inside `describe('rewriteKtdText')` add:

```ts
      it('resolveKtdNode: exact id, case-insensitive id, unique short name (percent-decoded); unknown is undefined', () => {
        const envelope = buildMultiEnvelope({ [ROOT_ID]: 'r', [BAT_ID]: 'b', [BAF_ID]: 'f' });
        expect(resolveKtdNode(envelope, ROOT_ID)?.id).toBe(ROOT_ID);
        expect(resolveKtdNode(envelope, 'zi_traveltp')?.id).toBe(ROOT_ID);
        // BAT_ID carries `name=%25_OWN` on the wire: both the decoded and the encoded spelling resolve.
        expect(resolveKtdNode(envelope, '%_OWN')?.id).toBe(BAT_ID);
        expect(resolveKtdNode(envelope, '%25_OWN')?.id).toBe(BAT_ID);
        expect(resolveKtdNode(envelope, 'readtravelsummary')?.id).toBe(BAF_ID);
        expect(resolveKtdNode(envelope, 'ZI_TravelTP.ReadTravelSummary')?.id).toBe(BAF_ID);
        expect(resolveKtdNode(envelope, 'nope')).toBeUndefined();
        expect(resolveKtdNode(envelope, '   ')).toBeUndefined();
      });

      it('resolveKtdNode: a short name shared by several nodes is ambiguous, not a guess', () => {
        const base = '/sap/bc/adt/bo/behaviordefinitions/zi_traveltp/source/main';
        const envelope = buildMultiEnvelope({
          [`${base}#type=BDEF/BSO;name=ZI_TravelTP.update`]: 'a',
          [`${base}#type=BDEF/BSO;name=ZI_TravelBookingTP.update`]: 'b',
        });
        expect(() => resolveKtdNode(envelope, 'update')).toThrow(/ambiguous[\s\S]*ZI_TravelTP\.update[\s\S]*ZI_TravelBookingTP\.update/);
        expect(resolveKtdNode(envelope, 'ZI_TravelBookingTP.update')?.id).toBe(`${base}#type=BDEF/BSO;name=ZI_TravelBookingTP.update`);
      });

      it('headings accept a unique short name and still refuse an unknown ADT-shaped id', () => {
        const envelope = buildMultiEnvelope({ [ROOT_ID]: 'r', [BAT_ID]: 'b' });
        const rewritten = rewriteKtdText(envelope, '## %_OWN\n\nbat by short name');
        expect(rewritten).toContain(`<sktd:id>${BAT_ID}</sktd:id><sktd:text>${b64('bat by short name')}</sktd:text>`);
        expect(() => rewriteKtdText(envelope, `## ${BAF_ID}\n\nx`)).toThrow(/does not exist/);
        // Prose stays prose: no node is named like this, so it is body content of the root.
        const prose = rewriteKtdText(envelope, `## ${ROOT_ID}\n\n## /notes/package layout\n\ntext`);
        expect(decodeKtdText(prose)).toContain('## /notes/package layout');
      });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/adt/ddic-xml.test.ts -t "resolveKtdNode"`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement the resolver and use it for headings**

In `src/adt/ddic-xml.ts`, after `unknownKtdNodeError`:

```ts
/**
 * The `name=` part of a fragment id, percent-decoded (`%25_OWN` on the wire is the node
 * `%_OWN`), or the whole id for the root node. Falls back to the raw text when the
 * encoding is malformed. For BDEF nodes this is entity-qualified: `ZI_TravelTP.GetPhoto`.
 */
function ktdNodeQualifiedName(id: string): string {
  const at = id.indexOf(';name=');
  const raw = at < 0 ? id : id.slice(at + ';name='.length);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** The unqualified node name a caller types: the last dot-segment of the qualified name (`GetPhoto`, `finalize`, `%_OWN`). */
function ktdNodeShortName(id: string): string {
  const qualified = ktdNodeQualifiedName(id);
  return qualified.slice(qualified.lastIndexOf('.') + 1);
}
```

(Code review of 357b44c found that matching only "decoded short name OR raw full name" left two of
the four spellings of a qualified, percent-encoded name — `ZI_TravelTP.%_OWN` and `%25_OWN` —
unresolvable and silently treated as prose. The follow-up commit adds `ktdNodeRawName` as the single
owner of `;name=` parsing, splits `ktdNodeQualifiedName` from `ktdNodeShortName`, matches all four
spellings explicitly, moves the ambiguity throw into `ambiguousKtdNodeError(envelopeXml, ref,
candidates)` naming the document, and adds tests for the spelling grid, rule precedence and the
malformed-encoding fallback.)

```ts

/**
 * Resolve a node reference against the envelope: exact id, then case-insensitive id,
 * then a short name (`GetPhoto`, `finalize`, the root's own name) that exactly one node
 * carries. Returns undefined when nothing matches; throws when a short name is ambiguous
 * — never picks one of several candidates.
 */
export function resolveKtdNode(envelopeXml: string, ref: string): KtdElement | undefined {
  return resolveKtdNodeIn(findKtdElements(envelopeXml), ref);
}

function resolveKtdNodeIn(elements: KtdElement[], ref: string): KtdElement | undefined {
  const wanted = ref.trim();
  if (!wanted) return undefined;
  const exact = elements.find((element) => element.id === wanted);
  if (exact) return exact;
  const upper = wanted.toUpperCase();
  const byCase = elements.filter((element) => element.id.toUpperCase() === upper);
  if (byCase.length > 0) return byCase[0];
  // A caller may pass the name as SAP encodes it on the wire (`%25_OWN`) or decoded (`%_OWN`).
  const byName = elements.filter((element) => {
    if (!element.id) return false;
    const at = element.id.indexOf(';name=');
    const rawName = at < 0 ? element.id : element.id.slice(at + ';name='.length);
    return ktdNodeShortName(element.id).toUpperCase() === upper || rawName.toUpperCase() === upper;
  });
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new Error(
      `KTD node "${wanted}" is ambiguous — ${byName.length} nodes carry that name. Use the full id:\n` +
        byName.map((element) => `  ${element.id}`).join('\n'),
    );
  }
  return undefined;
}
```

Rewrite the heading loop in `splitKtdMarkdownByElementId` to use it. Replace the `knownIds` Map construction and the `lines.forEach` body:

```ts
function splitKtdMarkdownByElementId(markdown: string, elements: KtdElement[]): Map<string, string> | undefined {
  const knownIds = elements.map((element) => element.id).filter(Boolean);
  const lines = markdown.split(/\r?\n/);
  const headings: Array<{ line: number; id: string }> = [];
  const unknown: string[] = [];

  lines.forEach((line, index) => {
    const heading = line.match(/^##[ \t]+(.+?)[ \t]*$/);
    if (!heading) return;
    const id = heading[1];
    // Exact, case-insensitive, or unique short name — one resolver for headings and
    // shortTexts[].node. An ambiguous short name throws here with the candidates.
    const resolved = knownIds.length > 0 ? resolveKtdNodeIn(elements, id) : undefined;
    if (resolved) headings.push({ line: index, id: resolved.id });
    // Unmistakably an ADT node id, yet no element here carries it: a typo, or a node
    // that does not exist yet. Never silently fold it into a neighbouring node's text.
    // The test is deliberately narrow so ordinary prose headings stay prose.
    else if (knownIds.length > 0 && (id.startsWith('/sap/bc/adt/') || id.includes('#type='))) unknown.push(id);
  });

  if (unknown.length > 0) throw unknownKtdNodeError(unknown, knownIds);
  if (headings.length === 0) return undefined;
```

Keep the rest of the function (preamble check, duplicate check, bodies map) unchanged. Note `unknownKtdNodeError(unknown, knownIds)` now receives an array — its parameter is `Iterable<string>`, so no signature change.

- [ ] **Step 4: Run the whole file**

Run: `npx vitest run tests/unit/adt/ddic-xml.test.ts`
Expected: all pass, including the existing case-insensitivity and prose-heading tests.

- [ ] **Step 5: Commit**

```bash
git add src/adt/ddic-xml.ts tests/unit/adt/ddic-xml.test.ts
git commit -m "feat(write): resolve KTD node headings by unique short name

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Short-text read helpers (`elementShortText`, obligation, `formatKtdShortTexts`)

**Files:**
- Modify: `src/adt/ddic-xml.ts`
- Test: `tests/unit/adt/ddic-xml.test.ts` (inside `describe('live envelope shape …')`, which has `liveEnvelope`, `FINALIZE_ID`, `HTML_FN_ID`)

- [ ] **Step 1: Write the failing tests**

Import `formatKtdShortTexts`. Add:

```ts
      it('formatKtdShortTexts lists nodes that have a short text as "<TYPE> <name>: <text>"', () => {
        const block = formatKtdShortTexts(liveEnvelope);
        expect(block).toContain('Short texts (SAPWrite shortTexts=[{node,text}]; node = the name before " ["):');
        expect(block).toContain('  ZI_TRAVELTP.finalize [BDEF/BSO]: Saver: FINALIZE — last determinations before save');
        // The undocumented sibling has an empty short text and is not listed.
        expect(block).not.toContain('ReadTravelSummaryHTML');
      });

      it('formatKtdShortTexts is empty when no node has a short text', () => {
        const envelope =
          '<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" adtcore:name="ZX">' +
          '<sktd:element><sktd:id>ZX</sktd:id><sktd:text/><sktd:shortText sktd:text="" sktd:obligation="forbidden"/></sktd:element>' +
          '</sktd:docu>';
        expect(formatKtdShortTexts(envelope)).toBe('');
      });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/adt/ddic-xml.test.ts -t "formatKtdShortTexts"`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

After `elementBase64` in `src/adt/ddic-xml.ts`:

```ts
/** `sktd:text` attribute of the element's `<sktd:shortText>`: Base64 of the short text, '' when none. */
const SHORT_TEXT_ATTR = /<sktd:shortText\b[^>]*?\bsktd:text="([^"]*)"/; // lazy: reader and writer bind to the FIRST sktd:text

/** Decoded short text of an element, '' when empty or absent. */
function elementShortText(elementXml: string): string {
  const base64 = elementXml.match(SHORT_TEXT_ATTR)?.[1] ?? '';
  return base64 ? Buffer.from(base64, 'base64').toString('utf-8') : '';
}
```

(The `sktd:obligation` reader is defined in Task 6, its first user — `noUnusedLocals` rejects a
private function with no caller. This task also absorbs the Task 3 review Minors: the two
resolver docstrings, the symmetric four-spelling list, and a cross-spelling-collision test.)

```ts

/**
 * Trailer label for a node: the qualified, percent-decoded name first — the exact spelling
 * `resolveKtdNode` accepts, so it can be copied back as `shortTexts[].node` or a `## ` heading —
 * then the node type in brackets (`ZI_TRAVELTP.finalize [BDEF/BSO]`). The root node is its bare name.
 */
function ktdNodeLabel(id: string, rootName: string): string {
  const type = ktdNodeType(id);
  // Every line is bracketed, so the header's copy rule ("the name before ' ['") is total. `[root]`
  // is asserted only for the id that IS the document's own name; any other type-less id is `[node]`.
  if (type) return `${ktdNodeQualifiedName(id)} [${type}]`;
  return id.toUpperCase() === rootName.toUpperCase() ? `${id} [root]` : `${id} [node]`;
}

/** `BDEF/BSO` for a fragment id, '' for the root node. Shared by the label and the undocumented index. */
function ktdNodeType(id: string): string {
  const typeAt = id.indexOf('#type=');
  const nameAt = typeAt < 0 ? -1 : id.indexOf(';name=', typeAt);
  return typeAt < 0 || nameAt < 0 ? '' : id.slice(typeAt + '#type='.length, nameAt);
}

/** Last dot-segment of a (qualified) node name: `ZI_TravelTP.GetPhoto` → `GetPhoto`. Used by the resolver's spelling list. */
function lastNameSegment(name: string): string {
  return name.slice(name.lastIndexOf('.') + 1);
}
```

`ktdNodeQualifiedName` already exists after Task 3's review follow-up; reuse it, do not add another
name parser.

```ts

/**
 * Trailer block listing every node that carries a short text. Empty string when none does.
 * Read-only: short texts are written through SAPWrite's `shortTexts` parameter, never
 * through the Markdown body.
 */
export function formatKtdShortTexts(envelopeXml: string): string {
  const rootName = envelopeKtdName(envelopeXml);
  const lines = findKtdElements(envelopeXml)
    .filter((element) => element.id)
    .map((element) => ({
      label: ktdNodeLabel(element.id, rootName),
      // One line per node whatever SAP stored.
      text: elementShortText(element.xml).replace(/\s+/g, ' ').trim(),
    }))
    .filter((entry) => entry.text)
    .map((entry) => `  ${entry.label}: ${entry.text}`);
  if (lines.length === 0) return '';
  return ['Short texts (SAPWrite shortTexts=[{node,text}]; node = the name before " ["):', ...lines].join('\n');
}
```

`formatKtdUndocumentedIndex` keeps its base/type grouping but must spell names the same way:
use `ktdNodeType(id)` for the type and `ktdNodeQualifiedName(id)` (decoded) for the name instead of
its own raw slicing, so one trailer never shows `%_OWN` in one block and `%25_OTHER` in the other.
(Review outcome of commit 49fb70f: the first label format, `<TYPE> <name>`, did not resolve when
copied back and silently became prose as a heading; the fixed format is pinned by a round-trip test
that parses the rendered label and resolves it.)

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/adt/ddic-xml.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/adt/ddic-xml.ts tests/unit/adt/ddic-xml.test.ts
git commit -m "feat(read): format KTD node short texts for the metadata trailer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: SAPRead shows short texts in the trailer

**Files:**
- Modify: `src/handlers/read.ts` (SKTD branch; import line 8)
- Test: `tests/unit/handlers/read.test.ts`

- [ ] **Step 1: Write the failing test**

Next to the undocumented-index test:

```ts
    it('lists node short texts in the KTD metadata trailer, not in the body', async () => {
      mockFetch.mockReset();
      const shortText = Buffer.from('Finalize step', 'utf-8').toString('base64');
      const envelope =
        '<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" adtcore:name="ZBDEF">' +
        `<sktd:element><sktd:id>ZBDEF</sktd:id><sktd:text>${Buffer.from('Root docs.', 'utf-8').toString('base64')}</sktd:text><sktd:shortText sktd:text="" sktd:obligation="forbidden"/></sktd:element>` +
        `<sktd:element><sktd:id>/sap/bc/adt/bo/behaviordefinitions/zbdef/source/main#type=BDEF/BSO;name=ZBDEF.finalize</sktd:id><sktd:text>${Buffer.from('Saver docs.', 'utf-8').toString('base64')}</sktd:text><sktd:shortText sktd:text="${shortText}" sktd:obligation="optional"/></sktd:element>` +
        '</sktd:docu>';
      mockFetch.mockResolvedValueOnce(mockResponse(200, envelope, { 'x-csrf-token': 'T' }));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'SKTD', name: 'ZBDEF' });

      const text = result.content[0]?.text ?? '';
      const marker = text.indexOf('<!-- arc1:ktd-meta');
      expect(marker).toBeGreaterThan(0);
      expect(text.slice(0, marker)).not.toContain('Finalize step');
      expect(text.slice(marker)).toContain('  ZBDEF.finalize [BDEF/BSO]: Finalize step');
    });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/handlers/read.test.ts -t "short texts in the KTD metadata trailer"`
Expected: FAIL — no marker (no undocumented nodes here, so no trailer is emitted yet).

- [ ] **Step 3: Implement**

`src/handlers/read.ts` import:

```ts
import { decodeKtdText, formatKtdShortTexts, formatKtdUndocumentedIndex, KTD_META_MARKER } from '../adt/ddic-xml.js';
```

Trailer composition — this step also folds in the four Minor items from the Task 2 code review,
which all sit on these same lines. Replace the whole trailer block (comments included) with:

```ts
        // decodeKtdText hides the nodes SAP pre-created without text, and never shows short
        // texts. Both go into a read-only trailer behind a marker SAPWrite strips
        // (KTD_META_MARKER): an undocumented node can be addressed in a write without first
        // provoking the write's refusal to learn its id, and a pasted-back SAPRead result
        // never writes this trailer into a node's body.
        const trailer = [formatKtdShortTexts(source), formatKtdUndocumentedIndex(source)].filter(Boolean).join('\n\n');
        const text = [markdown, trailer && `${KTD_META_MARKER}\n${trailer}`].filter(Boolean).join('\n\n');
        return cachedTextResult(text, cacheHit, revalidated, versionWarning);
```

(Two labelled blocks read better with a blank line between them, hence `'\n\n'` between blocks; the
body/marker separator is the same `'\n\n'` as before. All four input combinations of empty/non-empty
`markdown`/`trailer` produce the same output as the previous nested ternary, except that the blank
line between blocks is new.)

Same commit, three Task 4 review Minors in `src/adt/ddic-xml.ts`: `ktdNodeLabel` renders the root as
`<id> [root]` so every line is bracketed; the header reads `node = the name before " ["` (the word
"brackets" was ambiguous next to `[{node,text}]`); `ktdNodeBase(id)` joins the name-helper family and
replaces the last inline `#type=` scan in `formatKtdUndocumentedIndex`. The label round-trip test
loops over every rendered line, including a bracket-less root carrying a short text.

Review of 25545de (folded into the same task as a follow-up commit): the undocumented-node index
header still told the reader to rebuild `<base>#type=<TYPE>;name=<NAME>` from a listed name, which
since Task 4 is percent-decoded — the rebuilt id does not exist and the write is refused, while the
short-texts block above teaches "use the name". Both blocks now teach one rule; the index header is
`Undocumented nodes: N. SAP pre-created them with empty text; document one by adding a "## <name>"
section using a name listed below.`, pinned by an index round-trip test (name from a rendered index
line → `## <name>` heading → `rewriteKtdText` writes that node). `[root]` is asserted only when the
id equals `envelopeKtdName`; other type-less ids render `[node]`. A read-level test covers the
short-texts-only trailer (no index block, no trailing blank line).

Test adjustments in `tests/unit/handlers/read.test.ts`, same step: in the undocumented-index test
replace the ordering assertion (`text.indexOf(...) > text.indexOf(...)`) and its comment with the
exact layout the LLM sees:

```ts
      expect(text).toContain(`Root docs.\n\n${KTD_META_MARKER}\nUndocumented nodes: 2`);
```

(import `KTD_META_MARKER` alongside `stripKtdMetaTrailer` in the test's dynamic import). And add a
read-level test for a fully undocumented KTD, the branch whose behaviour Task 2 changed:

```ts
    it('a KTD with nothing documented reads as marker-first trailer only, which the writer reduces to an empty body', async () => {
      mockFetch.mockReset();
      const envelope =
        '<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" adtcore:name="ZBDEF">' +
        '<sktd:element><sktd:id>ZBDEF</sktd:id><sktd:text/><sktd:shortText sktd:text="" sktd:obligation="forbidden"/></sktd:element>' +
        '<sktd:element><sktd:id>/sap/bc/adt/bo/behaviordefinitions/zbdef/source/main#type=BDEF/BAF;name=ZBDEF.GetPhoto</sktd:id><sktd:text/><sktd:shortText sktd:text="" sktd:obligation="optional"/></sktd:element>' +
        '</sktd:docu>';
      mockFetch.mockResolvedValueOnce(mockResponse(200, envelope, { 'x-csrf-token': 'T' }));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'SKTD', name: 'ZBDEF' });

      const text = result.content[0]?.text ?? '';
      expect(text.startsWith(KTD_META_MARKER)).toBe(true);
      expect(text).toContain('Undocumented nodes: 2');
      expect(stripKtdMetaTrailer(text)).toBe('');
    });
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/handlers/read.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/read.ts tests/unit/handlers/read.test.ts
git commit -m "feat(read): show KTD node short texts in the SAPRead metadata trailer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Short-text write splice and `rewriteKtdDocument`

**Files:**
- Modify: `src/adt/ddic-xml.ts`
- Test: `tests/unit/adt/ddic-xml.test.ts`

`rewriteKtdDocument(envelopeXml, markdown | undefined, shortTexts | undefined)` is the single entry point the handlers will call. `rewriteKtdText` stays exported (body only) so its 30 existing tests keep meaning; `rewriteKtdDocument` delegates to it.

- [ ] **Step 1: Write the failing tests**

Import `rewriteKtdDocument` and the type `KtdShortText`. Inside `describe('live envelope shape …')`:

```ts
      it('rewriteKtdDocument sets a short text on an optional node and re-encodes it as Base64', () => {
        const out = rewriteKtdDocument(liveEnvelope, undefined, [{ node: 'ReadTravelSummaryHTML', text: 'HTML report of the summary' }]);
        const b64 = Buffer.from('HTML report of the summary', 'utf-8').toString('base64');
        expect(out).toContain(`<sktd:shortText sktd:text="${b64}" sktd:obligation="optional"/>`);
        // Body untouched, sibling untouched.
        expect(out).toContain('<sktd:text/>');
        expect(out).toContain('U2F2ZXI6IEZJTkFMSVpFIOKAlCBsYXN0IGRldGVybWluYXRpb25zIGJlZm9yZSBzYXZl');
      });

      it('rewriteKtdDocument applies bodies and short texts in one pass', () => {
        const out = rewriteKtdDocument(liveEnvelope, `## ${HTML_FN_ID}\n\nRenders the summary as HTML.`, [
          { node: HTML_FN_ID, text: 'HTML summary' },
        ]);
        expect(out).toContain(`<sktd:text>${Buffer.from('Renders the summary as HTML.', 'utf-8').toString('base64')}</sktd:text>`);
        expect(out).toContain(`sktd:text="${Buffer.from('HTML summary', 'utf-8').toString('base64')}" sktd:obligation="optional"`);
      });

      it('rewriteKtdDocument clears a short text with an empty string', () => {
        const out = rewriteKtdDocument(liveEnvelope, undefined, [{ node: 'finalize', text: '' }]);
        expect(out).toContain('<sktd:shortText sktd:text="" sktd:obligation="optional"/>');
        expect(out).not.toContain('U2F2ZXI6IEZJTkFMSVpFIOKAlCBsYXN0IGRldGVybWluYXRpb25zIGJlZm9yZSBzYXZl');
      });

      it('rewriteKtdDocument refuses a short text on a node whose obligation is forbidden', () => {
        const envelope =
          '<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" adtcore:name="ZX">' +
          '<sktd:element><sktd:id>ZX</sktd:id><sktd:text/><sktd:shortText sktd:text="" sktd:obligation="forbidden"/></sktd:element>' +
          '</sktd:docu>';
        expect(() => rewriteKtdDocument(envelope, undefined, [{ node: 'ZX', text: 'nope' }])).toThrow(/does not take a short text/);
      });

      it('rewriteKtdDocument refuses more than 60 characters, an unknown node, a duplicate node, and an empty call', () => {
        const long = 'x'.repeat(61);
        expect(() => rewriteKtdDocument(liveEnvelope, undefined, [{ node: 'finalize', text: long }])).toThrow(/61 characters[\s\S]*60/);
        expect(() => rewriteKtdDocument(liveEnvelope, undefined, [{ node: 'nope', text: 'x' }])).toThrow(/does not exist/);
        expect(() =>
          rewriteKtdDocument(liveEnvelope, undefined, [
            { node: 'finalize', text: 'a' },
            { node: FINALIZE_ID, text: 'b' },
          ]),
        ).toThrow(/twice/);
        expect(() => rewriteKtdDocument(liveEnvelope, undefined, undefined)).toThrow(/nothing to write/i);
        // An explicit empty body is the erase hazard, refused even when short texts are present.
        expect(() => rewriteKtdDocument(liveEnvelope, '', [])).toThrow(/empty body/);
        expect(() => rewriteKtdDocument(liveEnvelope, '', [{ node: 'finalize', text: 'x' }])).toThrow(/empty body/);
        expect(() => rewriteKtdDocument(liveEnvelope, '   ', [{ node: 'finalize', text: 'x' }])).toThrow(/empty body/);
      });

      it('rewriteKtdDocument refuses a node whose element has no <sktd:shortText>', () => {
        const envelope =
          '<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" adtcore:name="ZX">' +
          '<sktd:element><sktd:id>ZX</sktd:id><sktd:text/></sktd:element>' +
          '</sktd:docu>';
        expect(() => rewriteKtdDocument(envelope, undefined, [{ node: 'ZX', text: 'x' }])).toThrow(/no <sktd:shortText>/);
      });

      it('rewriteKtdDocument validates every assignment before changing a byte (an invalid second entry leaves the first unwritten)', () => {
        expect(() =>
          rewriteKtdDocument(liveEnvelope, undefined, [
            { node: 'ReadTravelSummaryHTML', text: 'ok' },
            { node: 'nope', text: 'x' },
          ]),
        ).toThrow(/does not exist/);
      });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/adt/ddic-xml.test.ts -t "rewriteKtdDocument"`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

In `src/adt/ddic-xml.ts`, after `rewriteKtdText`:

```ts
/** `sktd:obligation` attribute of the element's `<sktd:shortText>`. */
const SHORT_TEXT_OBLIGATION_ATTR = /<sktd:shortText\b[^>]*?\bsktd:obligation="([^"]*)"/; // lazy, like SHORT_TEXT_ATTR

/** `sktd:obligation` of the element's short text: 'optional' | 'forbidden' | 'mandatory' | ''. */
function elementShortTextObligation(elementXml: string): string {
  return elementXml.match(SHORT_TEXT_OBLIGATION_ATTR)?.[1] ?? '';
}

/** One short-text assignment: `node` is any reference `resolveKtdNode` accepts. */
export interface KtdShortText {
  node: string;
  text: string;
}

/** Stated by the document's own `<sktd:instruction sktd:instructionId="shorttext">`. */
export const KTD_SHORT_TEXT_MAX_LENGTH = 60;

/**
 * Apply a Markdown body (optional) and per-node short texts (optional) to a KTD
 * envelope in one pass — the single entry point for SAPWrite. Everything is validated
 * before any byte changes, so a refusal never leaves a half-applied document.
 */
export function rewriteKtdDocument(envelopeXml: string, markdown: string | undefined, shortTexts: KtdShortText[] | undefined): string {
  // "Not supplied" and "supplied empty" are different requests: an explicit empty body is the
  // erase-everything hazard rewriteKtdText already refuses (same message, shared constant), even
  // when shortTexts is present; "nothing to write" is only for the both-absent call.
  const body = markdown === undefined ? undefined : stripKtdMetaTrailer(markdown);
  const assignments = shortTexts ?? [];
  if (body !== undefined && !body.trim()) throw new Error(KTD_EMPTY_BODY_MESSAGE);
  if (body === undefined && assignments.length === 0) {
    throw new Error('KTD documentation update has nothing to write: pass "source" (node bodies), "shortTexts", or both.');
  }
  let rewritten = body === undefined ? envelopeXml : rewriteKtdText(envelopeXml, body);
  if (assignments.length > 0) rewritten = applyKtdShortTexts(rewritten, assignments);
  return rewritten;
}

/** Validate every assignment against the envelope, then splice them back to front. */
function applyKtdShortTexts(envelopeXml: string, assignments: KtdShortText[]): string {
  const elements = findKtdElements(envelopeXml);
  const knownIds = elements.map((element) => element.id).filter(Boolean);
  const resolved = new Map<string, { element: KtdElement; text: string }>();
  for (const { node, text } of assignments) {
    const element = resolveKtdNodeIn(envelopeXml, elements, node);
    if (!element) throw unknownKtdNodeError([node], knownIds);
    if (resolved.has(element.id)) {
      throw new Error(`KTD node "${element.id}" appears twice in shortTexts — keep one entry per node.`);
    }
    // Normalised the way the reader displays it, so stored and shown values agree; a short text
    // is single-line by nature.
    const trimmed = text.replace(/\s+/g, ' ').trim();
    // UTF-16 code units, which is how an ABAP CHAR60 field counts.
    if (trimmed.length > KTD_SHORT_TEXT_MAX_LENGTH) {
      throw new Error(
        `Short text for KTD node "${element.id}" is ${trimmed.length} characters (UTF-16 units, as ABAP counts them); SAP allows ${KTD_SHORT_TEXT_MAX_LENGTH}.`,
      );
    }
    if (!SHORT_TEXT_ATTR.test(element.xml)) {
      throw new Error(`KTD node "${element.id}" has no <sktd:shortText> element to write into; ARC-1 does not synthesize one.`);
    }
    if (elementShortTextObligation(element.xml) === 'forbidden') {
      throw new Error(
        `KTD node "${element.id}" does not take a short text (sktd:obligation="forbidden" — the object root and entity nodes describe themselves).`,
      );
    }
    resolved.set(element.id, { element, text: trimmed });
  }

  let rewritten = envelopeXml;
  for (const element of [...elements].reverse()) {
    const hit = resolved.get(element.id);
    if (!hit) continue;
    rewritten = rewritten.slice(0, element.start) + setKtdElementShortText(element.xml, hit.text) + rewritten.slice(element.end);
  }
  return rewritten;
}

/** Replace `sktd:shortText/@sktd:text` inside one element block with base64(text). */
function setKtdElementShortText(elementXml: string, text: string): string {
  const base64 = text ? Buffer.from(text, 'utf-8').toString('base64') : '';
  return elementXml.replace(SHORT_TEXT_ATTR, (match) => match.replace(/sktd:text="[^"]*"/, `sktd:text="${base64}"`));
}
```

Task 8 may extend `setKtdElementShortText` to also set `adtcore:objectReference/@adtcore:description`, depending on the live experiment. Do not add it now.

Same commit, two Task 5 review Minors: `envelopeKtdName` returns the prose fallback `'this KTD'` for
messages, so `formatKtdShortTexts` must not compare ids against it — add `envelopeKtdObjectName`
(the `adtcore:name` or `''`), make `envelopeKtdName` delegate to it, and use the object name for the
`[root]` comparison (a nameless envelope labels type-less ids `[node]` deliberately; one test). The
index header ends `using one of the node names listed below (the base and root lines are context, not
names).` so a model does not grab the `base:` line.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/adt/ddic-xml.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/adt/ddic-xml.ts tests/unit/adt/ddic-xml.test.ts
git commit -m "feat(write): apply per-node KTD short texts in the envelope rewrite

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Schema + tool definition + handlers

**Files:**
- Modify: `src/handlers/schemas.ts` (both SAPWrite schemas at ~line 624 and ~line 720; `validateSapWriteInput` at ~line 368)
- Modify: `src/handlers/tools.ts` (SAPWrite properties, after `refObjectDescription` at ~line 848)
- Modify: `src/handlers/write/update-delete.ts` (SKTD branch), `src/handlers/write/create.ts` (SKTD `if (source)` block)
- Test: `tests/unit/handlers/write-ddic.test.ts`, `tests/unit/handlers/tool-definitions-snapshot.test.ts` (fixtures)

- [ ] **Step 1: Write the failing handler tests**

In `tests/unit/handlers/write-ddic.test.ts`, after the test `refuses an unaddressed body on a multi-node KTD …` (it can reuse `recordKtdCalls`/`twoNodeEnvelope`; extend the envelope builder first):

Replace `twoNodeEnvelope`'s two element lines with:

```ts
      `<sktd:element><sktd:id>${KTD_ROOT_ID}</sktd:id><sktd:text>${ktdB64(rootText)}</sktd:text><sktd:shortText sktd:text="" sktd:obligation="forbidden"/></sktd:element>` +
      `<sktd:element><sktd:id>${KTD_FIELD_ID}</sktd:id><sktd:text>${ktdB64(fieldText)}</sktd:text><sktd:shortText sktd:text="" sktd:obligation="optional"/></sktd:element>` +
```

Then add:

```ts
    it('writes a short text alone (no source) through shortTexts, resolving the node by short name', async () => {
      const calls = recordKtdCalls(twoNodeEnvelope('root', 'field'));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'SKTD',
        name: KTD_ROOT_ID,
        shortTexts: [{ node: 'PaymentValueDate', text: 'Value date of the payment' }],
      });

      expect(result.isError).toBeUndefined();
      const putCall = calls.find((c) => c.method === 'PUT');
      expect(putCall?.body).toContain(`<sktd:shortText sktd:text="${ktdB64('Value date of the payment')}" sktd:obligation="optional"/>`);
      // Bodies untouched.
      expect(putCall?.body).toContain(`<sktd:text>${ktdB64('root')}</sktd:text>`);
      expect(putCall?.body).toContain(`<sktd:text>${ktdB64('field')}</sktd:text>`);
    });

    it('refuses a short text on the root (obligation forbidden) before taking a lock', async () => {
      const calls = recordKtdCalls(twoNodeEnvelope('root', 'field'));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'SKTD',
        name: KTD_ROOT_ID,
        shortTexts: [{ node: KTD_ROOT_ID, text: 'nope' }],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('does not take a short text');
      expect(calls.some((c) => c.url.includes('_action=LOCK'))).toBe(false);
    });

    it('an explicit empty source is refused even when shortTexts is present', async () => {
      const calls = recordKtdCalls(twoNodeEnvelope('root', 'field'));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'SKTD',
        name: KTD_ROOT_ID,
        source: '',
        shortTexts: [{ node: 'PaymentValueDate', text: 'x' }],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('empty body');
      expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    });

    // Follow-up commit after the Task 7 code review adds three more handler tests: clearing a
    // short text (`text: ""`) survives the MCP-argument normaliser and reaches SAP as
    // `sktd:text=""`; the adapted empty-source test also asserts the mechanism it describes
    // (`stripLlmEmptyValues({ source: '' }).source` is undefined); and a create whose POST
    // succeeded but whose shortTexts were refused reports "Created SKTD …", the refusal, and a
    // retry hint naming `shortTexts=[…]` but not `source=…`, with no PUT.

    it('rejects shortTexts on a non-KTD type at the schema', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'CLAS',
        name: 'ZCL_X',
        source: 'CLASS zcl_x DEFINITION PUBLIC. ENDCLASS. CLASS zcl_x IMPLEMENTATION. ENDCLASS.',
        shortTexts: [{ node: 'x', text: 'y' }],
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('shortTexts');
      expect(result.content[0]?.text).toContain('SKTD');
    });

    it('SKTD create accepts shortTexts without source', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      const created =
        '<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" adtcore:name="ZTR_C_PAYMENT_VALUE_DATE">' +
        `<sktd:element><sktd:id>${KTD_FIELD_ID}</sktd:id><sktd:text/><sktd:shortText sktd:text="" sktd:obligation="optional"/></sktd:element>` +
        '</sktd:docu>';
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string | Buffer }) => {
        const method = opts?.method ?? 'GET';
        calls.push({ method, url: String(url), body: opts?.body ? String(opts.body) : undefined });
        if (method === 'POST' && String(url).includes('_action=LOCK')) {
          return Promise.resolve(mockResponse(200, KTD_LOCK_BODY, { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && String(url).includes('/documentation/ktd/documents/')) {
          return Promise.resolve(mockResponse(200, created, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(201, '<sktd:docu/>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'SKTD',
        name: 'ZTR_C_PAYMENT_VALUE_DATE',
        package: '$TMP',
        refObjectType: 'DDLS/DF',
        shortTexts: [{ node: 'PaymentValueDate', text: 'Value date' }],
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Created SKTD ZTR_C_PAYMENT_VALUE_DATE');
      const putCall = calls.find((c) => c.method === 'PUT');
      expect(putCall?.body).toContain(`sktd:text="${ktdB64('Value date')}"`);
    });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/handlers/write-ddic.test.ts -t "short text|shortTexts"`
Expected: FAIL — the schema strips/rejects `shortTexts`, or the handler ignores it.

- [ ] **Step 3: Zod schema**

`src/handlers/schemas.ts`. Near `fmParameterSchema` add:

```ts
// KTD (SKTD) per-node short text. `node` is the full node id or a unique short name.
const ktdShortTextSchema = z.object({
  node: z.string().min(1),
  text: z.string(),
});
```

In BOTH SAPWrite object schemas (the on-prem one and the BTP one), right after `refObjectDescription: z.string().optional(),` add:

```ts
    shortTexts: z.array(ktdShortTextSchema).optional(),
```

Extend `validateSapWriteInput`'s input type with `shortTexts?: unknown[];` and add before `validateFunctionProcessingInput(input, ctx);`:

```ts
  if (input.shortTexts !== undefined && input.shortTexts.length > 0) {
    // `type` is a Zod enum member here (like the `include` guard above), so no case folding.
    const type = input.type ?? '';
    if (type !== 'SKTD' && type !== 'KTD') {
      ctx.addIssue({
        code: 'custom',
        path: ['shortTexts'],
        message: 'shortTexts is only supported for type="SKTD" (alias "KTD"): per-node short texts of a Knowledge Transfer Document.',
      });
    }
    if (input.action !== 'update' && input.action !== 'create') {
      ctx.addIssue({
        code: 'custom',
        path: ['shortTexts'],
        message: 'shortTexts is only supported with action="update" or action="create".',
      });
    }
  }
```

- [ ] **Step 4: JSON Schema (tools.ts)**

After the `refObjectDescription` property in the SAPWrite definition:

```ts
          shortTexts: {
            type: 'array',
            description:
              'SKTD/KTD update/create: per-node short texts (max 60 chars; "" clears). node = full node id, or the name SAPRead\'s trailer lists before " [" (e.g. "GetPhoto"). Works without "source".',
            items: {
              type: 'object',
              properties: {
                node: { type: 'string' },
                text: { type: 'string' },
              },
              required: ['node', 'text'],
            },
          },
```

- [ ] **Step 5: Handlers**

`src/handlers/write/update-delete.ts`: import `rewriteKtdDocument, type KtdShortText` instead of `rewriteKtdText`; in the SKTD branch replace `const body = rewriteKtdText(currentEnvelope, source);` with:

```ts
    const body = rewriteKtdDocument(
      currentEnvelope,
      hasSource ? source : undefined,
      args.shortTexts as KtdShortText[] | undefined,
    );
```

`src/handlers/write/create.ts`: import `rewriteKtdDocument, type KtdShortText` (keep `normalizeAdtLanguage`). Replace `if (source) {` with:

```ts
    const shortTexts = args.shortTexts as KtdShortText[] | undefined;
    if (hasSource || shortTexts?.length) {
```

(`hasSource` comes from `ctx`, exactly as in `update` — both call sites read the same way and neither
depends on `||` truthiness) and `body = rewriteKtdText(currentEnvelope, source);` with:

```ts
        body = rewriteKtdDocument(currentEnvelope, hasSource ? source : undefined, shortTexts);
```

The partial-failure hint after a successful POST must name what the caller actually sent: `source=…`
only when `hasSource`, `shortTexts=[…]` only when `shortTexts?.length`, comma-joined — a caller who
sent only short texts must not be pointed at `source`.

(On create an empty `source` means "no body" — the KTD is brand new, so there is nothing to erase;
on update the handler passes `hasSource ? source : undefined`. Note from implementation: at the MCP
boundary `stripLlmEmptyValues` (issue #360) removes empty strings for every tool before Zod, so an
explicit `source: ""` never reaches the handler — `hasSource` is already false. The empty-body
refusal therefore protects library/CLI callers of `rewriteKtdDocument`; through MCP, `source: ""`
with `shortTexts` proceeds as a short-texts-only write, and `source: ""` alone hits "nothing to
write". Adding `source` to the normaliser's meaningful-empty list would be a global change across
all tools and was deliberately not made. The handler test for this case asserts the pipeline
behaviour and points at the library-level contract test.)

Adjust the success text to `Created SKTD ${name} in package ${pkg} and wrote its documentation.` and the partial-failure text to `…but the documentation was NOT written: …`.

- [ ] **Step 6: Regenerate the tool-definition snapshot and check the budget**

Run: `npx vitest run tests/unit/handlers/tool-definitions-snapshot.test.ts -u`
Then: `git diff --stat tests/fixtures/tool-definitions/` — exactly the 7 non-hyperfocused fixtures change, each adding the `shortTexts` property to SAPWrite and nothing else. Read one diff fully (`git diff tests/fixtures/tool-definitions/onprem-full-textsearch-on.json`).
Run: `npx tsx scripts/ci/check-tool-schema-budget.ts` → `✓ tool schema budget: all scenarios within budget.`
Headroom is tight, so keep the description exactly as written above: `standard-full-git` total is 70,449 of a 72,000-byte wall and SAPWrite is 21,397 of a 23,000-byte per-tool wall (`WRITE_WIRE_WALL`, `PER_TOOL_WIRE_WALL` in `scripts/ci/check-tool-schema-budget.ts`); the property adds roughly 400 bytes. If the check fails, shorten the `shortTexts` description rather than raising a wall.

- [ ] **Step 7: Run the gate**

```bash
npx biome check --write src/handlers/schemas.ts src/handlers/tools.ts src/handlers/write/update-delete.ts src/handlers/write/create.ts tests/unit/handlers/write-ddic.test.ts
npm run typecheck
npx vitest run tests/unit/adt/ddic-xml.test.ts tests/unit/handlers/read.test.ts tests/unit/handlers/write-ddic.test.ts tests/unit/handlers/tool-definitions-snapshot.test.ts tests/unit/handlers/schemas.test.ts tests/unit/handlers/tools.test.ts
npm run check:sizes
npm run validate:policy
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/handlers/schemas.ts src/handlers/tools.ts src/handlers/write/update-delete.ts src/handlers/write/create.ts tests/unit/handlers/write-ddic.test.ts tests/fixtures/tool-definitions/
git commit -m "feat(write): shortTexts parameter for per-node KTD short texts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Live experiment — which attribute is the source of truth

**Files:**
- Possibly modify: `src/adt/ddic-xml.ts` (`setKtdElementShortText`), `tests/unit/adt/ddic-xml.test.ts`
- Modify: `docs/research/2026-09-02-sktd-multi-node-write.md`

Requires the local MCP server (`abap-trial-local-arc1`) rebuilt from this branch and restarted: `npm run build`, then restart Claude Desktop.

- [ ] **Step 1: Set a short text on the `$TMP` test bed**

Call `SAPWrite(action="update", type="SKTD", name="ZARC1_KTD_ROOT", shortTexts=[{node:"create", text:"Creates one row"}])` — `create` is unique in that 5-node KTD. Expected: success, no lock refused.

- [ ] **Step 2: Read the raw envelope back**

`SAPRead(type="SKTD", name="ZARC1_KTD_ROOT", version="inactive")` — the trailer must show `BDEF/BSO ZARC1_KTD_ROOT.create: Creates one row`. Then obtain the raw XML (the user runs the same `curl` as on 2026-09-02, against the trial host) and inspect the `create` element:
- `sktd:shortText/@sktd:text` = base64("Creates one row") — expected.
- `adtcore:objectReference/@adtcore:description`: **followed** (SAP derives it) or **unchanged**?

- [ ] **Step 2b: Confirm the length unit.** The error message claims SAP counts UTF-16 units ("as ABAP counts them"). Send a short text of 30 emoji (60 UTF-16 units, 30 code points) to the `create` node: accepted by ARC-1; if SAP also accepts it, then 31 emoji (62 units) must be refused by ARC-1 before any lock. If SAP itself rejects the 30-emoji value, or accepts a 31-emoji value sent by other means (e.g. Eclipse), soften the wording in `applyKtdShortTexts` to "characters (UTF-16 units)" without the ABAP attribution and record the observation `[E]`.

- [x] **Step 3a: If `description` followed** — no code change. Record in the research note (Task 9) with `[E]`.
  **Outcome 2026-09-03 `[E]`:** it followed. ARC-1 wrote only `sktd:shortText/@sktd:text`; the raw
  envelope read back showed `adtcore:objectReference/@adtcore:description="Creates one row"` set by
  SAP, and removed again after clearing the short text. Step 3b is not needed. Also verified live:
  30 emoji (60 UTF-16 units) accepted by SAP, 31 emoji refused by ARC-1 before any lock; `""` clears;
  a whole SAPRead output pasted back is a no-op; bodies byte-identical throughout.

- [ ] **Step 3b: If `description` did NOT follow** — extend `setKtdElementShortText` to keep both consistent:

```ts
function setKtdElementShortText(elementXml: string, text: string): string {
  const base64 = text ? Buffer.from(text, 'utf-8').toString('base64') : '';
  const withShortText = elementXml.replace(SHORT_TEXT_ATTR, (match) => match.replace(/sktd:text="[^"]*"/, `sktd:text="${base64}"`));
  // SAP mirrors the short text into the objectReference description; keep them equal.
  const reference = /<adtcore:objectReference\b[^>]*\/>/;
  return withShortText.replace(reference, (tag) => {
    const stripped = tag.replace(/\s+adtcore:description="[^"]*"/, '');
    return text ? stripped.replace(/\/>$/, ` adtcore:description="${escapeXmlAttr(text)}"/>`) : stripped;
  });
}
```

and add a unit test asserting `adtcore:description="HTML summary"` appears in the `ReadTravelSummaryHTML` element after `rewriteKtdDocument(liveEnvelope, undefined, [{ node: 'ReadTravelSummaryHTML', text: 'HTML summary' }])`, and is removed on clearing. Re-run Step 1–2 to confirm SAP accepts the PUT. Commit: `fix(write): mirror KTD short text into the objectReference description`.

- [ ] **Step 4: Live on the 17-node trial KTD**

`SAPWrite(action="update", type="SKTD", name="ZI_TRAVELTP-equivalent-on-your-system", transport=<open request>, shortTexts=[{node:"GetPhoto", text:"…"},{node:"SetPhoto", text:"…"},{node:"DeletePhoto", text:"…"}])` — three nodes in one call, then `SAPRead` shows all three in the trailer and every body unchanged; `SAPActivate`. (Use the real object name on the trial system; do not put it in code or docs.)

---

### Task 9: Documentation

(Executed as 9a — everything below except the live-verification outcome — while Task 8 waited for
the MCP server restart; the research note's §8 ends with an explicit "pending live verification"
line that Task 8 replaces with the `[E]` result.)

**Files:**
- Modify: `docs_page/tools.md` (SKTD row line 88; SAPWrite parameter table after `refObjectDescription`, ~line 335)
- Modify: `AGENTS.md` (SKTD/KTD row, line 195)
- Modify: `docs/research/2026-09-02-sktd-multi-node-write.md` (append §8)

- [ ] **Step 1: tools.md SAPRead row** — append to the `SKTD` / `KTD` row: `The response ends with a read-only metadata trailer (an HTML-comment marker line) listing each node's short text and the nodes SAP pre-created without documentation; SAPWrite ignores the trailer, so a whole read can be pasted back safely.`

- [ ] **Step 2: tools.md SAPWrite table** — add after the `refObjectDescription` row:

```
| `shortTexts` | array | No | SKTD/KTD update/create: `[{node, text}]` per-node short texts (max 60 chars; `""` clears). `node` is the full node id or a unique node name (`GetPhoto`, `finalize`). Root and entity nodes do not take one (`obligation="forbidden"`). May be used without `source`. |
```

- [ ] **Step 3: AGENTS.md** — append to the SKTD/KTD row: `Short texts: SAPWrite shortTexts=[{node,text}] (60 chars, forbidden on root/BAE, resolver exact→case→unique short name shared with headings); SAPRead lists them in a trailer behind KTD_META_MARKER that rewriteKtdText strips.`

- [ ] **Step 4: Research note §8** — `## 8. Short texts (follow-up, implemented)`: the wire facts (§2 of the spec), the `[E]` outcome of Task 8, and the trailer decision. In the same file, refresh the sample index block in §6 so it shows the marker line first (`<!-- arc1:ktd-meta … -->`), the blank line between the short-text block and the index, decoded node names, and the index header's rule (`"## <name>" section using a name listed below`) — it currently reproduces the pre-marker output and would otherwise read as the live contract.

- [ ] **Step 5: Gate and commit**

```bash
npm run check:sizes
git add docs_page/tools.md AGENTS.md docs/research/2026-09-02-sktd-multi-node-write.md
git commit -m "docs: KTD short texts — tools reference, agent routing, research addendum

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Final gate and PR

- [ ] **Step 1:** `npm test` — only the 9 pre-existing environment failures. `npm run typecheck`, `npx biome check src tests`, `npm run check:sizes`, `npm run validate:policy`, `npm run build`.
- [x] **Step 2:** grep the branch diff for the client namespace and object names used during live verification (the same census run before PR #2) → no output; client identifiers never enter the repo. Done 2026-09-03: only the repo's pre-existing generic transport-id examples matched.
- [ ] **Step 3:** Once PR #2 is merged: `git rebase main`, re-run Step 1, `git push -u origin feat/ktd-short-text`, `gh pr create --base main --title "feat(write): per-node short texts for Knowledge Transfer Documents" --body-file <body>` ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Self-review (done while writing)

- **Spec coverage:** §3.1 → Tasks 6–7; §3.2 → Tasks 2, 4, 5; §3.3 → Task 1; §4 → Task 3; §5 → Task 6 (all seven refusals have a test); §6 → Tasks 6–7; §7 → Task 7 step 6; §8 → Tasks 1–7 tests + Task 8 live; §9 → Task 9; §2 open point → Task 8.
- **Type consistency:** `KtdElement { id, start, end, xml }`; `resolveKtdNodeIn(elements, ref)` / `resolveKtdNode(envelopeXml, ref)`; `KtdShortText { node, text }`; `rewriteKtdDocument(envelopeXml, markdown | undefined, shortTexts | undefined)`; `KTD_META_MARKER`, `stripKtdMetaTrailer`, `formatKtdShortTexts`, `KTD_SHORT_TEXT_MAX_LENGTH` — used with these exact names throughout.
- **No placeholders:** every code step shows the code; the only conditional step (Task 8 3a/3b) shows both branches.

## Final whole-feature review outcome (2026-09-03)

Verdict: ready for PR once the paste-back no-op was pinned in CI. Applied in 7cda4a9: two
round-trip tests (byte-identical on a compact envelope with both trailer blocks; decoded-equal on
the live capture, whose 76-column Base64 wrapping rules out a byte comparison), move-only grouping
of the short-text primitives in `ddic-xml.ts`, docstrings marking `rewriteKtdText` and
`resolveKtdNode` as steps behind the entry points, spec §4 caught up with the four-spelling resolver,
AGENTS.md row wording. Deferred as a follow-up, not for this PR: extracting the KTD section
(~500 of 1,137 lines) into `src/adt/ktd-xml.ts` as a move-only refactor with its tests.

PR step: waits on PR #2 (`fix/sktd-multi-node-write`), which this branch is stacked on.

## Release review outcome (2026-09-03, 7 lenses → 48 unique findings → 22 confirmed by refuters)

Applied on the branch (see the two commits after 8dcb1bd):

- Correctness: trailer names are guaranteed to round-trip (`addressableKtdName` — a BDEF's root
  entity node is named like the object, and that name resolves to the root, so the entity is listed
  by full id); a `## ` section pasted below the SAPRead trailer is refused instead of silently
  dropped; `## ` headings resolve qualified names only (bare `## Update` stays prose — every BDEF has
  `<Entity>.update`), while `shortTexts[].node` keeps all four spellings; a typo in a qualified
  heading (`ZI_TravelTP.GetPhotos`) is refused instead of folded into the previous node; the heading
  regex was quadratic in the line length (ReDoS on `source`) and is now linear.
- Simplification: one back-to-front splice helper (`spliceKtdElements`) instead of three copies;
  `rewriteKtdDocument` no longer repeats the strip/empty check `rewriteKtdText` performs;
  `stripKtdMetaTrailer` searches the constant instead of a retyped regex literal; the unknown-node
  refusal lists nodes compactly (names grouped by base/type) instead of ~80 raw ids; the create
  handler's partial-success guard now covers the GET and the PUT, not only the rewrite.
- Tests for each of the above plus CRLF bodies, exactly-60/non-BMP short texts, the lone
  `<sktd:text>` path, the `shortTexts` action gate, the neither-source-nor-shortTexts update, and the
  retry-hint variants. `tests/unit/handlers/write-ddic.test.ts` crossed the 3000-line budget → 3100
  with the SKTD block named as the split.
- Docs: tools.md (SKTD is not a `/source/main` write; the index lists names), research §4/§8, spec
  §4, AGENTS row.

Refuted or deferred: the resolver hardening that would make `## ZI_TravelTP` ambiguous (changes the
documented contract; separate change if wanted), `decodeKtdText` rebuilt on `findKtdElements`
(behaviour-preserving refactor, follow-up with the `ktd-xml.ts` split), per-write element rescans
(measured negligible at 91 nodes).
