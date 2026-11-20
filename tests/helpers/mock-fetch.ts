/**
 * Shared test helper for mocking fetch() responses.
 *
 * Provides a `mockResponse()` function that creates Response-like objects
 * compatible with the ADT HTTP client's expectations (status, headers, text(), getSetCookie()).
 */

/**
 * Create a mock Response object for use with vi.stubGlobal('fetch', mockFetch).
 *
 * @param status - HTTP status code
 * @param body - Response body as string
 * @param headers - Optional response headers (key-value pairs)
 * @param cookies - Optional Set-Cookie header values (each string is a full Set-Cookie value)
 */
export function mockResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {},
  cookies: string[] = [],
): Response {
  const h = new Headers(headers);
  const nullBodyStatus = status === 204 || status === 205 || status === 304;
  const nativeResponse = new Response(nullBodyStatus ? null : body, { status, headers: h });
  for (const c of cookies) {
    h.append('set-cookie', c);
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: nativeResponse.statusText,
    headers: h,
    // Tests may deliberately reuse this response object for independent fetches.
    // Give each access a fresh stream instead of sharing a consumed/locked body.
    get body() {
      return new Response(nullBodyStatus ? null : body, { status }).body;
    },
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

/**
 * ADT discovery document of a release without the server-driven collections: it advertises only the
 * program collection. Serve it where a test needs the caller's own discovery to confirm an absence.
 */
export const DISCOVERY_WITHOUT_SERVER_DRIVEN =
  '<?xml version="1.0"?><app:service xmlns:app="http://www.w3.org/2007/app" xmlns:atom="http://www.w3.org/2005/Atom">' +
  '<app:workspace><atom:title>W</atom:title><app:collection href="/sap/bc/adt/programs/programs">' +
  '<atom:title>P</atom:title><app:accept>text/plain</app:accept></app:collection></app:workspace></app:service>';

/** True for a request to the ADT discovery document. */
export function isDiscoveryRequest(url: unknown): boolean {
  return new URL(String(url)).pathname === '/sap/bc/adt/discovery';
}
