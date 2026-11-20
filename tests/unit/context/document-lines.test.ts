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
  it('preserves mixed content and empty elements without adding text nodes', () => {
    const xml = '<p xml:space="preserve">Hi <b>A</b><i>B</i><br/>!</p>';
    expect(breakXmlLines(xml)).toBe('<p xml:space="preserve">Hi <b>A</b\n><i>B</i\n><br/>!</p>');
  });

  it('preserves CDATA, comments, instructions, attribute values and existing whitespace', () => {
    const xml =
      '<?xml version="1.0"?><r a="x>y"><!-- >< --><?pi >< ?><s><![CDATA[><]]></s><t> lead and trail </t>\n</r>';
    const broken = breakXmlLines(xml);
    expect(broken.replace(/\n(?=\/?>)|(?<=\?>)\n/g, '')).toBe(xml);
    expect(broken).toContain('<!-- >< --><?pi >< ?>');
    expect(broken).toContain('<![CDATA[><]]>');
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
    expect(breakXmlLines(xml).length).toBeLessThan(xml.length * 2);
  });
});
