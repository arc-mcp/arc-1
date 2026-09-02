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
