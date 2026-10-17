import { createHash } from 'node:crypto';
import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const value = z.string().max(64 * 1024);
const assertion = z.object({ sql: value, column: z.string().min(1).max(128), equals: z.string().max(1000) }).strict();
export const notebookSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().max(200),
    cells: z
      .array(
        z.discriminatedUnion('kind', [
          z.object({ id, kind: z.literal('markdown'), value }).passthrough(),
          z
            .object({
              id,
              kind: z.literal('sql'),
              value,
              target: id,
              maxRows: z.number().int().min(1).max(10_000),
              assertion: assertion.optional(),
            })
            .passthrough(),
        ]),
      )
      .max(50),
  })
  .passthrough()
  .superRefine((notebook, ctx) => {
    if (new Set(notebook.cells.map((c) => c.id)).size !== notebook.cells.length)
      ctx.addIssue({ code: 'custom', message: 'Cell IDs must be unique.' });
  });
export type SqlNotebook = z.infer<typeof notebookSchema>;
/** Observed SAP 1.2 serialization only. Import is pure: destinations must be mapped explicitly. */
export function importAbapSql(input: unknown, destinationMap: Record<string, string>): SqlNotebook {
  assertNotebookSize(input);
  const source = z
    .object({
      cells: z
        .array(
          z
            .object({
              kind: z.enum(['markdown', 'sql']),
              value: z.string(),
              destination: z.string().optional(),
              rowNumber: z.number().optional(),
            })
            .passthrough(),
        )
        .max(50),
    })
    .passthrough()
    .parse(input);
  const { cells, ...imported } = source;
  const document = notebookSchema.parse({
    schemaVersion: 1,
    title: 'Imported ABAP SQL notebook',
    imported,
    cells: cells.map((cell, index) => {
      const cellId = `cell-${index + 1}-${createHash('sha256').update(cell.value).digest('hex').slice(0, 8)}`;
      const { kind, value, ...metadata } = cell;
      if (kind === 'markdown') return { id: cellId, kind, value, imported: metadata };
      const target =
        cell.destination && Object.hasOwn(destinationMap, cell.destination)
          ? destinationMap[cell.destination]
          : undefined;
      if (!target)
        throw new Error(`Explicit target mapping required for destination ${cell.destination ?? '(missing)'}.`);
      return {
        id: cellId,
        kind,
        value,
        target,
        maxRows: Math.min(10_000, Math.max(1, cell.rowNumber ?? 100)),
        imported: metadata,
      };
    }),
  });
  assertNotebookSize(document);
  return document;
}

export const MAX_NOTEBOOK_BYTES = 1024 * 1024;
/** Bound unknown imported fields too; they are preserved data, never executable configuration. */
export function assertNotebookSize(input: unknown): void {
  const json = JSON.stringify(input);
  if (!json || Buffer.byteLength(json) > MAX_NOTEBOOK_BYTES)
    throw new Error('Notebook input exceeds 1 MiB or is not JSON.');
}
