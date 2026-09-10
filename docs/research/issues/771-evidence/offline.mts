/** Historical characterization tests for reviewed base c55adcb8. No SAP connection or source modification.
 * Expected to fail after the issue #771 fix because they assert the former behavior.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDataElementXml } from '../../../../src/adt/ddic-xml.js';
import { parseDataElementMetadata } from '../../../../src/adt/xml-parser.js';
import { SAPWriteSchema, SAPWriteSchemaBtp } from '../../../../src/handlers/schemas.js';
import { getToolDefinitions } from '../../../../src/handlers/tools.js';
import { DEFAULT_CONFIG } from '../../../../src/server/types.js';
import {
  buildCreateXml,
  dtelNeedsPostCreateUpdate,
  getMetadataWriteProperties,
  mergeMetadataWriteProperties,
} from '../../../../src/handlers/write-helpers.js';
const out = path.dirname(fileURLToPath(import.meta.url));
const wanted = { shortLength: 10, mediumLength: 20, longLength: 40, headingLength: 55, deactivateInputHistory: true };
const base = {
  name: 'Z771_OFFLINE',
  package: '$TMP',
  description: 'Test',
  dataType: 'CHAR',
  length: 60,
  shortLabel: 'ABCDEF',
  mediumLabel: 'ABCDEFGHIJKL',
  longLabel: 'ABCDEFGHIJKLMNOPQRSTU',
  headingLabel: 'ABCDEF',
};
const results: unknown[] = [];
function passed(name: string) {
  results.push({ name, status: 'passed' });
}
for (const [flavor, schema] of [
  ['onprem', SAPWriteSchema],
  ['btp', SAPWriteSchemaBtp],
] as const) {
  for (const action of ['create', 'update']) {
    const r = schema.safeParse({ action, type: 'DTEL', ...base, ...wanted });
    assert.equal(r.success, false);
    if (!r.success)
      assert.deepEqual(r.error.issues.find((i) => i.code === 'unrecognized_keys')?.keys, Object.keys(wanted));
    passed(`${flavor}: ${action} rejects all five keys`);
  }
  const batch = schema.parse({
    action: 'batch_create',
    package: '$TMP',
    objects: [{ type: 'DTEL', ...base, ...wanted }],
  });
  for (const k of Object.keys(wanted)) assert.equal(k in batch.objects![0], false);
  passed(`${flavor}: batch silently strips all five keys`);
  const config = { ...DEFAULT_CONFIG, allowWrites: true, systemType: flavor };
  const tool = getToolDefinitions(config).find((t) => t.name === 'SAPWrite')!;
  const props = tool.inputSchema.properties as Record<string, any>;
  for (const k of Object.keys(wanted)) {
    assert.equal(k in props, false);
    assert.equal(k in props.objects.items.properties, false);
  }
  passed(`${flavor}: advertised top-level and batch schemas omit all five keys`);
}
for (const key of Object.keys(wanted)) assert.equal(key in getMetadataWriteProperties(wanted), false);
passed('metadata extractor drops all five keys');
assert.equal(dtelNeedsPostCreateUpdate(wanted), false);
passed('post-create PUT detector ignores all five keys');
const xml = buildDataElementXml({ ...base, ...wanted });
for (const [tag, value] of [
  ['short', '06'],
  ['medium', '12'],
  ['long', '21'],
  ['heading', '06'],
])
  assert.ok(xml.includes(`<dtel:${tag}FieldLength>${value}</dtel:${tag}FieldLength>`));
assert.ok(xml.includes('<dtel:deactivateInputHistory>false</dtel:deactivateInputHistory>'));
passed('builder emits derived lengths and false even when extra runtime keys supplied');
const raw = fs.readFileSync(path.join(out, '758/direct-put-active.xml'), 'utf8');
const parsed = parseDataElementMetadata(raw);
for (const k of Object.keys(wanted)) assert.equal(k in parsed, false);
passed('read parser drops five values present in live response');
const merged = await mergeMetadataWriteProperties(
  { getDataElement: async () => parsed } as any,
  'DTEL',
  parsed.name,
  getMetadataWriteProperties(wanted),
);
const rebuilt = buildCreateXml('DTEL', parsed.name, '$TMP', parsed.description, merged, 'EN');
assert.ok(rebuilt.includes('<dtel:shortFieldLength>06</dtel:shortFieldLength>'));
assert.ok(rebuilt.includes('<dtel:deactivateInputHistory>false</dtel:deactivateInputHistory>'));
passed('merge and rebuild loses stored lengths and true flag');
fs.writeFileSync(path.join(out, 'offline-results.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({ tests: results.length, passed: results.length, results }, null, 2));
