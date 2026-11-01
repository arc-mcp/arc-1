import { describe, expect, it } from 'vitest';
import { bdefDeclaredEntities, bdefExtensionTargets } from '../../../src/adt/bdef-extension-parser.js';

const base = `managed implementation in class bp_demo_rap_extensible unique;
strict ( 2 );
define behavior for DEMO_RAP_EXTENSIBLE alias Root
persistent table demo_rap_extens { create; }
define behavior for /ACME/CHILD alias Child { update; }`;

describe('BDEF declaration evidence', () => {
  it('verifies the live DEMO_RAP_EXTEND1 statement against entities, including child entities', () => {
    expect(bdefDeclaredEntities(base, 'define')).toEqual(['DEMO_RAP_EXTENSIBLE', '/ACME/CHILD']);
    expect(
      bdefExtensionTargets(
        base,
        `extension implementation in class bp_demo_rap_extend1 unique;
extend behavior for DEMO_RAP_EXTENSIBLE {
 determination MyDet1 on save { create; update; }
 extend determine action trigger_all { determination MyDet1; }
}
extend behavior for /acme/child { }`,
      ),
    ).toEqual(['DEMO_RAP_EXTENSIBLE', '/ACME/CHILD']);
  });

  it.each([
    '// extend behavior for DEMO_RAP_EXTENSIBLE { }',
    '/* extend behavior for DEMO_RAP_EXTENSIBLE { } */',
    '/* outer /* nested */ extend behavior for DEMO_RAP_EXTENSIBLE { } */',
    "'extend behavior for DEMO_RAP_EXTENSIBLE { }'",
    '"extend behavior for DEMO_RAP_EXTENSIBLE { }"',
    '`extend behavior for DEMO_RAP_EXTENSIBLE { }`',
    '|extend behavior for DEMO_RAP_EXTENSIBLE { }|',
    'ordinary extend behavior for DEMO_RAP_EXTENSIBLE { }',
    'extend; behavior for DEMO_RAP_EXTENSIBLE { }',
    'extend behavior; for DEMO_RAP_EXTENSIBLE { }',
    "extend behavior for 'DEMO_RAP_EXTENSIBLE' { }",
    'define behavior for OTHER { extend behavior for DEMO_RAP_EXTENSIBLE { } }',
    'define behavior for DEMO_RAP_EXTENSIBLE { }',
    'extend behavior for UNRELATED { }',
    'extend behavior for DEMO_RAP_EXTENSIBLE',
    '/* unclosed comment\nextend behavior for DEMO_RAP_EXTENSIBLE { }',
  ])('rejects a comment, string, incomplete statement or ordinary reference: %s', (source) => {
    expect(bdefExtensionTargets(base, source)).toEqual([]);
  });

  it('comments separate tokens, while delimiters prevent cross-statement matches', () => {
    expect(bdefExtensionTargets(base, 'extend/*head*/behavior/*head*/for/*entity*/DEMO_RAP_EXTENSIBLE{}')).toEqual([
      'DEMO_RAP_EXTENSIBLE',
    ]);
    expect(
      bdefExtensionTargets(
        base,
        `extend /* comment */ behavior // comment
for DEMO_RAP_EXTENSIBLE { }`,
      ),
    ).toEqual(['DEMO_RAP_EXTENSIBLE']);
    expect(bdefDeclaredEntities("'define behavior for FALSE { }'; define behavior for REAL { }", 'define')).toEqual([
      'REAL',
    ]);
  });

  it('bounds lexer work and deduplicates repeated declared entities', () => {
    expect(() => bdefDeclaredEntities('a'.repeat(256 * 1024 + 1), 'define')).toThrow('verification limit');
    expect(bdefDeclaredEntities('define behavior for ROOT {} define behavior for ROOT {}', 'define')).toEqual(['ROOT']);
  });
});
