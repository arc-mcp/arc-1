/**
 * High-level RAP behavior pool generator (PR-C / SAPWrite generate_behavior_implementation).
 *
 * One-shot equivalent of Eclipse ADT's "Generate Behavior Implementation"
 * Cmd+1 quickfix on a behavior pool class. Composes existing capabilities:
 *
 *   1. parseClassMetadata.rootEntityRef  — auto-discover the bound BDEF
 *   2. extractRapHandlerRequirements     — derive every required handler method
 *   3. applyRapHandlerScaffold           — auto-create lhc_<alias> skeletons,
 *                                          inject signatures + empty stubs
 *   4. updateSource (per include URL)    — write CCDEF + CCIMP under one lock
 *   5. activateBatch                     — optional final activation
 *
 * This avoids the broken `/sap/bc/adt/quickfixes/proposals/.../create_class_implementation`
 * server endpoint (HTTP 500 on a4h regardless of payload — verified live during research).
 * Local generation is deterministic, fully unit-testable, and reuses the proven PR #257
 * include-write path.
 *
 * Inputs:
 *   className — the behavior pool class (e.g. "ZBP_DM_PROJECT")
 *   options.bdefName — explicit BDEF override; default is auto-discovery from rootEntityRef
 *   options.targetAlias — restrict scaffold to one entity alias (case-insensitive)
 *   options.activate — also run SAPActivate after writing (default true)
 *   options.dryRun — preview without writing/activating (default false)
 *
 * Output:
 *   `RapGenerateResult` carries the discovery, validation, scaffold, and activation
 *   outcomes. Activation failures matching the "stale active CCDEF/CCIMP placeholder
 *   + new inactive content" coupling DO NOT throw — they return `activation.success=false`
 *   with a guided `hint` so the caller can surface the recovery path. Other activation
 *   failures rethrow.
 */

import type { AdtClient } from './client.js';
import { lockObject, unlockObject, updateSource } from './crud.js';
import { activateBatch } from './devtools.js';
import { AdtApiError, AdtSafetyError } from './errors.js';
import {
  applyRapHandlerScaffold,
  extractRapHandlerRequirements,
  findMissingRapHandlerImplementationStubs,
  findMissingRapHandlerRequirements,
  type RapHandlerRequirement,
} from './rap-handlers.js';

/** Options for `generateBehaviorImplementation`. */
export interface RapGenerateOptions {
  /** Explicit BDEF name (overrides rootEntityRef auto-discovery). */
  bdefName?: string;
  /** Restrict scaffold to a single entity alias (case-insensitive). */
  targetAlias?: string;
  /** Also run `SAPActivate` on the class after writing (default `true`). */
  activate?: boolean;
  /** Preview the plan without writing or activating (default `false`). */
  dryRun?: boolean;
  /** Optional transport request to attribute writes to. */
  transport?: string;
}

/** Discovery + validation diagnostics. */
export interface RapGenerateDiscovery {
  className: string;
  bdefName: string;
  /** Where the BDEF name came from. */
  source: 'rootEntityRef' | 'explicit';
  /** Class metadata category (must be `behaviorPool`). */
  classCategory: string;
}

export interface RapGenerateValidation {
  /** MAIN source contains a `FOR BEHAVIOR OF <bdef>` clause that points at the discovered BDEF. */
  mainHasForBehaviorOf: boolean;
  /** BDEF source contains `managed implementation in class <className>` (or `unmanaged …`) bound to the class. */
  bdefBindsClass: boolean;
  /** Free-text reason when one of the cross-references doesn't match. */
  mismatchReason?: string;
}

export interface RapGenerateActivation {
  success: boolean;
  /** Human-friendly recovery hint when `success === false` for a known soft-failure mode. */
  hint?: string;
  /** Activation messages from SAP (errors + warnings + info). */
  messages?: string[];
}

export interface RapGenerateResult {
  discovery: RapGenerateDiscovery;
  validation: RapGenerateValidation;
  /** Whether any include source actually changed during scaffolding. */
  scaffoldChanged: boolean;
  /** Sections updated by the scaffold (e.g. ['definitions', 'implementations']). */
  changedSections: Array<'main' | 'definitions' | 'implementations'>;
  /** Counts by category for telemetry / talk demos. */
  inserted: {
    signatures: number;
    stubs: number;
    autoCreatedSkeletons: number;
  };
  /** Required handlers parsed out of the BDEF (post `targetAlias` filter). */
  required: RapHandlerRequirement[];
  /** Activation report; absent when `activate=false` or when scaffold made no changes. */
  activation?: RapGenerateActivation;
  /** Echoes the `dryRun` request flag for caller convenience. */
  dryRun: boolean;
}

/**
 * Classify a `generate_behavior_implementation` outcome as MCP success vs error.
 *
 * The orchestrator never throws on activation failure — it returns a structured
 * result so the caller can see what was scaffolded. The handler then decides
 * which MCP result code to surface. See Codex review on PR #260 (P1):
 *   - activation absent (dryRun / activate=false / no scaffold change + no activation) → success
 *   - activation.success === true → success
 *   - activation.success === false WITH hint (e.g. stale-active CCDEF coupling) → success
 *     (the source is correct; the user follows the recovery path)
 *   - activation.success === false WITHOUT hint → error (real compile failure)
 */
export function isRapGenerateResultSuccess(result: RapGenerateResult): boolean {
  if (!result.activation) return true;
  if (result.activation.success) return true;
  return Boolean(result.activation.hint);
}

/**
 * Recovery hint for the well-known "stale active CCDEF/CCIMP placeholder + new
 * inactive handlers" activation rejection. Surfaced verbatim when SAP returns
 * `Local classes of "CL_ABAP_BEHAVIOR_HANDLER" can only be derived in the
 * "Local Definitions/Implementations" of a global BEHAVIOR class`. The hint is
 * intentionally specific — generic "try Eclipse" advice would not unblock the
 * SEGW→RAP migration skill.
 */
const STALE_ACTIVE_HINT =
  'Activation rejected with the well-known "Local classes of CL_ABAP_BEHAVIOR_HANDLER…" error. ' +
  'This typically means the active CCDEF/CCIMP for this class are still SAP placeholder comments ' +
  'while the inactive copies now contain real handlers, and RAP refuses the inactive→active transition. ' +
  'Recovery options: (a) activate the class once via Eclipse "Generate Behavior Implementation" wizard ' +
  '(it bypasses this coupling), or (b) delete and recreate the class via SAPWrite(action="delete", type="CLAS") ' +
  'followed by SAPWrite(action="create", type="CLAS", …) and rerun generate_behavior_implementation against ' +
  'the freshly created class. The just-written CCDEF/CCIMP source is correct and reusable in both recovery paths.';

/** Build the include URL for CCDEF/CCIMP/macros/testclasses (mirror of object-types.ts classIncludeUrl). */
function classIncludeUrlFor(
  name: string,
  include: 'definitions' | 'implementations' | 'macros' | 'testclasses',
): string {
  return `/sap/bc/adt/oo/classes/${encodeURIComponent(name)}/includes/${include}`;
}

function classObjectUrl(name: string): string {
  return `/sap/bc/adt/oo/classes/${encodeURIComponent(name)}`;
}

function classMainSourceUrl(name: string): string {
  return `${classObjectUrl(name)}/source/main`;
}

const FOR_BEHAVIOR_OF_RE = /\bfor\s+behavior\s+of\s+(\w+)/i;
const MANAGED_IMPL_RE = /\b(?:managed|unmanaged|projection)\s+implementation\s+in\s+class\s+(\w+)\s+unique\b/i;
/**
 * "Local classes of CL_ABAP_BEHAVIOR_HANDLER…" is the activation rejection that
 * happens when the active CCDEF/CCIMP placeholders are out of sync with the new
 * inactive content. We recognize it by the stable English fragment SAP emits in
 * the activation message body — the message text is identical across 7.50 and
 * 7.58 (verified live during PR-C research, 2026-05-10).
 */
const STALE_ACTIVE_RE = /local classes of\s+["']?cl_abap_behavior_handler["']?\s+can\s+only\s+be\s+derived/i;

/**
 * Run the high-level "Generate Behavior Implementation" flow against a
 * behavior pool class. See module-level docs for the contract.
 */
export async function generateBehaviorImplementation(
  client: AdtClient,
  className: string,
  options: RapGenerateOptions = {},
): Promise<RapGenerateResult> {
  const dryRun = options.dryRun === true;
  const activateRequested = options.activate !== false; // default true
  const targetAlias = (options.targetAlias ?? '').trim().toLowerCase();
  const transport = options.transport;

  if (!className?.trim()) {
    throw new AdtSafetyError('generate_behavior_implementation: className is required.');
  }
  const cleanClassName = className.trim();

  // ── Phase 1: discovery ────────────────────────────────────────────────
  const metadata = await client.getClassMetadata(cleanClassName);
  if (metadata.category !== 'behaviorPool') {
    throw new AdtSafetyError(
      `generate_behavior_implementation: class ${cleanClassName} is not a RAP behavior pool ` +
        `(class:category=${metadata.category || '<empty>'}). The action only operates on classes ` +
        `marked behaviorPool. Create the class via SAPWrite(action="create", type="CLAS") with a ` +
        `'CLASS … FOR BEHAVIOR OF <bdef>' DEFINITION header and ensure the BDEF is active first.`,
    );
  }

  const explicitBdef = options.bdefName?.trim();
  let bdefName = explicitBdef ?? metadata.rootEntityRef?.name ?? '';
  const discoverySource: 'explicit' | 'rootEntityRef' = explicitBdef ? 'explicit' : 'rootEntityRef';
  if (!bdefName) {
    throw new AdtSafetyError(
      `generate_behavior_implementation: cannot auto-discover BDEF for ${cleanClassName} — ` +
        `class metadata has no rootEntityRef. Pass an explicit "bdefName" parameter to override.`,
    );
  }
  bdefName = bdefName.toUpperCase();

  // ── Phase 2: read sources + cross-validate ────────────────────────────
  const structured = await client.getClassStructured(cleanClassName);
  const mainSource = structured.main ?? '';
  const definitionsSource = structured.definitions ?? '';
  const implementationsSource = structured.implementations ?? '';
  const bdefRead = await client.getBdef(bdefName);
  const bdefSource = bdefRead.source;

  const mainBdefMatch = FOR_BEHAVIOR_OF_RE.exec(mainSource);
  const bdefClassMatch = MANAGED_IMPL_RE.exec(bdefSource);
  const mainBdefRef = mainBdefMatch?.[1]?.toUpperCase();
  const bdefClassRef = bdefClassMatch?.[1]?.toUpperCase();

  const validation: RapGenerateValidation = {
    mainHasForBehaviorOf: Boolean(mainBdefRef),
    bdefBindsClass: Boolean(bdefClassRef),
  };
  const mismatches: string[] = [];
  if (!mainBdefRef) {
    mismatches.push(`MAIN source for ${cleanClassName} does not contain "FOR BEHAVIOR OF <bdef>"`);
  } else if (mainBdefRef !== bdefName) {
    mismatches.push(`MAIN binds BDEF ${mainBdefRef} but discovery resolved to ${bdefName}`);
  }
  if (!bdefClassRef) {
    mismatches.push(`BDEF ${bdefName} does not contain "managed implementation in class <class> unique"`);
  } else if (bdefClassRef !== cleanClassName.toUpperCase()) {
    mismatches.push(`BDEF ${bdefName} binds class ${bdefClassRef} but we are generating for ${cleanClassName}`);
  }
  if (mismatches.length > 0) {
    validation.mismatchReason = mismatches.join('; ');
  }
  if (validation.mismatchReason && !dryRun) {
    throw new AdtSafetyError(
      `generate_behavior_implementation: cross-reference validation failed (${validation.mismatchReason}). ` +
        `Refusing to mutate. Re-run with dryRun=true to inspect the report and fix the source files first.`,
    );
  }

  // ── Phase 3: scaffold plan ────────────────────────────────────────────
  let requirements = extractRapHandlerRequirements(bdefSource);
  if (targetAlias) {
    requirements = requirements.filter((req) => req.entityAlias.toLowerCase() === targetAlias);
  }

  const combinedSource = [mainSource, definitionsSource, implementationsSource].filter(Boolean).join('\n\n');
  const missingSignatures = findMissingRapHandlerRequirements(requirements, combinedSource);
  const missingStubs = findMissingRapHandlerImplementationStubs(requirements, combinedSource);

  const scaffoldPlan = applyRapHandlerScaffold(
    {
      main: mainSource,
      definitions: definitionsSource || undefined,
      implementations: implementationsSource || undefined,
    },
    missingSignatures,
    missingStubs,
  );

  const result: RapGenerateResult = {
    discovery: {
      className: cleanClassName,
      bdefName,
      source: discoverySource,
      classCategory: metadata.category,
    },
    validation,
    scaffoldChanged: scaffoldPlan.changedSections.length > 0,
    changedSections: scaffoldPlan.changedSections.filter(
      (section): section is 'main' | 'definitions' | 'implementations' =>
        section === 'main' || section === 'definitions' || section === 'implementations',
    ),
    inserted: {
      signatures: scaffoldPlan.insertedSignatureCount,
      stubs: scaffoldPlan.insertedImplementationStubCount,
      autoCreatedSkeletons:
        (scaffoldPlan.skeletons?.createdDefinitions.length ?? 0) +
        (scaffoldPlan.skeletons?.createdImplementations.length ?? 0),
    },
    required: requirements,
    dryRun,
  };

  // Dry-run short-circuits before any side effects.
  if (dryRun) {
    return result;
  }

  const objectUrl = classObjectUrl(cleanClassName);

  // ── Phase 4: write (only when scaffold has changes) ───────────────────
  // When scaffoldChanged=false, all handlers are already in place — skip the
  // lock+write cycle entirely. Activation still runs below if requested, because
  // a populated-but-inactive class is a realistic rerun/recovery state after
  // earlier manual include writes (Codex review note on PR #260).
  if (result.scaffoldChanged) {
    await client.http.withStatefulSession(async (session) => {
      const lock = await lockObject(session, client.safety, objectUrl, 'MODIFY');
      const effectiveTransport = transport ?? (lock.corrNr || undefined);
      try {
        if (scaffoldPlan.changed.main && scaffoldPlan.sections.main !== mainSource) {
          await updateSource(
            session,
            client.safety,
            classMainSourceUrl(cleanClassName),
            scaffoldPlan.sections.main,
            lock.lockHandle,
            effectiveTransport,
          );
        }
        if (scaffoldPlan.changed.definitions && scaffoldPlan.sections.definitions) {
          await updateSource(
            session,
            client.safety,
            classIncludeUrlFor(cleanClassName, 'definitions'),
            scaffoldPlan.sections.definitions,
            lock.lockHandle,
            effectiveTransport,
          );
        }
        if (scaffoldPlan.changed.implementations && scaffoldPlan.sections.implementations) {
          await updateSource(
            session,
            client.safety,
            classIncludeUrlFor(cleanClassName, 'implementations'),
            scaffoldPlan.sections.implementations,
            lock.lockHandle,
            effectiveTransport,
          );
        }
      } finally {
        try {
          await unlockObject(session, objectUrl, lock.lockHandle);
        } catch {
          // best-effort-cleanup: surface the original error, not an unlock failure
        }
      }
    });
  }

  // ── Phase 5: optional activation ──────────────────────────────────────
  if (activateRequested) {
    try {
      const activationOutcome = await activateBatch(client.http, client.safety, [
        { url: objectUrl, name: cleanClassName },
      ]);
      const detailMessages = (activationOutcome.details ?? []).map((d) => d.text).filter(Boolean);
      const allMessages = [...(activationOutcome.messages ?? []), ...detailMessages];
      if (activationOutcome.success) {
        result.activation = { success: true, messages: allMessages };
      } else {
        const matchedStaleActive = allMessages.some((msg) => STALE_ACTIVE_RE.test(msg));
        result.activation = {
          success: false,
          messages: allMessages,
          hint: matchedStaleActive ? STALE_ACTIVE_HINT : undefined,
        };
      }
    } catch (err) {
      // The activateBatch path normally returns a result rather than throwing,
      // but RAP-not-available / network errors / safety errors propagate. The
      // stale-active soft-failure is detected via message inspection above.
      // For unrecognised errors we attach the source-of-truth error message but
      // keep the result structure so callers can still see the scaffold report.
      if (err instanceof AdtApiError && STALE_ACTIVE_RE.test(err.message)) {
        result.activation = {
          success: false,
          messages: [err.message],
          hint: STALE_ACTIVE_HINT,
        };
      } else {
        throw err;
      }
    }
  }

  return result;
}
