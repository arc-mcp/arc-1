import { qualify as deletion } from './deletion-qualification.mjs';
import { qualify as formatter } from './formatter-qualification.mjs';
export async function qualify(context) {
  if (context.action.plan === 'formatter-two-user-v2' && context.action.restoreOnly === true) return formatter(context);
  return deletion({
    ...context,
    formatterQualifier: async ({ sessions, sentinels }) =>
      formatter({ ...context, sessions, sentinels, action: { plan: 'formatter-two-user-v2' } }),
  });
}
