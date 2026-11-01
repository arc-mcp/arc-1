import { describe, expect, it, vi } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: mockFetch,
}));
const { AdtClient } = await import('../../../src/adt/client.js');
const createClient = () => new AdtClient({ baseUrl: 'http://sap:8000', safety: unrestrictedSafetyConfig() });

describe('canonical object lookup (COMPAT-09)', () => {
  it.each([
    ['BAPI_USER_GET_DETAIL', 'bapi_user_get_detail', 'SU_USER'],
    ['/UI2/CATALOG_PFCG_CHANGE', '%2fui2%2fcatalog_pfcg_change', '%2fui2%2fcatalog_pfcg'],
  ])('accepts a decorated function only when its URI confirms the name: %s', async (name, encodedName, group) => {
    mockFetch.mockReset();
    const uri = `/sap/bc/adt/functions/groups/${group}/fmodules/${encodedName}`;
    mockFetch.mockResolvedValue(
      mockResponse(
        200,
        `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
        <adtcore:objectReference adtcore:uri="/sap/bc/adt/functions/groups/other/fmodules/other" adtcore:type="FUGR/FF" adtcore:name="${name} (Function Module)"/>
        <adtcore:objectReference adtcore:uri="${uri}" adtcore:type="FUGR/FF" adtcore:name="${name} (Function Module)"/>
        <adtcore:objectReference adtcore:uri="${uri}" adtcore:type="FUGR/FF" adtcore:name="${name}"/>
      </adtcore:objectReferences>`,
      ),
    );
    const [result] = await createClient().lookupObjects([name]);
    expect(result?.found).toBe(true);
    expect(result?.matches).toEqual([expect.objectContaining({ objectName: name, objectType: 'FUGR/FF', uri })]);
  });

  it.each([
    ['FUGR/FF', '/sap/bc/adt/functions/groups/z/fmodules/%ZZ'],
    ['FUGR/FF', '/sap/bc/adt/functions/groups/z/fmodules/zfoo/source/main'],
    ['FUGR/FF', 'https://other.example/sap/bc/adt/functions/groups/z/fmodules/zfoo'],
    ['CLAS/OC', '/sap/bc/adt/oo/classes/other'],
    ['CLAS/OC', '/sap/bc/adt/oo/classes/zfoo?version=active'],
    ['CLAS/OC', '/sap/bc/adt/oo/classes/zfoo#fragment'],
  ])('does not infer names from unverified search results: %s %s', async (type, uri) => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(
      mockResponse(
        200,
        `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
        <adtcore:objectReference adtcore:uri="${uri}" adtcore:type="${type}" adtcore:name="ZFOO (Label)"/>
      </adtcore:objectReferences>`,
      ),
    );
    expect(await createClient().lookupObjects(['ZFOO'])).toEqual([{ name: 'ZFOO', found: false, matches: [] }]);
  });

  it.each([
    ['CL_ABAP_TYPEDESCR', 'CLAS/OC', '/sap/bc/adt/oo/classes/cl_abap_typedescr'],
    ['T000', 'TABL/DT', '/sap/bc/adt/vit/wb/object_type/tabldt/object_name/T000'],
    ['SAPMSSY0', 'PROG/P', '/sap/bc/adt/programs/programs/sapmssy0'],
    ['/UI2/CL_JSON', 'CLAS/OC', '/sap/bc/adt/oo/classes/%2fui2%2fcl_json'],
  ])('resolves decorated non-function identities: %s', async (name, type, uri) => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(
      mockResponse(
        200,
        `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
        <adtcore:objectReference adtcore:uri="${uri}" adtcore:type="${type}" adtcore:name="${name} (Localized label)"/>
        <adtcore:objectReference adtcore:uri="${uri}" adtcore:type="${type}" adtcore:name="OTHER (Localized label)"/>
      </adtcore:objectReferences>`,
      ),
    );
    expect((await createClient().lookupObjects([name]))[0]?.matches).toEqual([
      expect.objectContaining({ objectName: name, objectType: type, uri }),
    ]);
  });

  it('preserves exact labels and ambiguity across object types', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(
      mockResponse(
        200,
        `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
        <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/domains/syst" adtcore:type="DOMA/DO" adtcore:name="SYST"/>
        <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/structures/syst" adtcore:type="TABL/DS" adtcore:name="SYST (Structure)"/>
      </adtcore:objectReferences>`,
      ),
    );
    expect((await createClient().lookupObjects(['SYST']))[0]?.matches.map((r) => r.objectType)).toEqual([
      'DOMA/DO',
      'TABL/DS',
    ]);
  });

  it('preserves ambiguity between distinct function URIs', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(
      mockResponse(
        200,
        `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
      <adtcore:objectReference adtcore:uri="/sap/bc/adt/functions/groups/z1/fmodules/zfoo" adtcore:type="FUGR/FF" adtcore:name="ZFOO (Function Module)"/>
      <adtcore:objectReference adtcore:uri="/sap/bc/adt/functions/groups/z2/fmodules/zfoo" adtcore:type="FUGR/FF" adtcore:name="ZFOO (Function Module)"/>
    </adtcore:objectReferences>`,
      ),
    );
    expect((await createClient().lookupObjects(['ZFOO']))[0]?.matches).toHaveLength(2);
  });
});
