import { describe, expect, it } from 'vitest';
import { parseFmSignature, spliceFmSignature } from '../../../src/adt/fm-signature.js';

const docs = `* Header mentions FUNCTION and ENDFUNCTION.
"! Function documentation
"! @parameter iv_input | <p class="shorttext synchronized" lang="en">Input text</p>
`;
const source = `${docs}FUNCTION z_demo
  IMPORTING VALUE(iv_input) TYPE char10.

  WRITE / 'ENDFUNCTION'.
  " ENDFUNCTION.
endfunction. " keep footer
* Footer
`;

describe('function parameter documentation', () => {
  it('reads the signature and synchronized description after leading comments', () => {
    expect(parseFmSignature(source).params).toEqual([
      { kind: 'importing', name: 'IV_INPUT', type: 'char10', byValue: true, description: 'Input text' },
    ]);
  });

  it('preserves the complete prefix and body/footer when descriptions are omitted', () => {
    const output = spliceFmSignature(source, 'Z_DEMO', [
      { kind: 'importing', name: 'IV_INPUT', type: 'STRING', byValue: true },
    ]);
    expect(output.startsWith(docs)).toBe(true);
    expect(output.endsWith(source.slice(source.indexOf('\n\n  WRITE') + 1))).toBe(true);
    expect(output).toContain('VALUE(IV_INPUT) TYPE STRING.');
  });

  it('writes an explicit description as synchronized ABAP Doc', () => {
    const output = spliceFmSignature(
      'FUNCTION z_demo.\nENDFUNCTION.\n',
      'Z_DEMO',
      [{ kind: 'importing', name: 'IV_INPUT', type: 'CHAR10', description: 'Input text' }],
      'en',
    );
    expect(output).toContain('"! @parameter iv_input | <p class="shorttext synchronized" lang="en">Input text</p>');
    expect(parseFmSignature(output).params[0]).toMatchObject({ description: 'Input text' });
  });
});

describe('documentation-safe signature edits', () => {
  const parameter = { kind: 'importing' as const, name: 'IV_INPUT', type: 'CHAR10', byValue: true };
  const edit = (input: string, description = 'Revised text', language = 'en') =>
    spliceFmSignature(input, 'Z_DEMO', [{ ...parameter, description }], language);

  it.each(['\n', '\r\n'])('repeated description edits preserve prose, body, footer, and %j line endings', (eol) => {
    const input = source
      .replace('Input text</p>', 'Input text</p> Extra prose.\n"! More detail.')
      .replaceAll('\n', eol);
    const output = edit(edit(input));
    expect(output).toContain(`Revised text</p> Extra prose.${eol}"! More detail.`);
    expect(output.match(/@parameter iv_input/g)).toHaveLength(1);
    expect(output.endsWith(input.slice(input.indexOf(`${eol}${eol}  WRITE`) + eol.length))).toBe(true);
    if (eol === '\r\n') expect(output.replaceAll('\r\n', '')).not.toContain('\n');
  });

  it('corrects an existing paragraph language to the verified original language', () => {
    const output = edit(source, 'Eingabewert', 'de');
    expect(output).toContain('lang="de">Eingabewert</p>');
    expect(output).not.toContain('lang="en"');
  });

  it('adds a short text to existing prose without replacing it', () => {
    const input = source.replace('<p class="shorttext synchronized" lang="en">Input text</p>', 'Original prose.');
    const output = edit(input);
    expect(output).toContain('lang="en">Revised text</p> Original prose.');
  });

  it('removes the removed parameter section, preserving function prose and unrelated tags', () => {
    const input = source.replace('FUNCTION z_demo', '"! @see related_function\nFUNCTION z_demo');
    const output = spliceFmSignature(input, 'Z_DEMO', []);
    expect(output).toContain('"! Function documentation\n"! @see related_function');
    expect(output).not.toContain('@parameter');
  });

  it('preserves a parameter description when moving between data parameter kinds', () => {
    const output = spliceFmSignature(source, 'Z_DEMO', [{ ...parameter, kind: 'changing' }]);
    expect(parseFmSignature(output).params[0]).toMatchObject({ kind: 'changing', description: 'Input text' });
  });

  it.each(['importing', 'exporting', 'changing', 'tables'] as const)(
    'round-trips %s descriptions and escapes once',
    (kind) => {
      const description = `R&D <input> "quoted" '@name'! &lt;`;
      const output = spliceFmSignature(
        'FUNCTION z_demo.\nENDFUNCTION.\n',
        'Z_DEMO',
        [{ kind, name: 'VALUE_IN', type: 'CHAR10', description }],
        'en',
      );
      expect(output).toContain('R&amp;D &lt;input&gt; &quot;quoted&quot; &#39;&#64;name&#39;&#33; &amp;lt;');
      expect(parseFmSignature(output).params[0]?.description).toBe(description);
    },
  );

  it('does not attach distant or ordinary comments to the FUNCTION', () => {
    const distant = `${docs}\n" Ordinary comment\n`;
    const input = `${distant}FUNCTION z_demo\n  IMPORTING iv_input TYPE i.\nENDFUNCTION.\n`;
    expect(parseFmSignature(input).params[0]?.description).toBeUndefined();
    const output = edit(input);
    expect(output.startsWith(distant)).toBe(true);
    expect(parseFmSignature(output).params[0]?.description).toBe('Revised text');
  });

  it.each([
    source.replace('"! Function documentation', '"! @parameter iv_input | Duplicate'),
    source.replace('Input text</p>', 'Input text</p><p class="shorttext synchronized">Second</p>'),
    source.replace('Input text</p>', '<b>Input text</b></p>'),
    source.replace('Input text</p>', 'Input text'),
    source.replace('Input text</p>', 'Input text</p><p class="shorttext synchronized">Unclosed'),
    source.replace('shorttext synchronized', 'shorttext'),
  ])('refuses ambiguous or unsupported short-text edits', (input) => {
    expect(() => edit(input)).toThrow(/ABAP Doc/);
    expect(
      spliceFmSignature(input, 'Z_DEMO', [parameter]).startsWith(input.slice(0, input.indexOf('FUNCTION z_demo'))),
    ).toBe(true);
  });

  it('reads ABAP Doc text without claiming that native SE37 synchronization occurred', () => {
    const withoutLanguage = source.replace(' lang="en"', '');
    expect(parseFmSignature(withoutLanguage).params[0]?.description).toBe('Input text');
  });

  it('does not present plain prose as a synchronized short text', () => {
    const input = source.replace('<p class="shorttext synchronized" lang="en">Input text</p>', 'Plain prose');
    expect(parseFmSignature(input).params[0]?.description).toBeUndefined();
  });

  it.each([
    '',
    ' ',
    'x'.repeat(61),
    'First\nWRITE / 1.',
    'line\rbreak',
    'tab\ttext',
    '\u0000',
    '\u0085',
    '\u2028',
    '\u202e',
  ])('refuses invalid description %j', (description) => {
    expect(() => edit(source, description)).toThrow(/printable/);
  });

  it('requires an explicit original language before emitting descriptions', () => {
    expect(() => spliceFmSignature(source, 'Z_DEMO', [{ ...parameter, description: 'New' }])).toThrow(
      /original language/,
    );
  });

  it.each(['" FUNCTION fake.\nWRITE / 1.\nENDFUNCTION.\n', '* FUNCTION fake.\nWRITE / 1.\nENDFUNCTION.\n'])(
    'does not mistake a comment or body statement for a FUNCTION envelope',
    (input) => {
      expect(parseFmSignature(input).params).toEqual([]);
      expect(() => spliceFmSignature(input, 'Z_DEMO', [])).toThrow(/FUNCTION/);
    },
  );

  it('preserves the body when the signature keyword and parameter share a line', () => {
    const input = '"! Documentation\nFUNCTION z_demo\n IMPORTING iv_input TYPE char10.\n\n WRITE / 1.\nENDFUNCTION.\n';
    const output = edit(input);
    expect(output.endsWith('\n\n WRITE / 1.\nENDFUNCTION.\n')).toBe(true);
    expect(output.match(/TYPE char10/gi)).toHaveLength(1);
  });
});
