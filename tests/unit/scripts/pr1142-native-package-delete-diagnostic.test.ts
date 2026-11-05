import { expect, it } from 'vitest';
import { packageDeleteDiagnostic } from '../../../scripts/qualification/pr1142/native-package-delete-diagnostic.js';
import { AdtApiError } from '../../../src/adt/errors.js';

const header =
  '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceError"/>';
const project = (body: string, handle = 'SECRET/HANDLE') =>
  packageDeleteDiagnostic(new AdtApiError('synthetic', 400, '/synthetic', body), handle);
it.each(['', ' lang="EN"'])(
  'retains bounded native message and T100 evidence, including missing language %s',
  (lang) => {
    const result = project(
      `${header}<message${lang}>Package still contains objects.</message><properties><entry key="T100KEY-MSGID">PAK</entry><entry key="T100KEY-MSGNO">051</entry></properties></exc:exception>`,
    );
    expect(result).toMatchObject({
      status: 400,
      shape: 'native-exception-projection',
      rawBodyRetained: false,
      properties: [
        { key: 'T100KEY-MSGID', value: 'PAK' },
        { key: 'T100KEY-MSGNO', value: '051' },
      ],
      messages: [{ key: 'message', text: 'Package still contains objects.' }, { key: 'localizedMessage' }],
    });
  },
);
it('redacts exact and encoded owning handles and excludes credential/session and unknown property fields', () => {
  const result = project(
    `${header}<message>SECRET/HANDLE SECRET%2FHANDLE</message><localizedMessage>password secret-value</localizedMessage><properties><entry key="Session">SECRET-SESSION</entry><entry key="T100KEY-V1">cookie=secret</entry></properties></exc:exception>`,
  );
  expect(JSON.stringify(result)).not.toMatch(/SECRET|secret-value|cookie=secret/);
  expect(result).toMatchObject({ shape: 'native-exception-projection', rawBodyRetained: false });
});
it.each([
  '<html>unknown</html>',
  `${header}<message>x</message><message>y</message></exc:exception>`,
  'x'.repeat(65537),
])('keeps only digest evidence for unknown/ambiguous/oversized errors', (body) => {
  const result = project(body);
  expect(result).toHaveProperty('sha256');
  expect(result.shape).not.toBe('native-exception-projection');
  expect(JSON.stringify(result)).not.toContain(body);
});
it('does not expose any body when the owning handle is unavailable', () => {
  expect(project(`${header}<message>raw diagnostic</message></exc:exception>`, '')).toMatchObject({
    shape: 'unavailable',
  });
});
