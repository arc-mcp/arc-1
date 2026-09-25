/**
 * SAPWrite actions — class-section surgery (issue #303).
 *
 * These actions share a common shape: lock → fresh source/structure → optional diff/refuse → splice into
 * /source/main (or /includes/<inc> when include= is set) → PUT → unlock, with no auto-activation.
 * Pre-write lint runs on the SPLICED FULL source (not the partial input fragment) because a raw
 * DEFINITION block alone fails abaplint with "Expected CLASSIMPLEMENTATION" (verified live on a4h);
 * lint is skipped for include= writes (same precedent as the `update include=` path).
 */

import {
  diffMethodSets,
  extractMethodNameFromClause,
  findSectionAnchor,
  insertMethodPair,
  moveMethodDefinition,
  removeMethodPair,
  spliceClassDefinition,
  spliceMethodSignature,
} from '../../adt/class-structure.js';
import { safeUpdateClassInclude } from '../../adt/crud.js';
import { isNotFoundError } from '../../adt/errors.js';
import { mapSapReleaseToAbaplintVersion } from '../../adt/features.js';
import { spliceMethod } from '../../context/method-surgery.js';
import { getCachedFeatures } from '../feature-cache.js';
import {
  CLASS_WRITE_INCLUDES,
  type ClassWriteInclude,
  classIncludeUrl,
  detectLocalHandlerInclude,
} from '../object-types.js';
import { errorResult, type ToolResult, textResult } from '../shared.js';
import { runPreWriteLint, runPreWriteSyntaxCheck } from '../write-helpers.js';
import { withClassEdit } from './class-edit.js';
import type { SapWriteContext } from './context.js';

export async function writeActionEditMethod(ctx: SapWriteContext): Promise<ToolResult> {
  const {
    client,
    args,
    config,
    type,
    name,
    source,
    include,
    lintOverride,
    checkOverride,
    objectUrl,
    srcUrl,
    enforcePackageForExistingObject,
  } = ctx;
  const method = String(args.method ?? '');
  if (!method) return errorResult('"method" is required for edit_method action.');
  if (!source) return errorResult('"source" (new method body) is required for edit_method action.');
  if (type !== 'CLAS') return errorResult('edit_method is only supported for type=CLAS.');
  await enforcePackageForExistingObject();

  // ── Resolve which class section the method body lives in ──
  // Order:
  //   1. Explicit `include` parameter wins (must be a valid CLAS include).
  //      If the user passed something but normalization rejected it,
  //      report it the same way `case 'update'` does.
  //   2. Auto-detect from local-class prefix in `method` specifier
  //      (lhc_*/lcl_* → implementations, ltc_* → testclasses). This is
  //      transparent to RAP-skill callers passing `lhc_project~approve_project`.
  //   3. Fall through to MAIN (existing behavior — covers global classes
  //      and `zif_order~create` style interface methods).
  if (args.include !== undefined && !include) {
    return errorResult(
      `Invalid CLAS include "${String(args.include)}". Valid values: ${CLASS_WRITE_INCLUDES.join(', ')}.`,
    );
  }
  const detectedInclude = include ? undefined : detectLocalHandlerInclude(method);
  const resolvedInclude: ClassWriteInclude | undefined = include ?? detectedInclude;

  return withClassEdit(ctx, async (edit) => {
    const writeUrl = resolvedInclude ? classIncludeUrl(name, resolvedInclude) : srcUrl;
    let currentSource: string;
    try {
      currentSource = await edit.read(writeUrl);
    } catch (error) {
      if (!resolvedInclude || !isNotFoundError(error)) throw error;
      return errorResult(
        `Include "${resolvedInclude}" does not exist in ${name}. Create it with SAPWrite(action="update", type="CLAS", name="${name}", include="${resolvedInclude}", source=...) before editing a method in it.`,
      );
    }

    // Use detected ABAP version from probe if available
    const probedAbapRelease = getCachedFeatures()?.abapRelease;
    const abaplintVer = probedAbapRelease ? mapSapReleaseToAbaplintVersion(probedAbapRelease) : undefined;

    // Splice in the new method body
    const spliced = spliceMethod(currentSource, name, method, source, abaplintVer);
    if (!spliced.success) {
      // Augment the error with which include was searched, so the LLM can
      // either correct the method specifier or override include= explicitly.
      const where = resolvedInclude ? `include "${resolvedInclude}"` : 'main source';
      const baseError = spliced.error ?? `Failed to splice method "${method}" in ${name}.`;
      const hint = detectedInclude
        ? ` (auto-routed via "${method}" prefix; pass include= explicitly to override).`
        : '';
      return errorResult(`${baseError} Searched ${where} of ${name}.${hint}`);
    }

    // Pre-write lint + server-side syntax check on the spliced source.
    //
    // Skip BOTH for include= writes. abaplint cannot parse a CCIMP/CCDEF
    // fragment as a complete class (the DEFINITION/IMPLEMENTATION halves
    // live in different files), so it would block legitimate writes with
    // "Expected CLASSDEFINITION" errors. The existing `case 'update'` include=
    // path also bypasses these checks for the same reason — keep parity.
    // The full-class activation pass after the write is the authoritative
    // syntax check.
    let lintWarnings: ReturnType<typeof runPreWriteLint> = { blocked: false } as ReturnType<typeof runPreWriteLint>;
    let checkNotes = '';
    if (!resolvedInclude) {
      lintWarnings = runPreWriteLint(spliced.newSource, type, name, config, lintOverride);
      if (lintWarnings.blocked) return lintWarnings.result!;

      checkNotes = await runPreWriteSyntaxCheck(
        { http: edit.http, safety: client.safety },
        type,
        spliced.newSource,
        objectUrl,
        config,
        checkOverride,
      );
    }

    await edit.save(writeUrl, spliced.newSource);
    const where = resolvedInclude ? ` (include: ${resolvedInclude})` : '';
    const msg = `Successfully updated method "${method}" in ${type} ${name}${where}.`;
    const extras = [lintWarnings.warnings, checkNotes].filter(Boolean).join('\n\n');
    return extras ? textResult(`${msg}\n\n${extras}`) : textResult(msg);
  });
}

export async function writeActionEditClassDefinition(ctx: SapWriteContext): Promise<ToolResult> {
  const {
    client,
    args,
    config,
    type,
    name,
    source,
    hasSource,
    include,
    includeProvided,
    transport,
    lintOverride,
    objectUrl,
    srcUrl,
    invalidateWrittenObject,
    enforcePackageForExistingObject,
  } = ctx;
  if (type !== 'CLAS') return errorResult('edit_class_definition is only supported for type=CLAS.');
  if (!hasSource) return errorResult('"source" (new CLASS DEFINITION block) is required for edit_class_definition.');
  if (includeProvided && !include) {
    return errorResult(
      `Invalid CLAS include "${String(args.include)}". Valid values: ${CLASS_WRITE_INCLUDES.join(', ')}.`,
    );
  }
  await enforcePackageForExistingObject();

  if (include) {
    // Whole include replacement has no read/modify race; retain missing-include initialization.
    const spliced = source.endsWith('\n') ? source : `${source}\n`;
    const initialized = await safeUpdateClassInclude(
      client.http,
      client.safety,
      objectUrl,
      classIncludeUrl(name, include),
      spliced,
      transport,
      getCachedFeatures()?.abapRelease,
    );
    invalidateWrittenObject(type, name);
    const initNote = initialized.initialized ? ` Initialised the ${include} include first.` : '';
    return textResult(
      `Successfully updated include ${include} of ${type} ${name}.${initNote} Active version unchanged until activation; read with SAPRead(version="inactive") to verify, then SAPActivate.`,
    );
  }
  return withClassEdit(ctx, async (edit) => {
    const { structure, main } = await edit.readMainAndStructure();
    // Refuse-policy: compute the method-set diff against the NEW DEFINITION.
    const diff = diffMethodSets(structure, source);
    const missingImpls: string[] = [];
    const orphanImpls: string[] = [];
    for (const add of diff.added) {
      // Exempt declarations that never have a METHOD…ENDMETHOD body.
      if (add.isAbstract || add.isEvent || add.isInterface || add.isAlias) continue;
      // Does IMPLEMENTATION already have a METHOD <name> header? Match the
      // method name followed by a word-boundary so AMDP / event-handler /
      // multi-line headers (`METHOD x BY DATABASE PROCEDURE…`, `METHOD x FOR
      // EVENT…`, `METHOD x\n  IMPORTING…`) are recognized — NOT only the bare
      // `METHOD x.` form. \b after the name prevents matching a longer name
      // with the same prefix (METHOD x_helper for added X).
      const re = new RegExp(`^\\s*METHOD\\s+${add.name}\\b`, 'im');
      if (!re.test(main)) missingImpls.push(add.name);
    }
    for (const rem of diff.removed) {
      if (rem.implementation) {
        // Was concrete, still has impl range — caller didn't remove the body.
        orphanImpls.push(rem.name);
      }
    }
    if (missingImpls.length > 0 || orphanImpls.length > 0) {
      const parts: string[] = [];
      if (missingImpls.length > 0) {
        parts.push(
          `Cannot apply edit_class_definition: the new DEFINITION declares method(s) ${missingImpls.join(', ')} but the existing IMPLEMENTATION block has no matching METHOD…ENDMETHOD body. Either include a METHOD <name>. ENDMETHOD. block per added method in your new source, or use SAPWrite(action="add_method", name="${name}", method="<METHODS clause>") to insert each one atomically.`,
        );
      }
      if (orphanImpls.length > 0) {
        parts.push(
          `Cannot apply edit_class_definition: the new DEFINITION removes method(s) ${orphanImpls.join(', ')} but the existing IMPLEMENTATION block still has METHOD…ENDMETHOD bodies for them (orphan implementation). Either remove those METHOD blocks in your edit, or use SAPWrite(action="delete_method", name="${name}", method="<name>") to drop each one atomically.`,
        );
      }
      return errorResult(parts.join('\n\n'));
    }
    const spliced = spliceClassDefinition(main, structure, source);
    const lintWarnings = runPreWriteLint(spliced, type, name, config, lintOverride);
    if (lintWarnings.blocked) return lintWarnings.result!;
    await edit.save(srcUrl, spliced);
    return textResult(
      `Successfully updated DEFINITION of ${type} ${name}. Active version unchanged until activation; read with SAPRead(version="inactive") to verify, then SAPActivate.`,
    );
  });
}

export async function writeActionEditMethodSignature(ctx: SapWriteContext): Promise<ToolResult> {
  const { args, type, name, source, hasSource, includeProvided, srcUrl, enforcePackageForExistingObject } = ctx;
  if (type !== 'CLAS') return errorResult('edit_method_signature is only supported for type=CLAS.');
  const methodSpecifier = String(args.method ?? '').trim();
  if (!methodSpecifier) {
    return errorResult('"method" (the method NAME to re-sign) is required for edit_method_signature.');
  }
  if (!hasSource) {
    return errorResult('"source" (the new METHODS clause) is required for edit_method_signature.');
  }
  // MAIN-only action: include= is rejected at the schema layer (this action is
  // not in SAPWRITE_INCLUDE_AWARE_ACTIONS). Defensive guard for direct CLI calls
  // that bypass Zod.
  if (includeProvided) {
    return errorResult(
      'edit_method_signature targets the global class DEFINITION (/source/main). For local-class (CCDEF) signatures, use edit_class_definition with include=definitions.',
    );
  }
  await enforcePackageForExistingObject();

  return withClassEdit(ctx, async (edit) => {
    const { structure, main } = await edit.readMainAndStructure();
    const upperName = methodSpecifier.toUpperCase();
    const method = structure.methods.find((m) => m.name === upperName);
    if (!method) {
      const available = structure.methods.map((m) => m.name).join(', ');
      const hint = methodSpecifier.includes('~')
        ? ' Interface-qualified names (e.g. "zif_x~m") are not addressable here — objectstructure lists the implementing method under its bare name; for interface/local-handler bodies use edit_method.'
        : '';
      return errorResult(
        `Method "${methodSpecifier}" not found in CLAS ${name}. Available methods: ${available || '(none)'}.${hint}`,
      );
    }

    const spliced = spliceMethodSignature(main, method, source);
    // No pre-write lint: edit_method_signature changes ONLY the declaration; the
    // method body still references the old signature until the caller follows up
    // with edit_method. Linting the spliced full source here would flag legitimate
    // in-progress renames (e.g. "param `name` not declared"). SAP activation is the
    // authoritative check — same rationale as the include= lint skip on edit_method.
    await edit.save(srcUrl, spliced);
    return textResult(
      `Successfully updated signature of method "${method.name}" in ${type} ${name}. Active version unchanged until activation; if the body still references the old signature, follow up with edit_method, then SAPActivate.`,
    );
  });
}

export async function writeActionAddMethod(ctx: SapWriteContext): Promise<ToolResult> {
  const { args, config, type, name, includeProvided, lintOverride, srcUrl, enforcePackageForExistingObject } = ctx;
  if (type !== 'CLAS') return errorResult('add_method is only supported for type=CLAS.');
  const clause = String(args.method ?? '');
  if (!clause.trim()) {
    return errorResult(
      '"method" (the full METHODS clause, e.g. "METHODS greet IMPORTING who TYPE string.") is required for add_method.',
    );
  }
  const methodName = extractMethodNameFromClause(clause);
  if (!methodName) {
    return errorResult(
      'Could not extract method name from the METHODS clause. Provide a clause starting with "METHODS <name>" or "CLASS-METHODS <name>".',
    );
  }
  // Interface-qualified names (lhc_x~y, zif_x~m) can't be added to a global
  // class's DEFINITION/IMPLEMENTATION — `~` is interface-method scope and would
  // produce invalid ABAP in the METHOD stub. Reject with a clear pointer.
  if (methodName.includes('~')) {
    return errorResult(
      `add_method cannot add the interface-qualified method "${methodName}" to a global class. Implement the interface via "INTERFACES <name>." in the DEFINITION (use edit_class_definition), then provide the body with edit_method.`,
    );
  }
  const visibility = (args.visibility as 'public' | 'protected' | 'private' | undefined) ?? 'public';
  const isAbstract = args.abstract === true;
  // MAIN-only action: include= is rejected at the schema layer (not in
  // SAPWRITE_INCLUDE_AWARE_ACTIONS). Defensive guard for direct CLI calls.
  if (includeProvided) {
    return errorResult(
      'add_method targets the global class DEFINITION (/source/main). For local-class (CCDEF) method additions, use edit_class_definition with include=definitions.',
    );
  }
  await enforcePackageForExistingObject();

  return withClassEdit(ctx, async (edit) => {
    const { structure, main } = await edit.readMainAndStructure();
    // Refuse if method already exists (would silently duplicate).
    if (structure.methods.some((m) => m.name === methodName)) {
      return errorResult(
        `Method "${methodName}" already exists in CLAS ${name}. Use SAPWrite(action="edit_method_signature", method="${methodName}", source="<new METHODS clause>") to change its signature.`,
      );
    }

    // A concrete (non-abstract) method needs an IMPLEMENTATION block to receive
    // its METHOD…ENDMETHOD stub. A purely-abstract class has no IMPLEMENTATION
    // half, so inserting a concrete declaration there would leave it unimplemented.
    if (!isAbstract && !structure.classImplementationBlock) {
      return errorResult(
        `CLAS ${name} has no IMPLEMENTATION block (purely abstract class). Pass abstract=true to add an abstract method, or add the IMPLEMENTATION half first via edit_class_definition.`,
      );
    }

    // Refuse with hint if the target visibility section header is missing.
    const anchor = findSectionAnchor(main, structure, visibility);
    if (!anchor) {
      return errorResult(
        `No ${visibility.toUpperCase()} SECTION exists in CLAS ${name}. Use SAPWrite(action="edit_class_definition") to add the section header first, then re-run add_method.`,
      );
    }

    const spliced = insertMethodPair(main, structure, {
      decl: clause,
      visibility,
      methodName,
      isAbstract,
    });

    const lintWarnings = runPreWriteLint(spliced, type, name, config, lintOverride);
    if (lintWarnings.blocked) return lintWarnings.result!;

    await edit.save(srcUrl, spliced);
    const stubNote = isAbstract ? ' (abstract — no IMPL stub inserted)' : '';
    return textResult(
      `Successfully added method "${methodName}" (${visibility}) to ${type} ${name}${stubNote}. Active version unchanged until activation; SAPActivate next.`,
    );
  });
}

export async function writeActionDeleteMethod(ctx: SapWriteContext): Promise<ToolResult> {
  const { args, config, type, name, includeProvided, lintOverride, srcUrl, enforcePackageForExistingObject } = ctx;
  if (type !== 'CLAS') return errorResult('delete_method is only supported for type=CLAS.');
  const methodSpecifier = String(args.method ?? '').trim();
  if (!methodSpecifier) {
    return errorResult('"method" (the method NAME to delete) is required for delete_method.');
  }
  // MAIN-only action: include= is rejected at the schema layer (not in
  // SAPWRITE_INCLUDE_AWARE_ACTIONS). Defensive guard for direct CLI calls.
  if (includeProvided) {
    return errorResult(
      'delete_method targets the global class DEFINITION (/source/main). For local-class (CCDEF/CCIMP) method removal, use edit_class_definition with include=...',
    );
  }
  await enforcePackageForExistingObject();

  return withClassEdit(ctx, async (edit) => {
    const { structure, main } = await edit.readMainAndStructure();
    const upperName = methodSpecifier.toUpperCase();
    const method = structure.methods.find((m) => m.name === upperName);
    if (!method) {
      const available = structure.methods.map((m) => m.name).join(', ');
      const hint = methodSpecifier.includes('~')
        ? ' Interface-qualified names (e.g. "zif_x~m") are not addressable here; objectstructure lists methods under their bare names.'
        : '';
      return errorResult(
        `Method "${methodSpecifier}" not found in CLAS ${name}. Available methods: ${available || '(none)'}.${hint}`,
      );
    }

    const spliced = removeMethodPair(main, method);
    const lintWarnings = runPreWriteLint(spliced, type, name, config, lintOverride);
    if (lintWarnings.blocked) return lintWarnings.result!;

    await edit.save(srcUrl, spliced);
    const where = method.implementation ? ' (DEFINITION + IMPLEMENTATION)' : ' (DEFINITION only — was ABSTRACT)';
    return textResult(
      `Successfully deleted method "${method.name}" from ${type} ${name}${where}. Active version unchanged until activation; SAPActivate next.`,
    );
  });
}

export async function writeActionChangeMethodVisibility(ctx: SapWriteContext): Promise<ToolResult> {
  const { args, config, type, name, includeProvided, lintOverride, srcUrl, enforcePackageForExistingObject } = ctx;
  // Body-preserving visibility move (issue #303 follow-up). Moves the METHODS
  // clause from its current section to the target section; the IMPLEMENTATION
  // block is never touched, so the method body survives. This is the safe
  // alternative to delete_method + add_method (which discards the body).
  if (type !== 'CLAS') return errorResult('change_method_visibility is only supported for type=CLAS.');
  const methodSpecifier = String(args.method ?? '').trim();
  if (!methodSpecifier) {
    return errorResult('"method" (the method NAME to move) is required for change_method_visibility.');
  }
  const target = args.visibility as 'public' | 'protected' | 'private' | undefined;
  if (!target) {
    return errorResult(
      '"visibility" (target section: public, protected, or private) is required for change_method_visibility.',
    );
  }
  // MAIN-only action: include= is rejected at the schema layer (not in
  // SAPWRITE_INCLUDE_AWARE_ACTIONS). Defensive guard for direct CLI calls.
  if (includeProvided) {
    return errorResult(
      'change_method_visibility targets the global class DEFINITION (/source/main). For local-class (CCDEF) methods, use edit_class_definition with include=definitions.',
    );
  }
  await enforcePackageForExistingObject();

  return withClassEdit(ctx, async (edit) => {
    const { structure, main } = await edit.readMainAndStructure();
    const upperName = methodSpecifier.toUpperCase();
    const method = structure.methods.find((m) => m.name === upperName);
    if (!method) {
      const available = structure.methods.map((m) => m.name).join(', ');
      const hint = methodSpecifier.includes('~')
        ? ' Interface-qualified names (e.g. "zif_x~m") are not addressable here; objectstructure lists methods under their bare names.'
        : '';
      return errorResult(
        `Method "${methodSpecifier}" not found in CLAS ${name}. Available methods: ${available || '(none)'}.${hint}`,
      );
    }

    // Idempotent: already in the requested section → no write.
    if (method.visibility === target) {
      return textResult(
        `Method "${method.name}" is already in the ${target.toUpperCase()} SECTION of ${type} ${name}. No change made.`,
      );
    }

    // The target section header must already exist (same constraint as add_method).
    const anchor = findSectionAnchor(main, structure, target);
    if (!anchor) {
      return errorResult(
        `No ${target.toUpperCase()} SECTION exists in CLAS ${name}. Use SAPWrite(action="edit_class_definition") to add the section header first, then re-run change_method_visibility.`,
      );
    }

    // DEFINITION-only move — IMPLEMENTATION (the method body) is preserved verbatim.
    const spliced = moveMethodDefinition(main, method, anchor.afterLine);
    const lintWarnings = runPreWriteLint(spliced, type, name, config, lintOverride);
    if (lintWarnings.blocked) return lintWarnings.result!;

    await edit.save(srcUrl, spliced);
    return textResult(
      `Successfully moved method "${method.name}" from ${method.visibility.toUpperCase()} to ${target.toUpperCase()} SECTION of ${type} ${name} (IMPLEMENTATION preserved). Active version unchanged until activation; SAPActivate next.`,
    );
  });
}
