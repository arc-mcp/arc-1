import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../../src/server/config.js';
import { buildServerInstructions } from '../../../src/server/server.js';

describe('buildServerInstructions', () => {
  it('is byte-identical to the static instructions without a system label', () => {
    const instructions = buildServerInstructions(parseArgs([]));
    expect(instructions.startsWith('ARC-1 gives this SAP ABAP system')).toBe(true);
    expect(instructions).not.toContain('Connected SAP system');
  });

  it('prepends the connected-system label as the first line', () => {
    const config = parseArgs(['--system-label', 'ERP production (read-only)']);
    const instructions = buildServerInstructions(config);
    // First line, so a model scanning several look-alike ARC-1 servers sees the difference
    // immediately instead of probing each with a tool call.
    expect(instructions.startsWith('Connected SAP system: ERP production (read-only).')).toBe(true);
    expect(instructions).toContain('ARC-1 gives this SAP ABAP system');
  });
});
