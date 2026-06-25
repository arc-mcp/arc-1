# BDEF behavior-extension create — investigation (tier-3 #10)

Status: **mechanism not yet cracked.** Deep live investigation on a4h-2025 (816) done; the exact ADT
create call that yields an object whose source parser accepts `extend behavior for <base>` remains
unknown. Not a hard blocker (Eclipse creates them), but needs an Eclipse ADT trace to finish.

## Goal

Let ARC-1 create a RAP **behavior extension** (`extend behavior for ZBase { … }`), not just a behavior
**definition** (`define behavior for ZRoot { … }`). Parity with sapcli `bdef extend` (commit `2337844`).

## What ARC-1 has today

`SAPWrite create type=BDEF` POSTs a `blue:blueSource` with `adtcore:type="BDEF/BDO"` to
`/sap/bc/adt/bo/behaviordefinitions/`, then PUTs the source — a behavior **definition**. There is no
extension path.

## sapcli's mechanism (`sap/adt/behaviordefinition.py`, `sap/cli/behaviordefinition.py`)

- `bdef extend <name> <desc> <pkg> <base-bdef> [--interface-bdef …]`.
- `BehaviorDefinition.OBJTYPE` is **`BDEF/BDO`** even for extensions — the type does NOT discriminate.
- The extension create attaches an **`ADTTemplate`**: `<adtcore:adtTemplate>` with two
  `<adtcore:adtProperty adtcore:key="base_bdef|interface_bdef">…</adtcore:adtProperty>` children.

## Live findings (a4h-2025 816) — all verified, all dead ends so far

1. **A base RAP BO works end-to-end.** Table `ZARC1_RAPB` (mandt+id+descr) → root view entity
   `ZR_ARC1_RAPB` → `managed` behavior `ZR_ARC1_RAPB` → all activate. (The managed behavior activates
   without a hand-written behavior pool — only standard `create/update/delete`.)
2. **`adtcore:type="BDEF/BDE"` is ignored.** POSTing a `blueSource` with type `BDEF/BDE` → 201 but the
   object is created as **`BDEF/BDO`**. SAP normalizes the type. (So my first implementation attempt —
   detect `extend behavior for` → emit `BDEF/BDE` — was wrong and was reverted.)
3. **`adtcore:adtTemplate` with `base_bdef` does NOT make an extension.** POSTing the blueSource with
   `<adtcore:adtTemplate><adtcore:adtProperty adtcore:key="base_bdef">ZR_ARC1_RAPB</…></…>` → 201, but
   the scaffolded source is `unmanaged;\ndefine behavior for ZR_ARC1_RAPB_X {}` — a **definition of the
   new object itself**, not `extend behavior for ZR_ARC1_RAPB`. The template was ignored (wrong element
   namespace/position, wrong endpoint, or it needs a different content type).
4. **A normal BDO rejects `extend` source.** PUTting `extend behavior for ZR_ARC1_RAPB {}` onto any
   BDO object and activating → `[line 1] "abstract | interface | managed | projection | unmanaged" was
   expected, not "extend"`. So an extension is a genuinely distinct object kind; the source parser only
   accepts `extend` when the object was created AS an extension.

## The remaining unknown

The ADT create that produces an object whose parser accepts `extend behavior for`. Hypotheses to test
next: (a) the `adtTemplate` must ride a **different content type / endpoint** than the plain blueSource
create (capture sapcli's *actual* HTTP, not just its Python model); (b) the base behavior must be
declared **`extensible`** first; (c) Eclipse posts to a dedicated `…/behaviordefinitions/…/extensions`
or templates route. **Fastest path: capture an Eclipse ADT "New Behavior Definition Extension" HTTP
trace** (the one source of ground truth I can't get from the CLI), or run sapcli `bdef extend` against
a4h with request logging and diff its body against finding #3.

## Why deferred (not shipped)

Shipping requires a create that round-trips to an activatable extension, verified on 758 + 816. Findings
2–4 show my reconstructions don't, and the right body needs an IDE trace. Per ARC-1's golden rule
(verify live) + ponytail (don't ship unverified), this is parked here rather than guessed into code.
