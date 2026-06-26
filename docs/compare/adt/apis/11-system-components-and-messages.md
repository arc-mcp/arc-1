# System components and message classes

**Inventory rows:** 37–38  
**Primary code:** `src/adt/client.ts`, `src/adt/features.ts`

### SAP ABAP-side: implementation & relevant objects

#### System components

| Item | Detail |
|------|--------|
| **ICF path** | `...` → `adt` → **`system`** → **`components`**. |
| **Typical packages** | System / component feed ADT (often under **`SADT_*`** or **`SEU_ADT`**-related core; **SICF handler** is definitive). |
| **Response** | Atom feed of installed software components (**SAP_BASIS**, **SAP_ABA**, **SAP_CLOUD**, …). |

#### Message class messages

| Item | Detail |
|------|--------|
| **ICF path** | `...` → `adt` → **`msg`** → **`messages`** → `{messageClass}`. |
| **Typical packages** | Message tooling ADT (**search `*MSG*ADT*`** / **`SMSG*`** packages on your release). |
| **TADIR** | **MSAG** (message class). |

*Procedure:* [README](README.md#sap-abap-where-server-side-code-lives-all-apis).

---

## A. `GET /sap/bc/adt/system/components`

### SAP system

- Returns **Atom feed** of installed software components.
- Used for **SAP_BASIS** release → abaplint mapping and **BTP vs on-prem** heuristic (`SAP_CLOUD` vs `SAP_ABA`).

### Contract

| Item | Value |
|------|--------|
| Method | `GET` |
| Response | Atom XML |

### ARC-1

- `getInstalledComponents` — `Read`, `'GetInstalledComponents'`.
- `detectSystemFromComponents` in `features.ts` — **no extra safety name** (internal).
- **406/415:** **Yes**

### Tests

- **Integration:** installed components structure tests.

### Verdict

**OK** — critical path for **lint** and **system type**; keep **parser resilient** to feed changes.

---

## B. `GET /sap/bc/adt/msg/messages/{messageClass}`

### SAP system

- Message class documentation / messages XML.

### ARC-1

- `getMessages` — `Read`, `'GetMessages'`.
- Returns **raw** `resp.body` string (minimal parsing).

### Tests

- **Unit / integration** thinner than other reads — optional gap.

### Actions

| Action | Priority |
|--------|----------|
| Add integration smoke for a known message class (e.g. `S`) | Low |

**Verdict:** **OK**; **response format** is **not structured** in ARC-1 — acceptable for MCP text mode; improve if structured SAPRead is required later.
