/** Offline presentation-config generator. Never inspects credentials, writes settings, or contacts SAP. */
import { type Command, Option } from 'commander';
import { SAP_SYSID_PATTERN, targetFromPinnedMcpPath } from './server/multi-target-identity.js';

export interface IdeSetupOptions {
  client: 'eclipse' | 'claude';
  editor?: 'off' | 'eclipse';
  endpoint?: string;
  systemId?: string;
}

export function buildIdeConfigFragment(options: IdeSetupOptions): Record<string, unknown> {
  const editor = options.editor ?? (options.client === 'claude' ? 'off' : options.client);
  if (!['eclipse', 'claude'].includes(options.client) || !['off', 'eclipse'].includes(editor)) {
    throw new Error('Choose a supported client and editor.');
  }
  if (editor !== 'eclipse' && options.systemId) throw new Error('--system-id is only for Eclipse links.');
  if (!options.endpoint) {
    if (editor === 'eclipse' && !SAP_SYSID_PATTERN.test(options.systemId ?? '')) {
      throw new Error('Provide --system-id with the real three-character SAP SID.');
    }
    return {
      env: {
        ARC1_IDE_LINKS: editor,
        ARC1_IDE_SYSTEM_ID: editor === 'eclipse' ? options.systemId : '',
      },
    };
  }
  if (editor === 'off') {
    throw new Error(
      'HTTP links are off when the MCP entry sends no Arc1-Ide-* headers; remove them if present. To enable links, pass --editor eclipse.',
    );
  }
  if (options.systemId) throw new Error('For HTTP, the server supplies the SAP SID; do not set --system-id here.');
  let endpoint: URL;
  try {
    endpoint = new URL(options.endpoint);
  } catch {
    throw new Error('Provide an absolute HTTP(S) MCP endpoint.');
  }
  if (
    !['https:', 'http:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error('Use an HTTP(S) MCP endpoint without credentials, query, or fragment.');
  }
  const target = targetFromPinnedMcpPath(endpoint.pathname);
  if (!target && endpoint.pathname !== '/mcp' && endpoint.pathname !== '/multi/mcp') {
    throw new Error('Expected /mcp, /<target>/<client>/mcp, or /multi/mcp.');
  }
  const headers: Record<string, string> = { 'Arc1-Ide-Client': editor };
  return options.client === 'eclipse' ? { requestInit: { headers } } : { headers };
}

export function registerIdeConfigCommand(parent: Command): void {
  parent
    .command('ide')
    .description('Print an Eclipse link preference fragment to merge into one existing MCP server entry (offline)')
    .addOption(
      new Option('--mcp-client <client>', 'MCP client configuration format')
        .choices(['eclipse', 'claude'])
        .default('eclipse'),
    )
    .addOption(
      new Option('--editor <editor>', 'Link style (default: client editor; Claude: off)').choices(['off', 'eclipse']),
    )
    .option('--endpoint <url>', 'Existing HTTP MCP URL; omit for local stdio')
    .option('--system-id <sid>', 'Real SAP SID for local Eclipse navigation')
    .action((options: Omit<IdeSetupOptions, 'client'> & { mcpClient: IdeSetupOptions['client'] }, command: Command) => {
      if (command.optsWithGlobals().client !== undefined) {
        throw new Error('--client is the SAP logon client; use --mcp-client to select the MCP client format.');
      }
      const fragment = buildIdeConfigFragment({ ...options, client: options.mcpClient });
      console.error(
        'Merge this fragment into that client’s existing MCP server entry; preserve its connection and authentication settings.',
      );
      if (options.endpoint)
        console.error(
          'Server prerequisite: ARC1_IDE_LINKS=eclipse. Single-target deployments also need the configured SAP SID; multi-target destinations already supply it. /mcp requires traditional single-target mode.',
        );
      console.log(JSON.stringify(fragment, null, 2));
    });
}
