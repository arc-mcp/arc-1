/** Only the consumed original graph; immutable before-child cleanup hashes never become the populated tree. */
import { GROUP, STAGES } from './native-procedural-fixed.js';
export const RETAINED_PROCEDURAL = 'pr1142-native-procedural-retained-v1';
export const RETAINED_STAGES = ['preflight', ...STAGES.slice(STAGES.indexOf('include-edit'))] as const;
export const ORIGINAL_INTENT = 'fc1b04ee3294ee6f1bd46190f3519bdd0e1d7223ba42185e748f09f63c5f531a';
export const ORIGINAL_RESULT = '1353216906940ad13eaa9fba241897aef10fa4acf058b5cde23b0838b3e65fd2';
export const originalGroupBaseline = Object.freeze({
  group: GROUP,
  hashes: Object.freeze({
    '/sap/bc/adt/functions/groups/zarc1_pt_6d7a93e20b45c18f/objectstructure':
      '4be88df6bcfed87002929ee7111bbcea2f8131114c91c97004dd6211d5bcd1e9',
    '/sap/bc/adt/functions/groups/zarc1_pt_6d7a93e20b45c18f?version=active':
      'b8220b9d94cf08929d6ffe09c4b16d7c4560302f6cf7db3bedb75268f9870ca6',
    '/sap/bc/adt/functions/groups/zarc1_pt_6d7a93e20b45c18f/source/main?version=active':
      '5e036eb688627040abb7148085ca87cbcb128367c4f9fdcb4d7ed339c5973cbc',
    '/sap/bc/adt/functions/groups/zarc1_pt_6d7a93e20b45c18f/includes/lzarc1_pt_6d7a93e20b45c18ftop/source/main?version=active':
      '8aa56ce454f98e92cf28b21d4148ed5bb7b38633f6f78b6085e71e62e3cb7ce1',
    '/sap/bc/adt/functions/groups/zarc1_pt_6d7a93e20b45c18f/includes/lzarc1_pt_6d7a93e20b45c18fuxx/source/main?version=active':
      '7a4ed62f6d45482063cddb8fd75847080ff8db080ae1aa23eebf3761a27cf6b5',
    '/sap/bc/adt/textelements/functiongroups/ZARC1_PT_6D7A93E20B45C18F/source/symbols?version=active':
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    '/sap/bc/adt/textelements/functiongroups/ZARC1_PT_6D7A93E20B45C18F/source/selections?version=active':
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    '/sap/bc/adt/textelements/functiongroups/ZARC1_PT_6D7A93E20B45C18F/source/headings?version=active':
      'a3cf2161fa9820c374e78862af37a9f4b54b7ff7a810773dc6de8009a1492fd1',
    '/sap/bc/adt/functions/groups/zarc1_pt_6d7a93e20b45c18f?version=inactive':
      'b8220b9d94cf08929d6ffe09c4b16d7c4560302f6cf7db3bedb75268f9870ca6',
    '/sap/bc/adt/functions/groups/zarc1_pt_6d7a93e20b45c18f/source/main?version=inactive':
      '5e036eb688627040abb7148085ca87cbcb128367c4f9fdcb4d7ed339c5973cbc',
    '/sap/bc/adt/functions/groups/zarc1_pt_6d7a93e20b45c18f/includes/lzarc1_pt_6d7a93e20b45c18ftop/source/main?version=inactive':
      '8aa56ce454f98e92cf28b21d4148ed5bb7b38633f6f78b6085e71e62e3cb7ce1',
    '/sap/bc/adt/functions/groups/zarc1_pt_6d7a93e20b45c18f/includes/lzarc1_pt_6d7a93e20b45c18fuxx/source/main?version=inactive':
      '7a4ed62f6d45482063cddb8fd75847080ff8db080ae1aa23eebf3761a27cf6b5',
    '/sap/bc/adt/textelements/functiongroups/ZARC1_PT_6D7A93E20B45C18F/source/symbols?version=inactive':
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    '/sap/bc/adt/textelements/functiongroups/ZARC1_PT_6D7A93E20B45C18F/source/selections?version=inactive':
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    '/sap/bc/adt/textelements/functiongroups/ZARC1_PT_6D7A93E20B45C18F/source/headings?version=inactive':
      'a3cf2161fa9820c374e78862af37a9f4b54b7ff7a810773dc6de8009a1492fd1',
  }),
});
export const retainedHashes = Object.freeze({
  parentActiveMetadata: '0d9e4c9a0417237863d27ce7cceece2f8734febf5e1fec5bdc8aff078d06e6bd',
  parentInactiveMetadata: '8425d53e017bc30a056e7d9215ba256cc32b9b0cff5c1821eb8aa2f7c2d8e771',
  tree: 'f282a07d1ff04c801624995842a3af96d5283fb442f0940c139a06949418788b',
  parentInserted: '2546dc99ff1d4d26129004853070e29c53b6ac7e24ea2d934df1817d69695a34',
  uxx: '367c89ed6eaa3960aaca7170f7a1fcfc7a815786f7d4c564b8487aefb3df568f',
  functionActive: '20266274f007c9223e4c33df404a43315f7e1dd7912b165966f1ec34477c8291',
  functionDraft: 'b4339a9bedaba1b498051060193bdd24dbef0797506b6ab6eee37db6bf002ab9',
  functionMetadata: '10bd53e1d4875a9400e88e8c12225c7483fe0f596cbfd137e602cfb66bfbcc9b',
  includeDraft: '73ee1e44e20e34455195eb5c4181cd34d11addf7bf5a7b0d4ce3ef1bbe626362',
  includeMetadata: 'da5a2d4357fd056c07a910efacf74cc435f979e2ff4c245d8bb06841acbf8db6',
  includeActiveMetadata: '92554eec9fd831d706fab8362ab1e9b584218a54149b40a9b8c03e22eb558df8',
  includeActive: '1c21db0d2bbb67ae02c444cf71a5a99f641e5edd24f1cd35f2d534deea668abc',
});
