import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { configuration } from './qualification-config.mjs';
export const { root, target, actors } = configuration;
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const ownerOf = (fixture) =>
  `/sap/bc/adt/oo/${fixture.type === 'CLAS' ? 'classes' : 'interfaces'}/${fixture.name.toLowerCase()}`;
export function sourceFor(fixture, marker, value) {
  const name = fixture.name.toLowerCase();
  return fixture.type === 'CLAS'
    ? `" ${marker}\nCLASS ${name} DEFINITION PUBLIC FINAL CREATE PUBLIC.\n PUBLIC SECTION.\n METHODS get_value RETURNING VALUE(rv_value) TYPE i.\nENDCLASS.\nCLASS ${name} IMPLEMENTATION.\n METHOD get_value.\n rv_value = ${value}.\n ENDMETHOD.\nENDCLASS.\n`
    : `" ${marker}\nINTERFACE ${name} PUBLIC.\n CONSTANTS value TYPE i VALUE ${value}.\nENDINTERFACE.\n`;
}
export function validateFixtures(manifest, selectedActors = actors) {
  assert.equal(manifest.target, target);
  assert.equal(manifest.nativeUrl, 'https://a4h.marianzeis.de');
  assert.equal(manifest.client, '001');
  assert.match(manifest.marker, /^[A-F0-9]{32}$/);
  assert.equal(manifest.fixtures.length, 4);
  const seen = new Set();
  for (const fixture of manifest.fixtures) {
    const actor = selectedActors.find((a) => a.label === fixture.actor && a.write);
    assert.ok(actor);
    assert.ok(['CLAS', 'INTF'].includes(fixture.type));
    const suffix = actor.letter + (fixture.type === 'CLAS' ? 'C' : 'I');
    assert.match(fixture.name, new RegExp(`^ZARC1_DPP_${suffix}_[A-F0-9]{8}$`));
    const key = `${fixture.actor}:${fixture.type}`;
    assert.equal(seen.has(key), false);
    seen.add(key);
    assert.equal(fixture.source1, sourceFor(fixture, manifest.marker, 1));
    assert.equal(fixture.source2, sourceFor(fixture, manifest.marker, 2));
    assert.equal(fixture.source3, sourceFor(fixture, manifest.marker, 3));
  }
  return digest(JSON.stringify(manifest));
}
