import path from 'node:path';
import { promises as dns } from 'node:dns';
import { log, note, password, select, text } from '@clack/prompts';
import pc from 'picocolors';
import type { FollowUp, PhaseResult } from '../lib/types.js';
import {
  printToolTable,
  promptConfirm,
  promptOrExit,
  logSubline,
  type ToolRow,
} from '../lib/ui.js';
import { clearCloudflareAccount, ensureCloudflareAccount } from '../lib/cloudflare.js';
import { mergeEnvFile } from '../lib/env-file.js';
import { tryOpenInBrowser } from '../lib/shell.js';
import { validateHostname, validatePagesProjectName } from '../lib/validators.js';
import { DEFAULT_APEX_DOMAIN, DEFAULT_PAGES_PROJECT } from '../lib/defaults.js';
import {
  attachPagesDomain,
  findZoneIdForName,
  getPagesProject,
  isDomainAlreadyAttachedError,
  listPagesDomains,
  readWranglerOAuthToken,
  upsertCname,
} from '../lib/cloudflare-api.js';

/**
 * Account-scoped API token page (preferred): tokens created here are bound to
 * a single CF account from the start. User-scoped tokens at
 * `/profile/api-tokens` can roam across every account the user is a member of
 * — broader blast radius if leaked.
 */
function tokenDashboardUrl(accountId: string): string {
  return `https://dash.cloudflare.com/${accountId}/api-tokens`;
}

export async function runDomainPhase(
  projectRoot: string,
  doctorMode: boolean,
): Promise<PhaseResult> {
  const followUpItems: FollowUp[] = [];

  // Cross-phase coupling note: deploy.ts persists CLOUDFLARE_PAGES_PROJECT and
  // LVBT_DOMAIN to .env.local; cold-start hydrates process.env from there at
  // startup, and we read it back here. .env.local is the deliberate persistence
  // layer between phases — wiring typed state through the orchestrator was
  // considered and rejected as over-engineering for a 7-phase CLI.
  const inferredProject = process.env.CLOUDFLARE_PAGES_PROJECT?.trim() || DEFAULT_PAGES_PROJECT;
  const inferredApex = (process.env.LVBT_DOMAIN?.trim() || DEFAULT_APEX_DOMAIN).toLowerCase();
  const inferredExtras = parseHostList(process.env.LVBT_EXTRA_HOSTS, inferredApex);

  note(
    `Attaches your domain to ${pc.cyan(inferredProject)} and writes every DNS record automatically.\n\nDNS write requires a Cloudflare API token with ${pc.cyan('Zone.DNS:Edit')} (wrangler's\nOAuth scopes don't include DNS). One-time setup: a paste prompt opens later\nand saves the token to ${pc.cyan('.env.local')} — every run after that is hands-off.\n\nIf the zone lives in another Cloudflare account, you'll be prompted to\nswitch wrangler users in-session.`,
    'Custom domain',
  );

  if (doctorMode) {
    await checkPublicDns([inferredApex, ...inferredExtras], false, followUpItems);
    return { success: followUpItems.length === 0, followUpItems };
  }

  // Fast-path: when env already has a full config and CF reports every host
  // `active`, skip prompts entirely and just confirm. Avoids re-asking for an
  // API token on a phase that has nothing to do.
  const fastPathSatisfied = await tryFastPath(inferredApex, inferredExtras, inferredProject);
  if (fastPathSatisfied) {
    const reconfigure = await promptConfirm(
      'Reconfigure anyway? (add a hostname, change project, etc.)',
      false,
    );
    if (!reconfigure) return { success: true, followUpItems };
  }

  const domainRaw = await promptOrExit(
    text({
      message: 'Apex domain',
      placeholder: inferredApex,
      defaultValue: inferredApex,
      validate: validateHostname,
    }),
  );
  const apex =
    typeof domainRaw === 'string' && domainRaw.trim()
      ? domainRaw.trim().toLowerCase()
      : inferredApex;

  // Extra hostnames are explicit opt-in. Common case is `www.<apex>`, but it's
  // not assumed — orgs that publish apex-only (or use `app.`, `staging.`) need
  // to be free of a hidden www default. Blank = apex only.
  const extrasRaw = await promptOrExit(
    text({
      message: 'Additional hostnames (comma-separated, blank = apex only)',
      placeholder: `e.g. www.${apex}`,
      defaultValue: inferredExtras.join(','),
    }),
  );
  const extras = parseHostList(typeof extrasRaw === 'string' ? extrasRaw : '', apex);

  const projectRaw = await promptOrExit(
    text({
      message: 'Cloudflare Pages project',
      placeholder: inferredProject,
      defaultValue: inferredProject,
      validate: validatePagesProjectName,
    }),
  );
  const project =
    typeof projectRaw === 'string' && projectRaw.trim() ? projectRaw.trim() : inferredProject;

  const hosts = [apex, ...extras];

  const updates = new Map<string, string>();
  if (apex !== inferredApex) updates.set('LVBT_DOMAIN', apex);
  if (project !== inferredProject) updates.set('CLOUDFLARE_PAGES_PROJECT', project);
  if (sortedJoin(extras) !== sortedJoin(inferredExtras)) {
    updates.set('LVBT_EXTRA_HOSTS', extras.join(','));
  }
  if (updates.size > 0) mergeEnvFile(path.join(projectRoot, '.env.local'), updates);

  // Bounded retry loop so the user can switch wrangler users in-session when
  // the apex's zone lives in a different CF account.
  const MAX_ATTEMPTS = 3;
  let zoneInAccount = false;
  let lastAttachOutcomes: AttachOutcome[] = [];
  let lastAccountId = '';
  let cnameTarget = `${project}.pages.dev`; // overwritten below once we fetch the real subdomain

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const accountResolution = await ensureCloudflareAccount(projectRoot);
    if (!accountResolution.ok || !accountResolution.accountId) {
      log.error('Could not resolve a Cloudflare account.');
      if (accountResolution.raw) {
        logSubline(pc.dim(accountResolution.raw.split('\n').slice(0, 3).join('\n')));
      }
      followUpItems.push({ kind: 'auth', message: 'Re-authenticate: `wrangler login`' });
      return { success: false, followUpItems };
    }
    const accountId = accountResolution.accountId;
    lastAccountId = accountId;

    const oauthToken = readWranglerOAuthToken();
    if (!oauthToken) {
      log.warn(
        `Couldn't read wrangler's OAuth token from disk — falling back to a dashboard link.`,
      );
      surfaceDashboardFollowUp(followUpItems, accountId, project, hosts, cnameTarget);
      await checkPublicDns(hosts, false, followUpItems);
      return { success: false, followUpItems };
    }

    const attachPromises = hosts.map((h) => attachDomainCall(accountId, project, h, oauthToken));
    lastAttachOutcomes = [];
    for (let i = 0; i < hosts.length; i++) {
      lastAttachOutcomes.push(await renderAttachTask(hosts[i]!, project, attachPromises[i]!));
    }
    if (lastAttachOutcomes.every((o) => o.kind === 'failed')) {
      log.error(
        `Couldn't attach any hosts under account ${accountId} — likely no access to the Pages project from this user.`,
      );
      surfaceDashboardFollowUp(followUpItems, accountId, project, hosts, cnameTarget);
      await checkPublicDns(hosts, false, followUpItems);
      return { success: false, followUpItems };
    }

    // Fetch the project's actual *.pages.dev hostname (with CF's per-project
    // suffix, e.g. `lvbt-website-5zh.pages.dev`). The naive `${project}.pages.dev`
    // is wrong — CF deduplicates project names globally with a random suffix,
    // and CNAMEs pointed at the naive form will never resolve.
    const proj = await getPagesProject(accountId, project, oauthToken);
    if (proj.ok && proj.data?.subdomain) {
      cnameTarget = proj.data.subdomain;
    } else {
      log.warn(
        `Couldn't fetch the Pages project's actual hostname; falling back to ${cnameTarget}, which may be wrong.`,
      );
    }

    const zone = await findZoneIdForName(apex, oauthToken);
    if (zone.zoneId) {
      zoneInAccount = true;
      // Skip the CNAME-write step (and its token paste prompt) for any host
      // that Pages already reports as `active` — its CNAME is already in
      // place, no need to overwrite or re-auth.
      const statuses = await fetchDomainStatuses(accountId, project, oauthToken);
      const pending = hosts.filter((h) => statuses.get(h) !== 'active');
      const alreadyActive = hosts.filter((h) => statuses.get(h) === 'active');
      if (alreadyActive.length > 0) {
        log.success(`Already wired: ${alreadyActive.map((h) => pc.cyan(h)).join(', ')}.`);
      }
      if (pending.length > 0) {
        await wireCnames(pending, zone.zoneId, cnameTarget, accountId, projectRoot, followUpItems);
      }
      break;
    }

    const action = await diagnoseAndRecover(
      projectRoot,
      apex,
      accountId,
      cnameTarget,
      followUpItems,
    );
    if (action === 'switched') {
      if (attempt === MAX_ATTEMPTS) {
        log.warn(
          `Hit retry limit (${MAX_ATTEMPTS} attempts). Re-run \`pnpm bootstrap --phase domain\` if you need to keep going.`,
        );
      }
      continue;
    }
    break;
  }

  if (!zoneInAccount) {
    for (const host of hosts) {
      followUpItems.push({
        kind: 'remote',
        message: `Once the zone is in the right account, point ${host} CNAME → ${cnameTarget}`,
      });
    }
  }

  await checkPublicDns(hosts, zoneInAccount, followUpItems);

  if (lastAttachOutcomes.some((o) => o.kind === 'failed')) {
    surfaceDashboardFollowUp(followUpItems, lastAccountId, project, hosts, cnameTarget);
  }

  return { success: followUpItems.length === 0, followUpItems };
}

// ── helpers ─────────────────────────────────────────────────────────────────

type AttachOutcome =
  | { kind: 'attached'; domain: string }
  | { kind: 'already_attached'; domain: string }
  | { kind: 'failed'; domain: string; raw: string };

/**
 * Parse a comma-separated host list. Drops blanks and exact-apex duplicates so
 * `hosts` doesn't end up with `apex` listed twice when the user types
 * `apex,www.apex` into the extras prompt.
 */
function parseHostList(raw: string | undefined, apex: string): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.split(',')) {
    const host = token.trim().toLowerCase();
    if (!host || host === apex || seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}

/**
 * Issue the Pages-attach call. We don't pre-list — `attachPagesDomain` returns
 * CF_ERROR.PAGES_DOMAIN_ALREADY_ATTACHED for the duplicate case, and we treat
 * that as a benign already-done outcome.
 */
async function attachDomainCall(
  accountId: string,
  project: string,
  domain: string,
  token: string,
): Promise<AttachOutcome> {
  const r = await attachPagesDomain(accountId, project, domain, token);
  if (r.ok) return { kind: 'attached', domain };
  if (isDomainAlreadyAttachedError(r.errors)) {
    return { kind: 'already_attached', domain };
  }
  const detail = r.errors.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${r.status}`;
  return { kind: 'failed', domain, raw: detail };
}

// No spinner: clack's spinner re-renders in place via cursor escapes that
// don't always survive other clack output above it (frames stack instead of
// overwriting in some terminals). Two static log lines are robust everywhere.
async function renderAttachTask(
  domain: string,
  project: string,
  promise: Promise<AttachOutcome>,
): Promise<AttachOutcome> {
  log.message(`Attaching ${pc.cyan(domain)} to ${pc.cyan(project)}…`);
  const captured = await promise;
  switch (captured.kind) {
    case 'attached':
      log.success(`Attached ${pc.cyan(domain)}.`);
      break;
    case 'already_attached':
      log.info(`${pc.cyan(domain)} already attached.`);
      break;
    case 'failed':
      log.error(`Could not attach ${domain}`);
      logSubline(pc.dim(captured.raw));
      break;
  }
  return captured;
}

/**
 * Write a CNAME for every host. Requires a Cloudflare API token with
 * `Zone.DNS:Edit` — wrangler's OAuth flow doesn't expose DNS write at all
 * (`wrangler login --scopes-list` confirms zone:read is the only zone scope).
 * If no token is configured, drives a one-time paste flow that saves it to
 * `.env.local` so subsequent runs are fully automatic.
 */
async function wireCnames(
  hosts: string[],
  zoneId: string,
  target: string,
  accountId: string,
  projectRoot: string,
  followUps: FollowUp[],
): Promise<void> {
  let apiToken = await ensureApiToken(accountId, projectRoot, { reason: 'initial' });
  if (!apiToken) {
    followUps.push({
      kind: 'auth',
      message:
        'Provide CLOUDFLARE_API_TOKEN (Zone.DNS:Edit) and re-run `pnpm bootstrap --phase domain`.',
    });
    return;
  }

  // Validate the token by *using* it. The /user/tokens/verify endpoint
  // requires user scope, which an account-scoped Zone.DNS:Edit token
  // legitimately lacks — it would falsely report `status: invalid` for
  // perfectly good tokens. The actual CNAME write is the only reliable check.
  let allowAuthRetry = true;
  for (const host of hosts) {
    let attempt = 0;
    while (true) {
      attempt++;
      log.message(`Writing CNAME ${pc.cyan(host)} → ${pc.cyan(target)} (proxied)…`);
      const r = await upsertCname(zoneId, host, target, apiToken, true);
      if (r.ok) {
        log.success(`CNAME set for ${pc.cyan(host)}.`);
        break;
      }
      const detail =
        r.errors.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${r.status}`;
      const authBlocked = r.status === 401 || r.status === 403;

      if (authBlocked && allowAuthRetry) {
        log.error(`Token rejected (HTTP ${r.status}) — needs Zone.DNS:Edit on ${host}'s zone.`);
        logSubline(pc.dim(detail));
        clearCloudflareApiToken(projectRoot);
        const fresh = await ensureApiToken(accountId, projectRoot, { reason: 'auth-retry' });
        if (!fresh) {
          followUps.push({
            kind: 'auth',
            message: `Re-create CLOUDFLARE_API_TOKEN with Zone.DNS:Edit and re-run.`,
          });
          return;
        }
        apiToken = fresh;
        allowAuthRetry = false;
        continue; // retry this host with the new token
      }

      log.error(`Couldn't write CNAME for ${host}`);
      logSubline(pc.dim(detail));
      followUps.push({
        kind: authBlocked ? 'auth' : 'remote',
        message: authBlocked
          ? `Re-create CLOUDFLARE_API_TOKEN with Zone.DNS:Edit on ${host}'s zone, then re-run.`
          : `Add CNAME ${host} → ${target} (proxied) at ${tokenDashboardUrl(accountId).replace('/api-tokens', `/${zoneId}/dns`)} and re-run.`,
      });
      // attempt counter avoids infinite loop on a stable non-auth failure
      void attempt;
      break;
    }
  }
}

function clearCloudflareApiToken(projectRoot: string): void {
  delete process.env.CLOUDFLARE_API_TOKEN;
  mergeEnvFile(path.join(projectRoot, '.env.local'), new Map([['CLOUDFLARE_API_TOKEN', '']]));
}

/**
 * Probe live Pages state and decide whether the domain phase can be a no-op.
 * Returns true iff:
 *   - We have account + project + apex from env (no first-run holes).
 *   - We have a wrangler OAuth token to read with.
 *   - Every host in (apex + extras) is reported `active` by CF Pages.
 * Prints a status block when truthy so the user sees what's already wired
 * before being asked whether to reconfigure.
 */
async function tryFastPath(apex: string, extras: string[], project: string): Promise<boolean> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!accountId || !apex || !project) return false;

  const oauthToken = readWranglerOAuthToken();
  if (!oauthToken) return false;

  const hosts = [apex, ...extras];
  const statuses = await fetchDomainStatuses(accountId, project, oauthToken);
  const allActive = hosts.length > 0 && hosts.every((h) => statuses.get(h) === 'active');
  if (!allActive) return false;

  const lines = hosts.map((h) => `  ${pc.green('✔')}  ${pc.cyan(h)}  active`);
  note(
    `${lines.join('\n')}\n\nNothing to wire — every host already validates and serves.`,
    'Already live',
  );
  return true;
}

/** Read each attached host's current Pages status (`active` once CF has
 *  validated the upstream CNAME). Returns an empty map on any API failure —
 *  callers treat unknown as "needs wiring", which is the safe default. */
async function fetchDomainStatuses(
  accountId: string,
  project: string,
  token: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const r = await listPagesDomains(accountId, project, token);
  if (!r.ok || !r.data) return out;
  for (const d of r.data) {
    if (d.name && d.status) out.set(d.name, d.status);
  }
  return out;
}

function tokenPromptBody(accountId: string): string {
  return [
    'Cloudflare API token needed (wrangler OAuth has no DNS scope).',
    '',
    `  1. Open ${pc.cyan(tokenDashboardUrl(accountId))}`,
    `  2. ${pc.bold('Create Token')} → use the ${pc.bold('"Edit zone DNS"')} template`,
    `     (or ${pc.bold('Custom token')} → Zone → DNS → Edit)`,
    '  3. Scope to your zone, Continue, Create',
    '  4. Copy the token from the success screen',
    '  5. Paste below — saved to .env.local for future runs',
  ].join('\n');
}

interface TokenPromptOptions {
  /** 'initial' = first time asking; 'auth-retry' = previous token was rejected by CF. */
  reason: 'initial' | 'auth-retry';
}

/**
 * Resolve the Cloudflare API token used for DNS writes. Returns the existing
 * env value when set, otherwise drives a paste flow that persists to
 * `.env.local` (0600). The paste isn't pre-validated — the actual CNAME
 * write is the source of truth. Returns null only on cancel.
 */
async function ensureApiToken(
  accountId: string,
  projectRoot: string,
  opts: TokenPromptOptions,
): Promise<string | null> {
  const existing = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (existing) {
    // A previously-persisted bad paste (e.g. with a stray prompt-arrow Unicode
    // char) would blow up later in `fetch` with an opaque ByteString error.
    // Re-validate before trusting it.
    if (validatePastedToken(existing) === undefined) return existing;
    log.warn('Saved CLOUDFLARE_API_TOKEN looks malformed — re-prompting.');
    clearCloudflareApiToken(projectRoot);
  }

  if (opts.reason === 'initial') {
    note(tokenPromptBody(accountId), 'Cloudflare API token');
    tryOpenInBrowser(tokenDashboardUrl(accountId));
  }

  const pasted = (await promptOrExit(
    password({
      message:
        opts.reason === 'auth-retry'
          ? 'Paste a new token (the previous one was rejected):'
          : 'Paste the Cloudflare API token:',
      validate: validatePastedToken,
    }),
  )) as string;
  const token = pasted.trim();

  process.env.CLOUDFLARE_API_TOKEN = token;
  mergeEnvFile(path.join(projectRoot, '.env.local'), new Map([['CLOUDFLARE_API_TOKEN', token]]));
  log.success('Token saved to .env.local.');
  return token;
}

function validatePastedToken(value: string | undefined): string | undefined {
  if (!value || value.trim().length < 20) return 'expected a longer token string';
  return undefined;
}

type RecoveryAction = 'switched' | 'skip';

type RecoveryChoice = 'switch' | 'add' | 'skip';

interface RecoveryOption {
  value: RecoveryChoice;
  label: string;
  hint: string;
}

/**
 * Distinguish "zone delegated to CF but in a different account" from "zone not
 * on CF at all" — the remediation differs sharply. For the former we drive an
 * interactive recovery; the loop retries against whatever wrangler login is
 * active after the user picks "switch". Returns 'switched' if the caller
 * should retry, 'skip' otherwise.
 */
async function diagnoseAndRecover(
  projectRoot: string,
  apex: string,
  accountId: string,
  cnameTarget: string,
  followUps: FollowUp[],
): Promise<RecoveryAction> {
  const ns = (await safeResolveNs(apex)).map((n) => n.toLowerCase().replace(/\.$/, ''));
  const allCfNs = ns.length > 0 && ns.every((n) => n.endsWith('.ns.cloudflare.com'));

  if (allCfNs) {
    log.error(
      `${pc.cyan(apex)} is delegated to Cloudflare (NS: ${ns.join(', ')}) but the zone isn't in this account (${accountId}). It lives in a different Cloudflare account.`,
    );

    const options: RecoveryOption[] = [
      {
        value: 'switch',
        label: 'Switch Cloudflare account',
        hint: 'pick a different account or wrangler user — same flow as deploy',
      },
      {
        value: 'add',
        label: `Add ${apex} to ${accountId}`,
        hint: 'opens the Cloudflare "Add a Site" dashboard in your browser',
      },
      {
        value: 'skip',
        label: 'Skip',
        hint: 'handle DNS manually later',
      },
    ];

    const choice = (await promptOrExit(
      select({
        message: 'Pick how to fix the account mismatch:',
        options,
        initialValue: 'switch',
      }),
    )) as RecoveryChoice;

    if (choice === 'switch') {
      clearCloudflareAccount(projectRoot);
      return 'switched';
    }

    if (choice === 'add') {
      const addSiteUrl = `https://dash.cloudflare.com/${accountId}/add-site`;
      log.info(`Add ${pc.cyan(apex)} as a site at ${pc.cyan(addSiteUrl)}, then re-run.`);
      followUps.push({
        kind: 'remote',
        message: `Add ${apex} to CF account ${accountId}: ${addSiteUrl}`,
      });
      return 'skip';
    }

    followUps.push({
      kind: 'auth',
      message: `Resolve CF account/zone mismatch for ${apex} (zone is in a different Cloudflare account).`,
    });
    return 'skip';
  }
  if (ns.length === 0) {
    log.error(
      `${pc.cyan(apex)} has no resolvable NS records — registrar delegation is missing or the domain isn't registered.`,
    );
    return 'skip';
  }
  log.error(
    `${pc.cyan(apex)} isn't delegated to Cloudflare (NS: ${ns.join(', ')}). Add it as a site in this CF account, then update your registrar to point at the NS Cloudflare assigns.`,
  );
  followUps.push({
    kind: 'remote',
    message: `Migrate ${apex} to Cloudflare DNS, then re-run \`pnpm bootstrap --phase domain\`. Target CNAME: ${cnameTarget}`,
  });
  return 'skip';
}

function surfaceDashboardFollowUp(
  followUps: FollowUp[],
  accountId: string,
  project: string,
  hosts: string[],
  cnameTarget: string,
): void {
  const dashUrl = `https://dash.cloudflare.com/${accountId}/pages/view/${project}/domains`;
  followUps.push({
    kind: 'remote',
    message: `Finish wiring ${hosts.join(', ')} (CNAME → ${cnameTarget}, proxied) from the dashboard: ${dashUrl}`,
  });
}

type LiveStatus =
  | { kind: 'live'; ip: string; httpStatus: number }
  | { kind: 'dns_only'; ip: string; httpError: string }
  | { kind: 'pending' };

interface FetchProbeResult {
  ok: boolean;
  status: number;
  error: string;
}

const DNS_POLL_MS = 5_000;
const HTTPS_TIMEOUT_MS = 8_000;
const MAX_WAIT_MS = 60_000;

/**
 * Verify hosts are actually serving the deployed site, not just attached.
 *
 * For zones in this CF account, the CNAME has just been written (either via
 * `wireCnames` programmatically with `CLOUDFLARE_API_TOKEN`, or by the user
 * clicking "Begin DNS transfer" on the dashboard). DNS propagation and
 * Universal SSL provisioning take a beat. Polls DNS every
 * {@link DNS_POLL_MS}ms; once a host resolves issues an HTTPS GET with a
 * {@link HTTPS_TIMEOUT_MS}ms timeout. Bounded by {@link MAX_WAIT_MS}.
 *
 * For zones outside this account, DNS propagation depends on the user's
 * registrar — no polling, just a snapshot and a follow-up.
 */
async function checkPublicDns(
  hosts: string[],
  zoneInAccount: boolean,
  followUps: FollowUp[],
): Promise<void> {
  if (hosts.length === 0) return;

  if (!zoneInAccount) {
    const results = await Promise.all(hosts.map((h) => safeResolve4(h)));
    const rows: ToolRow[] = hosts.map((host, i) =>
      buildExternalDnsRow(host, results[i] ?? [], followUps),
    );
    printToolTable('DNS records', rows);
    return;
  }

  // Pre-start polls so they run in parallel — Promise.all just awaits the
  // network work that's already in flight.
  const liveChecks = hosts.map((h) =>
    pollHostLive(h, {
      maxWaitMs: MAX_WAIT_MS,
      intervalMs: DNS_POLL_MS,
      httpTimeoutMs: HTTPS_TIMEOUT_MS,
    }),
  );

  const label =
    hosts.length === 1
      ? `Verifying ${pc.cyan(hosts[0]!)} is live`
      : `Verifying ${hosts.length} hosts are live`;
  log.message(`${label} (up to ${MAX_WAIT_MS / 1000}s)…`);
  const results = await Promise.all(liveChecks);
  const liveCount = results.filter((r) => r.kind === 'live').length;
  if (liveCount === hosts.length) {
    log.success(`${liveCount}/${hosts.length} live.`);
  } else {
    log.warn(`${liveCount}/${hosts.length} live.`);
  }

  const rows: ToolRow[] = hosts.map((host, i) => buildLiveRow(host, results[i]!));
  printToolTable('Domain status', rows);

  for (let i = 0; i < hosts.length; i++) {
    const host = hosts[i]!;
    const r = results[i]!;
    if (r.kind === 'live') continue;
    if (r.kind === 'dns_only') {
      followUps.push({
        kind: 'remote',
        message: `${host} resolves but HTTPS isn't responding yet — Cloudflare's Universal SSL takes 1–5 minutes after first attach. If it hasn't come up after that, re-run \`pnpm bootstrap --phase domain\`.`,
      });
    } else {
      followUps.push({
        kind: 'remote',
        message: `${host} hasn't propagated within ${MAX_WAIT_MS / 1000}s. Re-run \`pnpm bootstrap --phase domain\` in a minute or two.`,
      });
    }
  }
}

function buildExternalDnsRow(host: string, ips: string[], followUps: FollowUp[]): ToolRow {
  if (ips.length > 0) {
    const detail = ips.length === 1 ? `→ ${ips[0]}` : `→ ${ips[0]} (+${ips.length - 1})`;
    return { label: host, status: 'ready', detail };
  }
  followUps.push({
    kind: 'remote',
    message: `${host} not resolving — add the registrar CNAME, then re-run \`pnpm bootstrap --phase domain\`.`,
  });
  return { label: host, status: 'failed', detail: 'zone not in this account' };
}

function buildLiveRow(host: string, status: LiveStatus): ToolRow {
  switch (status.kind) {
    case 'live':
      return {
        label: host,
        status: 'ready',
        detail: `→ ${status.ip} · HTTP ${status.httpStatus}`,
      };
    case 'dns_only':
      return { label: host, status: 'failed', detail: `→ ${status.ip} · HTTPS pending` };
    case 'pending':
      return { label: host, status: 'failed', detail: 'no answer (propagation pending)' };
  }
}

interface PollOptions {
  maxWaitMs: number;
  intervalMs: number;
  httpTimeoutMs: number;
}

async function pollHostLive(host: string, opts: PollOptions): Promise<LiveStatus> {
  const deadline = Date.now() + opts.maxWaitMs;
  let lastIp: string | undefined;
  let lastHttpError: string | undefined;
  while (Date.now() < deadline) {
    const ips = await safeResolve4(host);
    if (ips.length > 0) {
      lastIp = ips[0];
      const http = await tryFetch(`https://${host}`, opts.httpTimeoutMs);
      if (http.ok) {
        return { kind: 'live', ip: ips[0]!, httpStatus: http.status };
      }
      lastHttpError = http.error;
    }
    if (Date.now() + opts.intervalMs >= deadline) break;
    await new Promise<void>((r) => setTimeout(r, opts.intervalMs));
  }
  if (lastIp) {
    return { kind: 'dns_only', ip: lastIp, httpError: lastHttpError ?? 'timed out' };
  }
  return { kind: 'pending' };
}

async function tryFetch(url: string, timeoutMs: number): Promise<FetchProbeResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // GET (not HEAD): Cloudflare sometimes serves cached error pages without a
    // body for HEADs.
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal, redirect: 'follow' });
    return {
      ok: res.ok,
      status: res.status,
      error: res.ok ? '' : `${res.status} ${res.statusText}`,
    };
  } catch (e) {
    return { ok: false, status: 0, error: shortError((e as Error).message) };
  } finally {
    clearTimeout(timer);
  }
}

function shortError(raw: string): string {
  // node:undici exception messages can be very long; keep the first line.
  const first = raw.split('\n')[0]!.trim();
  return first.length > 80 ? `${first.slice(0, 77)}...` : first;
}

/** Order-insensitive string-list compare; we don't want a reorder to count as a change. */
function sortedJoin(xs: string[]): string {
  return [...xs].sort().join(',');
}

async function safeResolveNs(host: string): Promise<string[]> {
  try {
    return await dns.resolveNs(host);
  } catch {
    return [];
  }
}

async function safeResolve4(host: string): Promise<string[]> {
  try {
    return await dns.resolve4(host);
  } catch {
    return [];
  }
}
