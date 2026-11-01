/**
 * Make supertest talk to its own server.
 *
 * `request(app)` binds a throwaway server with a host-less `listen(0)`, which
 * lands on the IPv6 wildcard `::`, and then requests `http://127.0.0.1:<port>`.
 * macOS picks that ephemeral port from the IPv6 table alone, so it happily hands
 * out a port another process already owns on IPv4 — Spotify, Ollama, Cursor and
 * friends all keep `0.0.0.0`/`127.0.0.1` listeners inside 49152-65535 — and the
 * kernel then routes the IPv4 request to that foreign socket instead of ours. The
 * test sees whatever the squatter answers: ECONNRESET, `Parse Error: Expected
 * HTTP/, RTSP/ or ICE/`, a timeout, or a plain wrong status, in whichever HTTP
 * test file drew the unlucky port.
 *
 * Binding 127.0.0.1 instead is not an option here: a `listen` with a host resolves
 * it through `dns.lookup` and supertest reads `address()` synchronously. So keep
 * the bind and address the request to the family it actually bound.
 */
import { Test } from 'supertest';

const serverAddress = Test.prototype.serverAddress;

Test.prototype.serverAddress = function loopbackServerAddress(app, path) {
  const url = serverAddress.call(this, app, path);
  const bound = (app as { address?: () => { family?: string } | null }).address?.();
  return bound?.family === 'IPv6' ? url.replace('//127.0.0.1:', '//[::1]:') : url;
};
