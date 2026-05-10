import { describe, expect, it } from 'vitest';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

describe('Tool Definitions', () => {
  it('returns tools for default config', () => {
    const tools = getToolDefinitions(DEFAULT_CONFIG);
    expect(tools.length).toBeGreaterThan(0);
  });

  it('always includes SAPRead and SAPSearch', () => {
    const tools = getToolDefinitions(DEFAULT_CONFIG);
    const names = tools.map((t) => t.name);
    expect(names).toContain('SAPRead');
    expect(names).toContain('SAPSearch');
  });

  it('registers all implemented tools', () => {
    const tools = getToolDefinitions({
      ...DEFAULT_CONFIG,
      allowWrites: true,
      allowFreeSQL: true,
      allowTransportWrites: true,
    });
    const names = tools.map((t) => t.name);
    // All implemented tools should be registered
    expect(names).toContain('SAPRead');
    expect(names).toContain('SAPSearch');
    expect(names).toContain('SAPQuery');
    expect(names).toContain('SAPLint');
    expect(names).toContain('SAPWrite');
    expect(names).toContain('SAPActivate');
    expect(names).toContain('SAPNavigate');
    expect(names).toContain('SAPDiagnose');
    expect(names).toContain('SAPTransport');
    // SAPContext and SAPManage are now implemented
    expect(names).toContain('SAPContext');
    expect(names).toContain('SAPManage');
  });

  it('hides write tools in read-only mode but keeps SAPManage read actions', () => {
    const tools = getToolDefinitions({ ...DEFAULT_CONFIG, allowWrites: false });
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('SAPWrite');
    expect(names).not.toContain('SAPActivate');
    expect(names).toContain('SAPManage');
    // Navigate, Diagnose, and SAPContext should still be available
    expect(names).toContain('SAPNavigate');
    expect(names).toContain('SAPDiagnose');
    expect(names).toContain('SAPContext');
  });

  it('SAPManage exposes only read actions when writes are disabled', () => {
    const tools = getToolDefinitions({ ...DEFAULT_CONFIG, allowWrites: false });
    const sapManage = tools.find((t) => t.name === 'SAPManage')!;
    const schema = sapManage.inputSchema as Record<string, any>;
    const actionEnum: string[] = schema.properties.action.enum;

    expect(actionEnum).toEqual([
      'features',
      'probe',
      'cache_stats',
      'flp_list_catalogs',
      'flp_list_groups',
      'flp_list_tiles',
    ]);
  });

  it('SAPTransport is always registered when featureTransport is not off (read actions always available)', () => {
    // Default: featureTransport='auto' — tool is registered
    const tools = getToolDefinitions({ ...DEFAULT_CONFIG, allowWrites: false, allowTransportWrites: false });
    const names = tools.map((t) => t.name);
    expect(names).toContain('SAPTransport');
  });

  it('SAPTransport is registered even when allowTransportWrites is off (read actions still work)', () => {
    const tools = getToolDefinitions({ ...DEFAULT_CONFIG, allowWrites: true, allowTransportWrites: false });
    const sapTransport = tools.find((t) => t.name === 'SAPTransport')!;
    const actionEnum = (sapTransport.inputSchema as Record<string, any>).properties.action.enum as string[];
    expect(actionEnum).toEqual(['list', 'get', 'check', 'history']);
  });

  it('SAPTransport includes write actions only when both write gates are enabled', () => {
    const tools = getToolDefinitions({ ...DEFAULT_CONFIG, allowWrites: true, allowTransportWrites: true });
    const sapTransport = tools.find((t) => t.name === 'SAPTransport')!;
    const actionEnum = (sapTransport.inputSchema as Record<string, any>).properties.action.enum as string[];
    expect(actionEnum).toContain('create');
    expect(actionEnum).toContain('release_recursive');
  });

  it('SAPTransport is hidden only when featureTransport=off', () => {
    const tools = getToolDefinitions({ ...DEFAULT_CONFIG, featureTransport: 'off' });
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('SAPTransport');
  });

  it('hides SAPGit when neither gCTS nor abapGit is available', () => {
    const tools = getToolDefinitions(DEFAULT_CONFIG, undefined, {
      gcts: { id: 'gcts', available: false, mode: 'auto' },
      abapGit: { id: 'abapGit', available: false, mode: 'auto' },
    } as any);
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('SAPGit');
  });

  it('shows SAPGit when gCTS is available', () => {
    const tools = getToolDefinitions(DEFAULT_CONFIG, undefined, {
      gcts: { id: 'gcts', available: true, mode: 'auto' },
      abapGit: { id: 'abapGit', available: false, mode: 'auto' },
    } as any);
    const names = tools.map((t) => t.name);
    expect(names).toContain('SAPGit');
  });

  it('shows SAPGit when abapGit is available', () => {
    const tools = getToolDefinitions(DEFAULT_CONFIG, undefined, {
      gcts: { id: 'gcts', available: false, mode: 'auto' },
      abapGit: { id: 'abapGit', available: true, mode: 'auto' },
    } as any);
    const names = tools.map((t) => t.name);
    expect(names).toContain('SAPGit');
  });

  it('SAPGit schema includes only read actions when git writes are disabled', () => {
    const tools = getToolDefinitions(DEFAULT_CONFIG, undefined, {
      gcts: { id: 'gcts', available: true, mode: 'auto' },
      abapGit: { id: 'abapGit', available: true, mode: 'auto' },
    } as any);
    const sapGit = tools.find((t) => t.name === 'SAPGit');
    expect(sapGit).toBeDefined();
    const schema = sapGit!.inputSchema as Record<string, any>;
    const actions: string[] = schema.properties.action.enum;
    expect(actions).toContain('list_repos');
    expect(actions).toContain('external_info');
    expect(actions).not.toContain('commit');
    expect(actions).not.toContain('unlink');
    expect(schema.properties.backend.enum).toEqual(['gcts', 'abapgit']);
  });

  it('SAPGit schema includes write actions only when both write gates are enabled', () => {
    const tools = getToolDefinitions({ ...DEFAULT_CONFIG, allowWrites: true, allowGitWrites: true }, undefined, {
      gcts: { id: 'gcts', available: true, mode: 'auto' },
      abapGit: { id: 'abapGit', available: true, mode: 'auto' },
    } as any);
    const sapGit = tools.find((t) => t.name === 'SAPGit');
    expect(sapGit).toBeDefined();
    const schema = sapGit!.inputSchema as Record<string, any>;
    const actions: string[] = schema.properties.action.enum;
    expect(actions).toContain('list_repos');
    expect(actions).toContain('commit');
    expect(actions).toContain('unlink');
    expect(schema.properties.backend.enum).toEqual(['gcts', 'abapgit']);
  });

  it('all tools have required schema properties', () => {
    const tools = getToolDefinitions(DEFAULT_CONFIG);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('SAPManage exposes package and FLP actions', () => {
    const tools = getToolDefinitions({ ...DEFAULT_CONFIG, allowWrites: true });
    const sapManage = tools.find((t) => t.name === 'SAPManage')!;
    const schema = sapManage.inputSchema as Record<string, any>;
    const actionEnum: string[] = schema.properties.action.enum;

    expect(actionEnum).toContain('create_package');
    expect(actionEnum).toContain('delete_package');
    expect(actionEnum).toContain('flp_list_catalogs');
    expect(actionEnum).toContain('flp_list_groups');
    expect(actionEnum).toContain('flp_list_tiles');
    expect(actionEnum).toContain('flp_create_catalog');
    expect(actionEnum).toContain('flp_create_group');
    expect(actionEnum).toContain('flp_create_tile');
    expect(actionEnum).toContain('flp_add_tile_to_group');
    expect(actionEnum).toContain('flp_delete_catalog');
  });

  it('includes SAPLint but hides SAPQuery by default (allowFreeSQL=false)', () => {
    const tools = getToolDefinitions(DEFAULT_CONFIG);
    const names = tools.map((t) => t.name);
    expect(names).toContain('SAPLint');
    expect(names).not.toContain('SAPQuery');
  });

  it('shows SAPQuery when allowFreeSQL=true', () => {
    const tools = getToolDefinitions({ ...DEFAULT_CONFIG, allowFreeSQL: true });
    const names = tools.map((t) => t.name);
    expect(names).toContain('SAPQuery');
  });

  it('describes SAPRead sqlFilter as condition-only expression', () => {
    const tools = getToolDefinitions(DEFAULT_CONFIG);
    const sapRead = tools.find((t) => t.name === 'SAPRead')!;
    const schema = sapRead.inputSchema as Record<string, any>;
    const sqlFilterDescription = schema.properties.sqlFilter.description as string;
    expect(sqlFilterDescription).toContain('condition expression only');
    expect(sqlFilterDescription).toContain('no WHERE');
    expect(sqlFilterDescription).toContain('no SELECT');
  });

  it('SAPRead schema includes source version controls', () => {
    const tools = getToolDefinitions(DEFAULT_CONFIG);
    const sapRead = tools.find((t) => t.name === 'SAPRead')!;
    const schema = sapRead.inputSchema as Record<string, any>;
    expect(schema.properties.version.enum).toEqual(['active', 'inactive', 'auto']);
    expect(schema.properties.force_refresh.type).toBe('boolean');
    expect(sapRead.description).toContain('version parameter');
  });

  it('SAPLint exposes lint + formatter actions (atc/syntax moved to SAPDiagnose)', () => {
    const tools = getToolDefinitions(DEFAULT_CONFIG);
    const sapLint = tools.find((t) => t.name === 'SAPLint')!;
    const schema = sapLint.inputSchema as Record<string, any>;
    const actionEnum: string[] = schema.properties.action.enum;

    expect(actionEnum).toContain('lint');
    expect(actionEnum).not.toContain('atc');
    expect(actionEnum).not.toContain('syntax');
    expect(actionEnum).toContain('lint_and_fix');
    expect(actionEnum).toContain('list_rules');
    expect(actionEnum).toContain('format');
    expect(actionEnum).toContain('get_formatter_settings');
    expect(actionEnum).toContain('set_formatter_settings');
    expect(actionEnum).toHaveLength(6);
    expect(schema.properties.indentation).toBeDefined();
    expect(schema.properties.style).toBeDefined();
  });

  it('SAPLint description mentions SAPDiagnose for server-side checks', () => {
    const tools = getToolDefinitions(DEFAULT_CONFIG);
    const sapLint = tools.find((t) => t.name === 'SAPLint')!;
    expect(sapLint.description).toContain('SAPDiagnose');
  });

  describe('SAPContext discoverability — impact action must be findable by LLMs', () => {
    it('lists impact first in the action enum so LLMs anchor on it in ambiguous cases', () => {
      const tools = getToolDefinitions(DEFAULT_CONFIG);
      const sapContext = tools.find((t) => t.name === 'SAPContext')!;
      const schema = sapContext.inputSchema as Record<string, any>;
      const actionEnum: string[] = schema.properties.action.enum;
      expect(actionEnum[0]).toBe('impact');
      expect(actionEnum).toContain('deps');
      expect(actionEnum).toContain('usages');
    });

    it('SAPContext tool description contains blast-radius trigger phrases', () => {
      const tools = getToolDefinitions(DEFAULT_CONFIG);
      const sapContext = tools.find((t) => t.name === 'SAPContext')!;
      // Trigger phrases that map the user's natural question to action="impact".
      expect(sapContext.description).toMatch(/blast.?radius/i);
      expect(sapContext.description).toMatch(/what breaks if/i);
      expect(sapContext.description).toMatch(/who consumes/i);
    });

    it('SAPContext action description steers LLMs away from SAPQuery-against-DDDDLSRC', () => {
      const tools = getToolDefinitions(DEFAULT_CONFIG);
      const sapContext = tools.find((t) => t.name === 'SAPContext')!;
      const schema = sapContext.inputSchema as Record<string, any>;
      const actionDesc: string = schema.properties.action.description;
      expect(actionDesc).toContain('DDDDLSRC');
      expect(actionDesc).toMatch(/impact/);
    });

    it('SAPQuery description redirects CDS impact questions to SAPContext(action="impact")', () => {
      // SAPQuery is only registered when free SQL is allowed.
      const tools = getToolDefinitions({ ...DEFAULT_CONFIG, allowFreeSQL: true });
      const sapQuery = tools.find((t) => t.name === 'SAPQuery')!;
      expect(sapQuery.description).toContain('DDDDLSRC');
      expect(sapQuery.description).toContain('SAPContext');
      expect(sapQuery.description).toMatch(/action="impact"/);
    });

    it('SAPNavigate description redirects CDS where-used questions to SAPContext(action="impact")', () => {
      const tools = getToolDefinitions(DEFAULT_CONFIG);
      const sapNavigate = tools.find((t) => t.name === 'SAPNavigate')!;
      expect(sapNavigate.description).toContain('SAPContext');
      expect(sapNavigate.description).toMatch(/action="impact"/);
      expect(sapNavigate.description).toMatch(/DDLS/);
    });

    it('SAPContext type property description marks type as optional for action="impact"', () => {
      // Regression for Sonnet 4.6 transcript: LLMs call
      //   SAPContext({ action: "impact", name: "I_COUNTRY" })
      // without `type` because impact is DDLS-only and the type is redundant.
      // The schema description must make that contract explicit so LLMs know
      // not to guess, and the handler defaults type=DDLS.
      const tools = getToolDefinitions(DEFAULT_CONFIG);
      const sapContext = tools.find((t) => t.name === 'SAPContext')!;
      const schema = sapContext.inputSchema as Record<string, any>;
      const typeDesc: string = schema.properties.type.description;
      expect(typeDesc).toMatch(/optional.*action="impact"|action="impact".*optional/i);
      expect(typeDesc).toMatch(/defaults to DDLS/i);
    });

    it('SAPContext exposes sibling consistency controls for impact', () => {
      const tools = getToolDefinitions(DEFAULT_CONFIG);
      const sapContext = tools.find((t) => t.name === 'SAPContext')!;
      const schema = sapContext.inputSchema as Record<string, any>;
      const siblingCheck = schema.properties.siblingCheck;
      const siblingMaxCandidates = schema.properties.siblingMaxCandidates;

      expect(siblingCheck).toBeDefined();
      expect(siblingCheck.type).toBe('boolean');
      expect(siblingCheck.description).toMatch(/default true/i);

      expect(siblingMaxCandidates).toBeDefined();
      expect(siblingMaxCandidates.type).toBe('number');
      expect(siblingMaxCandidates.description).toMatch(/default 4/i);
      expect(siblingMaxCandidates.description).toMatch(/hard cap 10/i);
    });
  });

  it('SAPDiagnose exposes runtime diagnostics + quickfix actions', () => {
    const tools = getToolDefinitions(DEFAULT_CONFIG);
    const sapDiagnose = tools.find((t) => t.name === 'SAPDiagnose')!;
    const schema = sapDiagnose.inputSchema as Record<string, any>;
    const actionEnum: string[] = schema.properties.action.enum;

    expect(actionEnum).toContain('syntax');
    expect(actionEnum).toContain('unittest');
    expect(actionEnum).toContain('atc');
    expect(actionEnum).toContain('quickfix');
    expect(actionEnum).toContain('apply_quickfix');
    expect(actionEnum).toContain('dumps');
    expect(actionEnum).toContain('traces');
    expect(actionEnum).toContain('system_messages');
    expect(actionEnum).toContain('gateway_errors');
    expect(schema.properties.source).toBeDefined();
    expect(schema.properties.sourceUri).toBeDefined();
    expect(schema.properties.line).toBeDefined();
    expect(schema.properties.column).toBeDefined();
    expect(schema.properties.proposalUri).toBeDefined();
    expect(schema.properties.proposalUserContent).toBeDefined();
    expect(schema.properties.proposalAffectedObjects).toBeDefined();
    expect(schema.properties.proposalAffectedObjects.items.required).toContain('uri');
    expect(schema.properties.sections).toBeDefined();
    expect(schema.properties.includeFullText).toBeDefined();
    expect(schema.properties.detailUrl).toBeDefined();
    expect(schema.properties.errorType).toBeDefined();
  });

  // ─── textSearch-based SAPSearch adaptation ───────────────────────

  describe('SAPSearch textSearch adaptation', () => {
    it('includes source_code in searchType when textSearch is available', () => {
      const tools = getToolDefinitions(DEFAULT_CONFIG, true);
      const sapSearch = tools.find((t) => t.name === 'SAPSearch')!;
      const schema = sapSearch.inputSchema as Record<string, any>;
      expect(schema.properties.searchType).toBeDefined();
      expect(schema.properties.searchType.enum).toContain('source_code');
      expect(schema.properties.objectType).toBeDefined();
      expect(schema.properties.packageName).toBeDefined();
    });

    it('omits source_code from SAPSearch when textSearch is unavailable', () => {
      const tools = getToolDefinitions(DEFAULT_CONFIG, false);
      const sapSearch = tools.find((t) => t.name === 'SAPSearch')!;
      const schema = sapSearch.inputSchema as Record<string, any>;
      expect(schema.properties.searchType).toBeUndefined();
      expect(schema.properties.objectType).toBeUndefined();
      expect(schema.properties.packageName).toBeUndefined();
    });

    it('includes source_code when textSearch is undefined (not yet probed)', () => {
      const tools = getToolDefinitions(DEFAULT_CONFIG);
      const sapSearch = tools.find((t) => t.name === 'SAPSearch')!;
      const schema = sapSearch.inputSchema as Record<string, any>;
      expect(schema.properties.searchType).toBeDefined();
      expect(schema.properties.searchType.enum).toContain('source_code');
    });

    it('SAPSearch description omits source_code mode when unavailable', () => {
      const tools = getToolDefinitions(DEFAULT_CONFIG, false);
      const sapSearch = tools.find((t) => t.name === 'SAPSearch')!;
      expect(sapSearch.description).not.toContain('source_code');
      expect(sapSearch.description).not.toContain('Source code search');
    });
  });

  // ─── Schema Validation (Issue #47: OpenAI compatibility) ─────────

  it('every array property has an items definition (Issue #47)', () => {
    // OpenAI/GPT models reject tool schemas where array types lack `items`.
    // This caused Eclipse GitHub Copilot to fail with:
    // "Invalid schema for function: array schema missing items"
    const tools = getToolDefinitions(DEFAULT_CONFIG);
    for (const tool of tools) {
      const schema = tool.inputSchema as Record<string, any>;
      if (schema.properties) {
        for (const [propName, propDef] of Object.entries(schema.properties as Record<string, any>)) {
          if (propDef.type === 'array') {
            expect(propDef.items, `Tool ${tool.name}, property ${propName}: array missing items`).toBeDefined();
          }
        }
      }
    }
  });

  it('all schemas have valid JSON Schema structure', () => {
    const tools = getToolDefinitions(DEFAULT_CONFIG);
    for (const tool of tools) {
      const schema = tool.inputSchema as Record<string, any>;
      expect(schema.type).toBe('object');
      // properties should be an object if present
      if (schema.properties) {
        expect(typeof schema.properties).toBe('object');
      }
      // required should be an array if present
      if (schema.required) {
        expect(Array.isArray(schema.required)).toBe(true);
      }
    }
  });

  it('descriptions are non-empty and reasonable length', () => {
    const tools = getToolDefinitions(DEFAULT_CONFIG);
    for (const tool of tools) {
      expect(tool.description.length, `Tool ${tool.name} description too short`).toBeGreaterThan(10);
    }
  });

  // ─── BTP System Type Adaptation ─────────────────────────────────

  describe('BTP system type adaptation', () => {
    const btpConfig = { ...DEFAULT_CONFIG, allowWrites: true, allowFreeSQL: true, systemType: 'btp' as const };
    const onpremConfig = { ...DEFAULT_CONFIG, allowWrites: true, allowFreeSQL: true, systemType: 'onprem' as const };
    const autoConfig = { ...DEFAULT_CONFIG, allowWrites: true, allowFreeSQL: true, systemType: 'auto' as const };

    it('removes PROG, INCL, VIEW, TEXT_ELEMENTS, VARIANTS from SAPRead on BTP', () => {
      const tools = getToolDefinitions(btpConfig);
      const sapRead = tools.find((t) => t.name === 'SAPRead')!;
      const schema = sapRead.inputSchema as Record<string, any>;
      const typeEnum: string[] = schema.properties.type.enum;

      expect(typeEnum).not.toContain('PROG');
      expect(typeEnum).not.toContain('INCL');
      expect(typeEnum).not.toContain('VIEW');
      expect(typeEnum).not.toContain('TEXT_ELEMENTS');
      expect(typeEnum).not.toContain('VARIANTS');
      expect(typeEnum).not.toContain('SOBJ');
      expect(typeEnum).not.toContain('AUTH');
      expect(typeEnum).not.toContain('FTG2');
      expect(typeEnum).not.toContain('FEATURE_TOGGLE');
      expect(typeEnum).not.toContain('ENHO');
    });

    it('keeps CLAS, INTF, DDLS, DCLS, DDLX, BDEF, SRVD, SRVB on BTP', () => {
      const tools = getToolDefinitions(btpConfig);
      const sapRead = tools.find((t) => t.name === 'SAPRead')!;
      const schema = sapRead.inputSchema as Record<string, any>;
      const typeEnum: string[] = schema.properties.type.enum;

      expect(typeEnum).toContain('CLAS');
      expect(typeEnum).toContain('INTF');
      expect(typeEnum).toContain('DDLS');
      expect(typeEnum).toContain('DCLS');
      expect(typeEnum).toContain('DDLX');
      expect(typeEnum).toContain('BDEF');
      expect(typeEnum).toContain('SRVD');
      expect(typeEnum).toContain('SRVB');
      expect(typeEnum).toContain('TABLE_CONTENTS');
    });

    it('includes all types on on-premise', () => {
      const tools = getToolDefinitions(onpremConfig);
      const sapRead = tools.find((t) => t.name === 'SAPRead')!;
      const schema = sapRead.inputSchema as Record<string, any>;
      const typeEnum: string[] = schema.properties.type.enum;

      expect(typeEnum).toContain('PROG');
      expect(typeEnum).toContain('INCL');
      expect(typeEnum).toContain('VIEW');
      expect(typeEnum).toContain('TEXT_ELEMENTS');
      expect(typeEnum).toContain('VARIANTS');
      expect(typeEnum).toContain('SOBJ');
      expect(typeEnum).toContain('DDLX');
      expect(typeEnum).toContain('SRVB');
      expect(typeEnum).toContain('AUTH');
      expect(typeEnum).toContain('FEATURE_TOGGLE');
      // FTG2 retained as deprecated alias for one minor — see
      // research/abap-types/types/ftg2.md and audit-symmetry-and-ftg2-rename.md.
      expect(typeEnum).toContain('FTG2');
      expect(typeEnum).toContain('ENHO');
      // MSAG canonical + MESSAGES deprecated alias (research/abap-types/types/msag.md)
      expect(typeEnum).toContain('MSAG');
      expect(typeEnum).toContain('MESSAGES');
    });

    it('includes DDLS, DCLS, DDLX, BDEF, SRVD, SRVB, TABL, DOMA, DTEL in SAPWrite types on both BTP and on-prem', () => {
      for (const config of [btpConfig, onpremConfig]) {
        const tools = getToolDefinitions(config);
        const sapWrite = tools.find((t) => t.name === 'SAPWrite')!;
        const schema = sapWrite.inputSchema as Record<string, any>;
        const typeEnum: string[] = schema.properties.type.enum;

        expect(typeEnum).toContain('DDLS');
        expect(typeEnum).toContain('DCLS');
        expect(typeEnum).toContain('DDLX');
        expect(typeEnum).toContain('BDEF');
        expect(typeEnum).toContain('SRVD');
        expect(typeEnum).toContain('SRVB');
        expect(typeEnum).toContain('TABL');
        expect(typeEnum).toContain('DOMA');
        expect(typeEnum).toContain('DTEL');
      }
    });

    it('SAPActivate schema includes objects array for batch activation', () => {
      const tools = getToolDefinitions(onpremConfig);
      const sapActivate = tools.find((t) => t.name === 'SAPActivate')!;
      const schema = sapActivate.inputSchema as Record<string, any>;

      expect(schema.properties.objects).toBeDefined();
      expect(schema.properties.objects.type).toBe('array');
      expect(schema.properties.objects.items).toBeDefined();
      expect(schema.properties.objects.items.properties.type).toBeDefined();
      expect(schema.properties.objects.items.properties.name).toBeDefined();
    });

    it('uses on-premise types when systemType is auto (default)', () => {
      const tools = getToolDefinitions(autoConfig);
      const sapRead = tools.find((t) => t.name === 'SAPRead')!;
      const schema = sapRead.inputSchema as Record<string, any>;
      const typeEnum: string[] = schema.properties.type.enum;

      // auto mode = full tool set (on-premise superset)
      expect(typeEnum).toContain('PROG');
      expect(typeEnum).toContain('INCL');
    });

    it('removes PROG and INCL from SAPWrite on BTP', () => {
      const tools = getToolDefinitions(btpConfig);
      const sapWrite = tools.find((t) => t.name === 'SAPWrite')!;
      const schema = sapWrite.inputSchema as Record<string, any>;
      const typeEnum: string[] = schema.properties.type.enum;

      expect(typeEnum).not.toContain('PROG');
      expect(typeEnum).not.toContain('INCL');
      expect(typeEnum).not.toContain('FUNC');
      expect(typeEnum).not.toContain('FUGR');
      expect(typeEnum).toContain('CLAS');
      expect(typeEnum).toContain('INTF');
      expect(typeEnum).toContain('TABL');
      expect(typeEnum).toContain('SRVB');
      expect(typeEnum).toContain('DOMA');
      expect(typeEnum).toContain('DTEL');
    });

    it('exposes FUGR + FUNC in on-premise SAPWrite type enum (issue #250)', () => {
      const tools = getToolDefinitions(onpremConfig);
      const sapWrite = tools.find((t) => t.name === 'SAPWrite')!;
      const schema = sapWrite.inputSchema as Record<string, any>;
      const typeEnum: string[] = schema.properties.type.enum;

      expect(typeEnum).toContain('FUGR');
      expect(typeEnum).toContain('FUNC');
      expect(schema.properties.group).toBeDefined();
      expect(sapWrite.description).toMatch(/FUGR/);
      expect(sapWrite.description).toMatch(/FUNC/);
      // The caveat about parameter management must be in the description so LLMs warn users.
      expect(sapWrite.description.toLowerCase()).toMatch(/parameter|signature/);
    });

    it('removes PROG and FUNC from SAPContext on BTP', () => {
      const tools = getToolDefinitions(btpConfig);
      const sapContext = tools.find((t) => t.name === 'SAPContext')!;
      const schema = sapContext.inputSchema as Record<string, any>;
      const typeEnum: string[] = schema.properties.type.enum;

      expect(typeEnum).not.toContain('PROG');
      expect(typeEnum).not.toContain('FUNC');
      expect(typeEnum).toContain('CLAS');
      expect(typeEnum).toContain('INTF');
    });

    it('BTP SAPQuery description warns about blocked tables and suggests CDS views', () => {
      const tools = getToolDefinitions(btpConfig);
      const sapQuery = tools.find((t) => t.name === 'SAPQuery')!;

      expect(sapQuery.description).toContain('BTP');
      expect(sapQuery.description).toContain('custom Z/Y tables');
      expect(sapQuery.description).toContain('blocked');
      expect(sapQuery.description).toContain('I_LANGUAGE');
    });

    it('on-premise SAPQuery description suggests metadata tables for reverse-engineering', () => {
      const tools = getToolDefinitions(onpremConfig);
      const sapQuery = tools.find((t) => t.name === 'SAPQuery')!;

      expect(sapQuery.description).toContain('DD02L');
      expect(sapQuery.description).toContain('TADIR');
      expect(sapQuery.description).toContain('reverse-engineering');
    });

    it('BTP SAPTransport description mentions gCTS', () => {
      const tools = getToolDefinitions({ ...btpConfig, allowTransportWrites: true });
      const sapTransport = tools.find((t) => t.name === 'SAPTransport')!;

      expect(sapTransport.description).toContain('gCTS');
      expect(sapTransport.description).toContain('BTP');
    });

    it('BTP SAPRead description mentions BTP limitations', () => {
      const tools = getToolDefinitions(btpConfig);
      const sapRead = tools.find((t) => t.name === 'SAPRead')!;

      expect(sapRead.description).toContain('BTP');
      expect(sapRead.description).toContain('IF_OO_ADT_CLASSRUN');
    });

    it('BTP SAPSearch description mentions released objects', () => {
      const tools = getToolDefinitions(btpConfig);
      const sapSearch = tools.find((t) => t.name === 'SAPSearch')!;

      expect(sapSearch.description).toContain('BTP');
      expect(sapSearch.description).toContain('released');
    });

    it('includes method but not expand_includes on BTP SAPRead', () => {
      const tools = getToolDefinitions(btpConfig);
      const sapRead = tools.find((t) => t.name === 'SAPRead')!;
      const schema = sapRead.inputSchema as Record<string, any>;

      // method is available on both BTP and on-prem (for CLAS method-level reads)
      expect(schema.properties.method).toBeDefined();
      // expand_includes is on-prem only (for FUGR)
      expect(schema.properties.expand_includes).toBeUndefined();
    });

    it('includes method and expand_includes props on on-premise SAPRead', () => {
      const tools = getToolDefinitions(onpremConfig);
      const sapRead = tools.find((t) => t.name === 'SAPRead')!;
      const schema = sapRead.inputSchema as Record<string, any>;

      expect(schema.properties.method).toBeDefined();
      expect(schema.properties.expand_includes).toBeDefined();
    });

    it('does not include group prop in BTP SAPContext', () => {
      const tools = getToolDefinitions(btpConfig);
      const sapContext = tools.find((t) => t.name === 'SAPContext')!;
      const schema = sapContext.inputSchema as Record<string, any>;

      expect(schema.properties.group).toBeUndefined();
    });

    it('still passes schema validation for BTP tools', () => {
      const tools = getToolDefinitions(btpConfig);
      for (const tool of tools) {
        const schema = tool.inputSchema as Record<string, any>;
        expect(schema.type).toBe('object');
        expect(tool.description.length).toBeGreaterThan(10);
        // Check array items (Issue #47)
        if (schema.properties) {
          for (const [propName, propDef] of Object.entries(schema.properties as Record<string, any>)) {
            if (propDef.type === 'array') {
              expect(propDef.items, `BTP Tool ${tool.name}, property ${propName}: array missing items`).toBeDefined();
            }
          }
        }
      }
    });
  });

  // ─── Three-file sync coverage for messages + STRU (PR-β) ──────────
  describe('three-file sync invariants', () => {
    function getSAPWriteSchema(btp: boolean): Record<string, any> {
      const tools = getToolDefinitions({ ...DEFAULT_CONFIG, allowWrites: true, systemType: btp ? 'btp' : 'onprem' });
      const sapWrite = tools.find((t) => t.name === 'SAPWrite');
      if (!sapWrite) throw new Error('SAPWrite tool not found in definitions');
      return sapWrite.inputSchema as Record<string, any>;
    }

    it('exposes the messages property at top-level SAPWrite (on-prem)', () => {
      const schema = getSAPWriteSchema(false);
      const messages = schema.properties.messages;
      expect(messages).toBeDefined();
      expect(messages.type).toBe('array');
      expect(messages.items.required).toEqual(['number', 'shortText']);
      expect(messages.items.properties.number).toBeDefined();
      expect(messages.items.properties.shortText).toBeDefined();
    });

    it('exposes the messages property inside batch_create items (on-prem)', () => {
      const schema = getSAPWriteSchema(false);
      const batchObjects = schema.properties.objects;
      expect(batchObjects?.type).toBe('array');
      const item = batchObjects.items;
      expect(item.properties.messages).toBeDefined();
      expect(item.properties.messages.type).toBe('array');
      expect(item.properties.messages.items.required).toEqual(['number', 'shortText']);
    });

    it('exposes the messages property at top-level SAPWrite (BTP)', () => {
      const schema = getSAPWriteSchema(true);
      expect(schema.properties.messages).toBeDefined();
      expect(schema.properties.messages.type).toBe('array');
    });

    it('exposes the CLAS include update property at top-level SAPWrite', () => {
      for (const btp of [false, true]) {
        const schema = getSAPWriteSchema(btp);
        const include = schema.properties.include;
        expect(include).toBeDefined();
        expect(include.type).toBe('string');
        expect(include.enum).toEqual(['definitions', 'implementations', 'macros', 'testclasses']);
        expect(include.description).toContain('update type=CLAS');
        expect(include.description).toContain('source/main');
        expect(include.description).toContain('version="inactive"');
      }
    });
  });
});
