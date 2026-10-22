import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { TARGET_CATALOG_MAX_RESULT_BYTES } from '../../../src/server/multi-target-catalog-enforced.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

// Presence/link checks are smoke tests, not a semantic review of arbitrary prose.
// Preserve paragraph boundaries; pin complete normative paragraphs/rows below.
const paragraphs = (text: string) => text.split(/\r?\n\s*\r?\n/).map((part) => part.replace(/\s+/g, ' ').trim());
const read = (path: string) =>
  paragraphs(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')).join('\n\n');
const hasParagraph = (text: string, expected: string) => paragraphs(text).includes(expected);
const setup = read('docs_page/multi-target-setup.md');
const targetAccess = read('docs_page/multi-target-authorization.md');
const admin = read('docs_page/multi-target-administration.md');
const auth = read('docs_page/authorization.md');

describe('target authorization operator documentation', () => {
  it('keeps one static-first setup with version availability and landscape acceptance checks', () => {
    expect(setup).toContain('### Optional target authorization');
    expect(setup).toContain('[Restrict access to systems and clients](multi-target-authorization.md)');
    expect(targetAccess).toContain('one static cohort role, one collection, one test user');
    expect(targetAccess).toContain('!!! info "Version availability"');
    expect(targetAccess).toContain('Target authorization is available from ARC-1 **1.6.0**.');
    expect(targetAccess).toContain('Confirm that your selected release includes this feature');
    expect(targetAccess).toContain('Use the library version resolved by the');
    expect(targetAccess).not.toContain('provided by `@arc-mcp/xsuaa-auth` 1.1.0');
    expect(targetAccess).toContain('Complete the acceptance checks below in your own landscape');
    for (const page of [
      setup,
      targetAccess,
      admin,
      auth,
      read('docs_page/xsuaa-setup.md'),
      read('docs_page/configuration-reference.md'),
      read('docs_page/btp-cloud-foundry-deployment.md'),
      read('.env.example'),
    ]) {
      expect(page).not.toMatch(
        /implementation candidate|opt-in candidate|PR #677|not customer-ready yet|unreleased pilot/i,
      );
    }
    for (const path of [
      'docs/plans/xsuaa-target-authorization.md',
      'docs/adr/0008-opt-in-xsuaa-target-authorization.md',
    ]) {
      expect(targetAccess).toContain(path);
    }
    expect(targetAccess).toContain('IAS-fed values are optional and not yet a verified operator recipe');
    expect(read('docs_page/xsuaa-setup.md')).toContain('multi-target-authorization.md');
  });

  it('documents the unchanged default and deliberate multi-only opt-in rather than automatic migration', () => {
    expect(DEFAULT_CONFIG.multiTargetAuthorization).toBe('standard');
    expect(
      hasParagraph(
        targetAccess,
        'Unset or explicit `standard` leaves existing authorization, paging and tool visibility unchanged. Display-label sanitization applies in both modes; see the [compatibility note](multi-target-administration.md#enforced-catalog-differences).',
      ),
    ).toBe(true);
    expect(targetAccess).toContain('ARC1_MULTI_TARGET_AUTHORIZATION: xsuaa-attribute');
    expect(targetAccess).toContain('SAP_BTP_PP_DESTINATION');
    expect(admin).toContain('before startup destination lookups or SAP probes');
    expect(admin).toContain('security downgrade');
    expect(admin).toContain('ARC1_MULTI_TARGET_AUTHORIZATION: standard');
    expect(admin).toContain('CF environment');
    expect(read('.env.example')).toContain('# ARC1_MULTI_TARGET_AUTHORIZATION=xsuaa-attribute');
    expect(read('docs_page/configuration-reference.md')).toContain('--multi-target-authorization');
  });

  it('explains the optional supported modes without implying automatic SAP-account discovery', () => {
    expect(targetAccess).toContain('## When to use it');
    expect(
      hasParagraph(
        targetAccess,
        '**Standard access** uses `standard` (the default): no additional target filtering. **Target-filtered access** uses `xsuaa-attribute`. Both are supported choices.',
      ),
    ).toBe(true);
    expect(
      hasParagraph(
        targetAccess,
        "**This is not automatic SAP-account discovery.** Your identity/access administrator assigns the target list; ARC-1 does not check every SAP system at login to find the user's accounts. Keep those assignments aligned with SAP access through your organization's access process. A listed target can still reject a call if the SAP user, permissions or connection are missing.",
      ),
    ).toBe(true);
    expect(targetAccess).toContain('No new IAS configuration is required');
    expect(targetAccess).toContain('## How the parts fit together');
    expect(targetAccess).toContain('**not an SAP PFCG role**');
    expect(read('docs_page/llms.txt')).toContain('These are the only two accepted values');
    expect(read('AGENTS.md')).toContain('Default/unset `standard` = standard access');
  });

  it('uses only the two supported mode names throughout feature guidance', () => {
    for (const path of [
      'docs_page/multi-target-authorization.md',
      'docs_page/multi-target-setup.md',
      'docs_page/multi-target-administration.md',
      'docs_page/llms.txt',
      'docs/adr/0008-opt-in-xsuaa-target-authorization.md',
      'docs/plans/xsuaa-target-authorization.md',
      'examples/btp/multi-pp/README.md',
      'examples/btp/multi-pp/target-authorization.mtaext',
      'docs/research/2026-09-05-xsuaa-target-authorization-validation.md',
      'docs/research/2026-09-15-pr677-target-authorization-implementation.md',
      'docs/research/2026-09-17-pr677-claude-review-disposition.md',
      'docs/research/2026-10-13-pr677-final-build-acceptance.md',
    ]) {
      expect(read(path), path).not.toMatch(/\blegacy\b/i);
    }
    const reference = readFileSync(new URL('../../../docs_page/configuration-reference.md', import.meta.url), 'utf8')
      .split('\n')
      .find((line) => line.startsWith('| `ARC1_MULTI_TARGET_AUTHORIZATION`'));
    expect(reference).toContain('These are the only two accepted values');
    expect(reference).not.toMatch(/\blegacy\b/i);
  });

  it('separates grants, capability union, diagnostics and actual SAP access', () => {
    expect(auth).toContain('global functional scopes × union of granted targets');
    expect(auth).toContain('not execution on an ungranted target');
    expect(auth).toContain('SQL eligible on both A and B');
    expect(targetAccess).toContain('deployment assigns it to');
    expect(targetAccess).toContain('nobody. Combine it with Data, SQL or Admin collections');
    expect(auth).toContain('do not create SAP users, prove PP access, or enable multi-target writes');
    expect(
      hasParagraph(
        targetAccess,
        '**All targets is an explicit IAM assignment.** The separate `ARC-1 All Targets (<space>)` collection contributes literal `*`, including future configured targets, and `read`; deployment assigns it to nobody. Combine it with Data, SQL or Admin collections only when needed. Do not use `QAS/*`, regular expressions, or XSUAA **Unrestricted**. Existing functional collections do not acquire target grants; Admin sees operator diagnostics but cannot execute on an ungranted target.',
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

  it('routes human and agent entry points to the same setup without a second deployment sequence', () => {
    for (const path of [
      'docs_page/btp-overview.md',
      'docs_page/llms.txt',
      'docs_page/btp-setup-worksheet.md',
      'examples/btp/multi-pp/README.md',
      'AGENTS.md',
      'mkdocs.yml',
    ]) {
      expect(read(path), path).toContain('multi-target-authorization.md');
    }
    for (const page of [setup, targetAccess]) {
      expect(page).not.toMatch(/\bcp (?:-n )?.*mta-overrides/);
      expect(page).not.toContain('npm run btp:build-deploy-ext');
      expect(page).not.toMatch(/https:\/\/github\.com\/arc-mcp\/arc-1\/blob\/[^/]+\/examples\/btp/);
    }
    expect(targetAccess).toContain('same source revision');
    expect(read('examples/btp/multi-pp/README.md')).toContain('target-authorization.mtaext');
    expect(read('docs_page/btp-overview.md')).toContain(
      'Standard access (`standard`) only; opt-in target enforcement rejects this topology',
    );
  });

  it('keeps activation ahead of assignment and makes evidence and escalation explicit', () => {
    const enable = targetAccess.indexOf('### 3. Enable enforcement through the deployment owner');
    const assign = targetAccess.indexOf('### 4. Assign the pilot user and sign in again');
    expect(enable).toBeGreaterThan(0);
    expect(assign).toBeGreaterThan(enable);
    expect(targetAccess).toContain('Only after step 3 passes, assign');
    const runbook = read('docs_page/btp-cloud-foundry-deployment.md');
    expect(runbook).toContain('**Target-filtered multi-target access:** leave the restricted user unassigned');
    expect(runbook).toContain("enforcement before assigning the restricted user's target role collection");
    expect(runbook).toContain('**granted active targets**, not the whole registry');
    expect(targetAccess).toContain('Multi-target authorization enforced;');
    expect(targetAccess).toContain(JSON.stringify({ mode: 'xsuaa-attribute' }).slice(1, -1));
    expect(targetAccess).toContain('admin.authorization.mode="xsuaa-attribute"');
    expect(targetAccess).toContain('One invalid value rejects the whole grant set');
    expect(targetAccess).toContain('a valid ID may also have no active destination');
    expect(targetAccess).toContain('`arc1_targets` is an attribute, not an OAuth scope');
    expect(targetAccess).toContain('**pass, fail or unverified**');
    expect(targetAccess).toContain('SYSTEM.user');
    expect(targetAccess).toContain('is not proof of the propagated SAP user');
    const worksheet = read('docs_page/btp-setup-worksheet.md');
    expect(worksheet).toContain('## Target access setup and agent handoff');
    expect(worksheet).toContain('Evidence to retain | Stop if');
    expect(worksheet).toContain('Do not grant Admin/All Targets, switch to standard');
    expect(worksheet).toContain('What the agent may inspect/change');
  });

  it('keeps the first deployment linear and includes a real denied-target pilot', () => {
    const runbook = read('docs_page/btp-cloud-foundry-deployment.md');
    const profile = runbook.split('### Multi-target PP-only profile')[1]?.split('### Prepare the selected profile')[0];
    expect(profile).toContain('ARC1_MULTI_TARGET_AUTHORIZATION: xsuaa-attribute');
    expect(profile).toContain('continue through steps 5–9');
    const destinations = runbook.split('## 9. Configure SAP connectivity and destinations')[1]?.split('## 10.')[0];
    expect(destinations).toContain('cf restart arc1-mcp-server');
    expect(destinations).toContain('[minimal static role setup]');
    expect(destinations).toContain('then return to step 10');
    expect(targetAccess).toContain('**Arrived from runbook step 9?**');
    expect(targetAccess).toContain('grant `QAS/001` and leave `QAS/100` ungranted');
    expect(targetAccess).toContain('denied through **both aggregate and pinned routes**');
    expect(targetAccess).toContain('No other test users or roles are assumed to exist');
    expect(targetAccess).toContain('unknown ID alone does not prove rejection of an existing ungranted target');
  });

  it('keeps general BTP acceptance consistent with the shipped collections and filtered grants', () => {
    const mta = parse(readFileSync(new URL('../../../mta.yaml', import.meta.url), 'utf8'));
    const xsuaa = mta.resources.find((resource: { name: string }) => resource.name === 'arc1-xsuaa');
    expect(xsuaa.parameters.config['role-collections']).toHaveLength(8);
    const btpAdmin = read('docs_page/btp-administration.md');
    expect(btpAdmin).toContain('**eight role collections**');
    expect(btpAdmin).toContain('All eight space-specific role collections');
    expect(btpAdmin).toContain('A plain Viewer has no execution grants in filtered mode');
    expect(read('docs_page/btp-overview.md')).toContain('an exact-target collection for filtered access');
    const updating = read('docs_page/updating.md');
    expect(updating).not.toContain('all seven `ARC-1');
    expect(updating).toContain('an exact-target collection for filtered access');
    expect(read('docs_page/xsuaa-setup.md')).toContain('Viewer alone has no target grants');
  });

  it('distinguishes actual UAA scopes and token lifetimes from target claims and revocation guarantees', () => {
    const xsuaa = read('docs_page/xsuaa-setup.md');
    expect(xsuaa).toContain('`user_attributes` does exist as a separate');
    expect(xsuaa).toContain('ARC-1 does not require it');
    expect(xsuaa).not.toContain('Neither `arc1_targets` nor `user_attributes` is an OAuth scope');
    expect(targetAccess).toContain('/specify-attributes-in-new-role)');
    expect(admin.indexOf('### Target authorization lifecycle')).toBeGreaterThan(
      admin.indexOf('### SQL and client isolation'),
    );
    expect(admin).toContain('#### Role changes and revocation');
    expect(admin).toContain('there may be no such link');
    expect(admin).toContain('Refresh alone can retain removed grants');
    expect(admin).toContain('that does not remove ARC-1 inventory grants');
    const descriptor = JSON.parse(read('xs-security.json'));
    for (const key of ['token-validity', 'refresh-token-validity']) {
      expect(admin).toContain(`${key}: ${descriptor['oauth2-configuration'][key]}`);
    }
    expect(admin).toContain('not a one-hour or 30-day revocation guarantee');
    expect(targetAccess).toContain('**any assigned role** gives all-target access if the complete grant set is valid');
    expect(targetAccess).toContain('other assigned roles may still supply valid grants');
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
