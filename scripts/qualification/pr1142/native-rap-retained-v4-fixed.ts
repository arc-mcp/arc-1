/** Fourth consumed claim: all repository owners are active; only publication and reverse cleanup remain. */
import { RAP_DOCUMENT_STAGES } from './native-rap-documents-fixtures.js';
import { RAP_RETAINED_V3_COMPLETED, RAP_RETAINED_V3_OBSERVED_WRITES } from './native-rap-retained-v3-fixed.js';
export const RAP_RETAINED_V4_PROTOCOL = 'pr1142-native-rap-documents-retained-v4';
export const RAP_RETAINED_V4_COMPLETED = [
  ...RAP_RETAINED_V3_COMPLETED,
  'activate-document-updated',
  'create-service',
  'activate-service',
  'create-binding',
];
export const RAP_RETAINED_V4_OBSERVED_WRITES = RAP_RETAINED_V3_OBSERVED_WRITES;
export const RAP_RETAINED_V4_OBSERVED_ACTIVATIONS = ['activate-binding'];
export const RAP_RETAINED_V4_STAGES = RAP_DOCUMENT_STAGES.slice(RAP_DOCUMENT_STAGES.indexOf('publish'));
export const RAP_RETAINED_V4_HISTORY = {
  report: '4ac19832cfec4dffc9e852a3b5b25911ca38f62ee20a025fd28c9d31d733bee0',
  ledger: '5e02bf3da327ba1871265b0cf6373f5d5726124581c4d1d9f0157db86fd90e9b',
  intent: 'cdfbea392ceabdebfa2763004027dabe6c9d5501df2c7beb9a8bc2b7810b9af8',
  result: '709467ee54790956dd55fcc8950f1c1cb5c4bf1286d231b43cbf43819fb1fee2',
  independent: {
    'result.md': 'bd894ddf4f9ff828c10ae09d5bd9fe79127f1b57856e9d04a4c1f30c584e7d8a',
    'ledger.json': 'dc37d85f9b8a852f221dcb582d2c8fc3b601f0bb75b0321707b9c9e18677420e',
  },
};
/** All 47 successful exact owned views, including three case-spelled aliases; 400/406 remain non-proof. */
export const RAP_RETAINED_V4_READS = [
  {
    path: '/sap/bc/adt/ddic/tables/ztrp8e66923bdef5',
    accept: 'application/*',
    sha256: 'd815bf378eb176d5c759bd3349d81c29516f6f870e78e65de10d59b078ee690a',
    bytes: 3032,
  },
  {
    path: '/sap/bc/adt/ddic/tables/ztrp8e66923bdef5?version=inactive',
    accept: 'application/*',
    sha256: 'd815bf378eb176d5c759bd3349d81c29516f6f870e78e65de10d59b078ee690a',
    bytes: 3032,
  },
  {
    path: '/sap/bc/adt/ddic/tables/ztrp8e66923bdef5?version=active',
    accept: 'application/*',
    sha256: 'd815bf378eb176d5c759bd3349d81c29516f6f870e78e65de10d59b078ee690a',
    bytes: 3032,
  },
  {
    path: '/sap/bc/adt/ddic/db/settings/ztrp8e66923bdef5',
    accept: 'application/*',
    sha256: '91d3f232132ecf11a0971127dd76c09327a1ddf08ea51e11a64895c3c48460da',
    bytes: 1811,
  },
  {
    path: '/sap/bc/adt/ddic/db/settings/ztrp8e66923bdef5?version=inactive',
    accept: 'application/*',
    sha256: '91d3f232132ecf11a0971127dd76c09327a1ddf08ea51e11a64895c3c48460da',
    bytes: 1811,
  },
  {
    path: '/sap/bc/adt/ddic/db/settings/ztrp8e66923bdef5?version=active',
    accept: 'application/*',
    sha256: '91d3f232132ecf11a0971127dd76c09327a1ddf08ea51e11a64895c3c48460da',
    bytes: 1811,
  },
  {
    path: '/sap/bc/adt/ddic/ddl/sources/zrrp_8e66923bdef5',
    accept: 'application/vnd.sap.adt.ddlsource+xml',
    sha256: '9160e49d5ab73f5c593a7ecb88b121fa1608e262fd18538ff78cfc9b79755b1c',
    bytes: 2270,
  },
  {
    path: '/sap/bc/adt/ddic/ddl/sources/zrrp_8e66923bdef5?version=inactive',
    accept: 'application/*',
    sha256: '9160e49d5ab73f5c593a7ecb88b121fa1608e262fd18538ff78cfc9b79755b1c',
    bytes: 2270,
  },
  {
    path: '/sap/bc/adt/ddic/ddl/sources/zrrp_8e66923bdef5?version=active',
    accept: 'application/vnd.sap.adt.ddlsource+xml',
    sha256: '9160e49d5ab73f5c593a7ecb88b121fa1608e262fd18538ff78cfc9b79755b1c',
    bytes: 2270,
  },
  {
    path: '/sap/bc/adt/oo/classes/zbp_rp_8e66923bdef5',
    accept: 'application/*',
    sha256: 'a66abd7f2ab5d73eec08d96c99cfa83d45af0c4b37f1c019ba9c052e19778ddc',
    bytes: 7748,
  },
  {
    path: '/sap/bc/adt/oo/classes/zbp_rp_8e66923bdef5?version=inactive',
    accept: 'application/*',
    sha256: 'a66abd7f2ab5d73eec08d96c99cfa83d45af0c4b37f1c019ba9c052e19778ddc',
    bytes: 7748,
  },
  {
    path: '/sap/bc/adt/oo/classes/zbp_rp_8e66923bdef5?version=active',
    accept: 'application/*',
    sha256: 'a66abd7f2ab5d73eec08d96c99cfa83d45af0c4b37f1c019ba9c052e19778ddc',
    bytes: 7748,
  },
  {
    path: '/sap/bc/adt/bo/behaviordefinitions/zrrp_8e66923bdef5',
    accept: 'application/vnd.sap.adt.blues.v1+xml',
    sha256: '35568193c202a7a374019fad121e401999af13dfc741afcb1443ef9b1a968dce',
    bytes: 2590,
  },
  {
    path: '/sap/bc/adt/bo/behaviordefinitions/zrrp_8e66923bdef5?version=inactive',
    accept: 'application/*',
    sha256: '35568193c202a7a374019fad121e401999af13dfc741afcb1443ef9b1a968dce',
    bytes: 2590,
  },
  {
    path: '/sap/bc/adt/bo/behaviordefinitions/zrrp_8e66923bdef5?version=active',
    accept: 'application/vnd.sap.adt.blues.v1+xml',
    sha256: '35568193c202a7a374019fad121e401999af13dfc741afcb1443ef9b1a968dce',
    bytes: 2590,
  },
  {
    path: '/sap/bc/adt/documentation/ktd/documents/zrrp_8e66923bdef5',
    accept: 'application/vnd.sap.adt.sktdv2+xml',
    sha256: '3d2a4120a092202f5758344cf60496f1ede1c163015eeb7879e9a379875d7a8b',
    bytes: 7921,
  },
  {
    path: '/sap/bc/adt/documentation/ktd/documents/zrrp_8e66923bdef5?version=inactive',
    accept: 'application/vnd.sap.adt.sktdv2+xml',
    sha256: '3d2a4120a092202f5758344cf60496f1ede1c163015eeb7879e9a379875d7a8b',
    bytes: 7921,
  },
  {
    path: '/sap/bc/adt/documentation/ktd/documents/zrrp_8e66923bdef5?version=active',
    accept: 'application/vnd.sap.adt.sktdv2+xml',
    sha256: '3d2a4120a092202f5758344cf60496f1ede1c163015eeb7879e9a379875d7a8b',
    bytes: 7921,
  },
  {
    path: '/sap/bc/adt/ddic/tables/ZTRP8E66923BDEF5',
    accept: 'application/*',
    sha256: 'd815bf378eb176d5c759bd3349d81c29516f6f870e78e65de10d59b078ee690a',
    bytes: 3032,
  },
  {
    path: '/sap/bc/adt/ddic/tables/ZTRP8E66923BDEF5/source/main',
    accept: 'text/plain',
    sha256: '1d5d97042632ce28dbd3e21404706ec1bde3d6cc91a18e1ccb8e6515b961a834',
    bytes: 359,
  },
  {
    path: '/sap/bc/adt/ddic/tables/ZTRP8E66923BDEF5?version=inactive',
    accept: 'application/*',
    sha256: 'd815bf378eb176d5c759bd3349d81c29516f6f870e78e65de10d59b078ee690a',
    bytes: 3032,
  },
  {
    path: '/sap/bc/adt/ddic/tables/ZTRP8E66923BDEF5/source/main?version=inactive',
    accept: 'text/plain',
    sha256: '1d5d97042632ce28dbd3e21404706ec1bde3d6cc91a18e1ccb8e6515b961a834',
    bytes: 359,
  },
  {
    path: '/sap/bc/adt/ddic/tables/ZTRP8E66923BDEF5?version=active',
    accept: 'application/*',
    sha256: 'd815bf378eb176d5c759bd3349d81c29516f6f870e78e65de10d59b078ee690a',
    bytes: 3032,
  },
  {
    path: '/sap/bc/adt/ddic/tables/ZTRP8E66923BDEF5/source/main?version=active',
    accept: 'text/plain',
    sha256: '1d5d97042632ce28dbd3e21404706ec1bde3d6cc91a18e1ccb8e6515b961a834',
    bytes: 359,
  },
  {
    path: '/sap/bc/adt/ddic/ddl/sources/zrrp_8e66923bdef5/source/main',
    accept: 'text/plain',
    sha256: '96778a51638b0d0c3f5c7515c7030a092c5a3117ed104cd5978f0812ee672933',
    bytes: 208,
  },
  {
    path: '/sap/bc/adt/ddic/ddl/sources/zrrp_8e66923bdef5/source/main?version=inactive',
    accept: 'text/plain',
    sha256: '96778a51638b0d0c3f5c7515c7030a092c5a3117ed104cd5978f0812ee672933',
    bytes: 208,
  },
  {
    path: '/sap/bc/adt/ddic/ddl/sources/zrrp_8e66923bdef5/source/main?version=active',
    accept: 'text/plain',
    sha256: '96778a51638b0d0c3f5c7515c7030a092c5a3117ed104cd5978f0812ee672933',
    bytes: 208,
  },
  {
    path: '/sap/bc/adt/oo/classes/zbp_rp_8e66923bdef5/source/main',
    accept: 'text/plain',
    sha256: '45f98ab9d0f05c4bbd4f4f192dfdd61adc76959d318ab822b33b314972da9d15',
    bytes: 168,
  },
  {
    path: '/sap/bc/adt/oo/classes/zbp_rp_8e66923bdef5/includes/definitions',
    accept: 'text/plain',
    sha256: '3829118a7e789db9dfd979950526c2eab48c160ccac4a24db1d7697b5cbdb5cc',
    bytes: 165,
  },
  {
    path: '/sap/bc/adt/oo/classes/zbp_rp_8e66923bdef5/includes/implementations',
    accept: 'text/plain',
    sha256: 'c19089c7f74056b929a0d6cc44942ba8205007206ff39097d94c4b45f2c0a652',
    bytes: 622,
  },
  {
    path: '/sap/bc/adt/oo/classes/zbp_rp_8e66923bdef5/includes/macros',
    accept: 'text/plain',
    sha256: '3a608b0510edb3290a6d9fd5c4cd015fa51f105693f78c74e9142d6e4905e8e8',
    bytes: 106,
  },
  {
    path: '/sap/bc/adt/bo/behaviordefinitions/zrrp_8e66923bdef5/source/main',
    accept: 'text/plain',
    sha256: 'aa3e6745c646593532893ac7334f6b79600dc695b61eba5f4a07ca9b516686a1',
    bytes: 364,
  },
  {
    path: '/sap/bc/adt/bo/behaviordefinitions/zrrp_8e66923bdef5/source/main?version=inactive',
    accept: 'text/plain',
    sha256: 'aa3e6745c646593532893ac7334f6b79600dc695b61eba5f4a07ca9b516686a1',
    bytes: 364,
  },
  {
    path: '/sap/bc/adt/bo/behaviordefinitions/zrrp_8e66923bdef5/source/main?version=active',
    accept: 'text/plain',
    sha256: 'aa3e6745c646593532893ac7334f6b79600dc695b61eba5f4a07ca9b516686a1',
    bytes: 364,
  },
  {
    path: '/sap/bc/adt/oo/classes/zbp_rp_8e66923bdef5/source/main?version=active',
    accept: 'text/plain',
    sha256: '45f98ab9d0f05c4bbd4f4f192dfdd61adc76959d318ab822b33b314972da9d15',
    bytes: 168,
  },
  {
    path: '/sap/bc/adt/oo/classes/zbp_rp_8e66923bdef5/includes/definitions?version=active',
    accept: 'text/plain',
    sha256: '3829118a7e789db9dfd979950526c2eab48c160ccac4a24db1d7697b5cbdb5cc',
    bytes: 165,
  },
  {
    path: '/sap/bc/adt/oo/classes/zbp_rp_8e66923bdef5/includes/implementations?version=active',
    accept: 'text/plain',
    sha256: 'c19089c7f74056b929a0d6cc44942ba8205007206ff39097d94c4b45f2c0a652',
    bytes: 622,
  },
  {
    path: '/sap/bc/adt/oo/classes/zbp_rp_8e66923bdef5/includes/macros?version=active',
    accept: 'text/plain',
    sha256: '3a608b0510edb3290a6d9fd5c4cd015fa51f105693f78c74e9142d6e4905e8e8',
    bytes: 106,
  },
  {
    path: '/sap/bc/adt/ddic/srvd/sources/zsrp_8e66923bdef5',
    accept: 'application/vnd.sap.adt.ddic.srvd.v1+xml',
    sha256: '7fb0cf535d048a944000b69b732fa256db99e19e08536f3770ca930d755ce54d',
    bytes: 2041,
  },
  {
    path: '/sap/bc/adt/ddic/srvd/sources/zsrp_8e66923bdef5/source/main',
    accept: 'text/plain',
    sha256: '3374dda2015abf3e3cf22f72a88792deaf526633a7793eb58c0ce67a91699caf',
    bytes: 122,
  },
  {
    path: '/sap/bc/adt/businessservices/bindings/ZBRP_8E66923BDEF5',
    accept: 'application/vnd.sap.adt.businessservices.servicebinding.v2+xml',
    sha256: '581b50b79cb750455cd68ffe9bf978140396bf4d6f90fef96098544fb1d66dff',
    bytes: 2890,
  },
  {
    path: '/sap/bc/adt/businessservices/bindings/ZBRP_8E66923BDEF5?version=inactive',
    accept: 'application/vnd.sap.adt.businessservices.servicebinding.v2+xml',
    sha256: '581b50b79cb750455cd68ffe9bf978140396bf4d6f90fef96098544fb1d66dff',
    bytes: 2890,
  },
  {
    path: '/sap/bc/adt/ddic/srvd/sources/zsrp_8e66923bdef5?version=inactive',
    accept: 'application/vnd.sap.adt.ddic.srvd.v1+xml',
    sha256: '7fb0cf535d048a944000b69b732fa256db99e19e08536f3770ca930d755ce54d',
    bytes: 2041,
  },
  {
    path: '/sap/bc/adt/ddic/srvd/sources/zsrp_8e66923bdef5/source/main?version=inactive',
    accept: 'text/plain',
    sha256: '3374dda2015abf3e3cf22f72a88792deaf526633a7793eb58c0ce67a91699caf',
    bytes: 122,
  },
  {
    path: '/sap/bc/adt/businessservices/bindings/ZBRP_8E66923BDEF5?version=active',
    accept: 'application/vnd.sap.adt.businessservices.servicebinding.v2+xml',
    sha256: '581b50b79cb750455cd68ffe9bf978140396bf4d6f90fef96098544fb1d66dff',
    bytes: 2890,
  },
  {
    path: '/sap/bc/adt/ddic/srvd/sources/zsrp_8e66923bdef5?version=active',
    accept: 'application/vnd.sap.adt.ddic.srvd.v1+xml',
    sha256: '7fb0cf535d048a944000b69b732fa256db99e19e08536f3770ca930d755ce54d',
    bytes: 2041,
  },
  {
    path: '/sap/bc/adt/ddic/srvd/sources/zsrp_8e66923bdef5/source/main?version=active',
    accept: 'text/plain',
    sha256: '3374dda2015abf3e3cf22f72a88792deaf526633a7793eb58c0ce67a91699caf',
    bytes: 122,
  },
];
