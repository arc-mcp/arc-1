/**
 * ADT client configuration types.
 *
 * Separates ADT-level config (SAP connection, auth, safety) from
 * server-level config (MCP transport, HTTP address). The ADT client
 * only needs to know about SAP — it doesn't care about MCP.
 */

import type { BTPProxyConfig } from './btp.js';
import type { SafetyConfig } from './safety.js';
import { unrestrictedSafetyConfig } from './safety.js';

/** Feature mode: auto detects from SAP system, on/off forces */
export type FeatureMode = 'auto' | 'on' | 'off';

/** Feature configuration for optional SAP capabilities */
export interface FeatureConfig {
  hana: FeatureMode;
  abapGit: FeatureMode;
  gcts: FeatureMode;
  rap: FeatureMode;
  amdp: FeatureMode;
  ui5: FeatureMode;
  transport: FeatureMode;
  ui5repo: FeatureMode;
  flp: FeatureMode;
}

/** Default feature config: all auto-detect */
export function defaultFeatureConfig(): FeatureConfig {
  return {
    hana: 'auto',
    abapGit: 'auto',
    gcts: 'auto',
    rap: 'auto',
    amdp: 'auto',
    ui5: 'auto',
    transport: 'auto',
    ui5repo: 'auto',
    flp: 'auto',
  };
}

/** ADT client configuration */
export interface AdtClientConfig {
  /** SAP system URL (e.g., "http://sap:8000") */
  baseUrl: string;
  /** SAP username */
  username: string;
  /** SAP password */
  password: string;
  /** SAP client number (default: "100") */
  client: string;
  /** SAP language (default: "EN") */
  language: string;
  /** Skip TLS verification */
  insecure: boolean;
  /** Cookie-based auth (alternative to basic auth) */
  cookies: Record<string, string>;
  /** Path to cookie file — enables hot-reload on stale auth */
  cookieFile?: string;
  /** Inline cookie string — stored for config awareness (no hot-reload) */
  cookieString?: string;
  /** Safety configuration */
  safety: SafetyConfig;
  /** Feature detection config */
  features: FeatureConfig;
  /** Enable verbose logging */
  verbose: boolean;
  /** BTP Connectivity proxy (Cloud Connector) */
  btpProxy?: BTPProxyConfig;
  /**
   * Per-user SAP-Connectivity-Authentication header (principal propagation).
   * Contains a SAML assertion from the BTP Destination Service.
   * When set, sent with every request to Cloud Connector for user mapping.
   * Used for Approach A (Destination Service generates token) or Approach B Option 2 (backward compat).
   */
  sapConnectivityAuth?: string;
  /**
   * Per-user Proxy-Authorization override (principal propagation, recommended approach).
   * Contains the user exchange access token from jwt-bearer exchange with the Connectivity Service.
   * When set, replaces the regular connectivity proxy token in the Proxy-Authorization header.
   * Per SAP docs (page 209): "Recommended. The application sends one header containing the
   * user exchange token to the Connectivity proxy."
   */
  ppProxyAuth?: string;
  /**
   * Bearer token provider for BTP ABAP Environment (OAuth 2.0).
   * When set, replaces Basic Auth with `Authorization: Bearer <token>`.
   * The function handles token lifecycle (caching, refresh, re-login).
   */
  bearerTokenProvider?: () => Promise<string>;
  /** Opt-in: disable SAML redirect via X-SAP-SAML2 header + saml2 query param */
  disableSaml?: boolean;
  /** Maximum concurrent SAP HTTP requests. When set, requests beyond this limit queue. */
  maxConcurrent?: number;
}

/** Create default ADT client config */
export function defaultAdtClientConfig(): AdtClientConfig {
  return {
    baseUrl: '',
    username: '',
    password: '',
    client: '100',
    language: 'EN',
    insecure: false,
    cookies: {},
    safety: unrestrictedSafetyConfig(),
    features: defaultFeatureConfig(),
    verbose: false,
  };
}
