# Implementation Plan: SAPContext & SAPManage Tools

> ARC-1 claims 11 intent-based tools, but only 9 are wired. This document is the blueprint for completing the remaining two.

---

## Table of Contents

1. [SAPManage — Feature Probing Tool](#1-sapmanage--feature-probing-tool)
2. [SAPContext — Dependency Context Compression Tool](#2-sapcontext--dependency-context-compression-tool)
3. [Shared Work (Tests, Docs, CI)](#3-shared-work)
4. [Implementation Order & Dependencies](#4-implementation-order--dependencies)

---

## 1. SAPManage — Feature Probing Tool

### 1.1 Purpose

SAPManage lets an LLM discover what the connected SAP system can do *before* attempting operations that might fail. Instead of trial-and-error ("try RAP, get 404, try something else"), the LLM can ask once and plan accordingly.

### 1.2 Design Decision

Two designs existed in the Go era:

| Design | What it does | Status |
|--------|-------------|--------|
| **A — Object Lifecycle** | Create packages, move objects, delete objects | Overlaps with SAPWrite (create/delete already implemented) |
| **B — Feature Probing** | Probe SAP system capabilities, report what's available | Backend complete (`features.ts`), just needs wiring |

**Decision: Implement Design B.** The backend (`probeFeatures()`, `resolveWithoutProbing()`) is fully implemented and tested. Object lifecycle is already covered by SAPWrite.

### 1.3 Existing Backend

The feature detection system in `src/adt/features.ts` is complete:

- `probeFeatures(client, config)` — Parallel HEAD requests to 6 SAP endpoints
- `resolveWithoutProbing(config)` — Offline resolution based on config modes
- 6 features probed: `hana`, `abapGit`, `rap`, `amdp`, `ui5`, `transport`
- 3 modes per feature: `auto` (probe), `on` (force), `off` (disable)
- Types: `FeatureStatus`, `ResolvedFeatures` in `src/adt/types.ts`
- Tests: 5 passing tests in `tests/unit/adt/features.test.ts`

### 1.4 Tool Description (LLM-facing)

```
Probe and report SAP system capabilities. Use this BEFORE attempting operations
that depend on optional features (abapGit, RAP/CDS, AMDP, HANA, UI5/Fiori,
CTS transports).

Actions:
- "features": Get cached feature status from last probe (fast, no SAP round-trip).
  Returns which features are available, their mode (auto/on/off), and when they
  were last probed. Use this to decide which tools and object types are safe to use.
- "probe": Re-probe the SAP system now (makes 6 parallel HEAD requests, ~1-2s).
  Use this if you suspect feature availability has changed, or on first use when
  no cached status exists.

Example workflow:
  1. SAPManage(action="probe")         → discover system capabilities
  2. Check if "rap" is available       → if yes, DDLS/BDEF/SRVD types work
  3. Check if "transport" is available → if yes, SAPTransport tool works
  4. Proceed with appropriate tools

Returns JSON with 6 features, each having: id, available (bool), mode, message,
and probedAt timestamp. "available: false" means the feature endpoint returned 404
or is force-disabled — do NOT attempt operations that depend on it.
```

### 1.5 Input Schema

```typescript
{
  name: 'SAPManage',
  description: '<LLM description from 1.4>',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['features', 'probe'],
        description: 'Action: "features" for cached status, "probe" to re-check SAP system',
      },
    },
    required: ['action'],
  },
}
```

### 1.6 Implementation Steps

#### Step 1: Add feature state to server

**File: `src/server/types.ts`**

Add a `resolvedFeatures` field to `ServerConfig` (or a separate server state object) so that probed features can be cached and returned by the `features` action without re-probing.

#### Step 2: Probe at startup

**File: `src/server/server.ts`**

After the `AdtClient` is created, call `probeFeatures()` and store the result:

```typescript
import { probeFeatures } from '../adt/features.js';

// During server initialization:
const features = await probeFeatures(client.http, config.features);
// Store in server state for SAPManage to access
```

#### Step 3: Add handler function

**File: `src/handlers/intent.ts`**

```typescript
async function handleSAPManage(
  client: AdtClient,
  args: Record<string, unknown>,
  features: ResolvedFeatures, // passed from server state
): Promise<ToolResult> {
  const action = String(args.action ?? '');

  switch (action) {
    case 'features':
      return textResult(JSON.stringify(features, null, 2));

    case 'probe': {
      // Import needed
      const updated = await probeFeatures(client.http, config.features);
      // Update cached state
      Object.assign(features, updated);
      return textResult(JSON.stringify(updated, null, 2));
    }

    default:
      return errorResult(
        `Unknown SAPManage action: ${action}. Supported: features, probe`
      );
  }
}
```

#### Step 4: Wire into switch statement

**File: `src/handlers/intent.ts`** (line ~182, before `default:`)

```typescript
case 'SAPManage':
  result = await handleSAPManage(client, args, serverState.features);
  break;
```

#### Step 5: Register tool definition

**File: `src/handlers/tools.ts`**

Add SAPManage to `getToolDefinitions()`. It should be registered conditionally — only when NOT in read-only mode (consistent with its `write` scope in `TOOL_SCOPES`):

```typescript
if (config.allowWrites) {
  tools.push({
    name: 'SAPManage',
    description: '...', // from 1.4
    inputSchema: { ... }, // from 1.5
  });
}
```

**Design note:** Consider whether SAPManage should actually be `read` scoped instead of `write`. Feature probing is a read-only operation (HEAD requests). Changing scope from `write` to `read` in `TOOL_SCOPES` would make it available in read-only mode, which makes more sense — knowing what's available shouldn't require write access. This is a design decision to make during implementation.

#### Step 6: Update test expectations

**File: `tests/unit/handlers/tools.test.ts`** (line 33)

Remove `expect(names).not.toContain('SAPManage')` and add a positive test.

### 1.7 Unit Tests

**File: `tests/unit/handlers/manage.test.ts`** (new)

| Test Case | What it Validates |
|-----------|-------------------|
| `action=features returns cached feature status` | Returns JSON with all 6 features, correct shape |
| `action=probe calls probeFeatures and returns result` | Verifies HTTP calls are made, result is returned |
| `action=probe updates cached state` | After probe, subsequent `features` call returns updated data |
| `unknown action returns error` | Returns error with supported actions list |
| `missing action returns error` | Handles empty/undefined action gracefully |

**File: `tests/unit/handlers/tools.test.ts`** (update)

| Test Case | What it Validates |
|-----------|-------------------|
| `SAPManage registered when allowWrites=true` | Tool appears in definitions |
| `SAPManage NOT registered when allowWrites=false` | Tool excluded in read-only mode |

**File: `tests/unit/handlers/intent.test.ts`** (update)

| Test Case | What it Validates |
|-----------|-------------------|
| `SAPManage dispatches to handler` | Switch statement routes correctly |
| `SAPManage scope enforcement` | Write scope required when authInfo present |

### 1.8 Integration Tests

**File: `tests/integration/adt.integration.test.ts`** (append)

| Test Case | What it Validates |
|-----------|-------------------|
| `SAPManage probe returns valid feature status` | Real HEAD requests succeed, all 6 features have valid status |
| `SAPManage features returns previously probed data` | Cached result matches probe result |
| `feature.transport correlates with SAPTransport availability` | If transport=available, listing transports works; if not, it fails gracefully |

### 1.9 Effort Estimate

**Small** — ~2-4 hours. The backend is done. This is pure wiring: handler function, switch case, tool definition, state management, tests.

---

## 2. SAPContext — Dependency Context Compression Tool

### 2.1 Purpose

SAPContext is the most LLM-useful tool in ARC-1. When an LLM reads a class that references 10 other classes, it needs context about those dependencies to understand the code. Without SAPContext, the LLM must:

1. Read the main class (~200 lines)
2. Identify dependencies manually
3. Make N separate SAPRead calls (~200 lines each)
4. Parse through ~2,000 lines of implementation details it doesn't need

**With SAPContext**, the LLM makes ONE call and gets ~200 lines of compressed API contracts — only the public interfaces, method signatures, and type definitions that matter for understanding the code.

**Token savings: 7-30x compression** (real measurements from Go implementation).

### 2.2 Architecture: Go vs TypeScript Approach

| Aspect | Go Implementation | TypeScript Implementation (Recommended) |
|--------|------------------|------------------------------------------|
| **Parser** | Custom regex (10 patterns) | `@abaplint/core` AST (already a dependency) |
| **Dependency extraction** | Regex scanning source text | AST traversal of parsed ABAP |
| **Contract extraction** | State machine per object type | AST-based: walk PUBLIC SECTION nodes |
| **Parallel fetching** | 5 goroutines + semaphore | `Promise.all` with concurrency limiter |
| **Cycle detection** | `map[string]bool` seen set | `Set<string>` seen set |
| **LOC** | ~2,100 (14 files) | ~400-600 estimated (AST is more precise, less code) |

**Recommendation: Use `@abaplint/core` for parsing** instead of porting the Go regex approach. Benefits:
- Already a dependency (v2.115.27)
- Proper AST — no regex false positives
- Handles edge cases (string literals containing patterns, comments, etc.)
- Maintained by the abaplint author

### 2.3 Tool Description (LLM-facing)

```
Get compressed dependency context for an ABAP object. Returns only the public API
contracts (method signatures, interface definitions, type declarations) of all
objects that the target depends on — NOT the full source code.

This is the most token-efficient way to understand an object's dependencies.
Instead of N separate SAPRead calls returning full source (~200 lines each),
SAPContext returns ONE response with compressed contracts (~15-30 lines each).
Typical compression: 7-30x fewer tokens.

Parameters:
- type (required): Object type — CLAS, INTF, PROG, FUNC
- name (required): Object name (e.g., ZCL_ORDER)
- source (optional): Provide the source code directly instead of fetching from SAP.
  Useful when you already have the source from a prior SAPRead call.
- maxDeps (optional, default 20): Maximum number of dependencies to resolve.
  Higher values give more context but cost more tokens and SAP round-trips.
- depth (optional, default 1): Dependency expansion depth.
  - 1: Direct dependencies only (what this object references)
  - 2: Dependencies of dependencies (one level deeper)
  - 3: Maximum depth (three levels, with cycle detection)

What gets extracted per dependency:
- Classes: CLASS DEFINITION with PUBLIC SECTION only (methods, types, constants).
  PROTECTED, PRIVATE sections and CLASS IMPLEMENTATION are stripped.
- Interfaces: Full interface definition (interfaces are already public contracts).
- Function modules: FUNCTION signature block only (IMPORTING/EXPORTING/TABLES/
  CHANGING/EXCEPTIONS parameters). Function body is stripped.

Output format:
  * === Dependency context for ZCL_ORDER (5 deps resolved, 2 filtered) ===
  *
  * --- ZIF_ORDER (interface, 4 methods) ---
  INTERFACE zif_order PUBLIC.
    METHODS create IMPORTING order TYPE t_order.
    ...
  ENDINTERFACE.
  *
  * --- ZCL_ITEM (class, 3 public methods) ---
  CLASS zcl_item DEFINITION PUBLIC.
    PUBLIC SECTION.
      METHODS get_price RETURNING VALUE(result) TYPE p.
      ...
  ENDCLASS.

Filtering:
- SAP standard objects (CL_ABAP_*, IF_ABAP_*, CX_SY_*) are excluded by default —
  the LLM already knows standard SAP APIs.
- Self-references are excluded.
- Custom objects (Z*, Y*) are prioritized over SAP standard in dependency ordering.

Use SAPContext BEFORE writing code that modifies or extends existing objects.
Use SAPRead to get the full source of the target object, then SAPContext to
understand its dependencies.
```

### 2.4 Input Schema

```typescript
{
  name: 'SAPContext',
  description: '<LLM description from 2.3>',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['CLAS', 'INTF', 'PROG', 'FUNC'],
        description: 'Object type',
      },
      name: {
        type: 'string',
        description: 'Object name (e.g., ZCL_ORDER)',
      },
      source: {
        type: 'string',
        description:
          'Optional: provide source directly instead of fetching from SAP. ' +
          'Saves one round-trip if you already have the source from SAPRead.',
      },
      maxDeps: {
        type: 'number',
        description: 'Maximum dependencies to resolve (default 20). Lower = faster + fewer tokens.',
      },
      depth: {
        type: 'number',
        description:
          'Dependency depth: 1 = direct deps only (default), ' +
          '2 = deps of deps, 3 = maximum. Higher depth = more context but more SAP calls.',
      },
    },
    required: ['type', 'name'],
  },
}
```

### 2.5 New Module: `src/context/`

Create a new `context/` module under `src/` with the following files:

#### 2.5.1 `src/context/types.ts` — Type Definitions

```typescript
/** A dependency found in ABAP source code */
export interface Dependency {
  /** Object name (e.g., ZCL_ITEM, ZIF_ORDER) */
  name: string;
  /** Dependency kind */
  kind: DependencyKind;
  /** Source line where the reference was found */
  line: number;
}

export type DependencyKind =
  | 'class_ref'       // TYPE REF TO, NEW, CAST
  | 'static_call'     // =>
  | 'interface_use'   // ~, INTERFACES
  | 'inheritance'     // INHERITING FROM
  | 'function_call'   // CALL FUNCTION
  | 'exception'       // RAISING, CATCH

/** Compressed contract for a single dependency */
export interface Contract {
  /** Object name */
  name: string;
  /** Object type (CLAS, INTF, FUNC) */
  type: 'CLAS' | 'INTF' | 'FUNC' | 'UNKNOWN';
  /** Number of public methods (for stats line) */
  methodCount: number;
  /** Compressed source — public API only */
  source: string;
  /** Whether fetching/extraction succeeded */
  success: boolean;
  /** Error message if fetch/extraction failed */
  error?: string;
}

/** Full context compression result */
export interface ContextResult {
  /** Target object name */
  objectName: string;
  /** Target object type */
  objectType: string;
  /** Dependencies found in source */
  depsFound: number;
  /** Dependencies resolved (contracts fetched) */
  depsResolved: number;
  /** Dependencies filtered (SAP standard, self-refs) */
  depsFiltered: number;
  /** Dependencies that failed to resolve */
  depsFailed: number;
  /** Total lines in output */
  totalLines: number;
  /** Formatted output prologue */
  output: string;
}
```

#### 2.5.2 `src/context/deps.ts` — Dependency Extraction

This is the core innovation. Two approaches, choose one:

**Approach A: AST-based (recommended)**

Use `@abaplint/core` to parse the ABAP source into an AST, then walk the tree to find dependency references. This is more accurate than regex but requires understanding the abaplint AST structure.

```typescript
import { Registry, MemoryFile, Config, Version } from '@abaplint/core';
import type { Dependency } from './types.js';
import { detectFilename } from '../lint/lint.js';

/**
 * Extract dependencies from ABAP source using @abaplint/core parser.
 *
 * Parses the source into an AST and walks it looking for:
 * - TYPE REF TO references
 * - NEW / CAST instantiations
 * - Static method calls (=>)
 * - Interface uses (~)
 * - INHERITING FROM / INTERFACES declarations
 * - CALL FUNCTION statements
 * - RAISING / CATCH exception classes
 */
export function extractDependencies(source: string, objectName: string): Dependency[] {
  // Use abaplint registry to parse the source
  const config = Config.getDefault(Version.v702);
  const filename = detectFilename(source, objectName);
  const reg = new Registry(config);
  reg.addFile(new MemoryFile(filename, source));
  reg.parse();

  const deps: Dependency[] = [];
  const seen = new Set<string>();

  // Get the parsed object from the registry
  const objects = reg.getObjects();
  for (const obj of objects) {
    // Walk AST nodes looking for dependency patterns
    // Implementation depends on @abaplint/core AST structure
    // Key node types to look for:
    // - TypeRef nodes → TYPE REF TO
    // - NewObject nodes → NEW zcl_class()
    // - MethodCallChain with => → static calls
    // - InterfaceImplementation → INTERFACES keyword
    // - SuperClass → INHERITING FROM
    // - FunctionModuleCall → CALL FUNCTION
    // ... (walk the statement list and expression trees)
  }

  return deps;
}
```

**Approach B: Regex-based (Go port)**

Port the 10 regex patterns from the Go `deps.go`. Simpler to implement but has known false positives (matches inside strings/comments).

```typescript
const PATTERNS: Array<{ pattern: RegExp; kind: DependencyKind }> = [
  { pattern: /TYPE\s+REF\s+TO\s+(\w+)/gi, kind: 'class_ref' },
  { pattern: /NEW\s+(\w+)\s*\(/gi, kind: 'class_ref' },
  { pattern: /(\w+)=>/gi, kind: 'static_call' },
  { pattern: /(\w+)~/gi, kind: 'interface_use' },
  { pattern: /INHERITING\s+FROM\s+(\w+)/gi, kind: 'inheritance' },
  { pattern: /INTERFACES\s+(\w+)/gi, kind: 'interface_use' },
  { pattern: /CALL\s+FUNCTION\s+'(\w+)'/gi, kind: 'function_call' },
  { pattern: /CAST\s+(\w+)\s*\(/gi, kind: 'class_ref' },
  { pattern: /RAISING\s+(?:RESUMABLE\s+)?(\w+)/gi, kind: 'exception' },
  { pattern: /CATCH\s+([\w\s]+?)(?:INTO|\.)/gi, kind: 'exception' }, // needs split on spaces
];
```

**Recommendation:** Start with regex (Approach B) for the initial implementation — it's proven from the Go version and faster to ship. File an issue to migrate to AST-based extraction later for improved accuracy.

**Filtering rules** (apply to both approaches):
- Remove self-references (same name as target object)
- Remove SAP built-in types: names starting with `CL_ABAP_`, `IF_ABAP_`, `CX_SY_`, `CL_GUI_`, `CL_SALV_`
- Remove ABAP built-in types: `STRING`, `XSTRING`, `I`, `INT8`, `P`, `C`, `N`, `D`, `T`, `F`, `X`, `ABAP_BOOL`, `ABAP_TRUE`, `ABAP_FALSE`, `SY`, `SYST`
- Deduplicate by name (keep first occurrence for line reference)
- Sort: custom objects (Z*, Y*) first, then SAP standard, alphabetically within each group

#### 2.5.3 `src/context/contract.ts` — Contract Extraction

Extract the public API contract from full source code.

```typescript
import type { Contract } from './types.js';

/**
 * Extract the public API contract from ABAP source.
 *
 * For classes: Keep only CLASS DEFINITION + PUBLIC SECTION.
 *   Strip PROTECTED SECTION, PRIVATE SECTION, and CLASS IMPLEMENTATION.
 * For interfaces: Return as-is (interfaces ARE contracts).
 * For function modules: Keep only the signature comment block (*" lines).
 */
export function extractContract(
  source: string,
  name: string,
  objectType: 'CLAS' | 'INTF' | 'FUNC' | 'UNKNOWN',
): Contract {
  switch (objectType) {
    case 'CLAS':
      return extractClassContract(source, name);
    case 'INTF':
      return extractInterfaceContract(source, name);
    case 'FUNC':
      return extractFunctionContract(source, name);
    default:
      return { name, type: objectType, methodCount: 0, source, success: true };
  }
}
```

**Class contract extraction algorithm:**

1. Find `CLASS <name> DEFINITION` line
2. Find `PUBLIC SECTION.` within the definition
3. Collect lines until hitting `PROTECTED SECTION.`, `PRIVATE SECTION.`, or `ENDCLASS.`
4. Wrap in `CLASS <name> DEFINITION PUBLIC. ... ENDCLASS.`
5. Count `METHODS` lines for the stats

**Interface contract extraction:** Return the full source (interfaces are already public contracts). Count `METHODS` lines.

**Function module contract extraction:**

1. Find `FUNCTION <name>.`
2. Collect `*"` comment lines (the signature block with IMPORTING/EXPORTING/TABLES/CHANGING/EXCEPTIONS)
3. Return `FUNCTION <name>.\n<signature lines>\nENDFUNCTION.`

#### 2.5.4 `src/context/compressor.ts` — Orchestrator

```typescript
import type { AdtClient } from '../adt/client.js';
import type { ContextResult, Contract, Dependency } from './types.js';
import { extractDependencies } from './deps.js';
import { extractContract } from './contract.js';

const DEFAULT_MAX_DEPS = 20;
const DEFAULT_DEPTH = 1;
const MAX_CONCURRENT = 5;

/**
 * Compress dependency context for an ABAP object.
 *
 * Pipeline:
 * 1. Parse source → extract dependency names
 * 2. Filter (remove self-refs, SAP built-ins)
 * 3. Sort (custom objects first)
 * 4. Limit to maxDeps
 * 5. Fetch dependency sources (parallel, bounded to MAX_CONCURRENT)
 * 6. Extract contracts (public API only)
 * 7. If depth > 1, recurse on each dependency's source
 * 8. Format output prologue
 */
export async function compressContext(
  client: AdtClient,
  source: string,
  objectName: string,
  objectType: string,
  maxDeps = DEFAULT_MAX_DEPS,
  depth = DEFAULT_DEPTH,
): Promise<ContextResult> {
  const seen = new Set<string>([objectName.toUpperCase()]);
  const allContracts: Contract[] = [];

  await resolveDeps(client, source, objectName, objectType, maxDeps, depth, seen, allContracts);

  return formatResult(objectName, objectType, allContracts, seen);
}

async function resolveDeps(
  client: AdtClient,
  source: string,
  objectName: string,
  objectType: string,
  maxDeps: number,
  depth: number,
  seen: Set<string>,
  contracts: Contract[],
): Promise<void> {
  // 1. Extract dependencies
  const deps = extractDependencies(source, objectName);

  // 2. Filter already-seen
  const newDeps = deps.filter((d) => !seen.has(d.name.toUpperCase()));

  // 3. Mark as seen
  for (const dep of newDeps) {
    seen.add(dep.name.toUpperCase());
  }

  // 4. Limit
  const limited = newDeps.slice(0, maxDeps);

  // 5. Fetch + extract (bounded parallel)
  const fetched = await fetchContractsParallel(client, limited);
  contracts.push(...fetched);

  // 6. Recurse if depth > 1
  if (depth > 1) {
    for (const contract of fetched) {
      if (contract.success && contract.source) {
        await resolveDeps(
          client, contract.source, contract.name, contract.type,
          maxDeps, depth - 1, seen, contracts,
        );
      }
    }
  }
}

/**
 * Fetch source and extract contract for each dependency.
 * Bounded to MAX_CONCURRENT parallel requests.
 */
async function fetchContractsParallel(
  client: AdtClient,
  deps: Dependency[],
): Promise<Contract[]> {
  // Simple concurrency limiter using batching
  const results: Contract[] = [];
  for (let i = 0; i < deps.length; i += MAX_CONCURRENT) {
    const batch = deps.slice(i, i + MAX_CONCURRENT);
    const batchResults = await Promise.all(
      batch.map((dep) => fetchSingleContract(client, dep)),
    );
    results.push(...batchResults);
  }
  return results;
}

async function fetchSingleContract(
  client: AdtClient,
  dep: Dependency,
): Promise<Contract> {
  try {
    // Determine object type from dependency kind and name
    const objectType = inferObjectType(dep);
    const source = await fetchSource(client, dep.name, objectType);
    return extractContract(source, dep.name, objectType);
  } catch (err) {
    return {
      name: dep.name,
      type: 'UNKNOWN',
      methodCount: 0,
      source: '',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function inferObjectType(dep: Dependency): 'CLAS' | 'INTF' | 'FUNC' | 'UNKNOWN' {
  const upper = dep.name.toUpperCase();
  // Naming conventions:
  // ZIF_*, YIF_*, IF_* → interface
  // ZCL_*, YCL_*, CL_* → class
  // ZCX_*, YCX_*, CX_* → exception class
  // CALL FUNCTION → function module
  if (dep.kind === 'function_call') return 'FUNC';
  if (dep.kind === 'interface_use') return 'INTF';
  if (/^[ZY]?IF_/i.test(upper) || /^IF_/i.test(upper)) return 'INTF';
  if (/^[ZY]?CL_/i.test(upper) || /^CL_/i.test(upper)) return 'CLAS';
  if (/^[ZY]?CX_/i.test(upper) || /^CX_/i.test(upper)) return 'CLAS';
  return 'CLAS'; // Default assumption
}

async function fetchSource(
  client: AdtClient,
  name: string,
  type: 'CLAS' | 'INTF' | 'FUNC' | 'UNKNOWN',
): Promise<string> {
  switch (type) {
    case 'CLAS': return client.getClass(name);
    case 'INTF': return client.getInterface(name);
    case 'FUNC': {
      // Function modules need their group — search for it
      const results = await client.searchObject(name, 1);
      if (results.length === 0) throw new Error(`Function module ${name} not found`);
      // Extract function group from search result URI
      const match = results[0].uri.match(/groups\/(\w+)/);
      const group = match ? match[1] : '';
      return client.getFunction(group, name);
    }
    default: return client.getClass(name); // Try as class
  }
}

function formatResult(
  objectName: string,
  objectType: string,
  contracts: Contract[],
  seen: Set<string>,
): ContextResult {
  const successful = contracts.filter((c) => c.success);
  const failed = contracts.filter((c) => !c.success);

  const lines: string[] = [];
  lines.push(`* === Dependency context for ${objectName} (${successful.length} deps resolved${failed.length > 0 ? `, ${failed.length} failed` : ''}) ===`);
  lines.push('');

  for (const contract of successful) {
    const methodLabel = contract.methodCount > 0 ? `, ${contract.methodCount} methods` : '';
    lines.push(`* --- ${contract.name} (${contract.type.toLowerCase()}${methodLabel}) ---`);
    lines.push(contract.source.trim());
    lines.push('');
  }

  if (failed.length > 0) {
    lines.push('* --- Failed dependencies ---');
    for (const f of failed) {
      lines.push(`* ${f.name}: ${f.error}`);
    }
    lines.push('');
  }

  const totalLines = lines.length;
  lines.push(`* Stats: ${seen.size - 1} deps found, ${successful.length} resolved, ${failed.length} failed, ${totalLines} lines`);

  return {
    objectName,
    objectType,
    depsFound: seen.size - 1,
    depsResolved: successful.length,
    depsFiltered: seen.size - 1 - contracts.length,
    depsFailed: failed.length,
    totalLines,
    output: lines.join('\n'),
  };
}
```

### 2.6 Handler Implementation

**File: `src/handlers/intent.ts`**

```typescript
import { compressContext } from '../context/compressor.js';

async function handleSAPContext(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  const type = String(args.type ?? '');
  const name = String(args.name ?? '');
  const maxDeps = Number(args.maxDeps ?? 20);
  const depth = Math.min(Number(args.depth ?? 1), 3); // Cap at 3

  if (!type || !name) {
    return errorResult('Both "type" and "name" are required for SAPContext.');
  }

  // Get source — either provided or fetched from SAP
  let source: string;
  if (args.source) {
    source = String(args.source);
  } else {
    // Fetch from SAP using existing client methods
    switch (type) {
      case 'CLAS': source = await client.getClass(name); break;
      case 'INTF': source = await client.getInterface(name); break;
      case 'PROG': source = await client.getProgram(name); break;
      case 'FUNC': {
        const group = String(args.group ?? '');
        source = await client.getFunction(group, name);
        break;
      }
      default:
        return errorResult(`SAPContext supports types: CLAS, INTF, PROG, FUNC. Got: ${type}`);
    }
  }

  const result = await compressContext(client, source, name, type, maxDeps, depth);
  return textResult(result.output);
}
```

**Switch case** (add before `default:` in `handleToolCall`):

```typescript
case 'SAPContext':
  result = await handleSAPContext(client, args);
  break;
```

### 2.7 Tool Registration

**File: `src/handlers/tools.ts`**

SAPContext is a **read** tool — register it unconditionally (same as SAPRead, SAPSearch):

```typescript
tools.push({
  name: 'SAPContext',
  description: '<LLM description from 2.3>',
  inputSchema: { ... }, // from 2.4
});
```

Update test: remove `expect(names).not.toContain('SAPContext')` from `tools.test.ts`.

### 2.8 Unit Tests

#### `tests/unit/context/deps.test.ts` — Dependency Extraction

| Test Case | Input | Expected |
|-----------|-------|----------|
| Extracts TYPE REF TO | `DATA lo_obj TYPE REF TO zcl_item.` | `[{ name: 'zcl_item', kind: 'class_ref' }]` |
| Extracts NEW | `DATA(lo) = NEW zcl_helper( ).` | `[{ name: 'zcl_helper', kind: 'class_ref' }]` |
| Extracts static call | `zcl_util=>convert( )` | `[{ name: 'zcl_util', kind: 'static_call' }]` |
| Extracts interface use | `zif_handler~process( )` | `[{ name: 'zif_handler', kind: 'interface_use' }]` |
| Extracts INHERITING FROM | `CLASS zcl_child DEFINITION INHERITING FROM zcl_parent.` | `[{ name: 'zcl_parent', kind: 'inheritance' }]` |
| Extracts INTERFACES | `INTERFACES zif_order.` | `[{ name: 'zif_order', kind: 'interface_use' }]` |
| Extracts CALL FUNCTION | `CALL FUNCTION 'Z_DELIVERY_FM'.` | `[{ name: 'Z_DELIVERY_FM', kind: 'function_call' }]` |
| Extracts CAST | `CAST zif_handler( lo_obj )` | `[{ name: 'zif_handler', kind: 'class_ref' }]` |
| Extracts RAISING | `RAISING zcx_not_found` | `[{ name: 'zcx_not_found', kind: 'exception' }]` |
| Filters built-in types | `DATA lv TYPE string.` | `[]` (string is built-in) |
| Filters SAP standard | `TYPE REF TO cl_abap_typedescr` | `[]` (CL_ABAP_* filtered) |
| Filters self-reference | Source of ZCL_ORDER containing `TYPE REF TO zcl_order` | `[]` |
| Deduplicates | Two `TYPE REF TO zcl_item` lines | `[{ name: 'zcl_item' }]` (one entry) |
| Sorts custom first | Mix of Z* and CL_* refs | Z* objects appear before CL_* |
| Handles empty source | `""` | `[]` |
| Handles complex class | Realistic 50-line class source | All expected dependencies extracted |
| Multiple deps in one line | `zcl_a=>method( NEW zcl_b( ) )` | Both `zcl_a` and `zcl_b` found |

#### `tests/unit/context/contract.test.ts` — Contract Extraction

| Test Case | Input | Expected |
|-----------|-------|----------|
| Class: extracts PUBLIC SECTION only | Full class with PUBLIC/PROTECTED/PRIVATE + IMPLEMENTATION | Only PUBLIC SECTION methods remain |
| Class: counts methods | Class with 5 public methods | `methodCount: 5` |
| Class: strips IMPLEMENTATION | Class with 200-line implementation | Implementation removed |
| Interface: returns full source | `INTERFACE zif_handler...ENDINTERFACE.` | Unchanged |
| Interface: counts methods | Interface with 3 methods | `methodCount: 3` |
| FM: extracts signature only | Full function module with body | Only `*"` signature lines |
| Handles empty PUBLIC SECTION | Class with only private methods | Empty public section returned |
| Handles nested class definitions | Class with local type definitions | Only main class public section |

#### `tests/unit/context/compressor.test.ts` — Orchestrator

| Test Case | Input | Expected |
|-----------|-------|----------|
| Compresses class with 3 deps | Mock class + 3 mock dep sources | Output has 3 contract blocks |
| Respects maxDeps limit | 10 deps, maxDeps=3 | Only 3 contracts fetched |
| Handles fetch failures gracefully | 1 dep 404s, 2 succeed | 2 contracts + 1 in "Failed dependencies" |
| Depth=1 resolves direct only | Class → dep → dep's dep | Only direct dep resolved |
| Depth=2 resolves two levels | Class → dep → dep's dep | Both levels resolved |
| Cycle detection works | A→B→A | No infinite loop, each resolved once |
| Formats output correctly | Known input | Output matches expected prologue format |
| Stats line is accurate | Known input | Correct counts in stats line |
| Uses provided source | source param given | No SAPRead call made for target |
| Concurrent fetch limit | 10 deps | Max 5 concurrent requests |

#### `tests/unit/handlers/intent.test.ts` (update)

| Test Case | What it Validates |
|-----------|-------------------|
| SAPContext dispatches to handler | Switch routes correctly |
| SAPContext with provided source skips fetch | Source param used, no HTTP call for target |
| SAPContext validates required params | Missing type/name returns error |
| SAPContext caps depth at 3 | depth=5 → treated as 3 |

### 2.9 Integration Tests

**File: `tests/integration/context.integration.test.ts`** (new)

| Test Case | What it Validates |
|-----------|-------------------|
| Compress context for real class | Real SAP class → output has valid structure, contracts are parseable |
| Depth=2 finds transitive deps | Real class with known deep dependency chain → deeper deps resolved |
| Large class with many deps | Class with >20 deps → maxDeps limits correctly, no timeout |
| Interface returns full contract | Real interface → output matches original source |
| Function module extracts signature | Real FM → only parameter block, no body |
| SAP standard objects are filtered | Known class referencing CL_ABAP_* → filtered from output |
| Performance: < 5s for typical class | Class with 10 deps → completes within timeout |

### 2.10 Effort Estimate

**Medium** — ~2-3 days. Breakdown:
- Types + contract extraction: 0.5 day
- Dependency extraction (regex approach): 0.5 day
- Compressor orchestrator: 0.5 day
- Handler + tool registration: 0.25 day
- Unit tests (30+ cases): 0.75 day
- Integration tests: 0.25 day
- Documentation: 0.25 day

---

## 3. Shared Work

### 3.1 Documentation Updates

| File | Change |
|------|--------|
| `docs/tools.md` | Add/update SAPContext section (parameters, examples, output format) |
| `docs/tools.md` | Add/update SAPManage section (already has stub at line 220-231, update with final schema) |
| `docs/architecture.md` | Update tool count, verify Mermaid diagrams show all 11 tools |
| `docs/mcp-usage.md` | Update workflow examples to include SAPContext usage patterns |
| `README.md` | Verify "11 intent-based tools" claim is now accurate |
| `CLAUDE.md` | Update "Key Files for Common Tasks" table with context/ module |

### 3.2 Test Infrastructure Updates

**File: `tests/unit/handlers/tools.test.ts`**

```typescript
// REMOVE these lines (currently at line ~33):
expect(names).not.toContain('SAPContext');
expect(names).not.toContain('SAPManage');

// ADD:
expect(names).toContain('SAPContext');
// SAPManage: only when allowWrites
```

### 3.3 CLAUDE.md Updates

Add to the codebase structure:

```
src/
├── context/
│   ├── types.ts                # Context compression types
│   ├── deps.ts                 # Dependency extraction from ABAP source
│   ├── contract.ts             # Public API contract extraction
│   └── compressor.ts           # Orchestrator (fetch + compress + format)
```

Add to Key Files table:

| Task | Files |
|------|-------|
| Add dependency pattern | `src/context/deps.ts` |
| Add contract extraction for new type | `src/context/contract.ts` |
| Modify context output format | `src/context/compressor.ts` |

---

## 4. Implementation Order & Dependencies

```
Phase 1: SAPManage (0.5 day)
  ├── Wire handler + tool definition
  ├── Add feature state to server
  ├── Unit tests
  ├── Integration tests
  └── Update docs

Phase 2: SAPContext - Core (1.5 days)
  ├── types.ts
  ├── deps.ts (regex approach) + unit tests
  ├── contract.ts + unit tests
  └── compressor.ts + unit tests

Phase 3: SAPContext - Integration (1 day)
  ├── Handler + tool registration
  ├── Integration tests
  ├── Documentation
  └── End-to-end validation with real SAP system

Phase 4: Polish (0.5 day)
  ├── Update all docs (tools.md, architecture.md, README, CLAUDE.md)
  ├── Verify 11-tool claim is now accurate
  ├── Run full test suite
  └── Consider: should SAPManage scope be 'read' instead of 'write'?
```

**Total: ~3.5 days**

### Dependencies Between Phases

- Phase 1 (SAPManage) has **zero dependencies** on Phase 2-3 — can ship independently
- Phase 2 (SAPContext core) depends on existing `@abaplint/core` and `AdtClient` — no new dependencies
- Phase 3 (SAPContext integration) depends on Phase 2
- Phase 4 depends on Phase 1 + 3

### Future Improvements (Not in Scope)

- Migrate dependency extraction from regex to `@abaplint/core` AST
- Add contract caching (SQLite cache already exists — reuse it)
- Add `SAPContext` depth=0 mode (just list dependency names, no source fetch)
- Add workspace/local file provider (like Go's `MultiSourceProvider`)
- Benchmark and optimize for token budget constraints
