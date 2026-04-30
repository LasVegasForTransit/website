/**
 * Thin client for the Cloudflare REST API. Two auth sources:
 *   1. Wrangler's on-disk OAuth token (from `wrangler login`) — used for
 *      Pages and zone-read calls. Cannot write DNS records.
 *   2. `CLOUDFLARE_API_TOKEN` env var — required to write DNS records
 *      programmatically (must have `Zone.DNS:Edit`). Optional — when unset,
 *      the domain phase falls back to a dashboard hop for the user.
 *
 * The CF API is stable across versions; wrangler's CLI output isn't, so we
 * go direct.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

export interface CfErrorBody {
  errors?: Array<{ code: number; message: string }>;
  messages?: Array<{ code: number; message: string }>;
  success?: boolean;
}

/** Stable Cloudflare API error codes we care about. */
export const CF_ERROR = {
  /** "A project with this name already exists." (Pages). */
  PAGES_PROJECT_NAME_TAKEN: 8000002,
} as const;

/**
 * Cloudflare uses several "already attached" codes for Pages custom domains
 * depending on which validation tripped first (8000007 / 8000018). Both are
 * idempotent successes from our perspective.
 */
const PAGES_DOMAIN_ALREADY_ATTACHED_CODES: ReadonlySet<number> = new Set([8000007, 8000018]);

export function isDomainAlreadyAttachedError(errors: Array<{ code: number }>): boolean {
  return errors.some((e) => PAGES_DOMAIN_ALREADY_ATTACHED_CODES.has(e.code));
}

/**
 * Read wrangler's OAuth token from its on-disk config. The path varies by
 * wrangler version + OS; we try the known locations in order and parse the
 * minimal subset of TOML we need (just `oauth_token = "..."`). Returns null
 * if no non-expired token is found.
 */
export function readWranglerOAuthToken(): string | null {
  const home = os.homedir();
  const candidates = [
    process.env.WRANGLER_HOME,
    path.join(home, 'Library', 'Preferences', '.wrangler'),
    path.join(home, '.config', '.wrangler'),
    path.join(home, '.wrangler'),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);

  for (const dir of candidates) {
    const filePath = path.join(dir, 'config', 'default.toml');
    if (!existsSync(filePath)) continue;
    try {
      const contents = readFileSync(filePath, 'utf8');
      const tokenMatch = contents.match(/^\s*oauth_token\s*=\s*"([^"]+)"/m);
      if (!tokenMatch) continue;
      const token = tokenMatch[1]!;

      const expMatch = contents.match(/^\s*expiration_time\s*=\s*"([^"]+)"/m);
      if (expMatch) {
        const exp = Date.parse(expMatch[1]!);
        if (!Number.isNaN(exp) && exp <= Date.now()) {
          // Expired; another candidate may have a fresher token, keep looking.
          continue;
        }
      }
      return token;
    } catch {
      continue;
    }
  }
  return null;
}

interface CfRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  token: string;
}

interface CfResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  errors: Array<{ code: number; message: string }>;
}

async function cfRequest<T>(pathname: string, opts: CfRequestOptions): Promise<CfResponse<T>> {
  const res = await fetch(`${CF_API_BASE}${pathname}`, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  let json: (CfErrorBody & { result?: T }) | null = null;
  try {
    json = (await res.json()) as CfErrorBody & { result?: T };
  } catch {
    return { ok: false, status: res.status, errors: [{ code: 0, message: `HTTP ${res.status}` }] };
  }

  return {
    ok: res.ok && json?.success !== false,
    status: res.status,
    data: json?.result,
    errors: json?.errors ?? [],
  };
}

export interface PagesAttachedDomain {
  name: string;
  status?: string;
  verification_data?: unknown;
}

export async function attachPagesDomain(
  accountId: string,
  project: string,
  domain: string,
  token: string,
): Promise<CfResponse<PagesAttachedDomain>> {
  return cfRequest(
    `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(project)}/domains`,
    { method: 'POST', body: { name: domain }, token },
  );
}

export interface PagesProject {
  name: string;
  /** The actual public hostname Pages serves on, with CF's random suffix
   *  baked in (e.g. `lvbt-website-5zh.pages.dev`, NOT `lvbt-website.pages.dev`).
   *  This is the canonical CNAME target for any custom domain attached to the
   *  project. */
  subdomain: string;
  domains: string[];
  production_branch?: string;
}

export async function getPagesProject(
  accountId: string,
  project: string,
  token: string,
): Promise<CfResponse<PagesProject>> {
  return cfRequest(
    `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(project)}`,
    { token },
  );
}

export interface PagesDomainSummary {
  name: string;
  /** Pages reports `active` once the upstream CNAME validates and Universal
   *  SSL provisions; `pending` while it's waiting on either. */
  status?: string;
}

export async function listPagesDomains(
  accountId: string,
  project: string,
  token: string,
): Promise<CfResponse<PagesDomainSummary[]>> {
  return cfRequest(
    `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(project)}/domains`,
    { token },
  );
}

interface CfZoneAccountRef {
  id: string;
}

export interface CfZone {
  id: string;
  name: string;
  account?: CfZoneAccountRef;
}

export interface ZoneLookupResult {
  zoneId?: string;
  zoneName?: string;
  raw: CfResponse<CfZone[]>;
}

export async function findZoneIdForName(
  hostname: string,
  token: string,
): Promise<ZoneLookupResult> {
  // Walk up labels — for sub.example.com try sub.example.com → example.com.
  const labels = hostname.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join('.');
    const r = await cfRequest<CfZone[]>(`/zones?name=${encodeURIComponent(candidate)}`, {
      token,
    });
    if (r.ok && r.data && r.data.length > 0) {
      return { zoneId: r.data[0]!.id, zoneName: r.data[0]!.name, raw: r };
    }
    if (!r.ok) {
      return { raw: r };
    }
  }
  return { raw: { ok: true, status: 200, errors: [], data: [] } };
}

export interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
}

export interface CnameLookupResult {
  ok: boolean;
  record: DnsRecord | null;
  raw: CfResponse<DnsRecord[]>;
}

export async function findCname(
  zoneId: string,
  name: string,
  token: string,
): Promise<CnameLookupResult> {
  const r = await cfRequest<DnsRecord[]>(
    `/zones/${encodeURIComponent(zoneId)}/dns_records?type=CNAME&name=${encodeURIComponent(name)}`,
    { token },
  );
  if (!r.ok) return { ok: false, record: null, raw: r };
  return { ok: true, record: r.data && r.data.length > 0 ? r.data[0]! : null, raw: r };
}

/**
 * Idempotent CNAME write. Short-circuits when the record already matches; PUTs
 * to update an existing mismatching record; POSTs to create. Requires a token
 * with `Zone.DNS:Edit`.
 */
export async function upsertCname(
  zoneId: string,
  name: string,
  target: string,
  token: string,
  proxied = true,
): Promise<CfResponse<DnsRecord>> {
  const lookup = await findCname(zoneId, name, token);
  if (!lookup.ok) {
    return { ok: false, status: lookup.raw.status, errors: lookup.raw.errors };
  }
  const existing = lookup.record;
  if (existing) {
    if (existing.content === target && existing.proxied === proxied) {
      return { ok: true, status: 200, errors: [], data: existing };
    }
    return cfRequest(
      `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(existing.id)}`,
      {
        method: 'PUT',
        body: { type: 'CNAME', name, content: target, ttl: 1, proxied },
        token,
      },
    );
  }
  return cfRequest(`/zones/${encodeURIComponent(zoneId)}/dns_records`, {
    method: 'POST',
    body: { type: 'CNAME', name, content: target, ttl: 1, proxied },
    token,
  });
}
