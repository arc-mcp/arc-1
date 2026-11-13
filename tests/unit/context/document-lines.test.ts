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
  it('breaks between adjacent tags only and indents by depth', () => {
    expect(breakXmlLines('<?xml version="1.0"?><a x="1"><b>text</b><c/><d><e>t</e></d></a>')).toBe(
      '<?xml version="1.0"?>\n<a x="1">\n  <b>text</b>\n  <c/>\n  <d>\n    <e>t</e>\n  </d>\n</a>',
    );
  });

  it('adds only whitespace between tags', () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?><r a="x>y" b=\'<z/>\'><!-- c<d> --><s><![CDATA[<p></p>]]></s><t> lead and trail </t><u>a&lt;b</u></r>';
    const broken = breakXmlLines(xml);
    expect(broken.replace(/>\n *</g, '><')).toBe(xml);
    expect(broken).toContain('<r a="x>y" b=\'<z/>\'>');
    expect(broken).toContain('<s><![CDATA[<p></p>]]></s>');
    expect(broken).toContain('<t> lead and trail </t>');
  });

  it('keeps existing whitespace text between tags', () => {
    expect(breakXmlLines('<a>\n  <b/>\n</a>')).toBe('<a>\n  <b/>\n</a>');
  });
});
