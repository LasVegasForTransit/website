import path from 'node:path';
import { log, note } from '@clack/prompts';
import pc from 'picocolors';
import type { FollowUp, PhaseResult } from '../lib/types.js';
import { printToolTable, promptConfirm, logSubline, type ToolRow } from '../lib/ui.js';
import { rt } from '../lib/runtime.js';
import {
  clearCloudflareAccount,
  clearCloudflareApiToken,
  ensureCloudflareAccount,
} from '../lib/cloudflare.js';
import { mergeEnvFile } from '../lib/env-file.js';
import { firstLine, tryOpenInBrowser } from '../lib/shell.js';
import { validateHostname, validatePagesProjectName } from '../lib/validators.js';
import { DEFAULT_APEX_DOMAIN, DEFAULT_PAGES_PROJECT } from '../lib/defaults.js';
import {
  attachPagesDomain,
  findCname,
  findZoneIdForName,
  getPagesProject,
  isDomainAlreadyAttachedError,
  listPagesDomains,
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
    `Attaches your domain to ${pc.cyan(inferredProject)} and writes any DNS record that is missing.\n\nWriting DNS needs a Cloudflare API token with ${pc.cyan('Zone · DNS · Edit')}, because wrangler's\nsign-in cannot write DNS. Only if a record is missing, a prompt shows how to\nmake one and saves it to ${pc.cyan('.env.local')} on this machine; later runs reuse it.\n\nIf the zone lives in another Cloudflare account, you'll be prompted to\nswitch wrangler users in-session.`,
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
      'domain.reconfigure',
      'Reconfigure anyway? (add a hostname, change project, etc.)',
      false,
    );
    if (!reconfigure) return { success: true, followUpItems };
  }

  const domainRaw = await rt().prompts.text({
    id: 'domain.apex',
    message: 'Apex domain',
    placeholder: inferredApex,
    defaultValue: inferredApex,
    validate: validateHostname,
  });
  const apex = domainRaw.trim() ? domainRaw.trim().toLowerCase() : inferredApex;

  // Extra hostnames are explicit opt-in. Common case is `www.<apex>`, but it's
  // not assumed — orgs that publish apex-only (or use `app.`, `staging.`) need
  // to be free of a hidden www default. Blank = apex only.
  const extrasRaw = await rt().prompts.text({
    id: 'domain.extra-hosts',
    message: 'Additional hostnames (comma-separated, blank = apex only)',
    placeholder: `e.g. www.${apex}`,
    defaultValue: inferredExtras.join(','),
  });
  const extras = parseHostList(extrasRaw, apex);

  const projectRaw = await rt().prompts.text({
    id: 'domain.project',
    message: 'Cloudflare Pages project',
    placeholder: inferredProject,
    defaultValue: inferredProject,
    validate: validatePagesProjectName,
  });
  const project = projectRaw.trim() ? projectRaw.trim() : inferredProject;

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

    const oauthToken = rt().wranglerOAuthToken();
    if (!oauthToken) {
      log.warn(
        `Couldn't read wrangler's OAuth token from disk — falling back to a dashboard link.`,
      );
      surfaceDashboardFollowUp(followUpItems, accountId, project, hosts, cnameTarget);
      await checkPublicDns(hosts, false, followUpItems);
      return { success: false, followUpItems };
    }

    lastAttachOutcomes = await attachMissingHosts(accountId, project, hosts, oauthToken);
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
      const needCname = await hostsWithoutCname(pending, zone.zoneId, cnameTarget, oauthToken);
      if (needCname.length > 0) {
        await wireCnames(
          needCname,
          { id: zone.zoneId, name: zone.zoneName ?? apex },
          cnameTarget,
          accountId,
          projectRoot,
          followUpItems,
        );
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
 * Attach only the hosts Pages doesn't list yet. When the list can't be read,
 * every host is attached, and Cloudflare's "already attached" answer counts
 * as done, so a host is never attached twice either way.
 */
async function attachMissingHosts(
  accountId: string,
  project: string,
  hosts: string[],
  token: string,
): Promise<AttachOutcome[]> {
  const listed = await listPagesDomains(accountId, project, token);
  const attached = listed.ok && listed.data ? new Set(listed.data.map((d) => d.name)) : null;
  const outcomes: AttachOutcome[] = [];
  for (const host of hosts) {
    if (attached?.has(host)) {
      log.info(`${pc.cyan(host)} already attached.`);
      outcomes.push({ kind: 'already_attached', domain: host });
      continue;
    }
    outcomes.push(
      await renderAttachTask(host, project, attachDomainCall(accountId, project, host, token)),
    );
  }
  return outcomes;
}

/**
 * Hosts whose CNAME is not yet in place, checked with wrangler's sign-in so a
 * host that is only waiting for its certificate doesn't trigger a request for
 * the DNS token. If that sign-in can't read DNS records, every host counts as
 * needing a CNAME and the token path below checks again before writing.
 */
async function hostsWithoutCname(
  hosts: string[],
  zoneId: string,
  target: string,
  token: string,
): Promise<string[]> {
  const needed: string[] = [];
  for (const host of hosts) {
    const lookup = await findCname(zoneId, host, token);
    if (lookup.ok && lookup.record?.content === target && lookup.record.proxied === true) {
      log.success(`CNAME ${pc.cyan(host)} → ${pc.cyan(target)} is already in place.`);
      continue;
    }
    needed.push(host);
  }
  return needed;
}

/**
 * Issue the Pages-attach call. `attachPagesDomain` returns one of the
 * "already attached" codes for a duplicate, which counts as done.
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

interface ZoneRef {
  id: string;
  name: string;
}

/**
 * Write a CNAME for every host. Requires a Cloudflare API token with
 * Zone · DNS · Edit — wrangler's OAuth flow doesn't expose DNS write at all
 * (`wrangler login --scopes-list` confirms zone:read is the only zone scope).
 * If no token is configured, drives a one-time paste flow that saves it to
 * `.env.local` so subsequent runs are fully automatic.
 */
async function wireCnames(
  hosts: string[],
  zone: ZoneRef,
  target: string,
  accountId: string,
  projectRoot: string,
  followUps: FollowUp[],
): Promise<void> {
  const zoneId = zone.id;
  let apiToken = await ensureApiToken(accountId, projectRoot, {
    reason: 'initial',
    zoneName: zone.name,
  });
  if (!apiToken) {
    followUps.push({
      kind: 'auth',
      message: `Create a Cloudflare API token from the "Edit zone DNS" template for ${zone.name}, then re-run \`pnpm bootstrap --phase domain\`.`,
    });
    return;
  }

  // Validate the token by *using* it. The /user/tokens/verify endpoint
  // requires user scope, which an account-scoped Zone.DNS:Edit token
  // legitimately lacks — it would falsely report `status: invalid` for
  // perfectly good tokens. The actual CNAME write is the only reliable check.
  // `allowAuthRetry` bounds the loop: at most one auth-failure retry per
  // host, then every subsequent failure path falls through `break`. No
  // need for an iteration counter.
  let allowAuthRetry = true;
  for (const host of hosts) {
    while (true) {
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
        log.error(`Token rejected (HTTP ${r.status}): it needs Zone · DNS · Edit on ${zone.name}.`);
        logSubline(pc.dim(detail));
        clearCloudflareApiToken(projectRoot);
        const fresh = await ensureApiToken(accountId, projectRoot, {
          reason: 'auth-retry',
          zoneName: zone.name,
        });
        if (!fresh) {
          followUps.push({
            kind: 'auth',
            message: `Create a new token from the "Edit zone DNS" template for ${zone.name} and re-run.`,
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
          ? `Create a new token from the "Edit zone DNS" template for ${zone.name}, then re-run.`
          : `Add CNAME ${host} → ${target} (proxied) at ${tokenDashboardUrl(accountId).replace('/api-tokens', `/${zoneId}/dns`)} and re-run.`,
      });
      break;
    }
  }
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

  const oauthToken = rt().wranglerOAuthToken();
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

function tokenPromptBody(accountId: string, zoneName: string): string {
  return [
    `A DNS record for ${zoneName} is missing, and wrangler's sign-in cannot write DNS.`,
    'Make a Cloudflare API token that can, once:',
    '',
    `  1. Open ${pc.cyan(tokenDashboardUrl(accountId))} (Manage Account → API Tokens`,
    '     for the "Las Vegas for Better Transit" account).',
    `  2. Click ${pc.bold('Create Token')}. Next to ${pc.bold('Edit zone DNS')}, click ${pc.bold('Use template')}.`,
    `  3. Token name: ${pc.bold(`${zoneName} DNS (bootstrap)`)}.`,
    `  4. Permissions: keep the one row the template adds: ${pc.bold('Zone · DNS · Edit')}.`,
    `  5. Zone Resources: ${pc.bold(`Include · Specific zone · ${zoneName}`)}.`,
    `  6. Click ${pc.bold('Continue to summary')}, then ${pc.bold('Create Token')}.`,
    '  7. Copy the token (Cloudflare shows it only once) and paste it below.',
    '',
    `It is saved as CLOUDFLARE_API_TOKEN in ${pc.cyan('.env.local')} on this machine only (readable`,
    'only by you, never committed), so later runs do not ask again. It is not the',
    'deploy token that GitHub Actions uses.',
  ].join('\n');
}

interface TokenPromptOptions {
  /** 'initial' = first time asking; 'auth-retry' = previous token was rejected by CF. */
  reason: 'initial' | 'auth-retry';
  /** The zone the token must be able to edit, e.g. lasvegasfortransit.org. */
  zoneName: string;
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

  note(tokenPromptBody(accountId, opts.zoneName), 'Cloudflare API token');
  if (opts.reason === 'initial') tryOpenInBrowser(tokenDashboardUrl(accountId));

  const pasted = await rt().prompts.password({
    id: 'CLOUDFLARE_API_TOKEN',
    message:
      opts.reason === 'auth-retry'
        ? 'Paste a new token (the previous one was rejected):'
        : 'Paste the Cloudflare API token (hidden as you type):',
    validate: validatePastedToken,
  });
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

    const choice = await rt().prompts.select<RecoveryChoice>({
      id: 'domain.account-mismatch',
      message: 'Pick how to fix the account mismatch:',
      options,
      initialValue: 'switch',
    });

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
  // The attempt cap only matters when sleeping takes no time (tests); in a
  // terminal the deadline ends the loop first.
  const maxAttempts = Math.floor(opts.maxWaitMs / opts.intervalMs) + 1;
  let lastIp: string | undefined;
  let lastHttpError: string | undefined;
  for (let attempt = 0; attempt < maxAttempts && Date.now() < deadline; attempt++) {
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
    await rt().sleep(opts.intervalMs);
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
    const res = await rt().fetch(url, { method: 'GET', signal: ctrl.signal, redirect: 'follow' });
    return {
      ok: res.ok,
      status: res.status,
      error: res.ok ? '' : `${res.status} ${res.statusText}`,
    };
  } catch (e) {
    // node:undici exception messages can be very long; keep just the first line.
    return { ok: false, status: 0, error: firstLine((e as Error).message, 80) };
  } finally {
    clearTimeout(timer);
  }
}

/** Order-insensitive string-list compare; we don't want a reorder to count as a change. */
function sortedJoin(xs: string[]): string {
  return [...xs].sort().join(',');
}

// Both lookups answer [] when the name does not resolve.
function safeResolveNs(host: string): Promise<string[]> {
  return rt().resolveNs(host);
}

function safeResolve4(host: string): Promise<string[]> {
  return rt().resolve4(host);
}
