/** One new ST05-only claim; the three completed representatives and consumed refusal remain historical. */
import { runtimeRetainedV2History } from './native-runtime-retained-v2-fixed.js';
export const RUNTIME_ST05_PROTOCOL = 'pr1142-native-st05-retained-v1';
export const runtimeSt05History = Object.freeze({
  originalProtocol: 'pr1142-native-runtime-flp-retained-v2',
  originalRevision: 'a72c40eec6c767377e4b4ed747692f062ae4558f',
  originalIntentHash: '08bd629bbdd98a2f7cdfdaa455496dc2336f131554a18a20335471ce5cd676e5',
  results: {
    quickfix: '9b4a1d37a42a6eba21279e5addd9257b4d89e86c908c0d750fe745c2dee9f60a',
    profiler: '2e6e9fcb0a10b9366b1261cf9157556c330532ea4b8574f116ad2c1deba43835',
    'populated-flp': 'b4e33d21bc825a71a67c0c685122b4bb62f5b874c89c711c1b7c9e22fb1fc080',
    st05: 'b78de6049abf45468eade8b2337f7e57e7bae2ebba991b77a4877dc84ee44704',
  },
  baselineHash: 'ba61ebba34625dba104f1c4fca15b7d18f1b21d0b9a55fe5fe1af4118e6288b2',
  independentReportHash: '247cfbbc8e4f59a763e962c031afa95a9d1fcf3fd262b33de1aab656c2a9cccb',
  independentAuditHash: '78c83af83acd8c1a40f009ccc6f32369bfeb823073db559a8852a8bae24ed0f4',
  independentManifestHash: 'ac8ae5b7ecd11e8f4fe07b7023da43e9123c968c60fac999cde76dec4824fac0',
  operatorReportHash: '78f0940f66feb3737e30b84a1a0d9d06ff3b9de44dc3ff9cbe3293f13c1c27e6',
  operatorAuditHash: 'b4d526d67b8326f45a6abdac374d0151186b67dd665e13a8e97c0f430b8f0f1a',
  originalFileCount: 354,
  priorHistory: runtimeRetainedV2History,
});
