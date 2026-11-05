/** Concise pinned-only guidance; ordinary tool definitions and validation constraints remain unchanged. */
const write: Record<string, string> = {
  name: 'Exact native owner name.',
  source:
    'Full source for create/update; method body for edit_method; full FORM/MODULE for unit surgery; METHODS clause for signature edits. Class definition edits replace only DEFINITION, or the full selected include. SKTD merges "## <node>" sections from the read node index; unknown node headings refuse.',
  method:
    'Method name; qualify ambiguous local methods as <class>~<method>. add_method instead takes the complete METHODS clause.',
  visibility: 'Target visibility. add_method defaults public; moving a method requires an existing target section.',
  abstract: 'Optional assertion matching ABSTRACT in the METHODS clause; concrete methods receive a stub.',
  bdefName: 'RAP interface BDEF. Required for scaffold; generation otherwise reads the class rootEntityRef.',
  autoApply: 'RAP scaffold: false previews; true saves missing signatures/stubs under one owning lock.',
  targetAlias: 'Optional case-insensitive RAP entity alias; omission selects all declared entities.',
  activate: 'RAP generation: true (default) activates; false saves inactive. Inspect activation outcome.',
  activateAtEnd:
    'Batch: false activates each in order; true activates the written subset together, including after a later write failure.',
  dryRun: 'Preview RAP generation or SKTD changes without saving/activation.',
  description: 'Native description; normally at most 60 characters.',
  package: 'Creation package; defaults $TMP. Transportable objects require an allowed request/task.',
  transport: 'Native recording request/task; both request policies apply. Omit for local objects.',
  group: 'FUNC: containing FUGR. INCL: structural parent FUGR; omit for standalone includes.',
  odataVersion: 'SRVB protocol; default V2. Unsupported native variants refuse.',
  category: 'SRVB category: 0=UI (default), 1=Web API.',
  refObjectType: 'SKTD create: supported exact parent ADT type/subtype, e.g. DDLS/DF. ABAP Doc owners are excluded.',
  refObjectName: 'SKTD parent name; defaults to name.',
  objects:
    'Ordered create inputs; dependencies first. Per-item package/transport overrides defaults. See activateAtEnd.',
};
function withoutDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutDescriptions);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => key !== 'description' || typeof item !== 'string')
      .map(([key, item]) => [key, withoutDescriptions(item)]),
  );
}
export function compactPinnedWriteFields(properties: Record<string, unknown>) {
  for (const [key, description] of Object.entries(write))
    if (properties[key]) properties[key] = { ...(properties[key] as object), description };
  // These native metadata fields describe themselves; preserve their types/constraints, omit repeated labels.
  for (const key of [
    'length',
    'decimals',
    'outputLength',
    'conversionExit',
    'signExists',
    'lowercase',
    'valueTable',
    'shortLabel',
    'mediumLabel',
    'longLabel',
    'headingLabel',
    'searchHelp',
    'searchHelpParameter',
    'setGetParameter',
    'defaultComponentName',
    'changeDocument',
    'description',
    'name',
  ]) {
    if (!properties[key]) continue;
    const { description: _description, ...field } = properties[key] as Record<string, unknown>;
    properties[key] = field;
  }
  if (properties.objects) {
    const objects = properties.objects as Record<string, unknown>;
    // Item fields mirror their documented top-level fields; avoid repeating all DDIC/FUNC prose.
    properties.objects = { ...objects, items: withoutDescriptions(objects.items) };
  }
}

const manage: Record<string, string> = {
  name: 'Exact package/API-state owner name.',
  responsible: 'Existing internal SAP user, max 12 characters; email refused. Supply explicitly for PP.',
  recordChanges: 'Recording flag. Default true outside literal LOCAL or with a transport layer; otherwise false.',
  transport: 'Native recording request/task; both request policies apply.',
  objectType: 'Exact ADT type/subtype for change_package.',
  contract: 'API contract, default C1 (SRVD C0). SAP validates supported contracts.',
  catalogId: 'Classic catalog ID or domain ID; required for catalog/tile operations.',
};
export function compactPinnedManagementFields(tool: string, properties: Record<string, unknown>) {
  const descriptions =
    tool === 'SAPManage'
      ? manage
      : tool === 'SAPTransport'
        ? {
            summary:
              'Default true: list headers/counts; false includes objects. Diff true omits hunks, with the same native reads.',
          }
        : {};
  for (const [key, description] of Object.entries(descriptions))
    if (properties[key]) properties[key] = { ...(properties[key] as object), description };
}
