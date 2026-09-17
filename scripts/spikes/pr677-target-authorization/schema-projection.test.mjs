import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkTargetSchemaProjection, EXPECTED_LARGE_TARGET_PATTERN } from './schema-projection.mjs';

const targets = (count) => Array.from({ length: count }, (_, index) => `T${String(index).padStart(3, '0')}/001`);
const tool = (target, required = ['target']) => ({
  name: 'SAPRead',
  inputSchema: { type: 'object', properties: { target }, required },
});
function check(tools, expected) {
  const records = [];
  checkTargetSchemaProjection(tools, expected, (name, pass) => records.push({ name, pass }));
  return records;
}
const failed = (records, suffix) => records.some((record) => !record.pass && record.name.endsWith(suffix));

test('nonempty expected projection cannot pass vacuously with no operational tools', () => {
  for (const tools of [[], [{ name: 'SAPTargets', inputSchema: { properties: {} } }]]) {
    assert.ok(failed(check(tools, targets(1)), '.operational_tools_present'));
  }
});

test('schema projection independently accepts exact enums at 1, 2 and 16 targets', () => {
  for (const count of [1, 2, 16]) {
    const expected = targets(count);
    const records = check([tool({ type: 'string', enum: [...expected].reverse() })], expected);
    assert.ok(records.length >= 4);
    assert.ok(records.every((record) => record.pass));
  }
});

test('missing required target fails even if the enum is otherwise correct', () => {
  const expected = targets(1);
  assert.ok(failed(check([tool({ type: 'string', enum: expected }, [])], expected), '.required'));
});

test('extra, missing and duplicate enum entries fail against the trusted complete projection', () => {
  const expected = targets(2);
  for (const values of [[...expected, 'ZZZ/999'], [expected[0]], [expected[0], expected[0]]]) {
    assert.ok(failed(check([tool({ type: 'string', enum: values })], expected), '.exact_enum'));
  }
});

test('canonical large schema is required at 17, 100 and 256 active granted targets', () => {
  assert.equal(EXPECTED_LARGE_TARGET_PATTERN, '^[A-Z][A-Z0-9-]{1,30}[A-Z0-9]\\/[0-9]{3}$');
  for (const count of [17, 100, 256]) {
    const expected = targets(count);
    const records = check([tool({ type: 'string', pattern: EXPECTED_LARGE_TARGET_PATTERN })], expected);
    assert.ok(records.every((record) => record.pass));
  }
});

test('wrong or missing pattern and a lingering large-target enum fail', () => {
  const expected = targets(17);
  for (const pattern of ['.*', '^[A-Z]+/[0-9]+$', undefined]) {
    assert.ok(failed(check([tool({ type: 'string', pattern })], expected), '.canonical_pattern'));
  }
  assert.ok(
    failed(
      check([tool({ type: 'string', pattern: EXPECTED_LARGE_TARGET_PATTERN, enum: expected })], expected),
      '.pattern_shape',
    ),
  );
});

test('target type and unexpected combinators cannot mask an apparently correct enum', () => {
  const expected = targets(1);
  assert.ok(failed(check([tool({ type: ['string', 'null'], enum: expected })], expected), '.string_property'));
  assert.ok(
    failed(check([tool({ type: 'string', enum: expected, anyOf: [{ type: 'string' }] })], expected), '.enum_shape'),
  );
  assert.ok(failed(check([tool({ type: 'string', enum: expected, pattern: '.*' })], expected), '.enum_shape'));
});

test('zero projection excludes operational tools but permits target-free Admin catalog', () => {
  const catalog = { name: 'SAPTargets', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } };
  assert.ok(check([], []).every((record) => record.pass));
  assert.ok(check([catalog], []).every((record) => record.pass));
  assert.ok(failed(check([tool({ type: 'string', enum: [] })], []), '.zero_operational_tools'));
  assert.ok(failed(check([{ ...catalog, inputSchema: { properties: { target: {} } } }], []), '.no_target_selector'));
});
