/** This fixed cleanup owns only the retained DDLS from the consumed 8135 v3 attempt. */
import { declarativeV2Fixtures } from './native-declarative-fixtures.js';
export const V3_RECOVERY = 'pr1142-native-declarative-v3-recovery-v1';
export const V3_FAILED_REVISION = '8135cea8e7ff550964260b22009c980e477a2a10';
export const v3RecoveryFixtures = declarativeV2Fixtures('F4C656905A65AA61');
export const v3RecoveryFixture = v3RecoveryFixtures[0];
export const v3OriginalHashes = Object.freeze({
  intent: 'baf30e8af101a55265af39e4a68d8071e019f1f60f7ba5c57da55452f4933852',
  manifest: '1c27ee243e21b5a36d467f47f8a7cfde1b2d7780160cb1bdb77aac9c5e4347ef',
  result: '3b448b37cd7fbfeaf6aa6710fdae756f1af90bc15c156738ca1182f0d5a9408d',
  journal: '6ddb88daed1699b7c48f975144a056e476048fd1d2974aafbfac9fe44b9fb2b8',
});
export const v3RetainedHashes = Object.freeze({
  inactiveMetadata: '644bbdf3f165b7fca9bdbd978514cd73cc456b3387b4b1667eaff520a0e45b62',
  activeMetadata: 'dd659304ea1581e4bf3e8d71d1b9579df0865750dc625204da649fda4c26e080',
  inactiveSource: '06b0b8832019beef3310cf3b4e3d05d908a191c7aac67be5eb892f32fa4b2d5f',
  activeSource: '62e1dfa3ccbfc456e91338019fbb2e03c25c2a595de264e3dc23742e4c6c2a8a',
});
