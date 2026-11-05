/** Compiled continuation of the consumed aec9 prefix; never operator-selected resume. */
import { PACKAGE_API_STAGES, packageApiIntent, packageApiOwners } from './native-package-api-profile.js';
import { packageFixtures } from './native-package-fixtures.js';
export const PACKAGE_API_RETAINED_PROTOCOL = 'pr1142-native-package-api-retained-v1';
export const PACKAGE_API_RETAINED_GRAPH = packageFixtures('EC079E6DF825234F');
export const PACKAGE_API_RETAINED_COMPLETED = PACKAGE_API_STAGES.slice(0, 4);
export const PACKAGE_API_RETAINED_STAGES = PACKAGE_API_STAGES.slice(4);
export const PACKAGE_API_RETAINED_PAIR = {
  request: 'A4HK906609',
  task: 'A4HK906610',
  targetReceipt: '5bff080e76997f9b06d71579da3b267e9f19920fcc0f2b422ccbd13300f07f73',
  initialRequestHash: '272ec5d0bafd691f6ca3155bf9c71836cd3d1b1ed7ec107e60edc6b59b0419cf',
} as const;
export const PACKAGE_API_RETAINED_HISTORY = {
  report: '442b6705092a753547412fe9af3800f004dea76c9abd493e2c5b39fccad28f03',
  ledger: '7179c88b99b1640f750ce7f18777a9a045b39ea8797ae6bcef33c6f3356094c2',
  intent: '418da24786fa02945a5f0bae1d16b189c9cfb8e5e9cd71fc996cf38f7efed0d2',
  result: '119f24dc29ddd7e0e22e71525ebb984501c09bc2229d5a71faae234a6b37103a',
} as const;
export const PACKAGE_API_RETAINED_READS = [
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
    sha256: '701f211435d8a6a203bcec8c0f150b58a8e835c571cb1dd01b3740ea6babe1cd',
    bytes: 7729,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/cts/transportrequests/A4HK906609',
    sha256: '272ec5d0bafd691f6ca3155bf9c71836cd3d1b1ed7ec107e60edc6b59b0419cf',
    bytes: 10626,
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
    sha256: '701f211435d8a6a203bcec8c0f150b58a8e835c571cb1dd01b3740ea6babe1cd',
    bytes: 7729,
    accept: 'application/*',
  },
  {
    path: '/sap/bc/adt/oo/classes/zcl_arc1_pk_ec079e6df825234f/source/main?version=active',
    sha256: 'ba3477dffa104340241ff7956a0d802ca0e7ef6d1c598a14a1c089b4cb9cebe8',
    bytes: 215,
    accept: 'text/plain',
  },
] as const;
export const PACKAGE_API_RETAINED_PROFILE = {
  ...packageApiIntent(PACKAGE_API_RETAINED_GRAPH),
  stages: PACKAGE_API_RETAINED_STAGES,
  previouslyCompleted: PACKAGE_API_RETAINED_COMPLETED,
  retainedOwners: packageApiOwners(PACKAGE_API_RETAINED_GRAPH).map((o) => o.owner),
  retainedPair: PACKAGE_API_RETAINED_PAIR,
  history: PACKAGE_API_RETAINED_HISTORY,
  reads: PACKAGE_API_RETAINED_READS,
  repeatNegative: 'definitive-native-400-PAK051-only-after-fresh-four-owner-proof',
};
