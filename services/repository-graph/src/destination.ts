import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fetch } from 'undici';
import { boundedText } from './bounded-body.js';
import { selectedBinding } from './graph/bindings.js';

const require = createRequire(import.meta.url);

interface XsEnv {
  getServices(query: Record<string, { label?: string; tag?: string }>): Record<string, Record<string, unknown>>;
}

interface DestinationCredentials {
  clientid: string;
  clientsecret: string;
  uri: string;
  url: string;
}

export interface ResolvedDestination {
  authTokens?: Array<{
    http_header?: { key?: string; value?: string };
    type?: string;
  }>;
  destinationConfiguration: Record<string, string>;
}

const xsenv = require('@sap/xsenv') as XsEnv;

function destinationCredentials(): DestinationCredentials {
  const serviceKeyFile = process.env.ARC_GRAPH_DESTINATION_SERVICE_KEY_FILE?.trim();
  if (serviceKeyFile) {
    const parsed = JSON.parse(readFileSync(serviceKeyFile, 'utf8')) as Record<string, unknown>;
    const fileCredentials = (
      parsed.credentials && typeof parsed.credentials === 'object' ? parsed.credentials : parsed
    ) as Partial<DestinationCredentials>;
    if (fileCredentials?.clientid && fileCredentials.clientsecret && fileCredentials.uri && fileCredentials.url) {
      return fileCredentials as DestinationCredentials;
    }
    throw new Error('Destination service key file is missing required credentials');
  }
  const binding = process.env.ARC_GRAPH_DESTINATION_BINDING;
  if (process.env.VCAP_APPLICATION && !binding)
    throw new Error('Explicit Destination service binding required in Cloud Foundry');
  const credentials = (
    binding
      ? selectedBinding(process.env, binding)
      : xsenv.getServices({ destination: { tag: 'destination' } }).destination
  ) as Partial<DestinationCredentials> | undefined;
  if (!credentials?.clientid || !credentials.clientsecret || !credentials.uri || !credentials.url) {
    throw new Error('No usable Destination service binding is available');
  }
  return credentials as DestinationCredentials;
}

async function responseJson<T>(response: Awaited<ReturnType<typeof fetch>>, operation: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${operation} failed with HTTP ${response.status}`);
  }
  return JSON.parse(await boundedText(response, 262_144)) as T;
}

export async function resolveDestination(name: string): Promise<ResolvedDestination> {
  const credentials = destinationCredentials();
  for (const value of [credentials.url, credentials.uri]) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('Destination service requires credential-free HTTPS endpoints');
    }
  }
  const form = new URLSearchParams({
    client_id: credentials.clientid,
    client_secret: credentials.clientsecret,
    grant_type: 'client_credentials',
  });
  const tokenResponse = await fetch(`${credentials.url.replace(/\/$/, '')}/oauth/token`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const token = await responseJson<{ access_token: string }>(tokenResponse, 'Destination token request');

  const destinationResponse = await fetch(
    `${credentials.uri.replace(/\/$/, '')}/destination-configuration/v1/destinations/${encodeURIComponent(name)}`,
    {
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
      headers: { authorization: `Bearer ${token.access_token}` },
    },
  );
  return responseJson<ResolvedDestination>(destinationResponse, `Destination ${name}`);
}
