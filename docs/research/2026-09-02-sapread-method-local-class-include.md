# `SAPRead method=` never found methods of class-local classes

Date: 2026-09-02. Found on an on-prem SAP_BASIS 816 system while documenting a RAP behaviour pool;
pre-existing since the method-level read was introduced.

## Symptom

```
SAPRead(type="CLAS", name="ZBP_TRAVEL", method="lhc_travel~get_photo")
→ Method "lhc_travel~get_photo" not found in ZBP_TRAVEL. Available methods: (none)
```

while `SAPRead(..., include="implementations", grep="photo")` located the very same method and
annotated it with `[lhc_travel=>get_photo]`. AGENTS.md documents the `<localclass>~<method>`
specifier, and `extractMethod` in `src/context/method-surgery.ts` does honour it.

## Root cause

`src/handlers/read.ts`, CLAS branch: the method path always fetched `source/main`:

```ts
if (methodParam && !args.include) {
  const { source: fullSource } = await cachedGet('CLAS', name, effectiveVersion, (ifNoneMatch) =>
    client.getClass(name, undefined, { ifNoneMatch, version: effectiveVersion }),
  );
```

A behaviour pool's MAIN is only the `CLASS … FOR BEHAVIOR OF …` shell; every handler method lives
in the `implementations` include (CCIMP), which this path never read. `extractMethod` therefore
searched an empty class and reported "(none)". Two more consequences of the same condition:

- `method` + `include` passed together made `!args.include` false, so `method` was silently
  ignored and the whole include came back.
- `edit_method` had already solved the routing with `detectLocalHandlerInclude`
  (`lhc_*`/`lcl_*` → implementations, `ltc_*` → testclasses) — the read side never adopted it.

`git log -S` dates the condition to the `ts-src` → `src` rename (2026-04-02) and it survived the
handler split (#402) unchanged.

## Fix

The read path resolves the section the way `edit_method` does: an explicit `include=` wins; else
`detectLocalHandlerInclude(method)`; else MAIN. Include reads go through `client.getClassInclude`
(raw endpoint, no `=== include ===` header) and bypass the source cache, whose key has no include
component — MAIN and CCIMP bytes must never share an entry. A 404 on the include is reported as
"Include … is not available for class …" instead of "(none)", and a bare name not found in MAIN
gets a hint to use `lhc_x~method` or `include=`. No schema change: `include=` values were already
validated by `SAPREAD_CLAS_READ_INCLUDES`, and `text_symbols` is routed before this switch.

Unit-tested through `handleToolCall` with a behaviour-pool fixture (MAIN shell + CCIMP handler):
routing of `lhc_x~method`, bare `method` + `include=`, `method="*"` + `include=`, the MAIN-miss
hint, and the missing-include error.
