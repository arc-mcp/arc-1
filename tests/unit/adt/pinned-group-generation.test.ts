import { afterEach, expect, it, vi } from 'vitest';
import { type ActivationOptions, activate } from '../../../src/adt/devtools.js';
import { AdtHttpClient } from '../../../src/adt/http.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';

const group = '/sap/bc/adt/functions/groups/zarc1_fg';
const generated =
  '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="false" generationExecuted="true"/></chkl:messages>';
const success = (body: string) => ({ statusCode: 200, headers: {}, body });
const prompt = (uri: string, type = 'FUGR/F') =>
  `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:c="http://www.sap.com/adt/core"><ioc:entry><ioc:object ioc:deleted="false"><ioc:ref c:uri="${uri}" c:name="ZARC1_FG" c:type="${type}"/></ioc:object></ioc:entry></ioc:inactiveObjects>`;
afterEach(() => vi.restoreAllMocks());

function fixture() {
  const safety = {
    ...defaultSafetyConfig(),
    allowWrites: true,
    multiTargetWrite: {
      enabled: true,
      target: 'A4H/001',
      allowedPackages: ['$TMP'],
      allowedTransports: [],
      serverAllowedTransports: [],
    },
  };
  const http = new AdtHttpClient({ baseUrl: 'https://sap.example' });
  const post = vi.spyOn(http, 'post').mockResolvedValue(success(generated));
  const validate = vi.fn(async () => {});
  const options: ActivationOptions = { name: 'ZARC1_FG', validateReferences: validate, functionGroupGeneration: true };
  return { safety, http, post, validate, options };
}

it.each([false, true])('reports generation through the existing handshake with prompt=%s', async (withPrompt) => {
  const { http, safety, post, validate, options } = fixture();
  if (withPrompt) post.mockResolvedValueOnce(success(prompt(group)));
  const result = await activate(http, safety, group, options);
  expect(result).toMatchObject({ success: true, execution: 'generation' });
  expect(post).toHaveBeenCalledTimes(withPrompt ? 2 : 1);
  expect(validate).toHaveBeenCalledTimes(withPrompt ? 2 : 1);
  for (const call of post.mock.calls) expect(call[4]).toMatchObject({ noReplay: true, retryTransientErrors: false });
});

it('reports actual activation distinctly when native activation also executed', async () => {
  const { http, safety, post, options } = fixture();
  post.mockResolvedValueOnce(success(generated.replace('activationExecuted="false"', 'activationExecuted="true"')));
  expect(await activate(http, safety, group, options)).toMatchObject({ success: true, execution: 'activation' });
});

it('does not reinterpret generation as ordinary activation', async () => {
  const { http, safety, post, options } = fixture();
  delete options.functionGroupGeneration;
  await expect(activate(http, safety, group, options)).rejects.toThrow(/evidence|activation/i);
  expect(post).toHaveBeenCalledTimes(1);
});

it.each(['/sap/bc/adt/oo/classes/zarc1_fg', `${group}/fmodules/zmodule`, `${group}/includes/lzarc1_fgtop`])(
  'refuses the generation profile on another owner before HTTP: %s',
  async (owner) => {
    const { http, safety, post, options } = fixture();
    await expect(activate(http, safety, owner, options)).rejects.toThrow('exactly the selected function group');
    expect(post).not.toHaveBeenCalled();
  },
);

it.each([
  { uri: `${group}/fmodules/zmodule`, type: 'FUGR/FF' },
  { uri: `${group}/includes/lzarc1_fgtop`, type: 'FUGR/I' },
  { uri: '/sap/bc/adt/functions/groups/zother', type: 'FUGR/F' },
  { uri: group, type: 'PROG/P' },
])('refuses an expanded or inconsistent preaudit before confirmation: $uri/$type', async ({ uri, type }) => {
  const { http, safety, post, validate, options } = fixture();
  post.mockResolvedValueOnce(success(prompt(uri, type)));
  await expect(activate(http, safety, group, options)).rejects.toThrow('exactly the selected function group');
  expect(post).toHaveBeenCalledTimes(1);
  expect(validate).toHaveBeenCalledTimes(1);
});

it('preserves policy revalidation failure between preaudit and confirmation', async () => {
  const { http, safety, post, validate, options } = fixture();
  post.mockResolvedValueOnce(success(prompt(group)));
  validate.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Package changed'));
  await expect(activate(http, safety, group, options)).rejects.toThrow('Package changed');
  expect(post).toHaveBeenCalledTimes(1);
});

it('requires positive execution evidence after confirmation and never retries', async () => {
  const { http, safety, post, options } = fixture();
  post
    .mockResolvedValueOnce(success(prompt(group)))
    .mockResolvedValueOnce(success(generated.replace('generationExecuted="true"', 'generationExecuted="false"')));
  await expect(activate(http, safety, group, options)).rejects.toThrow(/evidence|activation/i);
  expect(post).toHaveBeenCalledTimes(2);
});

it('requires an explicit pinned safety context and a scope validator', async () => {
  const { http, safety, post, options } = fixture();
  await expect(activate(http, { ...safety, multiTargetWrite: undefined }, group, options)).rejects.toThrow(
    'explicit pinned profile',
  );
  await expect(activate(http, safety, group, { name: 'ZARC1_FG', functionGroupGeneration: true })).rejects.toThrow();
  expect(post).not.toHaveBeenCalled();
});
