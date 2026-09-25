/**
 * What a caller asks to be laid over a cluster's objects:
 *
 *   applog                                  BAL_S_MSG over BALDAT buckets (the messages)
 *   stxl                                    TLINE over STXL, rendered as text
 *   ZDEMO_S_HEADER                          one DDIC structure over every object
 *   HDR=ZDEMO_S_HEADER,ITEMS=ZDEMO_S_ITEM   a structure per object name
 *
 * Ported from vibing-steampunk's `pkg/adt/cluster_layout.go` (same MIT
 * license, same original author).
 */

import type { AdtClient } from './client.js';
import { applyLayout, type Cluster, type Layout, TLINE_LAYOUT } from './datacluster/index.js';
import { structureLayout } from './ddic-layout.js';

/** The two layouts that are not DDIC structures. */
export const LAYOUT_APPLOG = 'APPLOG';
export const LAYOUT_STXL = 'STXL';

export interface LayoutSpec {
  /** The structure for every object not named in `byObject`. */
  default?: string;
  /** Maps an object name (as the EXPORT named it) to a structure. */
  byObject: Map<string, string>;
}

/** Reads a `layout`/`--layout` argument. */
export function parseLayoutSpec(s: string): LayoutSpec {
  const spec: LayoutSpec = { byObject: new Map() };
  for (const partRaw of s.split(',')) {
    const part = partRaw.trim();
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq < 0) {
      if (spec.default) throw new Error(`layout "${s}" names two defaults, ${spec.default} and ${part}`);
      spec.default = part.toUpperCase();
      continue;
    }
    const obj = part.slice(0, eq).trim().toUpperCase();
    const name = part
      .slice(eq + 1)
      .trim()
      .toUpperCase();
    if (!obj || !name) throw new Error(`layout "${part}": expected OBJECT=STRUCTURE`);
    spec.byObject.set(obj, name);
  }
  return spec;
}

/** Reports whether nothing was asked for. */
export function layoutSpecEmpty(s: LayoutSpec): boolean {
  return !s.default && s.byObject.size === 0;
}

/** The special layout in force for the whole cluster, or undefined. */
export function layoutSpecMode(s: LayoutSpec): string | undefined {
  return s.default === LAYOUT_APPLOG || s.default === LAYOUT_STXL ? s.default : undefined;
}

/** Returns the structure asked for an object, or undefined. */
export function layoutSpecFor(s: LayoutSpec, object: string): string | undefined {
  const byObj = s.byObject.get(object.toUpperCase());
  if (byObj) return byObj;
  if (layoutSpecMode(s)) return undefined;
  return s.default;
}

/** Fetches DDIC layouts once each (and their failures) and lays them over objects. */
export class LayoutResolver {
  private readonly layouts = new Map<string, Layout>();
  private readonly errors = new Map<string, Error>();

  constructor(private readonly client: AdtClient | undefined) {}

  /** Returns the DDIC layout for a structure name. */
  async layout(nameIn: string): Promise<Layout> {
    const name = nameIn.trim().toUpperCase();
    if (name === 'TLINE') return TLINE_LAYOUT;
    const cached = this.layouts.get(name);
    if (cached) return cached;
    const cachedErr = this.errors.get(name);
    if (cachedErr) throw cachedErr;
    if (!this.client) {
      const err = new Error(`layout ${name} needs a system to read DD03L from`);
      this.errors.set(name, err);
      throw err;
    }
    try {
      const l = await structureLayout(this.client, name);
      this.layouts.set(name, l);
      return l;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.errors.set(name, e);
      throw e;
    }
  }

  /** Lays the spec's structures over every object of the cluster it names. Objects that do not fit keep their numbered fields; each failure becomes one note that says which object and why. */
  async apply(c: Cluster, spec: LayoutSpec): Promise<string[]> {
    const notes: string[] = [];
    for (const obj of c.objects) {
      const name = layoutSpecFor(spec, obj.name);
      if (!name) continue;
      let l: Layout;
      try {
        l = await this.layout(name);
      } catch (err) {
        notes.push(`${obj.name}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      try {
        applyLayout(obj, l);
      } catch (err) {
        notes.push(err instanceof Error ? err.message : String(err));
      }
    }
    return notes;
  }
}
