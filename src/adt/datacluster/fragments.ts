/**
 * Reassembles the database rows of a cluster table into the one byte stream
 * `parseCluster` reads.
 *
 * Ported from vibing-steampunk's `pkg/datacluster/fragments.go` (same MIT
 * license, same original author); `ReadExport` (CSV/SE16-export ingestion)
 * is not ported — ARC-1 reads cluster tables live, not from an export file.
 */

/** One database row of a cluster table: the SRTF2 sequence number, the CLUSTR byte count valid in this row, and the CLUSTD bytes. */
export interface Fragment {
  seq: number;
  length: number;
  data: Buffer;
}

/**
 * Joins the fragments of one cluster key back into one stream: sorted by sequence, each trimmed
 * to the length its row declares. The last row of a cluster is normally the only one shorter than
 * the column; the others are zero-padded on the database and that padding must go.
 */
export function joinFragments(fragments: Fragment[]): Buffer {
  if (fragments.length === 0) throw new Error('datacluster: no fragments');
  const sorted = [...fragments].sort((a, b) => a.seq - b.seq);
  const parts: Buffer[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i]!;
    if (i > 0 && f.seq === sorted[i - 1]!.seq) {
      throw new Error(`datacluster: fragment ${f.seq} appears twice`);
    }
    if (f.seq !== i) {
      throw new Error(`datacluster: fragment ${i} is missing`);
    }
    const n = f.length > 0 && f.length <= f.data.length ? f.length : f.data.length;
    parts.push(f.data.subarray(0, n));
  }
  return Buffer.concat(parts);
}

/** Accepts the CLUSTD column as the data preview and table reads deliver it: upper- or lower-case hex, possibly with whitespace. */
export function decodeHex(s: string): Buffer {
  const cleaned = s.replace(/[\s]/g, '');
  if (cleaned.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(cleaned)) {
    throw new Error('datacluster: CLUSTD is not hex');
  }
  return Buffer.from(cleaned, 'hex');
}
