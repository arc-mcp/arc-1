/**
 * Tests for getAppUrl() — the function that determines the public URL arc-1
 * advertises in OAuth metadata. ARC1_PUBLIC_URL env var override beats
 * VCAP_APPLICATION; without either, returns undefined.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getAppUrl } from '../../../src/adt/btp.js';

describe('getAppUrl', () => {
  let savedPublicUrl: string | undefined;
  let savedVcapApp: string | undefined;

  beforeEach(() => {
    savedPublicUrl = process.env.ARC1_PUBLIC_URL;
    savedVcapApp = process.env.VCAP_APPLICATION;
    delete process.env.ARC1_PUBLIC_URL;
    delete process.env.VCAP_APPLICATION;
  });

  afterEach(() => {
    if (savedPublicUrl === undefined) delete process.env.ARC1_PUBLIC_URL;
    else process.env.ARC1_PUBLIC_URL = savedPublicUrl;
    if (savedVcapApp === undefined) delete process.env.VCAP_APPLICATION;
    else process.env.VCAP_APPLICATION = savedVcapApp;
  });

  it('returns undefined when neither env var is set', () => {
    expect(getAppUrl()).toBeUndefined();
  });

  it('returns the CF route from VCAP_APPLICATION.application_uris', () => {
    process.env.VCAP_APPLICATION = JSON.stringify({
      application_uris: ['my-app.cfapps.us10.hana.ondemand.com'],
    });
    expect(getAppUrl()).toBe('https://my-app.cfapps.us10.hana.ondemand.com');
  });

  it('falls back to .uris when application_uris missing', () => {
    process.env.VCAP_APPLICATION = JSON.stringify({
      uris: ['my-app.cfapps.us10.hana.ondemand.com'],
    });
    expect(getAppUrl()).toBe('https://my-app.cfapps.us10.hana.ondemand.com');
  });

  it('returns undefined when VCAP_APPLICATION is malformed JSON', () => {
    process.env.VCAP_APPLICATION = 'not-json';
    expect(getAppUrl()).toBeUndefined();
  });

  it('ARC1_PUBLIC_URL overrides VCAP_APPLICATION', () => {
    process.env.VCAP_APPLICATION = JSON.stringify({
      application_uris: ['cf-host.example.com'],
    });
    process.env.ARC1_PUBLIC_URL = 'https://api-mgmt.example.com/arc1';
    expect(getAppUrl()).toBe('https://api-mgmt.example.com/arc1');
  });

  it('ARC1_PUBLIC_URL works without VCAP_APPLICATION', () => {
    process.env.ARC1_PUBLIC_URL = 'https://api-mgmt.example.com/arc1';
    expect(getAppUrl()).toBe('https://api-mgmt.example.com/arc1');
  });

  it('strips trailing slash from ARC1_PUBLIC_URL', () => {
    process.env.ARC1_PUBLIC_URL = 'https://api-mgmt.example.com/arc1/';
    expect(getAppUrl()).toBe('https://api-mgmt.example.com/arc1');
  });

  it('preserves multi-segment paths', () => {
    process.env.ARC1_PUBLIC_URL = 'https://api-mgmt.example.com/v1/arc1';
    expect(getAppUrl()).toBe('https://api-mgmt.example.com/v1/arc1');
  });

  it('treats empty / whitespace-only ARC1_PUBLIC_URL as unset', () => {
    process.env.ARC1_PUBLIC_URL = '   ';
    process.env.VCAP_APPLICATION = JSON.stringify({
      application_uris: ['cf-host.example.com'],
    });
    expect(getAppUrl()).toBe('https://cf-host.example.com');
  });
});
