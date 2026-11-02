import { describe, expect, it } from 'vitest';
import { classifySapDomainError } from '../../../src/adt/errors.js';

const missingResource = 'No suitable resource found';
const variantsPath = '/sap/bc/adt/programs/programs/RSUSR002/variants';

describe('program-variant resource diagnostics', () => {
  it.each([variantsPath, '/sap/bc/adt/programs/programs/%2FACME%2FREPORT/variants', `${variantsPath}?sap-client=001`])(
    'identifies the unavailable resource at %s',
    (path) => {
      const result = classifySapDomainError(404, missingResource, path);
      expect(result?.category).toBe('program-variants-unavailable');
      expect(result?.hint).toMatch(/program.variant/i);
      expect(result?.hint).not.toMatch(/SICF|Handler List|3128830/);
      expect(result?.transaction).toBeUndefined();
    },
  );

  it('recognizes SAP XML carrying the same resource error', () => {
    const body = `<exception><type id="ExceptionResourceNotFound"/><message>${missingResource}</message></exception>`;
    expect(classifySapDomainError(404, body, variantsPath)?.category).toBe('program-variants-unavailable');
  });

  it('recognizes the captured German resource response', () => {
    expect(classifySapDomainError(404, 'Keine geeignete Ressource gefunden', variantsPath)?.category).toBe(
      'program-variants-unavailable',
    );
  });

  it.each([
    undefined,
    '/sap/bc/adt/programs/programs/RSUSR002',
    '/sap/bc/adt/atc/variants',
    `${variantsPath}/source/main`,
    '/sap/bc/adt/programs/programs/RSUSR002/other/variants',
    '/other/programs/programs/RSUSR002/variants',
    '/proxy/sap/bc/adt/programs/programs/RSUSR002/variants',
    '/sap/bc/adt/programs/includes/X/variants',
    `${variantsPath}/`,
  ])('keeps the existing resource diagnosis for %s', (path) => {
    expect(classifySapDomainError(404, missingResource, path)?.category).toBe('icf-handler-not-bound');
  });

  it.each([401, 403, 429, 500])('does not relabel HTTP %i', (status) => {
    expect(classifySapDomainError(status, missingResource, variantsPath)?.category).not.toBe(
      'program-variants-unavailable',
    );
  });

  it('does not relabel an ordinary missing-object error', () => {
    expect(classifySapDomainError(404, 'Program does not exist', variantsPath)?.category).toBeUndefined();
  });
});
