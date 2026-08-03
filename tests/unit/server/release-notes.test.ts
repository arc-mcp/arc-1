import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * The annotated release notes (docs_page/release-notes.md) are the human/LLM-readable companion
 * to the release-please CHANGELOG.md. This guard is the forcing function: a released version that
 * never got annotated fails CI instead of silently rotting.
 *
 * Annotate ahead of the release (while the release-please PR is open) to keep main green — this
 * test only requires CHANGELOG ⊆ release notes, never the other way round.
 */

const CHANGELOG_PATH = 'CHANGELOG.md';
const NOTES_PATH = 'docs_page/release-notes.md';

/** Same helper as release-sbom-workflow.test.ts — a GitHub expression is not a JS template. */
const githubExpression = (expression: string): string => `\${{ ${expression} }}`;

/** `## [1.0.0](...compare...)` — the release-please version heading. */
const releasedVersions = (changelog: string): string[] =>
  [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((match) => match[1]);

/**
 * A version counts as annotated only where the page actually documents it: its own heading
 * (`## 1.0.0 — …`) or the leading cell of a summary-table row (`| 0.8.0 | date | … |`).
 * A passing mention in prose is not annotation, and a bare substring search would match
 * 0.9.2 inside 0.9.27.
 */
const isAnnotated = (notes: string, version: string): boolean => {
  const literal = version.replace(/\./g, String.raw`\.`);
  return new RegExp(String.raw`^(?:#{2,3} ${literal}(?![\d.])|\| ?${literal} ?\|)`, 'm').test(notes);
};

describe('annotated release notes', () => {
  it('annotate every released version from CHANGELOG.md', async () => {
    const [changelog, notes] = await Promise.all([readFile(CHANGELOG_PATH, 'utf8'), readFile(NOTES_PATH, 'utf8')]);

    const versions = releasedVersions(changelog);
    expect(versions.length).toBeGreaterThan(0);

    const missing = versions.filter((version) => !isAnnotated(notes, version));
    expect(
      missing,
      `Unannotated releases in ${NOTES_PATH}: ${missing.join(', ')}. Run the /release-notes command to write them.`,
    ).toEqual([]);
  });

  it('stay reachable from the docs nav and the raw changelog', async () => {
    const [mkdocs, changelog] = await Promise.all([readFile('mkdocs.yml', 'utf8'), readFile(CHANGELOG_PATH, 'utf8')]);

    expect(mkdocs).toContain('release-notes.md');
    // release-please inserts new entries below any prose that precedes the first version heading,
    // so this pointer survives every release (googleapis/release-please src/updaters/changelog.ts).
    expect(changelog.slice(0, changelog.indexOf('## ['))).toContain('release-notes');
  });

  it('link the published notes from the GitHub Release, best-effort', async () => {
    const workflow = parse(await readFile('.github/workflows/release.yml', 'utf8')) as {
      jobs: Record<
        string,
        { needs?: string[]; if?: string; 'continue-on-error'?: boolean; permissions?: Record<string, string> }
      >;
    };

    const job = workflow.jobs['link-release-notes'];
    expect(job.needs).toEqual(['release-please']);
    expect(job.if).toBe(githubExpression('needs.release-please.outputs.release_created'));
    // Documentation polish must never fail an artifact release.
    expect(job['continue-on-error']).toBe(true);
    expect(job.permissions).toEqual({ contents: 'write' });
  });
});
