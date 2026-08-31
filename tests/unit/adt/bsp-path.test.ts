import { describe, expect, it } from 'vitest';
import { resolveBspNameAndPath } from '../../../src/adt/bsp-path.js';

describe('resolveBspNameAndPath', () => {
  it.each([
    ['ZAPP_BOOKING', undefined, { appName: 'ZAPP_BOOKING' }],
    ['/ZAPP_BOOKING', undefined, { appName: '/ZAPP_BOOKING' }],
    ['ZAPP_BOOKING/WebContent', undefined, { appName: 'ZAPP_BOOKING', path: 'WebContent' }],
    ['/UI2/USHELL', undefined, { appName: '/UI2/USHELL' }],
    ['/UI2/USHELL/chips', '/action.chip.xml/', { appName: '/UI2/USHELL', path: 'chips/action.chip.xml' }],
    ['ZAPP/a/b/c', undefined, { appName: 'ZAPP', path: 'a/b/c' }],
    ['ZAPP/', '//webapp//', { appName: 'ZAPP', path: 'webapp' }],
    ['', '/manifest.json/', { appName: '', path: 'manifest.json' }],
  ])('resolves name=%j and appendedPath=%j', (name, appendedPath, expected) => {
    expect(resolveBspNameAndPath(name, appendedPath)).toEqual(expected);
  });
});
