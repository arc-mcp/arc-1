import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TARGET_CATALOG_MAX_RESULT_BYTES } from '../../../src/server/multi-target-catalog-enforced.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

// Presence/link checks are smoke tests, not a semantic review of arbitrary prose.
// Preserve paragraph boundaries; pin complete normative paragraphs/rows below.
const paragraphs = (text: string) => text.split(/\r?\n\s*\r?\n/).map((part) => part.replace(/\s+/g, ' ').trim());
const read = (path: string) =>
  paragraphs(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')).join('\n\n');
const hasParagraph = (text: string, expected: string) => paragraphs(text).includes(expected);
const setup = read('docs_page/multi-target-setup.md');
const admin = read('docs_page/multi-target-administration.md');
const auth = read('docs_page/authorization.md');

describe('target authorization operator documentation', () => {
  it('keeps one static-first setup with explicit candidate/readiness and evidence links', () => {
    expect(setup).toContain('### Optional target authorization');
    expect(setup).toContain('one static cohort role, one collection, one test user');
    expect(setup).toContain('not customer-ready yet');
    expect(setup).toContain('published in `@arc-mcp/xsuaa-auth` 1.1.0');
    expect(setup).toContain('Live acceptance remains incomplete');
    expect(setup).not.toContain('published `1.0.2` dependency is insufficient');
    for (const path of [
      'docs/plans/xsuaa-target-authorization.md',
      'docs/adr/0008-opt-in-xsuaa-target-authorization.md',
      'docs/research/2026-09-15-pr677-target-authorization-implementation.md',
    ]) {
      expect(setup).toContain(path);
    }
    expect(setup).toContain('IAS-fed values are optional and not yet a verified operator recipe');
    expect(read('docs_page/xsuaa-setup.md')).toContain('multi-target-setup.md#optional-target-authorization');
  });

  it('documents the unchanged default and deliberate multi-only opt-in rather than automatic migration', () => {
    expect(DEFAULT_CONFIG.multiTargetAuthorization).toBe('legacy');
    expect(
      hasParagraph(
        setup,
        'Unset or explicit `legacy` leaves existing authorization, paging and tool visibility unchanged. Display-label sanitization applies in both modes; see the [compatibility note](multi-target-administration.md#enforced-catalog-differences).',
      ),
    ).toBe(true);
    expect(setup).toContain('ARC1_MULTI_TARGET_AUTHORIZATION: xsuaa-attribute');
    expect(setup).toContain('SAP_BTP_PP_DESTINATION');
    expect(admin).toContain('before startup destination lookups or SAP probes');
    expect(admin).toContain('security downgrade');
    expect(admin).toContain('ARC1_MULTI_TARGET_AUTHORIZATION: legacy');
    expect(admin).toContain('CF environment');
    expect(read('.env.example')).toContain('# ARC1_MULTI_TARGET_AUTHORIZATION=xsuaa-attribute');
    expect(read('docs_page/configuration-reference.md')).toContain('--multi-target-authorization');
  });

  it('separates grants, capability union, diagnostics and actual SAP access', () => {
    expect(auth).toContain('global functional scopes × union of granted targets');
    expect(auth).toContain('not execution on an ungranted target');
    expect(auth).toContain('SQL eligible on both A and B');
    expect(setup).toContain('deployment assigns it to');
    expect(setup).toContain('nobody. Combine it with Data, SQL or Admin collections');
    expect(auth).toContain('do not create SAP users, prove PP access, or enable multi-target writes');
    expect(
      hasParagraph(
        setup,
        '**All targets is an explicit IAM assignment.** The separate `ARC-1 All Targets (<space>)` collection contributes literal `*`, including future configured targets, and `read`; deployment assigns it to nobody. Combine it with Data, SQL or Admin collections only when needed. Do not use `A4H/*`, regular expressions, or XSUAA **Unrestricted**. Existing functional collections do not acquire target grants; Admin sees operator diagnostics but cannot execute on an ungranted target.',
      ),
    ).toBe(true);
  });

  it('documents actual bounded unpaged catalog and token/client refresh limitations', () => {
    expect(TARGET_CATALOG_MAX_RESULT_BYTES).toBe(512 * 1024);
    expect(admin).toContain('256 total ARC-related candidates');
    expect(admin).toContain('512 KiB');
    expect(admin).toContain('`offset` and other arguments are');
    expect(admin).toContain('countsComplete:false');
    expect(admin).toContain('query filters displayed rows, not registry totals');
    expect(admin).toContain('Immediate revocation');
    expect(admin).toContain('private, no-store');
    expect(admin).toContain('private browser window');
  });

  it('keeps reader catalog visibility at more than one granted active target, unlike Admin', () => {
    const developerGuide = read('docs/dev-guide.md');
    expect(setup).toContain('with more than one granted active target');
    expect(setup).toContain('At zero grants, readers receive `tools: []`');
    expect(setup).toContain('`SAPTargets` is absent');
    expect(admin).toContain('Available only with more than one granted active target');
    expect(admin).toContain('Calling the unlisted catalog directly returns `UNKNOWN_TOOL`');
    expect(admin).toContain('Available at zero/one/many grants');
    expect(
      hasParagraph(
        admin,
        'At zero granted active targets, a reader receives `tools: []` and only a caller-specific no-target explanation. At one, SAP tool schemas contain the one exact target, still required on each call, but no `SAPTargets`. Calling the unlisted catalog directly returns `UNKNOWN_TOOL`; it cannot reveal whether another user has more targets. Existing deny-actions also apply, including to Admin.',
      ),
    ).toBe(true);
    expect(developerGuide).toContain('Enforced readers get the tool only with more than one granted active target');
    for (const page of [setup, admin, developerGuide]) {
      expect(page).not.toMatch(
        /Enforced readers always|always provides aggregate `SAPTargets`|including zero\/one grants/,
      );
    }
  });

  it('does not let negation or cross-paragraph joining satisfy a normative paragraph', () => {
    const contract = 'Readers see only granted targets.';
    expect(hasParagraph('Readers see only\ngranted targets.', contract)).toBe(true);
    expect(hasParagraph(`It is not true that ${contract}`, contract)).toBe(false);
    expect(hasParagraph('Readers see only\n\ngranted targets.', contract)).toBe(false);
    expect(hasParagraph(`${contract} This rule does not apply.`, contract)).toBe(false);
  });

  it('points operators to the extra unassigned collection and audit-only grant diagnostics', () => {
    const runbook = read('docs_page/btp-cloud-foundry-deployment.md');
    expect(runbook).toContain('eight space-qualified role collections');
    expect(runbook).toContain('Leave `ARC-1 All Targets (<space>)` unassigned unless explicitly approved');
    expect(read('docs_page/xsuaa-setup.md')).toContain('**eight collections in total**');
    expect(admin).toContain('`TARGET_NOT_GRANTED` | Operator audit only');
    expect(admin).toContain('One invalid value rejects the **whole** grant set');
  });
});
