import { describe, expect, it } from 'vitest';
import { makeSamlMaterial } from '../../helpers/saml-material.js';

describe('makeSamlMaterial', () => {
  it('explains when the openssl executable is unavailable', () => {
    expect(() => makeSamlMaterial('rsa', '/nonexistent/arc1-openssl')).toThrow(
      'OpenSSL binary is required to generate SAML test certificates.',
    );
  });
});
