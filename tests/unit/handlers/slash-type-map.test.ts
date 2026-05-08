/**
 * Citation guard for SLASH_TYPE_MAP and KNOWN_BASE_TYPES.
 *
 * Background — PR #222 / issue #218 audit found six bugs of the same class
 * (`STRU/DS`, `FUNC/FM`, `FUGR/FF` mis-route, `CLAS/LI`, `VIEW/V`, `TRAN/O`),
 * all rooted in slash codes added without verification against any SAP source.
 * This test enforces two structural invariants:
 *
 *   1. Every entry in SLASH_TYPE_MAP has a matching entry in
 *      SLASH_TYPE_EVIDENCE pointing at a research file that exists on disk.
 *   2. Every entry in KNOWN_BASE_TYPES is a target value of SLASH_TYPE_MAP
 *      (i.e. some slash code normalizes to it) OR is a top-level canonical
 *      type that doesn't have a slash form (e.g. PROG itself, INCL itself).
 *
 * If a future contributor adds a new slash alias without a research doc, this
 * test fails — that's the anti-cargo-cult guard.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  KNOWN_BASE_TYPES,
  normalizeObjectType,
  objectBasePath,
  SLASH_TYPE_EVIDENCE,
  SLASH_TYPE_MAP,
} from '../../../src/handlers/intent.js';

// Codex review of PR #223 found that iterating only over SLASH_TYPE_EVIDENCE
// keys was insufficient — a contributor could add a SLASH_TYPE_MAP entry
// without a matching evidence entry and the guard wouldn't notice. The fix
// is direct key-equality: the two maps must have exactly the same key set.

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

describe('SLASH_TYPE_MAP citation guard (anti-cargo-cult)', () => {
  it('SLASH_TYPE_MAP and SLASH_TYPE_EVIDENCE have identical key sets', () => {
    // The structural invariant: every map entry must have evidence and every
    // evidence entry must back a real map entry. Sorted-array equality fails
    // loudly if either side gains an entry without the other.
    const mapKeys = Object.keys(SLASH_TYPE_MAP).sort();
    const evidenceKeys = Object.keys(SLASH_TYPE_EVIDENCE).sort();
    expect(mapKeys).toEqual(evidenceKeys);
  });

  it('every SLASH_TYPE_EVIDENCE key resolves to an existing research file on disk', () => {
    const missing: string[] = [];
    for (const [slashCode, evidencePath] of Object.entries(SLASH_TYPE_EVIDENCE)) {
      const fullPath = resolve(REPO_ROOT, evidencePath);
      if (!existsSync(fullPath)) {
        missing.push(`${slashCode} → ${evidencePath}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every SLASH_TYPE_MAP entry round-trips through normalizeObjectType', () => {
    // Sanity check that the public normalizer agrees with the raw map — guards
    // against future refactors that add lookup logic skipping certain entries.
    for (const [slashCode, expected] of Object.entries(SLASH_TYPE_MAP)) {
      expect(normalizeObjectType(slashCode), `${slashCode} normalization`).toBe(expected);
    }
  });

  it('removed invented aliases are NOT in SLASH_TYPE_EVIDENCE', () => {
    // Sanity check that the citation map didn't get back-filled with the
    // invented aliases the audit removed.
    const invented = ['FUNC/FM', 'CLAS/LI', 'VIEW/V', 'TRAN/O'];
    for (const code of invented) {
      expect(SLASH_TYPE_EVIDENCE[code]).toBeUndefined();
    }
  });

  it('replacement aliases ARE in SLASH_TYPE_EVIDENCE', () => {
    // The aliases that replaced the invented ones must be cited.
    const replacements: Array<[string, string]> = [
      ['FUGR/FF', 'research/abap-types/types/fugr.md'],
      ['VIEW/DV', 'research/abap-types/types/view.md'],
      ['TRAN/T', 'research/abap-types/types/tran.md'],
    ];
    for (const [code, expectedPath] of replacements) {
      expect(SLASH_TYPE_EVIDENCE[code]).toBe(expectedPath);
    }
  });
});

describe('KNOWN_BASE_TYPES exhaustiveness', () => {
  it('every target of SLASH_TYPE_MAP normalisation is in KNOWN_BASE_TYPES', () => {
    // For every cited slash code, the canonical short form it normalizes to
    // MUST be in KNOWN_BASE_TYPES — otherwise objectBasePath has no case for
    // it (Plan A Task 4 exhaustiveness guard).
    const orphans: Array<[string, string]> = [];
    for (const slashCode of Object.keys(SLASH_TYPE_EVIDENCE)) {
      const canonical = normalizeObjectType(slashCode);
      if (!KNOWN_BASE_TYPES.has(canonical)) {
        orphans.push([slashCode, canonical]);
      }
    }
    expect(orphans).toEqual([]);
  });

  it('objectBasePath returns a valid /sap/bc/adt/ URL for every KNOWN_BASE_TYPES entry except FUNC', () => {
    // Exhaustiveness regression test. FUNC is the documented exception
    // (function modules require parent group context — there is no single
    // base path; objectBasePath('FUNC') intentionally throws — see codex
    // PR #223 follow-up). Every other canonical type must return a usable
    // ADT URL.
    for (const type of KNOWN_BASE_TYPES) {
      if (type === 'FUNC') continue;
      const url = objectBasePath(type);
      expect(url, `${type} → ${url}`).toMatch(/^\/sap\/bc\/adt\//);
      expect(url.endsWith('/'), `${type} should end with '/'`).toBe(true);
    }
  });

  it('objectBasePath("FUNC") throws — function modules require parent group context', () => {
    // Codex review of PR #223 follow-up: a real ADT search returning
    // { type: "FUGR/FF", name: "BAPI_USER_GETLIST" } now canonicalises to
    // FUNC, but objectBasePath('FUNC') used to return /functions/groups/
    // and any caller using objectUrlForType would build
    // /functions/groups/BAPI_USER_GETLIST — wrong, because the URL needs
    // /groups/{group}/fmodules/{fm}. SAPRead and SAPNavigate handle FUNC
    // through dedicated FUNC-aware code paths; SAPActivate / SAPDiagnose /
    // SAPTransport now fail loudly here instead of mis-routing.
    expect(() => objectBasePath('FUNC')).toThrow(
      /function module.*cannot be resolved to a single base path|requires the parent function group/i,
    );
  });

  it('VIEW routes through the VIT generic-object endpoint, not /programs/programs/', () => {
    // Regression guard for the silent-fallthrough bug fixed in PR #222.
    // Before the fix, objectBasePath('VIEW') fell through to the program
    // path. Live a4h+npl 2026-05-08: GET /sap/bc/adt/ddic/views/V_USR_NAME
    // returns HTTP 500; only the VIT URL works.
    const url = objectBasePath('VIEW');
    expect(url).toBe('/sap/bc/adt/vit/wb/object_type/viewdv/object_name/');
    expect(url).not.toContain('/programs/programs/');
  });

  it('TRAN keeps the trant infix that matches ADT-emitted TRAN/T slash code', () => {
    // The TRAN URL builder was correct pre-PR #222; only the SLASH_TYPE_MAP
    // alias was wrong (TRAN/O → TRAN/T). This guards against regression.
    expect(objectBasePath('TRAN')).toBe('/sap/bc/adt/vit/wb/object_type/trant/object_name/');
  });

  it('falls back to /programs/programs/ for unknown non-slash types (legacy contract)', () => {
    // inferObjectType and similar callers may pass freestyle names that don't
    // match any canonical short type. The legacy contract is to route those
    // to the program endpoint; we keep that to avoid breaking unrelated paths.
    expect(objectBasePath('NOT_A_REAL_TYPE')).toBe('/sap/bc/adt/programs/programs/');
  });
});

describe('Slash-form throw guard (codex P1: removed aliases must not silently route)', () => {
  // Codex review of PR #223 found that the four removed aliases (FUNC/FM,
  // CLAS/LI, VIEW/V, TRAN/O) pass through normalizeObjectType unchanged, then
  // — for tools like SAPNavigate/SAPActivate/SAPDiagnose/SAPTransport that
  // accept `type: string` (no enum) — could still reach objectBasePath, which
  // previously fell through to /sap/bc/adt/programs/programs/. The fix is the
  // slash-form throw inside objectBasePath default branch. These tests are
  // the regression guard.
  const REMOVED_ALIASES = ['FUNC/FM', 'CLAS/LI', 'VIEW/V', 'TRAN/O'];

  for (const alias of REMOVED_ALIASES) {
    it(`objectBasePath('${alias}') throws (slash-form guard)`, () => {
      expect(() => objectBasePath(alias)).toThrow(/refusing to build URL for slash-form type/);
    });
  }

  it('objectBasePath throws for any unknown slash-form input (catch-all)', () => {
    // Defensive: even invented slash codes that nobody has seen before should
    // fail loudly rather than silently route somewhere wrong.
    expect(() => objectBasePath('ZZZZ/ZZ')).toThrow(/refusing to build URL for slash-form type/);
    expect(() => objectBasePath('FOO/BAR')).toThrow(/refusing to build URL for slash-form type/);
  });

  it('objectBasePath does NOT throw for canonical short types (except FUNC, which is intentional)', () => {
    // Positive control: every canonical type except FUNC stays callable.
    // FUNC is the documented exception — see "objectBasePath('FUNC') throws"
    // above for rationale.
    for (const type of KNOWN_BASE_TYPES) {
      if (type === 'FUNC') continue;
      expect(() => objectBasePath(type), `${type} unexpectedly threw`).not.toThrow();
    }
  });
});
