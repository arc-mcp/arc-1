/** Fixed unfinished tail of the consumed native document run; no operator-selected resume. */
import { RAP_DOCUMENT_STAGES, rapDocumentFixtures } from './native-rap-documents-fixtures.js';
export const RAP_RETAINED_PROTOCOL = 'pr1142-native-rap-documents-retained-v1';
export const RAP_RETAINED_SUFFIX = '8E66923BDEF5';
export const RAP_RETAINED_HISTORY = {
  report: '01e87e8979f3caccfcca7da42877b661e7ea34b2f4d18543e70173559a28a772',
  ledger: '3a2dae454476158cf1e66e9b9a7b5e2dff1faeba5be9888e139247150c0de0ad',
  intent: 'e9a53410883def37396a89af0e0fb0d5530470d2965efec03ab8d1f503c571b8',
  result: 'ebc6a5ab00f71e5d73e5b8bebd9cab5f86b6929c7285a9771300bcad0fa34337',
};
export const RAP_RETAINED_COMPLETED = RAP_DOCUMENT_STAGES.slice(0, 9);
export const RAP_RETAINED_STAGES = ['update-document-root', ...RAP_DOCUMENT_STAGES.slice(10)];
export function rapRetainedFixtures(suffix: string) {
  if (suffix !== RAP_RETAINED_SUFFIX) throw new Error('Only the fixed retained RAP graph is admitted.');
  return rapDocumentFixtures(suffix);
}
export const RAP_RETAINED_INDICES = [0, 1, 2, 3, 6] as const;
export const RAP_APPROVE_TEXT = 'Describes the owned approval action without executing it.';
export const RAP_RETAINED_READS = [
  {
    path: '/sap/bc/adt/ddic/tables/ztrp8e66923bdef5',
    sha256: 'd815bf378eb176d5c759bd3349d81c29516f6f870e78e65de10d59b078ee690a',
    bytes: 3032,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/ddic/tables/ztrp8e66923bdef5?version=inactive',
    sha256: 'd815bf378eb176d5c759bd3349d81c29516f6f870e78e65de10d59b078ee690a',
    bytes: 3032,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/ddic/tables/ztrp8e66923bdef5?version=active',
    sha256: 'd815bf378eb176d5c759bd3349d81c29516f6f870e78e65de10d59b078ee690a',
    bytes: 3032,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/ddic/db/settings/ztrp8e66923bdef5',
    sha256: '91d3f232132ecf11a0971127dd76c09327a1ddf08ea51e11a64895c3c48460da',
    bytes: 1811,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/ddic/db/settings/ztrp8e66923bdef5?version=inactive',
    sha256: '91d3f232132ecf11a0971127dd76c09327a1ddf08ea51e11a64895c3c48460da',
    bytes: 1811,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/ddic/db/settings/ztrp8e66923bdef5?version=active',
    sha256: '91d3f232132ecf11a0971127dd76c09327a1ddf08ea51e11a64895c3c48460da',
    bytes: 1811,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/ddic/ddl/sources/zrrp_8e66923bdef5',
    sha256: '9160e49d5ab73f5c593a7ecb88b121fa1608e262fd18538ff78cfc9b79755b1c',
    bytes: 2270,
    accept: 'application/vnd.sap.adt.ddlsource+xml',
  },
  {
    path: '/sap/bc/adt/ddic/ddl/sources/zrrp_8e66923bdef5?version=inactive',
    sha256: '9160e49d5ab73f5c593a7ecb88b121fa1608e262fd18538ff78cfc9b79755b1c',
    bytes: 2270,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/ddic/ddl/sources/zrrp_8e66923bdef5?version=active',
    sha256: '9160e49d5ab73f5c593a7ecb88b121fa1608e262fd18538ff78cfc9b79755b1c',
    bytes: 2270,
    accept: 'application/vnd.sap.adt.ddlsource+xml',
  },
  {
    path: '/sap/bc/adt/oo/classes/zbp_rp_8e66923bdef5',
    sha256: 'a66abd7f2ab5d73eec08d96c99cfa83d45af0c4b37f1c019ba9c052e19778ddc',
    bytes: 7748,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/oo/classes/zbp_rp_8e66923bdef5?version=inactive',
    sha256: 'a66abd7f2ab5d73eec08d96c99cfa83d45af0c4b37f1c019ba9c052e19778ddc',
    bytes: 7748,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/oo/classes/zbp_rp_8e66923bdef5?version=active',
    sha256: 'a66abd7f2ab5d73eec08d96c99cfa83d45af0c4b37f1c019ba9c052e19778ddc',
    bytes: 7748,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/bo/behaviordefinitions/zrrp_8e66923bdef5',
    sha256: '35568193c202a7a374019fad121e401999af13dfc741afcb1443ef9b1a968dce',
    bytes: 2590,
    accept: 'application/vnd.sap.adt.blues.v1+xml',
  },
  {
    path: '/sap/bc/adt/bo/behaviordefinitions/zrrp_8e66923bdef5?version=inactive',
    sha256: '35568193c202a7a374019fad121e401999af13dfc741afcb1443ef9b1a968dce',
    bytes: 2590,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/bo/behaviordefinitions/zrrp_8e66923bdef5?version=active',
    sha256: '35568193c202a7a374019fad121e401999af13dfc741afcb1443ef9b1a968dce',
    bytes: 2590,
    accept: 'application/vnd.sap.adt.blues.v1+xml',
  },
  {
    path: '/sap/bc/adt/documentation/ktd/documents/zrrp_8e66923bdef5',
    sha256: '2ecbaa6831d13537030c5593a7a98a9a3360850d269118731aadeb87932645eb',
    bytes: 7513,
    accept: 'application/vnd.sap.adt.sktdv2+xml',
  },
  {
    path: '/sap/bc/adt/documentation/ktd/documents/zrrp_8e66923bdef5?version=inactive',
    sha256: '2ecbaa6831d13537030c5593a7a98a9a3360850d269118731aadeb87932645eb',
    bytes: 7513,
    accept: 'application/vnd.sap.adt.sktdv2+xml',
  },
  {
    path: '/sap/bc/adt/documentation/ktd/documents/zrrp_8e66923bdef5?version=active',
    sha256: '2ecbaa6831d13537030c5593a7a98a9a3360850d269118731aadeb87932645eb',
    bytes: 7513,
    accept: 'application/vnd.sap.adt.sktdv2+xml',
  },
  {
    path: '/sap/bc/adt/ddic/tables/ZTRP8E66923BDEF5',
    sha256: 'd815bf378eb176d5c759bd3349d81c29516f6f870e78e65de10d59b078ee690a',
    bytes: 3032,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/ddic/tables/ZTRP8E66923BDEF5/source/main',
    sha256: '1d5d97042632ce28dbd3e21404706ec1bde3d6cc91a18e1ccb8e6515b961a834',
    bytes: 359,
    accept: 'text/plain',
  },
  {
    path: '/sap/bc/adt/ddic/tables/ZTRP8E66923BDEF5?version=inactive',
    sha256: 'd815bf378eb176d5c759bd3349d81c29516f6f870e78e65de10d59b078ee690a',
    bytes: 3032,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/ddic/tables/ZTRP8E66923BDEF5/source/main?version=inactive',
    sha256: '1d5d97042632ce28dbd3e21404706ec1bde3d6cc91a18e1ccb8e6515b961a834',
    bytes: 359,
    accept: 'text/plain',
  },
  {
    path: '/sap/bc/adt/ddic/tables/ZTRP8E66923BDEF5?version=active',
    sha256: 'd815bf378eb176d5c759bd3349d81c29516f6f870e78e65de10d59b078ee690a',
    bytes: 3032,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/ddic/tables/ZTRP8E66923BDEF5/source/main?version=active',
    sha256: '1d5d97042632ce28dbd3e21404706ec1bde3d6cc91a18e1ccb8e6515b961a834',
    bytes: 359,
    accept: 'text/plain',
  },
  {
    path: '/sap/bc/adt/ddic/ddl/sources/zrrp_8e66923bdef5/source/main',
    sha256: '96778a51638b0d0c3f5c7515c7030a092c5a3117ed104cd5978f0812ee672933',
    bytes: 208,
    accept: 'text/plain',
  },
  {
    path: '/sap/bc/adt/ddic/ddl/sources/zrrp_8e66923bdef5/source/main?version=inactive',
    sha256: '96778a51638b0d0c3f5c7515c7030a092c5a3117ed104cd5978f0812ee672933',
    bytes: 208,
    accept: 'text/plain',
  },
  {
    path: '/sap/bc/adt/ddic/ddl/sources/zrrp_8e66923bdef5/source/main?version=active',
    sha256: '96778a51638b0d0c3f5c7515c7030a092c5a3117ed104cd5978f0812ee672933',
    bytes: 208,
    accept: 'text/plain',
  },
  {
    path: '/sap/bc/adt/oo/classes/zbp_rp_8e66923bdef5/source/main',
    sha256: '45f98ab9d0f05c4bbd4f4f192dfdd61adc76959d318ab822b33b314972da9d15',
    bytes: 168,
    accept: 'text/plain',
  },
  {
    path: '/sap/bc/adt/oo/classes/zbp_rp_8e66923bdef5/includes/definitions',
    sha256: '3829118a7e789db9dfd979950526c2eab48c160ccac4a24db1d7697b5cbdb5cc',
    bytes: 165,
    accept: 'text/plain',
  },
  {
    path: '/sap/bc/adt/oo/classes/zbp_rp_8e66923bdef5/includes/implementations',
    sha256: 'c19089c7f74056b929a0d6cc44942ba8205007206ff39097d94c4b45f2c0a652',
    bytes: 622,
    accept: 'text/plain',
  },
  {
    path: '/sap/bc/adt/oo/classes/zbp_rp_8e66923bdef5/includes/macros',
    sha256: '3a608b0510edb3290a6d9fd5c4cd015fa51f105693f78c74e9142d6e4905e8e8',
    bytes: 106,
    accept: 'text/plain',
  },
  {
    path: '/sap/bc/adt/bo/behaviordefinitions/zrrp_8e66923bdef5/source/main',
    sha256: 'aa3e6745c646593532893ac7334f6b79600dc695b61eba5f4a07ca9b516686a1',
    bytes: 364,
    accept: 'text/plain',
  },
  {
    path: '/sap/bc/adt/bo/behaviordefinitions/zrrp_8e66923bdef5/source/main?version=inactive',
    sha256: 'aa3e6745c646593532893ac7334f6b79600dc695b61eba5f4a07ca9b516686a1',
    bytes: 364,
    accept: 'text/plain',
  },
  {
    path: '/sap/bc/adt/bo/behaviordefinitions/zrrp_8e66923bdef5/source/main?version=active',
    sha256: 'aa3e6745c646593532893ac7334f6b79600dc695b61eba5f4a07ca9b516686a1',
    bytes: 364,
    accept: 'text/plain',
  },
  {
    path: '/sap/bc/adt/oo/classes/zbp_rp_8e66923bdef5/source/main?version=active',
    sha256: '45f98ab9d0f05c4bbd4f4f192dfdd61adc76959d318ab822b33b314972da9d15',
    bytes: 168,
    accept: 'text/plain',
  },
  {
    path: '/sap/bc/adt/oo/classes/zbp_rp_8e66923bdef5/includes/definitions?version=active',
    sha256: '3829118a7e789db9dfd979950526c2eab48c160ccac4a24db1d7697b5cbdb5cc',
    bytes: 165,
    accept: 'text/plain',
  },
  {
    path: '/sap/bc/adt/oo/classes/zbp_rp_8e66923bdef5/includes/implementations?version=active',
    sha256: 'c19089c7f74056b929a0d6cc44942ba8205007206ff39097d94c4b45f2c0a652',
    bytes: 622,
    accept: 'text/plain',
  },
  {
    path: '/sap/bc/adt/oo/classes/zbp_rp_8e66923bdef5/includes/macros?version=active',
    sha256: '3a608b0510edb3290a6d9fd5c4cd015fa51f105693f78c74e9142d6e4905e8e8',
    bytes: 106,
    accept: 'text/plain',
  },
] as const;
