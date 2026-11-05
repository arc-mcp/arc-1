/** The one observed moved class and exact native CTS membership; no caller-selected resume. */
import { PACKAGE_API_STAGES, packageApiIntent } from './native-package-api-profile.js';
import { PACKAGE_API_RETAINED_GRAPH, PACKAGE_API_RETAINED_PAIR } from './native-package-api-retained-fixed.js';
export const PACKAGE_API_MOVED_PROTOCOL = 'pr1142-native-package-api-moved-v1';
export const PACKAGE_API_MOVED_STAGES = PACKAGE_API_STAGES.slice(7);
export const PACKAGE_API_MOVED_COMPLETED = PACKAGE_API_STAGES.slice(0, 6);
export const PACKAGE_API_MOVED_OBSERVED = ['move-class'];
export const PACKAGE_API_MOVED_PAIR = {
  ...PACKAGE_API_RETAINED_PAIR,
  task: 'A4HK906611',
  originalTask: 'A4HK906610',
  moved: true as const,
  initialRequestHash: 'a5e4ca7fe38b63c8738cee1b75007d4f0dc6a8ee8ae8fd5be84b3a39656bdd05',
};
export const PACKAGE_API_MOVED_HISTORY = {
  report: 'b54150797b27316d0da91ddf516f0a311befd7b27328af6ea3a4921f1e882fa9',
  ledger: '4effc3c5821aabcb9e4b1edccd95ba202cf75480280e7ac2cce1abefbb0a9392',
  intent: 'c2cef5af9b6419767eb15b4b32391191fbdc2c3f54c4edd15dc164ea739bac7c',
  result: 'c57f2854439230360f2af832a0200bb54d9378fb6187aa40e5760ceeaa4ed864',
  apiReport: '3e2e044cca4f759142ff50474f08a25fe92c333f78eb4679ac7141f7a2584f71',
  apiLedger: '12e68135cac2f8e8aadb972dd892d489e27cf16f880f8dabf368f62800c7314c',
} as const;
export const PACKAGE_API_MOVED_READS = [
  {
    path: '/sap/bc/adt/packages/%24arc1_pk_r_ec079e6df825234f',
    sha256: '64b87a32bef8e859c6fa1faf7a5be426ead3c9e0a0ee0bc186154b124b71e065',
    bytes: 3800,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/packages/%24arc1_pk_c_ec079e6df825234f',
    sha256: 'bf86bed7138c6bb544cecaa5f488e21f1b151e01cc4363060b743a578d41355a',
    bytes: 3766,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/oo/interfaces/zif_arc1_pk_ec079e6df825234f',
    sha256: '601e0ad030d900aa2b93a1d6381b0767004780fd030b0d89e5b239af989b1700',
    bytes: 2712,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/oo/classes/zcl_arc1_pk_ec079e6df825234f',
    sha256: '5c2ad229dc6495b757eb78b5eb65147309a3d6e75e9416ab9c81cbb303382046',
    bytes: 7693,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/cts/transportrequests/A4HK906609',
    sha256: 'a5e4ca7fe38b63c8738cee1b75007d4f0dc6a8ee8ae8fd5be84b3a39656bdd05',
    bytes: 17214,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/cts/transportrequests/A4HK906610',
    sha256: 'eb2101a7b9009da13fe66a2769195503fb2bf62af1ea188c25ed0d5326e183dc',
    bytes: 10626,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/packages/ZARC1_DEMO',
    sha256: '5bff080e76997f9b06d71579da3b267e9f19920fcc0f2b422ccbd13300f07f73',
    bytes: 3688,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/packages/%24ARC1_PK_R_EC079E6DF825234F',
    sha256: '64b87a32bef8e859c6fa1faf7a5be426ead3c9e0a0ee0bc186154b124b71e065',
    bytes: 3800,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/packages/%24ARC1_PK_C_EC079E6DF825234F',
    sha256: 'bf86bed7138c6bb544cecaa5f488e21f1b151e01cc4363060b743a578d41355a',
    bytes: 3766,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/oo/interfaces/zif_arc1_pk_ec079e6df825234f/source/main',
    sha256: 'e822cb245d7104667dd78a9d7b87ca22e7d42ae049992db1085706381aa9c754',
    bytes: 100,
    accept: 'text/plain',
  },
  {
    path: '/sap/bc/adt/oo/classes/zcl_arc1_pk_ec079e6df825234f/source/main',
    sha256: 'ba3477dffa104340241ff7956a0d802ca0e7ef6d1c598a14a1c089b4cb9cebe8',
    bytes: 215,
    accept: 'text/plain',
  },
  {
    path: '/sap/bc/adt/oo/interfaces/zif_arc1_pk_ec079e6df825234f/source/main?version=inactive',
    sha256: 'e822cb245d7104667dd78a9d7b87ca22e7d42ae049992db1085706381aa9c754',
    bytes: 100,
    accept: 'text/plain',
  },
  {
    path: '/sap/bc/adt/oo/classes/zcl_arc1_pk_ec079e6df825234f/source/main?version=inactive',
    sha256: 'ba3477dffa104340241ff7956a0d802ca0e7ef6d1c598a14a1c089b4cb9cebe8',
    bytes: 215,
    accept: 'text/plain',
  },
  {
    path: '/sap/bc/adt/oo/interfaces/zif_arc1_pk_ec079e6df825234f?version=active',
    sha256: '601e0ad030d900aa2b93a1d6381b0767004780fd030b0d89e5b239af989b1700',
    bytes: 2712,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/oo/interfaces/zif_arc1_pk_ec079e6df825234f/source/main?version=active',
    sha256: 'e822cb245d7104667dd78a9d7b87ca22e7d42ae049992db1085706381aa9c754',
    bytes: 100,
    accept: 'text/plain',
  },
  {
    path: '/sap/bc/adt/oo/classes/zcl_arc1_pk_ec079e6df825234f?version=active',
    sha256: '5c2ad229dc6495b757eb78b5eb65147309a3d6e75e9416ab9c81cbb303382046',
    bytes: 7693,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/oo/classes/zcl_arc1_pk_ec079e6df825234f/source/main?version=active',
    sha256: 'ba3477dffa104340241ff7956a0d802ca0e7ef6d1c598a14a1c089b4cb9cebe8',
    bytes: 215,
    accept: 'text/plain',
  },
  {
    path: '/sap/bc/adt/cts/transportrequests/A4HK906611',
    sha256: '35beb34d4855826a1b0bdf00a55b64bb60afd873ef5c2b720ec69931ba5eba4a',
    bytes: 11693,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/apireleases/%2Fsap%2Fbc%2Fadt%2Foo%2Fclasses%2Fzcl_arc1_pk_ec079e6df825234f',
    sha256: '66b397fba28e56b4e92e39ebd24a304ad73621b2f2f426839adbc6e267101267',
    bytes: 5103,
    accept: 'application/vnd.sap.adt.apirelease.v10+xml',
  },
] as const;
export const PACKAGE_API_MOVED_PROFILE = {
  ...packageApiIntent(PACKAGE_API_RETAINED_GRAPH),
  stages: PACKAGE_API_MOVED_STAGES,
  previouslyCompleted: PACKAGE_API_MOVED_COMPLETED,
  observedRetainedWrites: PACKAGE_API_MOVED_OBSERVED,
  retainedPair: PACKAGE_API_MOVED_PAIR,
  currentClassPackage: 'ZARC1_DEMO',
  history: PACKAGE_API_MOVED_HISTORY,
  reads: PACKAGE_API_MOVED_READS,
};
