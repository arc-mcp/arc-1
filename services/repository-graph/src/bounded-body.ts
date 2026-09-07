/** Counts decoded bytes, including chunked/compressed responses. Never retains an unbounded body. */
export async function boundedText(
  response: {
    headers: { get(name: string): string | null };
    body: {
      getReader(): {
        read(): Promise<{ done: boolean; value?: Uint8Array }>;
        cancel(): Promise<void>;
        releaseLock(): void;
      };
    } | null;
  },
  maxBytes = 1_048_576,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('response_too_large');
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      if (!item.value) throw new Error('invalid_response_chunk');
      bytes += item.value.byteLength;
      if (bytes > maxBytes) throw new Error('response_too_large');
      chunks.push(item.value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
