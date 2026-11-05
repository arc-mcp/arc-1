/** Exact stopped 4e graph. Native bytes are fixed history, never a fresh baseline to adopt. */
export const GROUP_CLEANUP_PROTOCOL = 'pr1142-native-procedural-group-cleanup-v1';
export const GROUP_CLEANUP_STAGES = ['preflight', 'group-delete', 'final'] as const;
export const GROUP_CLEANUP_INTENT = '2b9842c626f67afc3f7a974e0f7f182913773d0efa3c8f25f0ead9977f0c1d9f';
export const GROUP_CLEANUP_RESULT = 'f34074fcb37b68fc82c540f978bb4851fc2facf696fd471e02d418398f6b84e8';
export const groupCleanupHistoryDigest = 'a8e85c6daa3fda6789f58bf57c0a6878062bfba5cbd927ba48052ad248a3507d';
export const groupCleanupHistoryRoots = {
  'arc1-qualification/pr1142-native-procedural-tail-v1': 1254,
  'arc1-review/pr1142-native-procedural-tail-execution-20261103': 11,
  'arc1-review/pr1142-procedural-final-group-reads-20261103': 29,
} as const;
export const groupCleanupHistoryReports = [
  'arc1-review/pr1142-procedural-tail-execution-audit1/result.md',
  'arc1-review/pr1142-procedural-tail-execution-audit1/result.json',
  'arc1-review/pr1142-procedural-tail-execution-audit1/evidence-before.json',
] as const;
export const groupCleanupReads = [
  {
    path: '/sap/bc/adt/functions/groups/zarc1_pt_6d7a93e20b45c18f/objectstructure',
    accept: 'application/vnd.sap.adt.objectstructure.v2+xml',
    sha256: '4be88df6bcfed87002929ee7111bbcea2f8131114c91c97004dd6211d5bcd1e9',
  },
  {
    path: '/sap/bc/adt/functions/groups/zarc1_pt_6d7a93e20b45c18f?version=active',
    accept: 'application/*',
    sha256: 'c6bbdc196e1ae9cdbb3de69a665a1ac95e8325b1ecdb57187e816444d060c1ae',
  },
  {
    path: '/sap/bc/adt/functions/groups/zarc1_pt_6d7a93e20b45c18f/source/main?version=active',
    accept: 'text/plain',
    sha256: '11a2d13fe17cd3786d191d5f518bb9549ab07928ead605ab811cd7da4f3dd5e8',
  },
  {
    path: '/sap/bc/adt/functions/groups/zarc1_pt_6d7a93e20b45c18f/includes/lzarc1_pt_6d7a93e20b45c18ftop/source/main?version=active',
    accept: 'text/plain',
    sha256: '8aa56ce454f98e92cf28b21d4148ed5bb7b38633f6f78b6085e71e62e3cb7ce1',
  },
  {
    path: '/sap/bc/adt/functions/groups/zarc1_pt_6d7a93e20b45c18f/includes/lzarc1_pt_6d7a93e20b45c18fuxx/source/main?version=active',
    accept: 'text/plain',
    sha256: '7a4ed62f6d45482063cddb8fd75847080ff8db080ae1aa23eebf3761a27cf6b5',
  },
  {
    path: '/sap/bc/adt/textelements/functiongroups/ZARC1_PT_6D7A93E20B45C18F/source/symbols?version=active',
    accept: 'application/vnd.sap.adt.textelements.symbols.v1',
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  },
  {
    path: '/sap/bc/adt/textelements/functiongroups/ZARC1_PT_6D7A93E20B45C18F/source/selections?version=active',
    accept: 'application/vnd.sap.adt.textelements.selections.v1',
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  },
  {
    path: '/sap/bc/adt/textelements/functiongroups/ZARC1_PT_6D7A93E20B45C18F/source/headings?version=active',
    accept: 'application/vnd.sap.adt.textelements.headings.v1',
    sha256: 'e9f7f43617cfc040a33cb57872e1370c55378dc0a390493ba39e212d3706dbef',
  },
  {
    path: '/sap/bc/adt/functions/groups/zarc1_pt_6d7a93e20b45c18f?version=inactive',
    accept: 'application/*',
    sha256: '6852d11d6c77dbed425e771466dba28ed821273c14f1df53c6a20d326ec3963f',
  },
  {
    path: '/sap/bc/adt/functions/groups/zarc1_pt_6d7a93e20b45c18f/source/main?version=inactive',
    accept: 'text/plain',
    sha256: '11a2d13fe17cd3786d191d5f518bb9549ab07928ead605ab811cd7da4f3dd5e8',
  },
  {
    path: '/sap/bc/adt/functions/groups/zarc1_pt_6d7a93e20b45c18f/includes/lzarc1_pt_6d7a93e20b45c18ftop/source/main?version=inactive',
    accept: 'text/plain',
    sha256: '8aa56ce454f98e92cf28b21d4148ed5bb7b38633f6f78b6085e71e62e3cb7ce1',
  },
  {
    path: '/sap/bc/adt/functions/groups/zarc1_pt_6d7a93e20b45c18f/includes/lzarc1_pt_6d7a93e20b45c18fuxx/source/main?version=inactive',
    accept: 'text/plain',
    sha256: '7a4ed62f6d45482063cddb8fd75847080ff8db080ae1aa23eebf3761a27cf6b5',
  },
  {
    path: '/sap/bc/adt/textelements/functiongroups/ZARC1_PT_6D7A93E20B45C18F/source/symbols?version=inactive',
    accept: 'application/vnd.sap.adt.textelements.symbols.v1',
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  },
  {
    path: '/sap/bc/adt/textelements/functiongroups/ZARC1_PT_6D7A93E20B45C18F/source/selections?version=inactive',
    accept: 'application/vnd.sap.adt.textelements.selections.v1',
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  },
  {
    path: '/sap/bc/adt/textelements/functiongroups/ZARC1_PT_6D7A93E20B45C18F/source/headings?version=inactive',
    accept: 'application/vnd.sap.adt.textelements.headings.v1',
    sha256: 'e9f7f43617cfc040a33cb57872e1370c55378dc0a390493ba39e212d3706dbef',
  },
  {
    path: '/sap/bc/adt/functions/groups/zarc1_pt_6d7a93e20b45c18f',
    accept: 'application/*',
    sha256: '6852d11d6c77dbed425e771466dba28ed821273c14f1df53c6a20d326ec3963f',
  },
  {
    path: '/sap/bc/adt/functions/groups/zarc1_pt_6d7a93e20b45c18f/source/main',
    accept: 'text/plain',
    sha256: '11a2d13fe17cd3786d191d5f518bb9549ab07928ead605ab811cd7da4f3dd5e8',
  },
  {
    path: '/sap/bc/adt/textelements/functiongroups/ZARC1_PT_6D7A93E20B45C18F',
    accept: 'application/vnd.sap.adt.textelements.v1+xml',
    sha256: '7eade7475d1ffbb0accdf9419f9296303f762d1c5536c87b6d2f04cd71f92d07',
  },
  {
    path: '/sap/bc/adt/textelements/functiongroups/ZARC1_PT_6D7A93E20B45C18F?version=active',
    accept: 'application/vnd.sap.adt.textelements.v1+xml',
    sha256: '7eade7475d1ffbb0accdf9419f9296303f762d1c5536c87b6d2f04cd71f92d07',
  },
  {
    path: '/sap/bc/adt/textelements/functiongroups/ZARC1_PT_6D7A93E20B45C18F?version=inactive',
    accept: 'application/vnd.sap.adt.textelements.v1+xml',
    sha256: '7eade7475d1ffbb0accdf9419f9296303f762d1c5536c87b6d2f04cd71f92d07',
  },
] as const;
