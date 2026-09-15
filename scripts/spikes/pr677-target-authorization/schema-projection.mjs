/** Independent oracle for the accepted aggregate schema contract, not values derived from responses.
 * Runtime counterparts: multi-target-tools.ts injectTargetSchema/targetSchema and
 * multi-target-identity.ts TARGET_ID_PATTERN; spec § aggregate edge cases (0, 1–16, 17–256).
 */
export const EXPECTED_LARGE_TARGET_PATTERN = '^[A-Z][A-Z0-9-]{1,30}[A-Z0-9]\\/[0-9]{3}$';

export function checkTargetSchemaProjection(tools, expectedTargets, record, prefix = 'aggregate') {
  if (!Array.isArray(tools)) {
    record(`${prefix}.target_schema.tools_array`, false);
    return;
  }
  const operational = tools.filter((tool) => tool?.name !== 'SAPTargets');
  if (expectedTargets.length === 0) {
    record(`${prefix}.target_schema.zero_operational_tools`, operational.length === 0, {
      actualCount: operational.length,
    });
  }
  for (const [index, tool] of operational.entries()) {
    const test = `${prefix}.target_schema.tool_${index}`;
    const schema = tool?.inputSchema;
    const target = schema?.properties?.target;
    const object = target !== null && typeof target === 'object' && !Array.isArray(target);
    record(`${test}.required`, Array.isArray(schema?.required) && schema.required.includes('target'));
    record(`${test}.string_property`, object && target.type === 'string');
    if (expectedTargets.length === 0) {
      // Empty enums must never be emitted: the entire operational tool must be absent.
      record(`${test}.unexpected_zero_grant_tool`, false);
      continue;
    }
    if (expectedTargets.length <= 16) {
      const values = object && Array.isArray(target.enum) ? target.enum : undefined;
      record(
        `${test}.exact_enum`,
        !!values &&
          values.length === expectedTargets.length &&
          values.every((value) => typeof value === 'string') &&
          new Set(values).size === expectedTargets.length &&
          expectedTargets.every((value) => values.includes(value)),
      );
      record(
        `${test}.enum_shape`,
        object &&
          !Object.hasOwn(target, 'pattern') &&
          Object.keys(target).every((key) => ['type', 'description', 'enum'].includes(key)),
      );
    } else {
      record(`${test}.canonical_pattern`, object && target.pattern === EXPECTED_LARGE_TARGET_PATTERN);
      record(
        `${test}.pattern_shape`,
        object &&
          !Object.hasOwn(target, 'enum') &&
          Object.keys(target).every((key) => ['type', 'description', 'pattern'].includes(key)),
      );
    }
  }
  for (const [index, tool] of tools.filter((tool) => tool?.name === 'SAPTargets').entries()) {
    record(
      `${prefix}.target_schema.catalog_${index}.no_target_selector`,
      !Object.hasOwn(tool.inputSchema?.properties ?? {}, 'target') &&
        !(Array.isArray(tool.inputSchema?.required) && tool.inputSchema.required.includes('target')),
    );
  }
}
