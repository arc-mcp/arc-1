/**
 * SAPWrite actions — RAP behavior scaffolding. Split from write.ts (Stage D).
 */

import { lockObject, unlockObject, updateSource } from '../../adt/crud.js';
import { generateBehaviorImplementation, isRapGenerateResultSuccess } from '../../adt/rap-generate.js';
import {
  applyRapHandlerScaffold,
  extractRapHandlerRequirements,
  findMissingRapHandlerImplementationStubs,
  findMissingRapHandlerRequirements,
} from '../../adt/rap-handlers.js';
import { cachedFeatures } from '../feature-cache.js';
import { classIncludeUrl } from '../object-types.js';
import { errorResult, type ToolResult, textResult } from '../shared.js';
import { mergePreWriteWarnings, type PreWriteLintResult, runPreWriteLint } from '../write-helpers.js';
import type { SapWriteContext } from './context.js';

export async function writeActionScaffoldRapHandlers(ctx: SapWriteContext): Promise<ToolResult> {
  const {
    client,
    args,
    config,
    cachingLayer,
    type,
    name,
    transport,
    lintOverride,
    objectUrl,
    srcUrl,
    invalidateWrittenObject,
    enforcePackageForExistingObject,
  } = ctx;
  // What this action does:
  //   Given a behavior-pool class (ZBP_*) and its interface BDEF, inspect
  //   the class for every `lhc_<alias>` local handler class and make
  //   sure it declares a METHOD for every action / determination /
  //   validation / authorization master the BDEF requires. When autoApply
  //   is true, missing METHODS signatures plus empty METHOD stubs are
  //   inserted directly and the class is saved.
  //
  // Why this exists:
  //   Without it, the LLM agent trying to author a RAP behavior pool has
  //   to manually read the BDEF, compute the required handler signatures,
  //   paste them into the correct local class, and then save — a
  //   boilerplate-heavy step that is easy to get wrong (alias case,
  //   RESULT vs no RESULT, factory/static modifiers). The activation
  //   errors for an incomplete pool are particularly unhelpful. See
  //   docs/plans/completed/rap-onprem-agent-gap-closure.md.
  if (type !== 'CLAS') {
    return errorResult('scaffold_rap_handlers is only supported for type=CLAS behavior pool classes.');
  }
  const bdefName = String(args.bdefName ?? '').trim();
  if (!bdefName) {
    return errorResult('"bdefName" is required for scaffold_rap_handlers (interface behavior definition name).');
  }
  const autoApply = Boolean(args.autoApply ?? false);
  const targetAlias = String(args.targetAlias ?? '')
    .trim()
    .toLowerCase();

  if (autoApply) {
    await enforcePackageForExistingObject();
  }

  // Why scan all three CLAS includes (main, definitions, implementations):
  //   Behavior-pool handler classes CAN live in any of the three, and
  //   which include they occupy depends on how the pool was generated:
  //     - "main" (source/main) — unusual; some hand-written pools put
  //       lhc_* alongside the global class definition
  //     - "definitions" (CCDEF) — the ADT "Create Behavior Impl Class"
  //       wizard default target
  //     - "implementations" (CCIMP) — older SAP templates and every
  //       example under /DMO/* ship the handler classes here
  //   We read all three so the diff (findMissingRapHandlerRequirements)
  //   reflects what's actually declared anywhere in the class, and the
  //   apply flow can fall through main → definitions → implementations.
  const classStructured = await client.getClassStructured(name);
  const classMainSource = classStructured.main ?? '';
  const classDefinitionsSource = classStructured.definitions ?? '';
  const classImplementationsSource = classStructured.implementations ?? '';
  const classCombinedSource = [classMainSource, classDefinitionsSource, classImplementationsSource]
    .filter(Boolean)
    .join('\n\n');
  const bdefSource = cachingLayer
    ? (await cachingLayer.getSource('BDEF', bdefName, (ifNoneMatch) => client.getBdef(bdefName, { ifNoneMatch })))
        .source
    : (await client.getBdef(bdefName)).source;

  let requirements = extractRapHandlerRequirements(bdefSource);
  if (targetAlias) {
    requirements = requirements.filter((req) => req.entityAlias.toLowerCase() === targetAlias);
  }

  if (requirements.length === 0) {
    const allAliases = Array.from(new Set(extractRapHandlerRequirements(bdefSource).map((req) => req.entityAlias)));
    const aliasHint =
      targetAlias && allAliases.length > 0
        ? ` Available aliases in ${bdefName}: ${allAliases.join(', ')}.`
        : ' No RAP action/determination/validation/auth handler declarations were found in the BDEF source.';
    return errorResult(`No RAP handler requirements were found for the requested scope.${aliasHint}`);
  }

  const missing = findMissingRapHandlerRequirements(requirements, classCombinedSource);
  const missingImplementationStubs = findMissingRapHandlerImplementationStubs(requirements, classCombinedSource);
  const summary = {
    className: name,
    bdefName,
    targetAlias: targetAlias || undefined,
    scannedSections: [
      'main',
      classDefinitionsSource ? 'definitions' : undefined,
      classImplementationsSource ? 'implementations' : undefined,
    ].filter(Boolean),
    requiredCount: requirements.length,
    missingCount: missing.length,
    missing,
    missingImplementationStubCount: missingImplementationStubs.length,
    missingImplementationStubs,
  };

  if (!autoApply || (missing.length === 0 && missingImplementationStubs.length === 0)) {
    return textResult(JSON.stringify({ ...summary, applied: false }, null, 2));
  }

  // Pure RAP transformation planning lives in rap-handlers.ts. Keep this
  // handler focused on MCP/ADT concerns: safety, linting, locking, writes.
  const scaffoldPlan = applyRapHandlerScaffold(
    {
      main: classMainSource,
      definitions: classDefinitionsSource || undefined,
      implementations: classImplementationsSource || undefined,
    },
    missing,
    missingImplementationStubs,
  );

  if (scaffoldPlan.changedSections.length === 0) {
    const unresolvedHandlerClasses = Array.from(new Set(scaffoldPlan.unresolved.map((req) => req.targetHandlerClass)));
    const unresolvedHint =
      unresolvedHandlerClasses.length > 0
        ? `No source changes were applied because handler class skeleton(s) ${unresolvedHandlerClasses.join(', ')} were not found in main, definitions, or implementations. Create the local handler class skeleton(s) first (for example with the ADT quick fix "Create local handler class"), then rerun with autoApply=true.`
        : undefined;
    return textResult(
      JSON.stringify(
        {
          ...summary,
          applied: false,
          hint: unresolvedHint,
          applyResult: {
            skeletons: scaffoldPlan.skeletons,
            main: scaffoldPlan.signatures.main,
            definitions: scaffoldPlan.signatures.definitions,
            implementations: scaffoldPlan.signatures.implementations,
            implementationStubs: scaffoldPlan.implementationStubs,
            unresolved: scaffoldPlan.unresolved,
          },
        },
        null,
        2,
      ),
    );
  }

  const finalMainSource = scaffoldPlan.sections.main;
  const finalDefinitionsSource = scaffoldPlan.sections.definitions;
  const finalImplementationsSource = scaffoldPlan.sections.implementations;
  const { changed } = scaffoldPlan;

  // Run lint for every section we are about to update; block before any write to avoid partial state.
  let lintWarningsMain: PreWriteLintResult | undefined;
  if (changed.main) {
    lintWarningsMain = runPreWriteLint(finalMainSource, type, name, config, lintOverride);
    if (lintWarningsMain.blocked) return lintWarningsMain.result!;
  }
  let lintWarningsDefinitions: PreWriteLintResult | undefined;
  if (changed.definitions && finalDefinitionsSource) {
    lintWarningsDefinitions = runPreWriteLint(finalDefinitionsSource, type, name, config, lintOverride);
    if (lintWarningsDefinitions.blocked) return lintWarningsDefinitions.result!;
  }
  let lintWarningsImplementations: PreWriteLintResult | undefined;
  if (changed.implementations && finalImplementationsSource) {
    lintWarningsImplementations = runPreWriteLint(finalImplementationsSource, type, name, config, lintOverride);
    if (lintWarningsImplementations.blocked) return lintWarningsImplementations.result!;
  }
  // All modified includes share one lock so we never end up in a partial-state
  // (e.g. main written, implementations errored → handler class declares but
  // doesn't implement methods → class cannot activate). The lock is taken once
  // at the class object URL, and every include PUT carries the same lockHandle.
  // This mirrors how ADT-in-Eclipse saves a multi-include class in one commit.
  await client.http.withStatefulSession(async (session) => {
    const lock = await lockObject(session, client.safety, objectUrl, 'MODIFY', cachedFeatures?.abapRelease);
    const effectiveTransport = transport ?? (lock.corrNr || undefined);
    try {
      if (changed.main) {
        await updateSource(session, client.safety, srcUrl, finalMainSource, lock.lockHandle, effectiveTransport);
      }
      if (changed.definitions && finalDefinitionsSource) {
        await updateSource(
          session,
          client.safety,
          classIncludeUrl(name, 'definitions'),
          finalDefinitionsSource,
          lock.lockHandle,
          effectiveTransport,
        );
      }
      if (changed.implementations && finalImplementationsSource) {
        await updateSource(
          session,
          client.safety,
          classIncludeUrl(name, 'implementations'),
          finalImplementationsSource,
          lock.lockHandle,
          effectiveTransport,
        );
      }
    } finally {
      // Best-effort unlock — if the object was already removed or the session
      // expired, we still want to surface the original error instead of masking
      // it with an unlock failure.
      try {
        await unlockObject(session, objectUrl, lock.lockHandle);
      } catch {
        // Swallowed intentionally; see comment above.
      }
    }
  });
  invalidateWrittenObject();

  const msg =
    `Scaffolded ${scaffoldPlan.insertedSignatureCount} RAP handler signature(s) and ${scaffoldPlan.insertedImplementationStubCount} implementation stub(s) in ${type} ${name} from BDEF ${bdefName}. ` +
    `Auto-created ${scaffoldPlan.skeletons.createdDefinitions.length + scaffoldPlan.skeletons.createdImplementations.length} handler skeleton section(s). ` +
    `Updated section(s): ${scaffoldPlan.changedSections.join(', ')}.`;
  const warnings = mergePreWriteWarnings(
    lintWarningsMain?.warnings,
    lintWarningsDefinitions?.warnings,
    lintWarningsImplementations?.warnings,
  );
  const details = JSON.stringify(
    {
      ...summary,
      applied: true,
      applyResult: {
        skeletons: scaffoldPlan.skeletons,
        main: scaffoldPlan.signatures.main,
        definitions: scaffoldPlan.signatures.definitions,
        implementations: scaffoldPlan.signatures.implementations,
        implementationStubs: scaffoldPlan.implementationStubs,
        unresolved: scaffoldPlan.unresolved,
      },
    },
    null,
    2,
  );
  return warnings ? textResult(`${msg}\n\n${warnings}\n\n${details}`) : textResult(`${msg}\n\n${details}`);
}

export async function writeActionGenerateBehaviorImplementation(ctx: SapWriteContext): Promise<ToolResult> {
  const { client, args, type, name, transport, invalidateWrittenObject, enforcePackageForExistingObject } = ctx;
  // PR-C: high-level RAP one-shot — auto-discover BDEF via class metadata's
  // rootEntityRef, scaffold every required handler (creating lhc_<alias>
  // skeletons when missing), write under one lock, and (by default) activate.
  // Reliable equivalent of Eclipse ADT's "Generate Behavior Implementation"
  // Cmd+1 quickfix; avoids the broken /sap/bc/adt/quickfixes/proposals/
  // create_class_implementation server endpoint (HTTP 500 on a4h, verified
  // live during PR-C research). See docs/plans/add-generate-behavior-implementation.md.
  if (type !== 'CLAS') {
    return errorResult('generate_behavior_implementation is only supported for type=CLAS behavior pool classes.');
  }
  if (!name) {
    return errorResult('"name" is required for generate_behavior_implementation.');
  }
  const dryRun = args.dryRun === true || String(args.dryRun ?? '') === 'true';
  const activate = args.activate === undefined ? true : args.activate === true || String(args.activate) === 'true';
  const explicitBdef = (args.bdefName as string | undefined)?.trim() || undefined;
  const targetAlias = (args.targetAlias as string | undefined)?.trim() || undefined;

  // Package gate only when we'll actually mutate. dryRun=true is read-only;
  // bypassing the gate matches the scaffold_rap_handlers preview pattern.
  if (!dryRun) {
    await enforcePackageForExistingObject();
  }

  const result = await generateBehaviorImplementation(client, name, {
    bdefName: explicitBdef,
    targetAlias,
    activate,
    dryRun,
    transport,
  });
  invalidateWrittenObject();
  // MCP result-code mapping via the exported helper — see
  // `isRapGenerateResultSuccess` for the success/error contract (Codex review on PR #260, P1).
  // The structured JSON is preserved in both branches so the caller can still see what
  // was discovered, written, and what activation reported.
  const json = JSON.stringify(result, null, 2);
  return isRapGenerateResultSuccess(result) ? textResult(json) : errorResult(json);
}
