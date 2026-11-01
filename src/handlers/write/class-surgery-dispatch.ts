/** One action dispatch for the shared class-edit algorithms; admission remains at the caller. */
import { errorResult, type ToolResult } from '../shared.js';
import {
  writeActionAddMethod,
  writeActionChangeMethodVisibility,
  writeActionDeleteMethod,
  writeActionEditClassDefinition,
  writeActionEditMethod,
  writeActionEditMethodSignature,
} from './class-surgery.js';
import type { SapWriteContext } from './context.js';

export function dispatchClassSurgery(ctx: SapWriteContext): Promise<ToolResult> {
  switch (ctx.args.action) {
    case 'edit_method':
      return writeActionEditMethod(ctx);
    case 'edit_class_definition':
      return writeActionEditClassDefinition(ctx);
    case 'edit_method_signature':
      return writeActionEditMethodSignature(ctx);
    case 'add_method':
      return writeActionAddMethod(ctx);
    case 'delete_method':
      return writeActionDeleteMethod(ctx);
    case 'change_method_visibility':
      return writeActionChangeMethodVisibility(ctx);
    default:
      return Promise.resolve(errorResult('Unsupported class surgery action.'));
  }
}
