/**
 * RAP behavior-pool handler scaffolding.
 *
 * Context — this module exists because on-prem RAP development has a tight
 * contract between a BDEF (behavior definition source) and its behavior pool
 * (the ABAP global class named in `managed implementation in class ZBP_...`).
 * Every `action` / `determination` / `validation` / `authorization master`
 * declared in the BDEF requires a matching METHOD signature inside a local
 * handler class (`lhc_<alias>`). If any signature is missing, the class will
 * not activate and the error reported by ADT doesn't tell the developer
 * which signatures are missing — they see a generic "behavior pool does not
 * implement the required method for ..." message.
 *
 * The exported helpers cooperate:
 *   1. extractRapHandlerRequirements     — parse BDEF → list of required methods
 *   2. findMissingRapHandlerRequirements — diff required vs. present in class
 *   3. applyRapHandlerSignatures         — insert the missing METHODS lines
 *   4. applyRapHandlerImplementationStubs — insert empty METHOD stubs
 *   5. applyRapHandlerScaffold           — plan multi-include auto-apply
 *
 * The scaffolder writes declarations plus empty implementations only.
 * Business logic remains the developer's responsibility and can be filled
 * with edit_method.
 *
 * Naming convention: handler classes use the prefix `lhc_` (local handler
 * class) followed by the lowercased alias from the BDEF. This is the RAP
 * convention SAP's own templates use (see cl_abap_behavior_handler examples
 * in /DMO/* and the "Create Behavior Implementation Class" wizard in ADT).
 */

export type RapHandlerKind =
  | 'action'
  | 'determination'
  | 'validation'
  | 'instance_authorization'
  | 'global_authorization';

export interface RapHandlerRequirement {
  kind: RapHandlerKind;
  methodName: string;
  entityName: string;
  entityAlias: string;
  targetHandlerClass: string;
  declarationLine: number;
  signature: string;
}

export interface RapHandlerApplySkipped {
  requirement: RapHandlerRequirement;
  reason: string;
}

export interface RapHandlerApplyResult {
  updatedSource: string;
  inserted: RapHandlerRequirement[];
  skipped: RapHandlerApplySkipped[];
  changed: boolean;
}

export type RapHandlerSectionName = 'main' | 'definitions' | 'implementations';

export interface RapHandlerSourceSections {
  main: string;
  definitions?: string;
  implementations?: string;
}

export interface RapHandlerSectionApplyResults {
  main: RapHandlerApplyResult;
  definitions?: RapHandlerApplyResult;
  implementations?: RapHandlerApplyResult;
}

export interface RapHandlerScaffoldPlan {
  sections: RapHandlerSourceSections;
  skeletons: {
    createdDefinitions: string[];
    createdImplementations: string[];
    changed: Record<RapHandlerSectionName, boolean>;
    changedSections: RapHandlerSectionName[];
  };
  signatures: RapHandlerSectionApplyResults;
  implementationStubs: RapHandlerSectionApplyResults;
  unresolved: RapHandlerRequirement[];
  changed: Record<RapHandlerSectionName, boolean>;
  changedSections: RapHandlerSectionName[];
  insertedSignatureCount: number;
  insertedImplementationStubCount: number;
}

interface RapHandlerDeclarationBinding {
  kind: RapHandlerKind;
  methodName: string;
  entityAlias: string;
}

interface SignatureFallthroughPlan {
  signatures: RapHandlerSectionApplyResults;
  updatedSections: RapHandlerSourceSections;
  unresolved: RapHandlerRequirement[];
}

interface RapBehaviorBlock {
  entityName: string;
  alias: string;
  startLine: number;
  lines: string[];
}

interface ClassDefinitionRange {
  name: string;
  start: number;
  end: number;
  privateSection?: number;
}

interface ClassImplementationRange {
  name: string;
  start: number;
  end: number;
}

/**
 * Result of `ensureRapHandlerSkeletons`.
 *
 * IMPORTANT: `createdDefinitions` and `createdImplementations` enumerate the
 * **kinds of skeleton blocks created** (one entry per `lhc_<alias>` class that
 * needed a DEFINITION block / an IMPLEMENTATION block). They are NOT include
 * locations — both block kinds always land in the CCIMP include
 * (`/source/implementations`), with CCDEF (`/source/definitions`) left at its
 * SAP-generated placeholder. This matches SAP demo class `BP_DEMO_RAP_STRICT`
 * (package `SABAPDEMOS`) and the contract documented in ABAP keyword doc
 * `ABENABP_HANDLER_CLASS_GLOSRY`: *"A local class in a CCIMP include of an
 * ABAP behavior pool …"*.
 *
 * `changed.implementations` is `true` whenever either array is non-empty;
 * `changed.definitions` is always `false`; `changed.main` is always `false`.
 */
export interface RapHandlerSkeletonResult {
  sections: RapHandlerSourceSections;
  /** Class names whose `CLASS lhc_<alias> DEFINITION` block was newly emitted (now in CCIMP). */
  createdDefinitions: string[];
  /** Class names whose `CLASS lhc_<alias> IMPLEMENTATION` block was newly emitted (in CCIMP). */
  createdImplementations: string[];
  changed: Record<RapHandlerSectionName, boolean>;
  changedSections: RapHandlerSectionName[];
}

// AI-maintenance guide:
// If SAP adds or changes RAP handler syntax, update these parser patterns first,
// then add one fixture-style test in tests/unit/adt/rap-handlers.test.ts. Keeping
// the grammar fragments here avoids subtly divergent regexes in detection,
// missing-checks, and auto-apply.
const BDEF_DEFINE_BEHAVIOR_RE = /^\s*define\s+behavior\s+for\s+([^\s{]+)(?:\s+alias\s+([A-Za-z_]\w*))?/i;
const BDEF_ACTION_DECLARATION_RE =
  /^\s*(?:static\s+)?(?:(?:internal|factory)\s+)*action(?:\s*\([^)]*\))?\s+([A-Za-z_]\w*)\b/i;
const BDEF_DETERMINATION_DECLARATION_RE = /^\s*determination\s+([A-Za-z_]\w*)\s+on\s+(modify|save)\b/i;
const BDEF_VALIDATION_DECLARATION_RE = /^\s*validation\s+([A-Za-z_]\w*)\s+on\s+(modify|save)\b/i;
const BDEF_INSTANCE_AUTH_RE = /\bauthorization\s+master\s*\(\s*instance\s*\)/i;
const BDEF_GLOBAL_AUTH_RE = /\bauthorization\s+master\s*\(\s*global\s*\)/i;

const CLASS_DEFINITION_START_RE = /^\s*CLASS\s+([A-Za-z_][\w$]*)\s+DEFINITION\b/i;
const CLASS_DEFINITION_DEFERRED_RE = /\bDEFINITION\b.*\bDEFERRED\b/i;
const CLASS_IMPLEMENTATION_START_RE = /^\s*CLASS\s+([A-Za-z_][\w$]*)\s+IMPLEMENTATION\s*\./i;
const PRIVATE_SECTION_RE = /^\s*PRIVATE\s+SECTION\./i;
const ENDCLASS_RE = /^\s*ENDCLASS\./i;
const METHOD_DECLARATION_RE = /^\s*(?:CLASS-)?METHODS\s+([A-Za-z_~][\w~]*)/i;
const METHOD_IMPLEMENTATION_RE = /^\s*METHOD\s+([A-Za-z_~][\w~]*)\s*\./i;

const HANDLER_ACTION_BINDING_RE = /\bFOR\s+ACTION\s+([A-Za-z_]\w*)\s*~\s*([A-Za-z_]\w*)/i;
const HANDLER_ENTITY_BINDING_RE =
  /\bFOR\s+(?!ACTION\b|MODIFY\b|READ\b|VALIDATE\b|DETERMINE\b|INSTANCE\b|GLOBAL\b)([A-Za-z_]\w*)\s*~\s*([A-Za-z_]\w*)/i;
const HANDLER_AUTH_BINDING_RE = /\bAUTHORIZATION\b.*\bFOR\s+([A-Za-z_]\w*)\s+RESULT\b/i;
const HANDLER_DETERMINE_STATEMENT_RE = /\bFOR\s+DETERMINE\s+ON\b/i;
const HANDLER_VALIDATE_STATEMENT_RE = /\bFOR\s+VALIDATE\s+ON\b/i;
const HANDLER_INSTANCE_AUTH_STATEMENT_RE = /\bFOR\s+INSTANCE\s+AUTHORIZATION\b/i;
const HANDLER_GLOBAL_AUTH_STATEMENT_RE = /\bFOR\s+GLOBAL\s+AUTHORIZATION\b/i;

function bindingKey(targetHandlerClass: string, kind: RapHandlerKind, methodName: string, entityAlias: string): string {
  return [targetHandlerClass.toLowerCase(), kind, normalizeMethodName(methodName), entityAlias.toLowerCase()].join('|');
}

export function rapHandlerRequirementKey(requirement: RapHandlerRequirement): string {
  return bindingKey(requirement.targetHandlerClass, requirement.kind, requirement.methodName, requirement.entityAlias);
}

function countChar(value: string, char: string): number {
  return value.split(char).length - 1;
}

/**
 * Collect a BDEF statement that may span multiple lines.
 *
 * RAP behavior definitions are terminated by `;`, but developers routinely
 * split long declarations across lines for readability, e.g.:
 *     action acceptTravel
 *       result [1] $self;
 * We must join the continuation lines before deciding whether a `result`
 * clause is present — otherwise we'd emit `FOR ACTION ... RESULT result` for
 * actions that don't return anything, producing an invalid handler signature.
 *
 * The 20-line safety cutoff guards against runaway scans when the BDEF is
 * malformed or truncated; real declarations rarely exceed 5-6 lines.
 */
function collectStatement(lines: string[], startIdx: number): string {
  let statement = lines[startIdx] ?? '';
  if (statement.includes(';')) return statement;
  for (let j = startIdx + 1; j < lines.length; j += 1) {
    const next = lines[j] ?? '';
    statement += ` ${next}`;
    if (next.includes(';')) break;
    if (j - startIdx > 20) break;
  }
  return statement;
}

/**
 * Collect a multi-line ABAP statement terminated by `.`.
 *
 * Behavior handler declarations are often split across lines:
 *   METHODS set_status_accepted FOR MODIFY
 *     IMPORTING keys FOR ACTION travel~acceptTravel RESULT result.
 * Binding parsing needs the continuation lines; otherwise semantic method
 * names cannot be mapped back to the BDEF action/determination/validation.
 */
function collectAbapStatement(lines: string[], startIdx: number, endIdx: number, maxContinuation = 10): string {
  let statement = lines[startIdx] ?? '';
  for (let j = startIdx + 1; j <= endIdx && j < startIdx + maxContinuation; j += 1) {
    const cont = lines[j] ?? '';
    statement += ` ${cont}`;
    if (/\.\s*$/.test(cont.trim())) break;
  }
  return statement;
}

/**
 * Lowercase a BDEF identifier for use as an ABAP METHOD name.
 *
 * BDEF is case-insensitive for identifier matching but ABAP source code is
 * rendered in lowercase by SAP's pretty printer. We emit lowercase here so
 * the scaffolded METHODS lines match both the `lhc_<alias>` class name and
 * SAP's default code-style. The trailing period (from a terminating `.` or
 * `;` accidentally included by the regex match) is stripped defensively.
 */
function normalizeMethodName(name: string): string {
  return name.replace(/\.$/, '').trim().toLowerCase();
}

/**
 * Derive an alias from an entity name when the BDEF author omits `alias X`.
 *
 * RAP aliases are optional; if absent, SAP falls back to the entity name
 * itself for handler-class derivation. We emulate that by stripping namespace
 * prefixes (`/DMO/ZI_TRAVEL` → `ZI_TRAVEL`) and a short leading prefix like
 * `ZI_` or `I_` (→ `TRAVEL`), then sanitizing any leftover non-identifier
 * characters. Final fallback is `Entity` so the generated `lhc_entity`
 * remains a valid ABAP identifier.
 */
function deriveAlias(entityName: string): string {
  const noNamespace = entityName.split('/').at(-1) ?? entityName;
  const noPrefix = noNamespace.replace(/^[A-Z]{1,4}_/, '');
  const normalized = (noPrefix || noNamespace).replace(/[^A-Za-z0-9_]/g, '');
  return normalized || 'Entity';
}

/**
 * Split a BDEF into per-entity blocks bounded by `define behavior for ... { ... }`.
 *
 * A single interface BDEF can declare behavior for multiple entities
 * (root + compositions), and each block has its own alias, its own actions,
 * and produces its own `lhc_<alias>` handler class. We need the block
 * boundaries so that an action declared under entity A isn't attributed to
 * entity B's handler class.
 *
 * We track brace depth rather than simply splitting on `define behavior` so
 * nested `{ ... }` inside features/draft/etag clauses doesn't close the block
 * prematurely. `seenOpening` avoids closing a block before the first `{` is
 * consumed — `define behavior for X` and the opening brace may be on
 * separate lines.
 */
function parseBehaviorBlocks(source: string): RapBehaviorBlock[] {
  const blocks: RapBehaviorBlock[] = [];
  const lines = source.split('\n');

  let current:
    | {
        entityName: string;
        alias: string;
        startLine: number;
        lines: string[];
        depth: number;
        seenOpening: boolean;
      }
    | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    if (!current) {
      const defineMatch = line.match(BDEF_DEFINE_BEHAVIOR_RE);
      if (!defineMatch) continue;

      const entityName = defineMatch[1] ?? '';
      const alias = defineMatch[2] ?? deriveAlias(entityName);
      current = {
        entityName,
        alias,
        startLine: i + 1,
        lines: [],
        depth: 0,
        seenOpening: false,
      };
    }

    current.lines.push(line);
    if (line.includes('{')) current.seenOpening = true;
    current.depth += countChar(line, '{') - countChar(line, '}');

    if (current.seenOpening && current.depth <= 0) {
      blocks.push({
        entityName: current.entityName,
        alias: current.alias,
        startLine: current.startLine,
        lines: current.lines,
      });
      current = undefined;
    }
  }

  return blocks;
}

function pushRequirement(out: RapHandlerRequirement[], requirement: RapHandlerRequirement, seen: Set<string>): void {
  const key = rapHandlerRequirementKey(requirement);
  if (seen.has(key)) return;
  seen.add(key);
  out.push(requirement);
}

function groupRequirementsByTargetClass(requirements: RapHandlerRequirement[]): Map<string, RapHandlerRequirement[]> {
  const grouped = new Map<string, RapHandlerRequirement[]>();
  for (const req of requirements) {
    const key = req.targetHandlerClass.toLowerCase();
    const list = grouped.get(key) ?? [];
    list.push(req);
    grouped.set(key, list);
  }
  return grouped;
}

function hasActionResultClause(actionDeclaration: string): boolean {
  return /\bresult\b/i.test(actionDeclaration);
}

/**
 * Extract RAP behavior-pool handler method requirements from interface BDEF source.
 *
 * For every behavior block (one per entity in the BDEF), this produces the
 * exact METHOD signatures that the behavior pool's `lhc_<alias>` class must
 * declare for the class to activate. The output is used by:
 *   - findMissingRapHandlerRequirements: to diff against an existing class
 *   - applyRapHandlerSignatures: to synthesize the missing METHODS lines
 *
 * The emitted signatures mirror what SAP's "Create Behavior Implementation"
 * wizard would generate — same FOR MODIFY/FOR DETERMINE ON/FOR VALIDATE ON
 * syntax, same `alias~method` entity reference, same RESULT clause only when
 * the BDEF declares a `result` cardinality.
 */
export function extractRapHandlerRequirements(bdefSource: string): RapHandlerRequirement[] {
  const requirements: RapHandlerRequirement[] = [];
  const seen = new Set<string>();
  const blocks = parseBehaviorBlocks(bdefSource);

  for (const block of blocks) {
    const alias = block.alias;
    // RAP convention: one handler class per entity, named lhc_<alias>.
    // This matches SAP's own templates and the ADT "Create Behavior
    // Implementation Class" wizard — see /DMO/BP_TRAVEL_M and similar.
    const targetHandlerClass = `lhc_${alias.toLowerCase()}`;
    const body = block.lines.join('\n');

    for (let idx = 0; idx < block.lines.length; idx += 1) {
      const line = block.lines[idx] ?? '';
      const declarationLine = block.startLine + idx;

      // Match all BDEF action variants. Order of the optional prefixes matters:
      //   - `static` can appear alone or before `factory`: `static action`,
      //     `static factory action`
      //   - `internal` and `factory` are mutually exclusive but each may
      //     appear after `static`: `internal action`, `factory action`
      //   - the optional `( features: ... )` clause sits between the keyword
      //     `action` and the action name — `action ( features: instance ) Foo`
      // Missing any of these prefixes used to silently drop the requirement,
      // which was the original bug on live /DMO/BP_TRAVEL_M samples.
      const actionMatch = line.match(BDEF_ACTION_DECLARATION_RE);
      if (actionMatch?.[1]) {
        const actionName = actionMatch[1];
        const methodName = normalizeMethodName(actionName);
        // Collapse continuation lines so the `result` clause is visible even
        // when the author split the declaration across multiple lines.
        const actionDecl = collectStatement(block.lines, idx);
        // Emit `RESULT result` only when the BDEF declares a result cardinality.
        // Factory/internal/static actions without a result clause must NOT
        // carry RESULT in the handler signature — the activation check is strict
        // and rejects mismatched signatures with a cryptic "method signature
        // does not match BDL declaration" error.
        const hasResult = hasActionResultClause(actionDecl);
        const resultPart = hasResult ? ' RESULT result' : '';
        pushRequirement(
          requirements,
          {
            kind: 'action',
            methodName,
            entityName: block.entityName,
            entityAlias: alias,
            targetHandlerClass,
            declarationLine,
            signature:
              `METHODS ${methodName} FOR MODIFY\n` + `  IMPORTING keys FOR ACTION ${alias}~${actionName}${resultPart}.`,
          },
          seen,
        );
      }

      const determinationMatch = line.match(BDEF_DETERMINATION_DECLARATION_RE);
      if (determinationMatch?.[1] && determinationMatch[2]) {
        const determinationName = determinationMatch[1];
        const event = determinationMatch[2].toUpperCase();
        const methodName = normalizeMethodName(determinationName);
        pushRequirement(
          requirements,
          {
            kind: 'determination',
            methodName,
            entityName: block.entityName,
            entityAlias: alias,
            targetHandlerClass,
            declarationLine,
            signature:
              `METHODS ${methodName} FOR DETERMINE ON ${event}\n` +
              `  IMPORTING keys FOR ${alias}~${determinationName}.`,
          },
          seen,
        );
      }

      const validationMatch = line.match(BDEF_VALIDATION_DECLARATION_RE);
      if (validationMatch?.[1] && validationMatch[2]) {
        const validationName = validationMatch[1];
        const event = validationMatch[2].toUpperCase();
        const methodName = normalizeMethodName(validationName);
        pushRequirement(
          requirements,
          {
            kind: 'validation',
            methodName,
            entityName: block.entityName,
            entityAlias: alias,
            targetHandlerClass,
            declarationLine,
            signature:
              `METHODS ${methodName} FOR VALIDATE ON ${event}\n` + `  IMPORTING keys FOR ${alias}~${validationName}.`,
          },
          seen,
        );
      }
    }

    // `authorization master ( instance )` → the pool must implement
    // get_instance_authorizations (per-instance row-level checks, imports
    // keys so the handler can evaluate each row individually).
    const instanceAuthMatch = body.match(BDEF_INSTANCE_AUTH_RE);
    if (instanceAuthMatch) {
      pushRequirement(
        requirements,
        {
          kind: 'instance_authorization',
          methodName: 'get_instance_authorizations',
          entityName: block.entityName,
          entityAlias: alias,
          targetHandlerClass,
          declarationLine: block.startLine,
          signature:
            'METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION\n' +
            `  IMPORTING keys REQUEST requested_authorizations FOR ${alias} RESULT result.`,
        },
        seen,
      );
    }

    // `authorization master ( global )` → the pool must implement
    // get_global_authorizations (a single, stateless check for the whole
    // entity; no keys parameter because the decision is not per-row).
    const globalAuthMatch = body.match(BDEF_GLOBAL_AUTH_RE);
    if (globalAuthMatch) {
      pushRequirement(
        requirements,
        {
          kind: 'global_authorization',
          methodName: 'get_global_authorizations',
          entityName: block.entityName,
          entityAlias: alias,
          targetHandlerClass,
          declarationLine: block.startLine,
          signature:
            'METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION\n' +
            `  IMPORTING REQUEST requested_authorizations FOR ${alias} RESULT result.`,
        },
        seen,
      );
    }
  }

  return requirements;
}

/**
 * Find every `CLASS ... DEFINITION` block in an ABAP source, returning the
 * line index range and — if present — the line index of PRIVATE SECTION.
 *
 * Behavior pool sources frequently contain:
 *   - multiple concrete handler classes (`lhc_travel`, `lhc_booking`, ...)
 *   - deferred declarations (`CLASS lhc_travel DEFINITION DEFERRED.`) used
 *     to satisfy forward references in the implementation section; these
 *     have no matching ENDCLASS and must not be confused with the real
 *     definition that follows later in the same file
 *
 * The `i = end` advance at the bottom skips past the ENDCLASS of the class
 * we just processed, so the outer loop doesn't re-enter the same class and
 * double-register ranges.
 */
function parseClassDefinitionRanges(source: string): ClassDefinitionRange[] {
  const lines = source.split('\n');
  const ranges: ClassDefinitionRange[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const startMatch = line.match(CLASS_DEFINITION_START_RE);
    if (!startMatch?.[1]) continue;

    const name = startMatch[1];
    const isDeferred = CLASS_DEFINITION_DEFERRED_RE.test(line);
    if (isDeferred) continue;

    let end = i;
    let privateSection: number | undefined;
    for (let j = i + 1; j < lines.length; j += 1) {
      const inner = lines[j] ?? '';
      if (privateSection === undefined && PRIVATE_SECTION_RE.test(inner)) {
        privateSection = j;
      }
      if (ENDCLASS_RE.test(inner)) {
        end = j;
        break;
      }
    }

    ranges.push({ name, start: i, end, privateSection });
    i = end;
  }

  return ranges;
}

function parseClassImplementationRanges(source: string): ClassImplementationRange[] {
  const lines = source.split('\n');
  const ranges: ClassImplementationRange[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const startMatch = line.match(CLASS_IMPLEMENTATION_START_RE);
    if (!startMatch?.[1]) continue;

    const name = startMatch[1];
    let end = i;
    for (let j = i + 1; j < lines.length; j += 1) {
      const inner = lines[j] ?? '';
      if (ENDCLASS_RE.test(inner)) {
        end = j;
        break;
      }
    }

    ranges.push({ name, start: i, end });
    i = end;
  }

  return ranges;
}

function parseClassImplementationMethods(source: string): Map<string, Set<string>> {
  const lines = source.split('\n');
  const ranges = parseClassImplementationRanges(source);
  const out = new Map<string, Set<string>>();

  for (const range of ranges) {
    const key = range.name.toLowerCase();
    const methods = out.get(key) ?? new Set<string>();

    for (let i = range.start; i <= range.end; i += 1) {
      const line = lines[i] ?? '';
      const match = line.match(METHOD_IMPLEMENTATION_RE);
      if (match?.[1]) methods.add(normalizeMethodName(match[1]));
    }

    out.set(key, methods);
  }

  return out;
}

function parseHandlerDeclarationBinding(statement: string): RapHandlerDeclarationBinding | undefined {
  const actionBinding = statement.match(HANDLER_ACTION_BINDING_RE);
  if (actionBinding?.[1] && actionBinding[2]) {
    return { kind: 'action', entityAlias: actionBinding[1], methodName: actionBinding[2] };
  }

  const entityBinding = statement.match(HANDLER_ENTITY_BINDING_RE);
  if (entityBinding?.[1] && entityBinding[2]) {
    if (HANDLER_DETERMINE_STATEMENT_RE.test(statement)) {
      return { kind: 'determination', entityAlias: entityBinding[1], methodName: entityBinding[2] };
    }
    if (HANDLER_VALIDATE_STATEMENT_RE.test(statement)) {
      return { kind: 'validation', entityAlias: entityBinding[1], methodName: entityBinding[2] };
    }
  }

  const authBinding = statement.match(HANDLER_AUTH_BINDING_RE);
  if (authBinding?.[1]) {
    if (HANDLER_INSTANCE_AUTH_STATEMENT_RE.test(statement)) {
      return {
        kind: 'instance_authorization',
        entityAlias: authBinding[1],
        methodName: 'get_instance_authorizations',
      };
    }
    if (HANDLER_GLOBAL_AUTH_STATEMENT_RE.test(statement)) {
      return {
        kind: 'global_authorization',
        entityAlias: authBinding[1],
        methodName: 'get_global_authorizations',
      };
    }
  }

  return undefined;
}

/**
 * Map BDEF requirement keys to the concrete ABAP method name used in the
 * handler declaration.
 *
 * The generated method name for a BDEF action `acceptTravel` is `accepttravel`,
 * but real behavior pools often declare semantic method names such as
 * `set_status_accepted FOR ACTION travel~acceptTravel`. Stub detection and
 * stub generation must use the declared ABAP method name, otherwise a pool
 * that is already implemented under semantic names is reported as missing.
 */
function parseClassDefinitionHandlerBindings(source: string): Map<string, string> {
  const lines = source.split('\n');
  const ranges = parseClassDefinitionRanges(source);
  const out = new Map<string, string>();

  for (const range of ranges) {
    const targetHandlerClass = range.name;

    for (let i = range.start; i <= range.end; i += 1) {
      const line = lines[i] ?? '';
      const match = line.match(METHOD_DECLARATION_RE);
      if (!match?.[1]) continue;
      const declaredMethodName = normalizeMethodName(match[1]);
      const statement = collectAbapStatement(lines, i, range.end);

      const binding = parseHandlerDeclarationBinding(statement);
      if (binding)
        out.set(
          bindingKey(targetHandlerClass, binding.kind, binding.methodName, binding.entityAlias),
          declaredMethodName,
        );
    }
  }

  return out;
}

/**
 * Parse method declarations (`METHODS ...`) per class definition.
 *
 * The returned Set contains BOTH:
 *   1. Every declared METHOD name in the class (e.g. `submitforapproval`,
 *      `set_status_accepted`, `validate_customer`)
 *   2. Every RAP binding-key those methods are bound to (the action /
 *      determination / validation / authorization referenced in the
 *      `FOR ACTION <alias>~<name>` / `FOR <alias>~<name>` /
 *      `FOR INSTANCE AUTHORIZATION ... FOR <alias>` clauses)
 *
 * Why both? Hand-crafted behavior pools (like SAP's own /DMO/BP_TRAVEL_M)
 * routinely use semantic method names that differ from the BDEF action
 * names — e.g. BDEF `action acceptTravel` bound to METHOD
 * `set_status_accepted` via `FOR ACTION travel~acceptTravel`. The
 * scaffolder's missing-requirement check compares by BDEF identifier, so if
 * we only indexed method names, it would incorrectly report
 * `accepttravel` as missing and try to inject a duplicate METHOD line.
 *
 * METHOD declarations can span multiple lines (one line for the name +
 * continuation lines for FOR / IMPORTING / RESULT), so we join the
 * statement up to its terminating `.` before pattern-matching the binding.
 */
export function parseClassDefinitionMethods(source: string): Map<string, Set<string>> {
  const lines = source.split('\n');
  const ranges = parseClassDefinitionRanges(source);
  const out = new Map<string, Set<string>>();

  for (const range of ranges) {
    const key = range.name.toLowerCase();
    const methods = out.get(key) ?? new Set<string>();

    for (let i = range.start; i <= range.end; i += 1) {
      const line = lines[i] ?? '';
      const match = line.match(METHOD_DECLARATION_RE);
      if (!match?.[1]) continue;
      methods.add(normalizeMethodName(match[1]));

      // Collect the full multi-line METHODS statement so FOR-clause patterns
      // (which usually sit on a continuation line) are visible to the regex.
      const statement = collectAbapStatement(lines, i, range.end);

      // Also index the BDEF-side binding key. This is different from the
      // ABAP method name when developers use semantic names such as
      // `set_status_accepted FOR ACTION travel~acceptTravel`.
      const binding = parseHandlerDeclarationBinding(statement);
      if (binding) methods.add(normalizeMethodName(binding.methodName));
    }

    out.set(key, methods);
  }

  return out;
}

/**
 * Determine which RAP handler requirements are missing from class definitions.
 *
 * If the target handler class (`lhc_<alias>`) doesn't exist in the source at
 * all, every requirement for that class is reported missing so the caller
 * can decide whether to create the class or fall through to another include
 * (the scaffold flow searches `main` → `definitions` → `implementations`).
 *
 * Method-name comparison is case-insensitive because ABAP identifiers
 * are — we normalize on both sides so `METHODS SubmitForApproval ...`
 * matches a BDEF `action SubmitForApproval`.
 */
export function findMissingRapHandlerRequirements(
  requirements: RapHandlerRequirement[],
  classSource: string,
): RapHandlerRequirement[] {
  const classMethods = parseClassDefinitionMethods(classSource);

  return requirements.filter((req) => {
    const methods = classMethods.get(req.targetHandlerClass.toLowerCase());
    if (!methods) return true;
    return !methods.has(normalizeMethodName(req.methodName));
  });
}

export function findMissingRapHandlerImplementationStubs(
  requirements: RapHandlerRequirement[],
  classSource: string,
): RapHandlerRequirement[] {
  const classMethods = parseClassImplementationMethods(classSource);
  const declaredMethodByRequirement = parseClassDefinitionHandlerBindings(classSource);

  return requirements.filter((req) => {
    const methods = classMethods.get(req.targetHandlerClass.toLowerCase());
    if (!methods) return true;
    const implementationMethodName =
      declaredMethodByRequirement.get(rapHandlerRequirementKey(req)) ?? normalizeMethodName(req.methodName);
    return !methods.has(implementationMethodName);
  });
}

/**
 * Insert missing RAP handler signatures into matching `lhc_*` class definitions.
 *
 * Scope and contract:
 *  - Only DEFINITION sections are modified. Use
 *    applyRapHandlerImplementationStubs after this step when the scaffold
 *    should be immediately patchable with edit_method.
 *  - Requirements whose target class (`lhc_<alias>`) is not present in this
 *    source are returned in `skipped`, not silently dropped. The caller can
 *    then try another include (definitions/implementations) or surface a
 *    clear error to the user.
 *  - Edits are applied bottom-up (highest line index first) so that earlier
 *    splice operations don't shift the indices of later ones.
 *  - When a target class exists but has no PRIVATE SECTION at all, the
 *    entire PRIVATE SECTION with the signatures is inserted just before
 *    ENDCLASS — this covers freshly-generated behavior pools where ADT
 *    produced a skeleton without method declarations.
 */
export function applyRapHandlerSignatures(
  classSource: string,
  requirements: RapHandlerRequirement[],
): RapHandlerApplyResult {
  if (requirements.length === 0) {
    return { updatedSource: classSource, inserted: [], skipped: [], changed: false };
  }

  const lines = classSource.split('\n');
  const ranges = parseClassDefinitionRanges(classSource);
  const methodsByClass = parseClassDefinitionMethods(classSource);
  const grouped = groupRequirementsByTargetClass(requirements);

  type Edit = { index: number; lines: string[] };
  const edits: Edit[] = [];
  const inserted: RapHandlerRequirement[] = [];
  const skipped: RapHandlerApplySkipped[] = [];

  for (const [targetClassName, classRequirements] of grouped.entries()) {
    const range = ranges.find((r) => r.name.toLowerCase() === targetClassName);
    if (!range) {
      for (const req of classRequirements) {
        skipped.push({
          requirement: req,
          reason: `Handler class ${req.targetHandlerClass} not found in behavior pool.`,
        });
      }
      continue;
    }

    const existingMethods = methodsByClass.get(targetClassName) ?? new Set<string>();
    const toInsert = classRequirements.filter((req) => !existingMethods.has(normalizeMethodName(req.methodName)));
    if (toInsert.length === 0) continue;

    const signatureLines: string[] = [];
    for (let i = 0; i < toInsert.length; i += 1) {
      const req = toInsert[i]!;
      signatureLines.push(...req.signature.split('\n').map((line) => `    ${line}`));
      if (i < toInsert.length - 1) signatureLines.push('');
      inserted.push(req);
    }

    if (range.privateSection === undefined) {
      const block = ['  PRIVATE SECTION.', ...signatureLines, ''];
      edits.push({ index: range.end, lines: block });
      continue;
    }

    edits.push({
      index: range.privateSection + 1,
      lines: [...signatureLines, ''],
    });
  }

  if (edits.length === 0) {
    return { updatedSource: classSource, inserted, skipped, changed: false };
  }

  const sorted = edits.sort((a, b) => b.index - a.index);
  for (const edit of sorted) {
    lines.splice(edit.index, 0, ...edit.lines);
  }

  return {
    updatedSource: lines.join('\n'),
    inserted,
    skipped,
    changed: inserted.length > 0,
  };
}

export function applyRapHandlerImplementationStubs(
  classSource: string,
  requirements: RapHandlerRequirement[],
  options: { createImplementationBlocks?: boolean; definitionSource?: string } = {},
): RapHandlerApplyResult {
  if (requirements.length === 0) {
    return { updatedSource: classSource, inserted: [], skipped: [], changed: false };
  }

  const lines = classSource.split('\n');
  const definitionRanges = parseClassDefinitionRanges(classSource);
  const implementationRanges = parseClassImplementationRanges(classSource);
  const methodsByClass = parseClassImplementationMethods(classSource);
  const definitionLookupSource = options.definitionSource ? `${options.definitionSource}\n${classSource}` : classSource;
  const declaredMethodByRequirement = parseClassDefinitionHandlerBindings(definitionLookupSource);
  const grouped = groupRequirementsByTargetClass(requirements);

  type Edit = { index: number; lines: string[] };
  const edits: Edit[] = [];
  const inserted: RapHandlerRequirement[] = [];
  const skipped: RapHandlerApplySkipped[] = [];

  for (const [targetClassName, classRequirements] of grouped.entries()) {
    const existingMethods = methodsByClass.get(targetClassName) ?? new Set<string>();
    const seenMethods = new Set(existingMethods);
    const toInsert: Array<{ requirement: RapHandlerRequirement; implementationMethodName: string }> = [];
    for (const req of classRequirements) {
      const implementationMethodName =
        declaredMethodByRequirement.get(rapHandlerRequirementKey(req)) ?? normalizeMethodName(req.methodName);
      if (seenMethods.has(implementationMethodName)) continue;
      seenMethods.add(implementationMethodName);
      toInsert.push({ requirement: req, implementationMethodName });
    }
    if (toInsert.length === 0) continue;

    const stubLines: string[] = [];
    for (let i = 0; i < toInsert.length; i += 1) {
      const { requirement, implementationMethodName } = toInsert[i]!;
      stubLines.push(`  METHOD ${implementationMethodName}.`, '  ENDMETHOD.');
      if (i < toInsert.length - 1) stubLines.push('');
      inserted.push(requirement);
    }

    const implementationRange = implementationRanges.find((r) => r.name.toLowerCase() === targetClassName);
    if (implementationRange) {
      edits.push({ index: implementationRange.end, lines: [...stubLines, ''] });
      continue;
    }

    const hasDefinition = definitionRanges.some((r) => r.name.toLowerCase() === targetClassName);
    if (options.createImplementationBlocks && hasDefinition) {
      edits.push({
        index: lines.length,
        lines: ['', `CLASS ${classRequirements[0]!.targetHandlerClass} IMPLEMENTATION.`, ...stubLines, 'ENDCLASS.'],
      });
      continue;
    }

    for (const { requirement } of toInsert) {
      skipped.push({
        requirement,
        reason: `Implementation class ${requirement.targetHandlerClass} not found in behavior pool.`,
      });
    }
    inserted.splice(inserted.length - toInsert.length, toInsert.length);
  }

  if (edits.length === 0) {
    return { updatedSource: classSource, inserted, skipped, changed: false };
  }

  const sorted = edits.sort((a, b) => b.index - a.index);
  for (const edit of sorted) {
    lines.splice(edit.index, 0, ...edit.lines);
  }

  return {
    updatedSource: lines.join('\n'),
    inserted,
    skipped,
    changed: inserted.length > 0,
  };
}

function countInserted(results: RapHandlerSectionApplyResults): number {
  return (
    results.main.inserted.length +
    (results.definitions?.inserted.length ?? 0) +
    (results.implementations?.inserted.length ?? 0)
  );
}

function changedSectionsFrom(changed: Record<RapHandlerSectionName, boolean>): RapHandlerSectionName[] {
  return (Object.keys(changed) as RapHandlerSectionName[]).filter((section) => changed[section]);
}

function uniqueRequirementsByTargetClass(requirements: RapHandlerRequirement[]): RapHandlerRequirement[] {
  const seen = new Set<string>();
  const out: RapHandlerRequirement[] = [];
  for (const requirement of requirements) {
    const key = requirement.targetHandlerClass.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(requirement);
  }
  return out;
}

function hasClassDefinition(sections: RapHandlerSourceSections, targetHandlerClass: string): boolean {
  const target = targetHandlerClass.toLowerCase();
  return [sections.main, sections.definitions, sections.implementations]
    .filter(Boolean)
    .some((source) => parseClassDefinitionRanges(source ?? '').some((range) => range.name.toLowerCase() === target));
}

function hasClassImplementation(sections: RapHandlerSourceSections, targetHandlerClass: string): boolean {
  const target = targetHandlerClass.toLowerCase();
  return [sections.main, sections.definitions, sections.implementations]
    .filter(Boolean)
    .some((source) =>
      parseClassImplementationRanges(source ?? '').some((range) => range.name.toLowerCase() === target),
    );
}

function appendBlocksToSection(source: string | undefined, blocks: string[]): string | undefined {
  if (blocks.length === 0) return source;
  const blockText = blocks.join('\n\n');
  if (!source || source.trim().length === 0) return `${blockText}\n`;
  const separator = source.endsWith('\n') ? (source.endsWith('\n\n') ? '' : '\n') : '\n\n';
  return `${source}${separator}${blockText}\n`;
}

function handlerDefinitionSkeleton(targetHandlerClass: string): string {
  return `CLASS ${targetHandlerClass} DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
ENDCLASS.`;
}

function handlerImplementationSkeleton(targetHandlerClass: string): string {
  return `CLASS ${targetHandlerClass} IMPLEMENTATION.
ENDCLASS.`;
}

/**
 * Append `lhc_<alias>` skeletons to the CCIMP include only.
 *
 * Both the DEFINITION and the IMPLEMENTATION block of every missing handler
 * class go into `sections.implementations`. CCDEF (`sections.definitions`) is
 * **never modified**. This matches:
 *   - ABAP keyword doc `ABENABP_HANDLER_CLASS_GLOSRY`: handler classes live
 *     in the CCIMP include.
 *   - ABAP keyword doc `ABENABP_CL_ABAP_BEH_HANDLER`: "A handler class can be
 *     defined in the CCIMP include of an ABAP behavior pool. It consists of
 *     method declarations and implementations."
 *   - SAP demo class `BP_DEMO_RAP_STRICT` (package `SABAPDEMOS`): empty CCDEF,
 *     full DEFINITION+IMPLEMENTATION pair in CCIMP. Captured live as fixtures
 *     in `tests/fixtures/abap/bp-demo-rap-strict-{ccdef,ccimp}.abap`.
 *   - The activator's error message itself: *"Local classes of
 *     CL_ABAP_BEHAVIOR_HANDLER can only be derived in the 'Local
 *     Definitions/Implementations' of a global BEHAVIOR class"* — the quoted
 *     phrase is the literal name of the CCIMP tab in Eclipse ADT.
 *
 * Per-class block order in CCIMP is DEFINITION first, then IMPLEMENTATION, so
 * the IMPLEMENTATION block always sees its DEFINITION above it (ABAP forward-
 * reference rule).
 */
export function ensureRapHandlerSkeletons(
  sections: RapHandlerSourceSections,
  requirements: RapHandlerRequirement[],
): RapHandlerSkeletonResult {
  const targetRequirements = uniqueRequirementsByTargetClass(requirements);
  const combinedBlocks: string[] = [];
  const createdDefinitions: string[] = [];
  const createdImplementations: string[] = [];

  for (const requirement of targetRequirements) {
    const targetHandlerClass = requirement.targetHandlerClass;
    if (!hasClassDefinition(sections, targetHandlerClass)) {
      combinedBlocks.push(handlerDefinitionSkeleton(targetHandlerClass));
      createdDefinitions.push(targetHandlerClass);
    }
    if (!hasClassImplementation(sections, targetHandlerClass)) {
      combinedBlocks.push(handlerImplementationSkeleton(targetHandlerClass));
      createdImplementations.push(targetHandlerClass);
    }
  }

  const anyCreated = createdDefinitions.length > 0 || createdImplementations.length > 0;
  const changed = {
    main: false,
    definitions: false,
    implementations: anyCreated,
  };

  return {
    sections: {
      main: sections.main,
      definitions: sections.definitions,
      implementations: appendBlocksToSection(sections.implementations, combinedBlocks),
    },
    createdDefinitions,
    createdImplementations,
    changed,
    changedSections: changedSectionsFrom(changed),
  };
}

/**
 * Build the source used to resolve semantic method names while creating stubs.
 *
 * The declaration (`METHODS set_status_accepted FOR ACTION travel~acceptTravel`)
 * and implementation (`METHOD set_status_accepted.`) can live in different ADT
 * includes. Stub generation therefore needs the post-signature sources for all
 * sections, not only the include currently being edited.
 */
function buildDefinitionLookupSource(
  originalSections: RapHandlerSourceSections,
  signaturePlan: SignatureFallthroughPlan,
): string {
  return [
    signaturePlan.updatedSections.main,
    signaturePlan.updatedSections.definitions ?? originalSections.definitions,
    signaturePlan.updatedSections.implementations ?? originalSections.implementations,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Try signature insertion in ADT include order: main → definitions → implementations.
 *
 * A handler class can legally exist in any of these includes depending on how
 * ADT generated the behavior pool. The unresolved list is deliberately carried
 * forward between sections so a requirement is inserted exactly once, in the
 * first include that contains its concrete `lhc_<alias> DEFINITION`.
 */
function applySignaturesAcrossSections(
  sections: RapHandlerSourceSections,
  missingSignatures: RapHandlerRequirement[],
): SignatureFallthroughPlan {
  const main = applyRapHandlerSignatures(sections.main, missingSignatures);
  let unresolved = main.skipped.map((entry) => entry.requirement);

  let definitions: RapHandlerApplyResult | undefined;
  if (unresolved.length > 0 && sections.definitions) {
    definitions = applyRapHandlerSignatures(sections.definitions, unresolved);
    unresolved = definitions.skipped.map((entry) => entry.requirement);
  }

  let implementations: RapHandlerApplyResult | undefined;
  if (unresolved.length > 0 && sections.implementations) {
    implementations = applyRapHandlerSignatures(sections.implementations, unresolved);
    unresolved = implementations.skipped.map((entry) => entry.requirement);
  }

  return {
    signatures: { main, definitions, implementations },
    updatedSections: {
      main: main.updatedSource,
      definitions: definitions?.updatedSource ?? sections.definitions,
      implementations: implementations?.updatedSource ?? sections.implementations,
    },
    unresolved,
  };
}

/**
 * Build the complete auto-apply plan for a behavior pool without doing I/O.
 *
 * This is intentionally pure: the MCP handler owns safety checks, locks,
 * linting, and ADT writes; this helper owns the RAP-specific sequencing:
 *   1. insert missing METHODS declarations into whichever include contains
 *      the matching `lhc_<alias> DEFINITION`
 *   2. skip stubs whose declarations still could not be placed
 *   3. insert empty METHOD stubs using the concrete ABAP method name from
 *      existing/new declarations, including semantic names bound via
 *      `FOR ACTION alias~ActionName`
 *
 * Keeping this plan here prevents `intent.ts` from duplicating RAP parser
 * invariants such as "deferred classes are not editable" and "stub method
 * names come from declarations, not necessarily from BDEF action names".
 */
export function applyRapHandlerScaffold(
  sections: RapHandlerSourceSections,
  missingSignatures: RapHandlerRequirement[],
  missingImplementationStubs: RapHandlerRequirement[],
): RapHandlerScaffoldPlan {
  const skeletonPlan = ensureRapHandlerSkeletons(sections, [...missingSignatures, ...missingImplementationStubs]);
  const signaturePlan = applySignaturesAcrossSections(skeletonPlan.sections, missingSignatures);

  // A METHOD stub is only useful after its declaration exists. If the target
  // `lhc_*` class was not found anywhere, suppress the stub for that unresolved
  // declaration rather than creating an implementation block with no matching
  // RAP handler signature.
  const unresolvedDeclarationKeys = new Set(signaturePlan.unresolved.map(rapHandlerRequirementKey));
  const stubRequirements = missingImplementationStubs.filter(
    (req) => !unresolvedDeclarationKeys.has(rapHandlerRequirementKey(req)),
  );
  const definitionLookupSource = buildDefinitionLookupSource(skeletonPlan.sections, signaturePlan);

  const stubMain = applyRapHandlerImplementationStubs(signaturePlan.updatedSections.main, stubRequirements, {
    createImplementationBlocks: true,
    definitionSource: definitionLookupSource,
  });
  const stubDefinitions = skeletonPlan.sections.definitions
    ? applyRapHandlerImplementationStubs(
        signaturePlan.updatedSections.definitions ?? skeletonPlan.sections.definitions,
        stubRequirements,
        {
          definitionSource: definitionLookupSource,
        },
      )
    : undefined;
  const stubImplementations = skeletonPlan.sections.implementations
    ? applyRapHandlerImplementationStubs(
        signaturePlan.updatedSections.implementations ?? skeletonPlan.sections.implementations,
        stubRequirements,
        { createImplementationBlocks: true, definitionSource: definitionLookupSource },
      )
    : undefined;

  const changed = {
    main: skeletonPlan.changed.main || signaturePlan.signatures.main.changed || stubMain.changed,
    definitions:
      skeletonPlan.changed.definitions ||
      (signaturePlan.signatures.definitions?.changed ?? false) ||
      (stubDefinitions?.changed ?? false),
    implementations:
      skeletonPlan.changed.implementations ||
      (signaturePlan.signatures.implementations?.changed ?? false) ||
      (stubImplementations?.changed ?? false),
  };
  const changedSections = changedSectionsFrom(changed);

  return {
    sections: {
      main: stubMain.updatedSource,
      definitions: stubDefinitions?.updatedSource ?? signaturePlan.updatedSections.definitions,
      implementations: stubImplementations?.updatedSource ?? signaturePlan.updatedSections.implementations,
    },
    skeletons: {
      createdDefinitions: skeletonPlan.createdDefinitions,
      createdImplementations: skeletonPlan.createdImplementations,
      changed: skeletonPlan.changed,
      changedSections: skeletonPlan.changedSections,
    },
    signatures: signaturePlan.signatures,
    implementationStubs: {
      main: stubMain,
      definitions: stubDefinitions,
      implementations: stubImplementations,
    },
    unresolved: signaturePlan.unresolved,
    changed,
    changedSections,
    insertedSignatureCount: countInserted(signaturePlan.signatures),
    insertedImplementationStubCount: countInserted({
      main: stubMain,
      definitions: stubDefinitions,
      implementations: stubImplementations,
    }),
  };
}
