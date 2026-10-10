/** Recovery only for disposable PROG fixtures owned by the calling test. Never use on user objects. */
interface CleanupResult {
  isError?: boolean;
  content: Array<{ text?: string }>;
}

export async function deleteProgramFixture<T extends CleanupResult>(
  call: (tool: string, args: Record<string, unknown>) => Promise<T>,
  name: string,
): Promise<T> {
  const deletion = { action: 'delete', type: 'PROG', name };
  const result = await call('SAPWrite', deletion);
  if (
    !result.isError ||
    !result.content.some((c) => /was not deleted because its text pool is inactive/.test(c.text ?? ''))
  ) {
    return result;
  }
  // New programs have inactive pools, including deliberately uncompilable fixtures.
  // Explicitly discard this test's source and activate before retrying guarded deletion.
  for (const [tool, args] of [
    ['SAPWrite', { action: 'update', type: 'PROG', name, source: `REPORT ${name}.` }],
    ['SAPActivate', { type: 'PROG', name }],
  ] as const) {
    const recovery = await call(tool, args);
    if (recovery.isError)
      throw new Error(`Cleanup of ${name}: ${recovery.content.map((c) => c.text ?? '').join('\n')}`);
  }
  return call('SAPWrite', deletion);
}
