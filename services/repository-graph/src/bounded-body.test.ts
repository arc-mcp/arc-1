import { describe, expect, it } from 'vitest';
import { boundedText } from './bounded-body.js';

describe('decoded response byte limit', () => {
  it('reads an in-budget chunked body and rejects an oversized body', async () => {
    expect(await boundedText(new Response('small'), 5)).toBe('small');
    await expect(boundedText(new Response('oversize'), 5)).rejects.toThrow('response_too_large');
  });
  it('cancels a body when its declared length already exceeds the budget', async () => {
    let cancelled = false;
    const body = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    await expect(boundedText(new Response(body, { headers: { 'content-length': '99' } }), 5)).rejects.toThrow(
      'response_too_large',
    );
    expect(cancelled).toBe(true);
  });
});
