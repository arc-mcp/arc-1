import { createRequire } from 'node:module';
import { ipKeyGenerator } from 'express-rate-limit';
import { describe, expect, it } from 'vitest';

// Exercise the transitive copy used by the rate limiter, even if npm stops hoisting it.
const require = createRequire(import.meta.url);
const rateLimitRequire = createRequire(require.resolve('express-rate-limit'));
const { Address6 } = rateLimitRequire('ip-address') as typeof import('ip-address');

// ARC-1 uses subnet keys, not these classifiers. Guard the dependency fixes without
// implying that either advisory demonstrated an SSRF path in ARC-1 itself.
describe('ip-address security regressions', () => {
  describe('GHSA-2vr4-cq9g-pvrc: NAT64 local-use /48 is private', () => {
    it.each([
      '64:ff9b:1::',
      '64:ff9b:1:7f00:0:100::',
      '64:ff9b:1::7f00:1',
      '64:ff9b:1:a9fe:a9:fe00::',
      '64:ff9b:1::a9fe:a9fe',
      '64:ff9b:1:ffff:ffff:ffff:ffff:ffff',
      '0064:ff9b:0001:0000:0000:0000:7f00:0001',
      '64:ff9b:1::1/0',
    ])('classifies %s as private', (ip) => {
      expect(new Address6(ip).isPrivate()).toBe(true);
    });

    it.each(['64:ff9b:0:ffff::1', '64:ff9b:2::1', '64:ff9c::1', '2001:4860:4860::8888'])(
      'does not broaden the range to %s',
      (ip) => expect(new Address6(ip).isPrivate()).toBe(false),
    );
  });

  describe('GHSA-rpw4-54j3-4h4q: link-local covers the full fe80::/10', () => {
    it.each([
      'fe80::',
      'fe80:0:0:1::1',
      'fe80::1:0:0:0:1',
      'fe81::1',
      'fe90::1',
      'fea0::1',
      'febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
      'fe81:0000:0000:0000:0000:0000:0000:0001',
      'fe81::1/0',
    ])('classifies %s as link-local', (ip) => {
      expect(new Address6(ip).isLinkLocal()).toBe(true);
    });

    it.each(['fe7f:ffff::1', 'fec0::1', 'fc00::1', 'ff02::1', '2001:4860:4860::8888'])(
      'does not classify %s as link-local',
      (ip) => expect(new Address6(ip).isLinkLocal()).toBe(false),
    );
  });

  it.each(['fc00::1', 'fdff::1', '::ffff:192.168.1.1', '64:ff9b::c0a8:101'])(
    'preserves private classification for %s',
    (ip) => expect(new Address6(ip).isPrivate()).toBe(true),
  );

  it.each(['fe80::1', '::ffff:169.254.169.254', '64:ff9b::a9fe:a9fe'])(
    'preserves link-local classification for %s',
    (ip) => expect(new Address6(ip).isLinkLocal()).toBe(true),
  );
});

describe('rate-limit IP key compatibility', () => {
  it.each([
    ['192.0.2.1', '192.0.2.1'],
    ['::ffff:192.0.2.1', '192.0.2.1'],
    ['::ffff:c000:201', '192.0.2.1'],
    ['::192.0.2.1', '192.0.2.1'],
    ['2001:db8:abcd:1200::1', '2001:db8:abcd:1200::/56'],
    ['2001:0db8:abcd:12ff:0000:0000:0000:0009', '2001:db8:abcd:1200::/56'],
    ['2001:db8:abcd:1300::1', '2001:db8:abcd:1300::/56'],
  ])('keeps the expected bucket for %s', (ip, expected) => {
    expect(ipKeyGenerator(ip)).toBe(expected);
  });
});
