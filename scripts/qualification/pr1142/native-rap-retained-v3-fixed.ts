/** Third consumed claim: all requested documentation is stored; no document write may replay. */
import { RAP_DOCUMENT_STAGES } from './native-rap-documents-fixtures.js';
import { RAP_RETAINED_V2_COMPLETED, RAP_RETAINED_V2_READS } from './native-rap-retained-v2-fixed.js';
export const RAP_RETAINED_V3_PROTOCOL = 'pr1142-native-rap-documents-retained-v3';
export const RAP_RETAINED_V3_COMPLETED = RAP_RETAINED_V2_COMPLETED;
export const RAP_RETAINED_V3_OBSERVED_WRITES = ['update-document-create', 'update-document-update'];
export const RAP_RETAINED_V3_STAGES = RAP_DOCUMENT_STAGES.slice(
  RAP_DOCUMENT_STAGES.indexOf('activate-document-updated'),
);
export const RAP_RETAINED_V3_HISTORY = {
  report: 'b91084315de58429f91eae9d6b129da8f4dcad1292e08d26043917918ac0b93f',
  ledger: '7a02de13b16686d5688ecb9a8a5a64dc6b8f3f1c832d0504fb3c6f27c81afc1a',
  intent: 'd3763ac1779e31228136547f374751a75764688baa12ab62e1928c27d9ede51e',
  result: 'e2e9e6ee3119b200c51650a6732c8482c9eb5b24a0ee1b105812ba51bbacc67b',
  independent: {
    'result.md': 'f70e59409c9652f9b8617940394d0509a7e0fdbb5456771fa7b4231954f574d8',
    'result.json': 'a9a45e1740c6957f210f6dd21c8892045f037133901f6dd32a20317a50f3fcd7',
    'ledger.json': 'd4bf58a399138f61bf745caabb48e5b4e4905c3e367c05ca9494748df3766b24',
  },
};
const document = '/sap/bc/adt/documentation/ktd/documents/zrrp_8e66923bdef5';
export const RAP_RETAINED_V3_READS = RAP_RETAINED_V2_READS.map((row) =>
  row.path === document || row.path === `${document}?version=inactive`
    ? { ...row, sha256: 'fc10e52833148c8f946d92a5816761a8948c478afe27ba70a2ea886e4bd09380', bytes: 8116 }
    : row,
);
