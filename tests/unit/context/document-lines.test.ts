import { describe, expect, it } from 'vitest';
import { breakJsonLines, breakXmlLines, needsLineBreaks } from '../../../src/context/document-lines.js';

/** Drop JSON whitespace outside string literals — what "content unchanged" means for JSON. */
function minifyJson(json: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i]!;
    if (inString) {
      out += ch;
      if (ch === '\\') out += json[++i];
      else if (ch === '"') inString = false;
    } else if (!/\s/.test(ch)) {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

describe('needsLineBreaks', () => {
  it('flags documents with a line longer than grep shows', () => {
    expect(needsLineBreaks(`{"a":"${'x'.repeat(1200)}"}`)).toBe(true);
    expect(needsLineBreaks('{\n  "a": 1\n}')).toBe(false);
  });
});

describe('breakJsonLines', () => {
  it('indents objects and arrays', () => {
    expect(breakJsonLines('{"a":[1,2],"b":{},"c":[]}')).toBe(
      '{\n  "a": [\n    1,\n    2\n  ],\n  "b": {},\n  "c": []\n}',
    );
  });

  it('leaves string contents, escapes and number literals untouched', () => {
    const json = '{"text":"a, b: {c} [d] \\"e\\" \\\\","big":12345678901234567890,"neg":-1.5e-3,"t":true,"n":null}';
    const broken = breakJsonLines(json);
    expect(minifyJson(broken)).toBe(json);
    expect(broken).toContain('"a, b: {c} [d] \\"e\\" \\\\"');
    expect(broken).toContain('12345678901234567890');
  });

  it('keeps duplicate keys that a JSON.parse round trip would drop', () => {
    const json = '{"k":1,"k":2}';
    expect(minifyJson(breakJsonLines(json))).toBe(json);
  });

  it('re-indents already formatted input without changing its tokens', () => {
    const json = '{\n    "a" : [ 1 ,\n 2 ]\n}';
    expect(breakJsonLines(json)).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
  });
});

describe('breakXmlLines', () => {
  it('puts whole tags in element-only content on separate lines, including empty elements', () => {
    expect(breakXmlLines('<doc><p><br/></p><q></q></doc>')).toBe('<doc>\n<p>\n<br/>\n</p>\n<q>\n</q>\n</doc>');
    expect(breakXmlLines('<empty/>')).toBe('<empty/>');
    const tag = `<a note="example xml:space='preserve'">`;
    expect(breakXmlLines(tag + '<b/></a>')).toBe(tag + '\n<b/>\n</a>');
  });

  it('keeps a mixed-content subtree intact in an element-only document', () => {
    const mixed = '<p>a <b>b</b><i>c</i></p>';
    expect(breakXmlLines(`<doc>${mixed}<q/></doc>`)).toBe(`<doc>\n${mixed}\n<q/>\n</doc>`);
    for (const subtree of ['<p><b><i/></b> tail</p>', '<p><b/> <i/></p>', '<p xml:space="preserve"><b/><i/></p>']) {
      expect(breakXmlLines(subtree)).toBe(subtree);
    }
  });

  it('preserves CDATA, comments, instructions, attribute values and existing whitespace', () => {
    const tokens = [
      '<?xml version="1.0"?>',
      '<r a="x>y">',
      '<!-- >< -->',
      '<?pi >< ?>',
      '<s><b/><![CDATA[><]]></s>',
      '<t> lead and trail </t>',
      '</r>',
    ];
    expect(breakXmlLines(tokens.join(''))).toBe(tokens.join('\n'));
    expect(breakXmlLines('<a>\n  <b/>\n</a>')).toBe('<a>\n  <b/>\n</a>');
  });

  it('retains a DTD verbatim', () => {
    const xml = '<!DOCTYPE a [<!ENTITY x "><">]><a><b/>&x;</a>';
    expect(breakXmlLines(xml)).toBe(xml);
  });

  it('keeps formatting cost proportional to input at large nesting depths', () => {
    const depth = 30000;
    const json = '['.repeat(depth) + '"><"' + ']'.repeat(depth);
    expect(breakJsonLines(json).length).toBeLessThan(json.length * 20);
    expect(minifyJson(breakJsonLines(json))).toBe(json);
    const xml = '<a>'.repeat(depth) + '</a>'.repeat(depth);
    expect(breakXmlLines(xml)).toBe('<a>\n'.repeat(depth) + '</a>\n'.repeat(depth).trimEnd());
  });
});
