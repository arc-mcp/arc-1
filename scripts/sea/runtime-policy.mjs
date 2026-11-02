/** Patched Node floors for standalone builds; each supported line needs a native build/smoke qualification. */
const MIN_VERSIONS = { 22: [23, 4], 24: [22, 1], 26: [12, 1] };
export const SEA_NODE_VERSION_PREFIX = 'ARC1_NODE_VERSION=';

export function assertSeaNodeVersion(version) {
  const match = /^([1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  const parts = match ? match.slice(1).map(Number) : [];
  const [major, minor, patch] = parts;
  const floor = MIN_VERSIONS[major];
  if (!floor || parts.some((part) => !Number.isSafeInteger(part)) || minor < floor[0] || (minor === floor[0] && patch < floor[1])) {
    throw new Error(`Unsupported SEA Node version ${version}. Use Node 22.23.4+, 24.22.1+ or 26.12.1+ on those major lines.`);
  }
}

export function parseSeaVersionOutput(output, expectedArcVersion) {
  const lines = output.trim().split(/\r?\n/);
  if (lines.length !== 2 || !lines[0].startsWith(SEA_NODE_VERSION_PREFIX) || lines[1] !== expectedArcVersion) {
    throw new Error('Expected exactly the Node runtime probe and the ARC-1 --version output.');
  }
  const nodeVersion = lines[0].slice(SEA_NODE_VERSION_PREFIX.length);
  assertSeaNodeVersion(nodeVersion);
  return nodeVersion;
}
