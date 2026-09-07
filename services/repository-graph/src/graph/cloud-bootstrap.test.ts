import { describe, expect, it } from 'vitest';
import { bootstrapRoles } from './cloud-bootstrap.js';

describe('bootstrap DDL boundary', () => {
  it('only accepts generated hex passwords for two fixed runtime roles', () => {
    expect(
      bootstrapRoles({ apiPassword: 'a'.repeat(64), writerPassword: 'b'.repeat(64), role: 'postgres' }).map(([r]) => r),
    ).toEqual(['arc_graph_api', 'arc_graph_writer']);
    for (const bad of [undefined, '', "';DROP SCHEMA arc_graph;--", 'x'.repeat(64)])
      expect(() => bootstrapRoles({ apiPassword: bad, writerPassword: 'a'.repeat(64) })).toThrow(
        /^Invalid role secrets$/,
      );
  });
});
