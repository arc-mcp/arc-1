/** Request-local contract shared by extension family adapters. No persistent identity/source cache. */
import { isActionDenied } from '../server/deny-actions.js';
import { logger } from '../server/logger.js';
import { DataResponseBudget } from './data-result-context.js';
import { AdtApiError, AdtResponseLimitError, AdtSafetyError } from './errors.js';
import { type AdtRequestOptions, type RequestDeadlineOptions, throwIfRequestCancelled } from './http-deadline.js';
import { AdtRequestBudgetError, RequestAttemptBudget } from './request-attempt-budget.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';

export type ExtensionMode = 'none' | 'summary' | 'sources';
export interface ExtensionIdentity {
  type: string;
  name: string;
  version: string;
}
export interface ExtensionRequest {
  root: ExtensionIdentity;
  /** Coverage belongs to this object/source, even when the returned base is filtered. */
  scope: string;
  context?: { type: 'PROG' | 'FUGR' | 'CLAS'; name: string };
}
export interface ExtensionProvider {
  id: string;
  family: string;
  status: 'returned' | 'not_advertised' | 'unsupported' | 'context_required' | 'denied' | 'incomplete';
  coverage: 'direct_identities' | 'selected_source' | 'bounded_traversal' | 'candidate_index';
  reason?: string;
  version?: string;
  scope?: string;
  nested?: 'not_expanded' | 'bounded';
}
export interface ExtensionNode extends ExtensionIdentity {
  provider: string;
  family: string;
  uri?: string;
  switch?: string;
  applicability?: 'unknown';
}
export interface ExtensionEdge {
  from: string;
  to: string;
  kind: string;
  /** Occurrences must not be deduplicated with their objects. */
  attribute?: string | null;
  suffix?: string;
  location?: string;
}
export interface ExtensionSource {
  identity: ExtensionIdentity;
  representation: 'authored_source' | 'rendered_plugin_source' | 'generated_include_revision';
  source: string;
  provider: string;
}
export type ExtensionOmission =
  | 'requests'
  | 'wire_bytes'
  | 'deadline'
  | 'nodes'
  | 'depth'
  | 'output'
  | 'sources'
  | 'candidates'
  | 'edges';
export interface ExtensionDiscoveryResult extends ExtensionRequest {
  mode: Exclude<ExtensionMode, 'none'>;
  providers: ExtensionProvider[];
  nodes: ExtensionNode[];
  edges: ExtensionEdge[];
  sources: ExtensionSource[];
  issues: string[];
  omissions: Partial<Record<ExtensionOmission, number>>;
  consumed: { sends: number; responseBytes: number; elapsedMs: number };
}
export type ExtensionAdapter = (session: ExtensionDiscoverySession, request: ExtensionRequest) => Promise<void>;

export const EXTENSION_LIMITS = {
  summary: { timeMs: 2000, sends: 6, responseBytes: 128 * 1024, nodes: 8, depth: 0, outputBytes: 2048 },
  sources: { timeMs: 12000, sends: 20, responseBytes: 256 * 1024, nodes: 20, depth: 5, outputBytes: 16 * 1024 },
} as const;

export class ExtensionProtocolError extends Error {}
class ExtensionStoppedError extends Error {}

export function extensionKey(identity: ExtensionIdentity): string {
  return `${identity.type.toUpperCase()}:${identity.name.toUpperCase()}:${identity.version}`;
}

/** Also used before mandatory hidden root reads whose optional-phase budget starts afterwards. */
export function assertExtensionReadAllowed(safety: SafetyConfig, type: string): void {
  if (isActionDenied('SAPRead', type, safety.denyActions ?? []))
    throw new AdtSafetyError(`SAPRead.${type} denied for extension discovery.`);
  checkOperation(safety, OperationType.Read, 'ExtensionDiscovery');
}

export class ExtensionDiscoverySession {
  readonly limits;
  readonly options: AdtRequestOptions;
  readonly result: ExtensionDiscoveryResult;
  readonly sourceCache = new Map<string, string>();
  stopped = false;
  private readonly started = Date.now();

  constructor(
    readonly mode: Exclude<ExtensionMode, 'none'>,
    readonly request: ExtensionRequest,
    private readonly safety: SafetyConfig,
    parent: RequestDeadlineOptions = {},
  ) {
    this.limits = EXTENSION_LIMITS[mode];
    this.options = {
      signal: parent.signal,
      deadline: Math.min(parent.deadline ?? Infinity, this.started + this.limits.timeMs),
      attemptBudget: new RequestAttemptBudget(this.limits.sends),
      responseBudget: new DataResponseBudget(this.limits.responseBytes, 'extension-discovery', true),
      retryTransientErrors: false,
      probe: true,
    };
    this.result = {
      ...request,
      mode,
      providers: [],
      nodes: [],
      edges: [],
      sources: [],
      issues: [],
      omissions: {},
      consumed: { sends: 0, responseBytes: 0, elapsedMs: 0 },
    };
  }

  omit(kind: ExtensionOmission, count = 1): void {
    this.result.omissions[kind] = (this.result.omissions[kind] ?? 0) + count;
  }

  /** Every hidden read, including raw metadata/relations, enters here with its SAPRead type. */
  async read<T>(type: string, operation: (options: AdtRequestOptions) => Promise<T>): Promise<T> {
    if (this.options.signal?.aborted) throwIfRequestCancelled(this.options);
    if (this.stopped) throw new ExtensionStoppedError();
    try {
      throwIfRequestCancelled(this.options);
      assertExtensionReadAllowed(this.safety, type);
      return await operation(this.options);
    } catch (error) {
      if (this.options.signal?.aborted) throw error;
      // A failed provider cannot turn into alternate-route evidence after these failures.
      if (
        error instanceof AdtSafetyError ||
        error instanceof AdtResponseLimitError ||
        error instanceof AdtRequestBudgetError ||
        error instanceof ExtensionProtocolError ||
        (error instanceof AdtApiError && [401, 403, 429].includes(error.statusCode)) ||
        Date.now() >= this.options.deadline! ||
        this.options.attemptBudget?.authorizationFailureObserved
      ) {
        this.stopped = true;
      }
      throw error;
    }
  }

  /** Adapters may use this boundary per provider to retain mixed-provider evidence. */
  async provider(provider: ExtensionProvider, operation: () => Promise<void>): Promise<void> {
    this.result.providers.push(provider);
    try {
      await operation();
    } catch (error) {
      if (this.options.signal?.aborted) throw error;
      if (error instanceof ExtensionProtocolError) this.stopped = true;
      provider.status =
        error instanceof AdtSafetyError || (error instanceof AdtApiError && [401, 403].includes(error.statusCode))
          ? 'denied'
          : 'incomplete';
      provider.reason = this.failureReason(error);
      if (!this.result.issues.includes(provider.reason)) this.result.issues.push(provider.reason);
    }
  }

  addNode(node: ExtensionNode, depth = 0): boolean {
    if (this.result.nodes.some((existing) => extensionKey(existing) === extensionKey(node))) return true;
    if (depth > this.limits.depth) {
      this.omit('depth');
      return false;
    }
    if (this.result.nodes.length >= this.limits.nodes) {
      this.omit('nodes');
      return false;
    }
    this.result.nodes.push(node);
    return true;
  }

  addEdge(edge: ExtensionEdge): boolean {
    // Repeated occurrences stay distinct, but cannot grow without bound behind one deduplicated node.
    if (this.result.edges.length >= this.limits.nodes * 4) {
      this.omit('edges');
      return false;
    }
    this.result.edges.push(edge);
    return true;
  }

  finish(): ExtensionDiscoveryResult {
    this.result.consumed = {
      sends: this.options.attemptBudget!.used,
      responseBytes: this.options.responseBudget!.consumedBytes,
      elapsedMs: Date.now() - this.started,
    };
    logger.emitAudit({
      event: 'extension_discovery',
      level: 'info',
      timestamp: new Date().toISOString(),
      providers: this.result.providers.map(({ id, status }) => ({ id, status })),
      nodes: this.result.nodes.length,
      sources: this.result.sources.length,
      omissions: this.result.omissions,
      consumed: this.result.consumed,
    });
    return this.result;
  }

  private failureReason(error: unknown): string {
    if (error instanceof AdtResponseLimitError) {
      this.omit('wire_bytes');
      return 'response_byte_limit';
    }
    if (error instanceof AdtRequestBudgetError) {
      this.omit('requests');
      return 'request_limit';
    }
    if (Date.now() >= this.options.deadline!) {
      this.omit('deadline');
      return 'deadline';
    }
    if (error instanceof ExtensionProtocolError) return 'invalid_provider_response';
    if (error instanceof AdtSafetyError) return 'hidden_read_denied';
    if (error instanceof AdtApiError) return `http_${error.statusCode}`;
    if (error instanceof ExtensionStoppedError) return 'optional_phase_stopped';
    return 'provider_read_failed';
  }
}

/** Byte-bounded, separate text blocks. Source truncation is explicit and UTF-8 safe. */
export function renderExtensionDiscovery(result: ExtensionDiscoveryResult): Array<{ type: 'text'; text: string }> {
  result = structuredClone(result);
  const cap = EXTENSION_LIMITS[result.mode].outputBytes;
  const shown = result.nodes.slice(0, 8);
  if (result.nodes.length > shown.length) result.omissions.output = result.nodes.length - shown.length;
  const summary = () =>
    `[extensions] ${JSON.stringify({
      root: result.root,
      scope: result.scope,
      providers: compactProviders(result.providers),
      identities: shown.map(({ type, name, version, provider, family, switch: sw }) => ({
        type,
        name,
        version,
        provider,
        family,
        ...(sw ? { switch: sw } : {}),
      })),
      applicability: 'unknown',
      issues: result.issues,
      omissions: result.omissions,
      consumed: result.consumed,
    })}`;
  const blocks: Array<{ type: 'text'; text: string }> = [];
  // Reserve a full summary allowance so later omission counts cannot overrun the cap.
  let remaining = cap - 2048;
  if (result.mode === 'sources') {
    if (result.edges.length) {
      const graph = `[extension graph] ${JSON.stringify(result.edges)}`;
      if (Buffer.byteLength(graph) <= remaining) {
        blocks.push({ type: 'text', text: graph });
        remaining -= Buffer.byteLength(graph);
      } else result.omissions.output = (result.omissions.output ?? 0) + result.edges.length;
    }
    for (const [index, source] of result.sources.entries()) {
      const label = `[extension source ${source.identity.type} ${source.identity.name} version=${source.identity.version} representation=${source.representation} provider=${source.provider}]\n`;
      const body = label + source.source;
      const marker = `\n[extension source truncated; ${result.sources.length - index - 1} further source blocks omitted]`;
      if (Buffer.byteLength(body) > remaining) {
        result.omissions.output = (result.omissions.output ?? 0) + result.sources.length - index;
        if (remaining >= Buffer.byteLength(label + marker))
          blocks.push({ type: 'text', text: truncateUtf8(body, remaining, marker) });
        else if (remaining >= 40) blocks.push({ type: 'text', text: '[extension sources omitted: output cap]' });
        break;
      }
      blocks.push({ type: 'text', text: body });
      remaining -= Buffer.byteLength(body);
    }
  }
  let text = summary();
  while (Buffer.byteLength(text) > 2048 && shown.length) {
    shown.pop();
    result.omissions.output = (result.omissions.output ?? 0) + 1;
    text = summary();
  }
  if (Buffer.byteLength(text) > 2048) text = truncateUtf8(text, 2048, '\n[extension summary truncated]');
  return [{ type: 'text', text }, ...blocks];
}

function truncateUtf8(text: string, bytes: number, marker: string): string {
  let prefix = Buffer.from(text)
    .subarray(0, Math.max(0, bytes - Buffer.byteLength(marker)))
    .toString('utf8');
  if (prefix.endsWith('\uFFFD')) prefix = prefix.slice(0, -1);
  return prefix + marker;
}

/** Retain every status while bounding repeated traversal observations in the compact summary. */
function compactProviders(
  providers: ExtensionProvider[],
): Array<ExtensionProvider & { observations?: number; scopes?: string[] }> {
  const groups = new Map<string, ExtensionProvider & { observations: number; scopes: string[] }>();
  for (const { scope, ...provider } of providers) {
    const key = JSON.stringify(provider);
    const group = groups.get(key);
    if (group) {
      group.observations++;
      if (scope && !group.scopes.includes(scope)) group.scopes.push(scope);
    } else groups.set(key, { ...provider, observations: 1, scopes: scope ? [scope] : [] });
  }
  return [...groups.values()];
}
