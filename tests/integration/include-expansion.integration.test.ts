/**
 * Live read of a program with its includes (SAPRead expand_includes for PROG, FEAT-23).
 * Standard reports differ by release, so the test uses the first candidate whose INCLUDE statements
 * name an include the walk reads, and skips cleanly when none qualifies.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { expandsInclude, findIncludeStatements, readProgramExpanded } from '../../src/adt/include-expansion.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

describe('readProgramExpanded (PROG include walk)', () => {
  let client: AdtClient;

  beforeAll(() => {
    requireSapCredentials();
    client = getTestClient();
  });

  it('reads a real program with its includes, each block equal to a plain include read', async (ctx) => {
    let fixture: { name: string; include: string } | undefined;
    for (const name of ['RSHOWTIM', 'RSPARAM', 'RSUSR002', 'SAPMSSY0']) {
      let source: string | undefined;
      try {
        source = (await client.getProgram(name)).source;
      } catch {
        source = undefined;
      }
      const include = findIncludeStatements(source ?? '').find((statement) => expandsInclude(statement.name, name));
      if (include) {
        fixture = { name, include: include.name };
        break;
      }
    }
    requireOrSkip(ctx, fixture, `${SkipReason.NO_FIXTURE}: no candidate program with an expandable include`);

    const result = await readProgramExpanded(client, 'PROG', fixture.name, { root: 'active' });
    expect(result.blocks[0]?.name).toBe(`PROG ${fixture.name}`);
    const block = result.blocks.find((b) => b.name.toUpperCase() === fixture.include.toUpperCase());
    expect(block?.unreadable).toBeUndefined();
    expect(block?.source).toBe((await client.getInclude(fixture.include)).source);
  });
});
