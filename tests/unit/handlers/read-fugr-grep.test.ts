/**
 * SAPRead type=FUGR with grep: the pattern is applied to each include of the expanded
 * function group instead of being ignored (the whole include tree used to come back in full).
 * Kept apart from read.test.ts, which is at its file-size budget.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

// main → TOP + UXX; UXX → U01 + U02. The function module bodies live in U01/U02, which
// only the recursive walk reaches.
const SOURCES: Record<string, string> = {
  main: 'FUNCTION-POOL zdemo.\nINCLUDE lzdemotop.\nINCLUDE lzdemouxx.',
  lzdemotop: 'DATA gv_count TYPE i.',
  lzdemouxx: 'INCLUDE lzdemou01.\nINCLUDE lzdemou02.',
  lzdemou01: "FUNCTION z_demo_a.\n  CALL FUNCTION 'ENQUEUE_EZDEMO'.\n  lo_model->read_entities( ).\nENDFUNCTION.",
  lzdemou02: "FUNCTION z_demo_b.\n  CALL FUNCTION 'ENQUEUE_EZDEMO'.\n  CALL FUNCTION 'ENQUEUE_EZDEMO'.\nENDFUNCTION.",
};

function sourceFor(url: string): string | undefined {
  if (url.includes('/functions/groups/') && url.includes('/source/main')) return SOURCES.main;
  const include = /\/includes\/([^/]+)\/source\/main/.exec(url)?.[1];
  return include ? SOURCES[include] : undefined;
}

function serve(fail: string[] = []): void {
  mockFetch.mockImplementation((url: string) => {
    const include = /\/includes\/([^/]+)\//.exec(url)?.[1];
    if (include && fail.includes(include)) {
      return Promise.reject(new AdtApiError('Not found', 404, `/includes/${include}`));
    }
    const body = sourceFor(url);
    return Promise.resolve(body === undefined ? mockResponse(404, 'not found') : mockResponse(200, body));
  });
}

async function readFugr(args: Record<string, unknown>) {
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
    type: 'FUGR',
    name: 'ZDEMO',
    ...args,
  });
  return { isError: result.isError, text: result.content[0]?.text ?? '' };
}

describe('SAPRead FUGR grep', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    serve();
  });

  it('greps each include of the expanded group and returns only the matches', async () => {
    const { isError, text } = await readFugr({ expand_includes: true, grep: 'ENQUEUE_EZDEMO' });

    expect(isError).toBeUndefined();
    expect(text).toMatch(/^3 match\(es\) for \/ENQUEUE_EZDEMO\/i in 2 of 5 source\(s\):/);
    expect(text).toContain('=== lzdemou01 ===\n1 match(es)');
    expect(text).toContain('=== lzdemou02 ===\n2 match(es)');
    // Line numbers count within the include, so the hit can be read with SAPRead type=INCL.
    expect(text).toContain(">    2:   CALL FUNCTION 'ENQUEUE_EZDEMO'.");
    // No full source: an include without a match is not in the answer at all.
    expect(text).not.toContain('lzdemotop');
    expect(text).not.toContain('gv_count');
  });

  it('implies the expansion when grep comes without expand_includes', async () => {
    const { isError, text } = await readFugr({ grep: 'ENQUEUE_EZDEMO' });

    expect(isError).toBeUndefined();
    expect(text).toContain('=== lzdemou01 ===');
    // Not the metadata listing, which cannot be searched.
    expect(text).not.toContain('"functions"');
  });

  it('reports no match across the includes', async () => {
    const { isError, text } = await readFugr({ expand_includes: true, grep: 'NOWHERE_TOKEN' });

    expect(isError).toBeUndefined();
    expect(text).toBe('No matches found for /NOWHERE_TOKEN/i in 5 source(s).');
  });

  it('finds a non-regex pattern literally in one include although the others lack it', async () => {
    // `read_entities(` is no valid regex. grepSource searches it literally and flags it
    // invalid in every include that lacks the text; that must not hide the one that has it.
    const { isError, text } = await readFugr({ expand_includes: true, grep: 'read_entities(' });

    expect(isError).toBeUndefined();
    expect(text).toMatch(/^1 match\(es\) for \/read_entities\\\(\/i in 1 of 5 source\(s\):/);
    expect(text).toContain('=== lzdemou01 ===');
  });

  it('is an error when a non-regex pattern occurs in no include', async () => {
    const { isError, text } = await readFugr({ expand_includes: true, grep: 'nowhere(' });

    expect(isError).toBe(true);
    expect(text).toContain('Invalid regex pattern: "nowhere("');
  });

  it('refuses an unsafe pattern', async () => {
    const { isError, text } = await readFugr({ expand_includes: true, grep: '(?=x)' });

    expect(isError).toBe(true);
    expect(text).toContain('Unsupported grep pattern');
  });

  it('names an include that could not be read as not searched', async () => {
    serve(['lzdemou02']);
    const { isError, text } = await readFugr({ expand_includes: true, grep: 'ENQUEUE_EZDEMO' });

    expect(isError).toBeUndefined();
    expect(text).toMatch(/^1 match\(es\) .* in 1 of 4 source\(s\):/);
    expect(text).toContain('Not searched (could not be read): lzdemou02.');
    expect(text).not.toContain('[Could not read include');
  });

  it('says so when the include cap left includes unsearched', async () => {
    const many = Array.from({ length: 100 }, (_, i) => `INCLUDE linc${String(i).padStart(3, '0')}.`).join('\n');
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(mockResponse(200, url.includes('/functions/groups/') ? many : "CALL FUNCTION 'ENQUEUE_EZDEMO'.")),
    );
    const { isError, text } = await readFugr({ expand_includes: true, grep: 'ENQUEUE_EZDEMO' });

    expect(isError).toBeUndefined();
    expect(text).toContain('=== [truncated] ===\nInclude cap reached; some nested includes were not searched.');
  });

  it('keeps the full expansion when no grep is given', async () => {
    const { isError, text } = await readFugr({ expand_includes: true });

    expect(isError).toBeUndefined();
    expect(text).toContain('=== lzdemotop ===\nDATA gv_count TYPE i.');
    expect(text).toContain('=== lzdemou01 ===\nFUNCTION z_demo_a.');
  });
});
