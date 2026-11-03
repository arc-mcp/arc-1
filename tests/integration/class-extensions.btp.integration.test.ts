/** Read-only BTP public-flow qualification. No class/ENHO fixtures are created. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { config } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdtClient } from '../../src/adt/client.js';
import { createBearerTokenProvider, loadServiceKeyFile, parseServiceKey } from '../../src/adt/oauth.js';
import { defaultSafetyConfig } from '../../src/adt/safety.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { resetCachedFeatures, setCachedFeatures } from '../../src/handlers/feature-cache.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { hasBtpCredentials } from './helpers.js';

config();
const describeIf = hasBtpCredentials() ? describe : describe.skip;
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const configBtp = { ...DEFAULT_CONFIG, systemType: 'btp' as const };
const fixtures = (process.env.TEST_BTP_CLASS_EXTENSION_FIXTURE ?? '').split(',').filter(Boolean);
const targets: Array<{ type: string; name: string; include?: string }> = [
  { type: 'CLAS', name: 'CL_ABAP_RANDOM' },
  { type: 'INTF', name: 'IF_OO_ADT_CLASSRUN' },
  ...fixtures.map((name) => ({ type: 'CLAS', name })),
  ...(fixtures.includes('CL_SEEF_ADT_TEST_AUNIT_1')
    ? [{ type: 'CLAS', name: 'CL_SEEF_ADT_TEST_AUNIT_1', include: 'definitions' }]
    : []),
];

describeIf('BTP class extension public reads', () => {
  let client: AdtClient;
  let release: string | undefined;
  const observations: Record<string, unknown>[] = [];
  beforeAll(async () => {
    const key = process.env.TEST_BTP_SERVICE_KEY
      ? parseServiceKey(process.env.TEST_BTP_SERVICE_KEY)
      : loadServiceKeyFile(process.env.TEST_BTP_SERVICE_KEY_FILE || process.env.SAP_BTP_SERVICE_KEY_FILE || '');
    client = new AdtClient({
      baseUrl: key.url,
      client: key.abap?.sapClient || '100',
      language: 'EN',
      safety: defaultSafetyConfig(),
      bearerTokenProvider: createBearerTokenProvider(key),
    });
    const components = await client.getInstalledComponents();
    release = components.find((component) => component.name === 'SAP_BASIS')?.release;
    expect(release).toBeTruthy();
    setCachedFeatures({ abapRelease: release, systemType: 'btp' });
  }, 180_000);

  afterAll(() => {
    resetCachedFeatures();
    if (process.env.TEST_BTP_CLASS_EXTENSION_OUTPUT)
      writeFileSync(
        process.env.TEST_BTP_CLASS_EXTENSION_OUTPUT,
        `${JSON.stringify(
          {
            checkedAt: new Date().toISOString(),
            target: 'BTP ABAP service-key/browser OAuth, direct HTTPS',
            release,
            sourceHashes: Object.fromEntries(
              ['class-extensions', 'enhancements', 'enhancement-include'].map((file) => [
                file,
                digest(readFileSync(new URL(`../../src/adt/${file}.ts`, import.meta.url), 'utf8')),
              ]),
            ),
            observations,
          },
          null,
          2,
        )}\n`,
      );
  });

  it.each(targets)(
    'preserves $type $name and reports bounded provider coverage',
    async (target) => {
      const base = await handleToolCall(client, configBtp, 'SAPRead', { ...target, extensions: 'none' });
      expect(base.isError, `${target.type} ${target.name} baseline`).not.toBe(true);
      expect(base.content).toHaveLength(1);
      for (const extensions of ['summary', 'sources'] as const) {
        const result = await handleToolCall(client, configBtp, 'SAPRead', { ...target, extensions });
        expect(result.isError, `${target.name} ${extensions}`).not.toBe(true);
        expect(result.content[0]).toEqual(base.content[0]);
        const extra = result.content.slice(1);
        const extraBytes = extra.reduce((sum, block) => sum + Buffer.byteLength(block.text), 0);
        expect(extraBytes).toBeLessThanOrEqual(extensions === 'summary' ? 2048 : 16384);
        const summary = JSON.parse(extra[0]!.text.slice('[extensions] '.length));
        expect(summary.providers.length).toBeGreaterThan(0);
        expect(summary.root).toMatchObject({ type: target.type, name: target.name });
        expect(summary.applicability).toBe('unknown');
        expect(summary.consumed.sends).toBeLessThanOrEqual(extensions === 'summary' ? 6 : 20);
        expect(summary.consumed.responseBytes).toBeLessThanOrEqual(extensions === 'summary' ? 131072 : 262144);
        if (target.name === 'CL_OO_ADT_ENHANCED_CLASS') {
          expect(summary.identities).toContainEqual(expect.objectContaining({ name: 'CL_OO_ADT_ENHANCED_CLASS1' }));
          const sourceProvider = summary.providers.find(
            (provider: { id: string }) => provider.id === 'class_exted_obj_source',
          );
          if (sourceProvider?.status === 'denied') {
            expect(summary.omissions.sources).toBeGreaterThan(0);
            expect(extra.some((block) => block.text.includes('representation=generated_include_revision'))).toBe(false);
          }
        }
        if (target.name === 'CL_SEEF_ADT_TEST_AUNIT_1') {
          expect(summary.providers[0].status).toBe('returned');
          if (target.include) expect(summary.providers[1].reason).toContain(`class_section=${target.include}`);
          else if (extensions === 'sources') {
            const graph = JSON.parse(
              extra
                .find((block) => block.text.startsWith('[extension graph] '))!
                .text.slice('[extension graph] '.length),
            );
            expect(graph.filter((edge: { kind: string }) => edge.kind === 'extends')).toHaveLength(7);
            expect(graph.filter((edge: { kind: string }) => edge.kind === 'replacement')).toHaveLength(3);
            expect(
              summary.identities.find((node: { name: string }) => node.name === 'SEEF_ADT_TEST_ENHO_CLASS_1')?.switch,
            ).toBe('SEEF_ADT_TEST_SWITCH_01:off');
            expect(extra.filter((block) => block.text.includes('representation=rendered_plugin_source'))).toHaveLength(
              8,
            );
          }
        }
        observations.push({
          target,
          extensions,
          baseSha256: digest(base.content[0]!.text),
          extraBytes,
          summary,
          sourceBlocks: extra
            .slice(1)
            .map((block) => ({ label: block.text.split('\n')[0], sha256: digest(block.text) })),
        });
      }
    },
    60_000,
  );
});
