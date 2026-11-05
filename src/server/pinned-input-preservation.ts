/** Legacy Zod objects strip unknown nested fields. Pinned routes must reject that loss. */
export function assertNoDroppedPinnedInput(raw: unknown, parsed: unknown): void {
  let nodes = 0;
  const inspect = (before: unknown, after: unknown, depth: number): void => {
    if (++nodes > 10_000 || depth > 8) throw new Error('Pinned input exceeds its structural bound.');
    if (!before || typeof before !== 'object') return;
    if (!after || typeof after !== 'object') throw new Error('Invalid pinned input.');
    for (const [key, value] of Object.entries(before)) {
      if (value !== undefined && !Object.hasOwn(after, key)) throw new Error('Unsupported nested pinned input.');
      inspect(value, (after as Record<string, unknown>)[key], depth + 1);
    }
  };
  inspect(raw, parsed, 0);
}
