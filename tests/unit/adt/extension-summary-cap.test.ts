import { describe, expect, it } from 'vitest';
import { ExtensionDiscoverySession, renderExtensionDiscovery } from '../../../src/adt/extension-discovery.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';

describe('mixed provider rendering at the summary output cap', () => {
  it('preserves valid JSON, overall failure statuses and omission counts when providers exceed 2 KiB', () => {
    const session = new ExtensionDiscoverySession(
      'sources',
      {
        root: { type: 'CLAS', name: 'ZROOT', version: 'active' },
        scope: 'CLAS ZROOT owning object',
      },
      defaultSafetyConfig(),
    );
    for (let i = 0; i < 20; i++)
      session.result.providers.push({
        id: `class_exted_obj_source:ZEXTENSION_${i}`,
        family: 'class_bound_enhancement',
        status: i === 19 ? 'denied' : 'returned',
        coverage: 'selected_source',
        version: 'active',
        nested: 'bounded',
        reason:
          'generated active revision 00000; implementation names may be absent; runtime switch applicability unknown',
      });
    session.result.issues.push(...Array.from({ length: 20 }, (_, i) => `source unavailable ${i}`));
    const result = session.finish();
    const output = renderExtensionDiscovery(result);
    const summary = JSON.parse(output[0]!.text.slice('[extensions] '.length));
    expect(Buffer.byteLength(output[0]!.text)).toBeLessThanOrEqual(2048);
    expect(summary.providerStatuses).toEqual({ returned: 19, denied: 1 });
    expect(summary.providers.length + summary.omittedProviders).toBe(20);
    expect(summary.issues).toContain('summary_metadata_omitted');
    expect(summary.omittedIssues).toBe(20);
    expect(summary.omissions.output).toBeGreaterThanOrEqual(summary.omittedProviders + summary.omittedIssues);
    expect(result.providers).toHaveLength(20);
    expect(result.issues).toHaveLength(20);
  });
});
