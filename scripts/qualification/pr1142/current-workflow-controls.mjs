import { lstat, readFile } from 'node:fs/promises';
import { requireEvidence, sha } from './current-workflow-contract.mjs';
import { privateJson } from './safe-io.mjs';

/** Operator-supplied visual evidence, not a server-side global lock assertion. */
export async function readCurrentControls(
  root,
  manifest,
  manifestHash,
  run,
  read = privateJson,
  bytes = readFile,
  stat = lstat,
  requireFresh = true,
) {
  const receipt = await read(`${root}/current-baseline.json`);
  requireEvidence(
    receipt.version === 1 &&
      receipt.runId === run.runId &&
      receipt.sourceRevision === run.sourceRevision &&
      receipt.manifestSha256 === manifestHash &&
      receipt.client === '001' &&
      receipt.table === '*' &&
      receipt.inspectedByOperator === true &&
      Array.isArray(receipt.images) &&
      receipt.images.length === 3,
    'CURRENT_BASELINE_REQUIRED',
  );
  const expected = [
    { file: 'sm12-suffix.jpg', user: '*', argument: `*${manifest.marker.slice(0, 12)}*` },
    ...manifest.actors
      .filter((a) => a.write)
      .map((a) => ({ file: `sm12-${a.label}.jpg`, user: a.sapUser, argument: '*' })),
  ];
  let freshUntil = Infinity;
  for (const item of expected) {
    const matches = receipt.images.filter((entry) => entry.file === item.file);
    requireEvidence(matches.length === 1, 'CONTROL_IMAGE_IDENTITY');
    const row = matches[0],
      path = `${root}/${item.file}`;
    const observedAt = Date.parse(row.observedAt);
    requireEvidence(
      row.user === item.user &&
        row.argument === item.argument &&
        row.count === 0 &&
        row.complete === true &&
        row.error === false &&
        observedAt >= Date.parse(run.preparedAt) &&
        observedAt <= Date.now(),
      'CONTROL_FILTER_OR_CHRONOLOGY',
    );
    const info = await stat(path);
    requireEvidence(
      info.isFile() &&
        !info.isSymbolicLink() &&
        info.uid === process.getuid() &&
        (info.mode & 0o077) === 0 &&
        info.size >= 4 &&
        info.size <= 4 * 1024 * 1024,
      'CONTROL_IMAGE_PRIVATE_JPEG',
    );
    const image = await bytes(path);
    requireEvidence(
      image[0] === 255 && image[1] === 216 && image.at(-2) === 255 && image.at(-1) === 217 && sha(image) === row.sha256,
      'CONTROL_IMAGE_HASH_OR_TYPE',
    );
    freshUntil = Math.min(freshUntil, observedAt + 300_000);
  }
  requireEvidence(!requireFresh || Date.now() < freshUntil, 'CURRENT_BASELINE_EXPIRED');
  return { sha256: sha(receipt), freshUntil, receipt };
}
