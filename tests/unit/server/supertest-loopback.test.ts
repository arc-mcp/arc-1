import type { IncomingMessage, ServerResponse } from 'node:http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

describe('supertest reaches its own throwaway server', () => {
  it('addresses the request to the family the server bound', async () => {
    // `::ffff:127.0.0.1` means the IPv4 request landed on the `::` socket by luck —
    // a foreign IPv4 listener on that ephemeral port would have taken it instead
    // (tests/helpers/supertest-loopback.ts).
    let remote: string | undefined;
    const res = await request((req: IncomingMessage, response: ServerResponse) => {
      remote = req.socket.remoteAddress;
      response.end('ok');
    }).get('/');

    expect(res.status).toBe(200);
    expect(remote).not.toBe('::ffff:127.0.0.1');
  });
});
