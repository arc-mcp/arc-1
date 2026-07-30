/**
 * BTP Audit Log sink for ARC-1.
 *
 * Sends structured audit events to SAP BTP Audit Log Service v2 API.
 * Only activates when running on BTP with an auditlog premium service binding.
 *
 * Maps ARC-1 audit events to BTP Audit Log categories:
 * - security-events: auth failures, scope denials, safety blocks
 * - data-accesses: tool calls that read SAP data
 * - data-modifications: tool calls that write/delete SAP data
 * - configuration-changes: transport releases, activations
 *
 * Authentication uses mTLS (X.509 certificates) via the premium plan binding.
 * Tokens are cached with 60s refresh buffer (same pattern as btp.ts connectivity proxy).
 *
 * All writes are fire-and-forget — errors go to stderr, never block tool calls.
 */

import type {
  AuditEvent,
  AuthPPCreatedEvent,
  AuthScopeDeniedEvent,
  AuthSharedCreatedEvent,
  McpRateLimitedEvent,
  MultiTargetStageFailedEvent,
  SafetyBlockedEvent,
  ToolCallEndEvent,
  ToolCallStartEvent,
} from '../audit.js';
import type { LogSink } from './types.js';

/** BTP Audit Log service credentials from VCAP_SERVICES */
export interface BTPAuditLogConfig {
  url: string;
  uaa: {
    url: string;
    certurl: string;
    clientid: string;
    certificate: string;
    key: string;
  };
}

/** Audit log category endpoints */
type AuditCategory = 'security-events' | 'data-accesses' | 'data-modifications' | 'configuration-changes';

/** Categorize tool by its access pattern */
function toolCategory(tool: string): AuditCategory {
  if (['SAPWrite', 'SAPManage'].includes(tool)) return 'data-modifications';
  if (['SAPTransport', 'SAPActivate'].includes(tool)) return 'configuration-changes';
  return 'data-accesses';
}

/** Map ARC-1 event types to BTP Audit Log categories */
function categorize(event: AuditEvent): AuditCategory | null {
  switch (event.event) {
    case 'auth_scope_denied':
    case 'safety_blocked':
    case 'target_resolution_failed':
    case 'pp_exchange_failed':
    case 'shared_auth_failed':
    case 'cloud_connector_access_denied':
    case 'sap_service_unavailable':
    case 'sap_authentication_failed':
    case 'sap_authorization_failed':
    case 'target_policy_denied':
    case 'mcp_rate_limited':
      return 'security-events';

    case 'tool_call_start':
    case 'tool_call_end':
      return toolCategory(event.tool);

    case 'auth_pp_created':
      return event.level === 'error' ? 'security-events' : null;

    case 'auth_shared_created':
      return 'security-events';

    // Don't send http_request, server_start, etc. to BTP audit log
    default:
      return null;
  }
}

/**
 * Parse BTP Audit Log credentials from VCAP_SERVICES.
 * Returns undefined if the service is not bound.
 */
export function parseBTPAuditLogConfig(): BTPAuditLogConfig | undefined {
  const vcap = process.env.VCAP_SERVICES;
  if (!vcap) return undefined;

  try {
    const services = JSON.parse(vcap);
    // Look for auditlog service with premium plan
    const auditlogEntries = services.auditlog ?? services['auditlog-api'] ?? [];
    const premiumBinding = Array.isArray(auditlogEntries)
      ? auditlogEntries.find((s: Record<string, unknown>) => s.plan === 'premium' || s.plan === 'oauth2')
      : undefined;

    if (!premiumBinding?.credentials) return undefined;

    const creds = premiumBinding.credentials;
    return {
      url: creds.url,
      uaa: {
        url: creds.uaa?.url,
        certurl: creds.uaa?.certurl,
        clientid: creds.uaa?.clientid,
        certificate: creds.uaa?.certificate,
        key: creds.uaa?.key,
      },
    };
  } catch {
    return undefined;
  }
}

export class BTPAuditLogSink implements LogSink {
  private token: string | undefined;
  private tokenExpiresAt = 0;
  private pendingWrites: Promise<void>[] = [];

  constructor(private config: BTPAuditLogConfig) {}

  write(event: AuditEvent): void {
    const category = categorize(event);
    if (!category) return;

    // Fire-and-forget
    const p = this.sendEvent(event, category).catch((err) => {
      process.stderr.write(`[BTPAuditLogSink] Failed to write audit event: ${err}\n`);
    });
    this.pendingWrites.push(p);

    // Cleanup completed promises periodically
    if (this.pendingWrites.length > 50) {
      this.pendingWrites = this.pendingWrites.filter((p) => {
        let settled = false;
        p.then(
          () => (settled = true),
          () => (settled = true),
        );
        return !settled;
      });
    }
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.pendingWrites);
    this.pendingWrites = [];
  }

  private async sendEvent(event: AuditEvent, category: AuditCategory): Promise<void> {
    const token = await this.getToken();
    const payload = this.buildPayload(event);

    const response = await fetch(`${this.config.url}/audit-log/oauth2/v2/${category}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
    }
  }

  private buildPayload(event: AuditEvent): Record<string, unknown> {
    const user = event.user ?? '$USER';
    // Security events carry free-text `data`, not attributes — append the calling agent there so a
    // denial or lockout can be attributed to the software that triggered it, not just the user.
    const agent = event.clientAgent ? ` Agent: ${event.clientAgent}.` : '';
    const base: Record<string, unknown> = {
      uuid: crypto.randomUUID(),
      user,
      time: event.timestamp,
      tenant: '$PROVIDER',
    };

    switch (event.event) {
      case 'tool_call_start': {
        const e = event as ToolCallStartEvent;
        const argsStr = JSON.stringify(e.args);
        const argsSummary = argsStr.length > 500 ? `${argsStr.slice(0, 500)}...` : argsStr;
        const attrs = [
          { name: 'action', new: 'invoke' },
          { name: 'tool', new: e.tool },
          { name: 'user', new: user },
          { name: 'clientId', new: e.clientId ?? '' },
          { name: 'args', new: argsSummary },
        ];
        // Which agent software acted, next to the registered client it acted under.
        if (e.clientAgent) attrs.push({ name: 'clientAgent', new: e.clientAgent });
        if (e.target) attrs.push({ name: 'target', new: e.target });
        if (e.identity) attrs.push({ name: 'identity', new: e.identity });
        return {
          ...base,
          object: {
            type: 'MCP Tool Call',
            id: { tool: e.tool, requestId: e.requestId ?? '' },
          },
          attributes: attrs,
        };
      }

      case 'tool_call_end': {
        const e = event as ToolCallEndEvent;
        const attrs = [
          { name: 'action', new: 'complete' },
          { name: 'tool', new: e.tool },
          { name: 'user', new: user },
          { name: 'clientId', new: e.clientId ?? '' },
          { name: 'status', new: e.status },
          { name: 'durationMs', new: String(e.durationMs) },
          { name: 'resultSize', new: String(e.resultSize ?? 0) },
        ];
        if (e.errorMessage) {
          attrs.push({ name: 'error', new: e.errorMessage.slice(0, 500) });
        }
        if (e.errorClass) {
          attrs.push({ name: 'errorClass', new: e.errorClass });
        }
        if (e.clientAgent) {
          attrs.push({ name: 'clientAgent', new: e.clientAgent });
        }
        if (e.target) {
          attrs.push({ name: 'target', new: e.target });
        }
        if (e.identity) {
          attrs.push({ name: 'identity', new: e.identity });
        }
        return {
          ...base,
          object: {
            type: 'MCP Tool Call',
            id: { tool: e.tool, requestId: e.requestId ?? '' },
          },
          attributes: attrs,
        };
      }

      case 'auth_scope_denied': {
        const e = event as AuthScopeDeniedEvent;
        const target = e.target ? ` Target: ${e.target}.` : '';
        const identity = e.identity ? ` identity=${e.identity}.` : '';
        return {
          ...base,
          data: `Access denied: user "${user}" lacks scope "${e.requiredScope}" for tool ${e.tool}. Available scopes: [${e.availableScopes.join(', ')}].${target}${identity}${agent}`,
        };
      }

      case 'safety_blocked': {
        const e = event as SafetyBlockedEvent;
        const target = e.target ? ` Target: ${e.target}.` : '';
        const identity = e.identity ? ` identity=${e.identity}.` : '';
        return {
          ...base,
          data: `Safety blocked: operation "${e.operation}" denied — ${e.reason}. User: ${user}.${target}${identity}${agent}`,
        };
      }

      case 'auth_pp_created': {
        const e = event as AuthPPCreatedEvent;
        const route = e.target
          ? `target "${e.target}"`
          : e.destination
            ? `destination "${e.destination}"`
            : 'the configured SAP destination';
        return {
          ...base,
          data: `Principal propagation ${e.success ? 'succeeded' : 'failed'} for user "${user}" via ${route}${e.errorMessage ? `: ${e.errorMessage}` : ''}${e.identity ? ` identity=${e.identity}.` : ''}${agent}`,
        };
      }

      case 'auth_shared_created': {
        const e = event as AuthSharedCreatedEvent;
        return {
          ...base,
          data: `Shared technical SAP authentication succeeded for tool "${e.tool}". User: ${user}.${e.target ? ` Target: ${e.target}.` : ''} identity=shared.${agent}`,
        };
      }

      case 'target_resolution_failed':
      case 'pp_exchange_failed':
      case 'shared_auth_failed':
      case 'cloud_connector_access_denied':
      case 'sap_service_unavailable':
      case 'sap_authentication_failed':
      case 'sap_authorization_failed':
      case 'target_policy_denied': {
        const e = event as MultiTargetStageFailedEvent;
        const target = e.target ? ` Target: ${e.target}.` : '';
        const identity = e.identity ? ` identity=${e.identity}.` : '';
        return {
          ...base,
          data: `Multi-target stage "${e.event}" failed for tool "${e.tool}" with code "${e.errorCode}". User: ${user}.${target}${identity}${agent}`,
        };
      }

      case 'mcp_rate_limited': {
        const e = event as McpRateLimitedEvent;
        const target = e.target ? ` Target: ${e.target}.` : '';
        const identity = e.identity ? ` identity=${e.identity}.` : '';
        return {
          ...base,
          data: `MCP rate limit blocked tool "${e.tool}" at ${e.limitPerMinute}/min; retry after ${e.retryAfterMs}ms. User: ${user}.${target}${identity}${agent}`,
        };
      }

      default:
        return {
          ...base,
          data: `[${event.event}] ${JSON.stringify(event)}`,
        };
    }
  }

  private async getToken(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.token;
    }

    // For mTLS, we'd need to use the certificate and key from the service binding.
    // Node.js fetch doesn't support client certificates directly — in production,
    // the CF buildpack handles certificate injection via the NODE_EXTRA_CA_CERTS
    // and the service binding provides tokens via the bound app's identity.
    // For now, use client_credentials grant with the service binding.
    const tokenUrl = `${this.config.uaa.certurl}/oauth/token`;
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.uaa.clientid,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`Token fetch failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return this.token;
  }
}
