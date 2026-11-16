import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('experimental local SSO example', () => {
  it('keeps email admin-controlled and verified, and selects the claim explicitly', () => {
    const realm = JSON.parse(
      readFileSync(new URL('../../../examples/local-sso/keycloak/arc1-realm.json', import.meta.url), 'utf8'),
    );
    const profileComponent = realm.components['org.keycloak.userprofile.UserProfileProvider'][0];
    expect(profileComponent.providerId).toBe('declarative-user-profile');
    const profile = JSON.parse(profileComponent.config['kc.user.profile.config'][0]);
    const email = profile.attributes.find((attribute: { name: string }) => attribute.name === 'email');
    expect(realm.verifyEmail).toBe(true);
    expect(realm.defaultOptionalClientScopes).toBeUndefined();
    expect(realm.userProfileEnabled).toBeUndefined();
    expect(email.permissions).toEqual({ view: ['admin', 'user'], edit: ['admin'] });
    expect(profile.unmanagedAttributePolicy).toBe('ADMIN_EDIT');
    const arc1Scope = realm.clientScopes.find((scope: { name: string }) => scope.name === 'arc1');
    expect(arc1Scope.protocolMappers.map((mapper: { name: string }) => mapper.name)).toEqual(
      expect.arrayContaining(['email', 'email-verified']),
    );
    const compose = readFileSync(new URL('../../../examples/local-sso/compose.saml.yaml', import.meta.url), 'utf8');
    expect(compose).toMatch(/^\s+SAP_PP_SAML_NAMEID_CLAIM: email$/m);
  });
});
