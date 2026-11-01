/** Class metadata facet over the shared source-edit lifecycle. */
import { verifiedClassStructure } from '../../adt/class-structure-evidence.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { checkOperation, OperationType } from '../../adt/safety.js';
import type { ClassStructure } from '../../adt/types.js';
import { parseClassStructure } from '../../adt/xml-parser.js';
import type { ToolResult } from '../shared.js';
import type { SapWriteContext } from './context.js';
import { pinnedSourceState } from './pinned-source-context.js';
import { type SourceEdit, withSourceEdit } from './source-edit.js';

export interface ClassEdit extends SourceEdit {
  readMainAndStructure(): Promise<{ main: string; structure: ClassStructure }>;
}
export function withClassEdit(
  ctx: SapWriteContext,
  edit: (locked: ClassEdit) => Promise<ToolResult>,
): Promise<ToolResult> {
  return withSourceEdit(
    ctx,
    (locked) =>
      edit({
        ...locked,
        async readMainAndStructure() {
          const state = ctx.mutationContext.mode === 'pinned-pp' ? pinnedSourceState(ctx) : undefined;
          if (state?.include || ctx.type !== 'CLAS')
            throw new AdtSafetyError('Native class metadata selects class main source only.');
          const main = await locked.read(ctx.srcUrl);
          if (state) state.phase = 'structure-read';
          checkOperation(ctx.client.safety, OperationType.Read, 'GetClassStructure');
          const metadata = await locked.http.get(`${ctx.objectUrl}/objectstructure`, { 'Cache-Control': 'no-cache' });
          const structure = state
            ? verifiedClassStructure(metadata.body, main, ctx.name, ctx.objectUrl, ctx.client.sapClient)
            : parseClassStructure(metadata.body, ctx.name);
          if (state) state.phase = 'edit-preparation';
          return { main, structure };
        },
      }),
    'warn',
  );
}
