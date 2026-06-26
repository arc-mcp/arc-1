# Runtime diagnostics: short dumps and ABAP traces

**Inventory rows:** 53–59  
**Primary code:** `src/adt/diagnostics.ts`

### SAP ABAP-side: implementation & relevant objects

| API | ICF path (under `.../adt/`) | Typical packages / classes |
|-----|-----------------------------|----------------------------|
| **Dump list** | **`runtime`** → **`dumps`** | Short dump ADT feed (ST22-facing); **SICF handler** → **CLAS** resources emitting Atom **`application/atom+xml;type=feed`**. |
| **Dump detail** | **`runtime`** → **`dump`** → `{id}` (+ **`formatted`**) | Classes handling **`application/vnd.sap.adt.runtime.dump.v1+xml`** and plain-text formatted dump. |
| **Trace list** | **`runtime`** → **`traces`** → **`abaptraces`** | ABAP profiler / trace ADT integration (search **`RUNT*ADT*`**, **`TRACE*ADT*`** packages). |
| **Trace detail** | `.../abaptraces/{id}/hitlist|statements|dbAccesses` | Trace analysis resource classes (XML **`Accept: application/xml`**). |

Underlying runtime: **ST22** dump data, **SAT** / trace files — ADT exposes HTTP views on the same data.

*Procedure:* [README](README.md#sap-abap-where-server-side-code-lives-all-apis).

---

## A. `GET /sap/bc/adt/runtime/dumps[?$top=][&$query=]`

### Contract

| Accept | `application/atom+xml;type=feed` |

### ARC-1

- `listDumps` — `Read`, `'ListDumps'`.
- **406/415:** **Yes**

### Tests

- **Integration:** list dumps, filter by user, optional detail.

### Verdict

**OK**

---

## B. `GET /sap/bc/adt/runtime/dump/{dumpId}`

### Contract

| Accept | `application/vnd.sap.adt.runtime.dump.v1+xml` |

### ARC-1

- `getDump` (parallel with formatted).

### Verdict

**OK**

---

## C. `GET /sap/bc/adt/runtime/dump/{dumpId}/formatted`

### Contract

| Accept | `text/plain` |

### ARC-1

- Same `getDump`.

### Verdict

**OK**

---

## D. `GET /sap/bc/adt/runtime/traces/abaptraces`

### Contract

| Accept | `application/atom+xml;type=feed` |

### ARC-1

- `listTraces` — `'ListTraces'`.

### Verdict

**OK**

---

## E. `GET .../abaptraces/{traceId}/hitlist|statements|dbAccesses`

### Contract

| Accept | `application/xml` |

### ARC-1

- `getTraceHitlist`, `getTraceStatements`, `getTraceDbAccesses`.

### Tests

- **Unit:** `diagnostics.test.ts`; **integration** list traces (detail may be sparse).

### Actions

| Action | Priority |
|--------|----------|
| Add integration test for hitlist/statements when a trace ID is known | Low |

**Verdict:** **OK**; **trace detail** integration **optional**.
