import { log } from '@clack/prompts';
import pc from 'picocolors';
import { attachWorkerDomain, findZoneIdForName, listWorkerDomains } from '../lib/cloudflare-api.js';
import { ensureCloudflareAccount } from '../lib/cloudflare.js';
import { DEFAULT_APEX_DOMAIN, DEFAULT_WORKER_NAME } from '../lib/defaults.js';
import { rt } from '../lib/runtime.js';
import { promptConfirm } from '../lib/ui.js';
import type { FollowUp, PhaseResult } from '../lib/types.js';

const HOSTS = [DEFAULT_APEX_DOMAIN, `www.${DEFAULT_APEX_DOMAIN}`] as const;

function savedCloudflareAccount(): string | undefined {
  // eslint-disable-next-line turbo/no-undeclared-env-vars -- local bootstrap account choice.
  return process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
}

async function missingWorkerDomains(
  accountId: string,
  token: string,
  followUpItems: FollowUp[],
): Promise<string[]> {
  const missing: string[] = [];
  for (const host of HOSTS) {
    const response = await listWorkerDomains(accountId, host, token);
    if (!response.ok || !response.data) {
      followUpItems.push({
        kind: 'auth',
        message: `Could not read the Worker domain for ${host}; check Cloudflare permissions.`,
      });
      continue;
    }
    const attached = response.data.find((domain) => domain.hostname === host);
    if (attached?.service === DEFAULT_WORKER_NAME) {
      log.success(`${pc.cyan(host)} routes to ${pc.cyan(DEFAULT_WORKER_NAME)}.`);
    } else if (attached) {
      followUpItems.push({
        kind: 'remote',
        message: `${host} belongs to Worker ${attached.service}; transfer it explicitly before rerunning bootstrap.`,
      });
    } else {
      missing.push(host);
    }
  }
  return missing;
}

async function attachMissingDomains(
  accountId: string,
  token: string,
  missing: readonly string[],
  followUpItems: FollowUp[],
): Promise<void> {
  const zone = await findZoneIdForName(DEFAULT_APEX_DOMAIN, token);
  if (!zone.zoneId || !zone.zoneName) {
    followUpItems.push({
      kind: 'auth',
      message: `Could not find the ${DEFAULT_APEX_DOMAIN} zone in this Cloudflare account.`,
    });
    return;
  }
  for (const host of missing) {
    const attached = await attachWorkerDomain(
      accountId,
      {
        hostname: host,
        service: DEFAULT_WORKER_NAME,
        zone_id: zone.zoneId,
        zone_name: zone.zoneName,
      },
      token,
    );
    if (attached.ok) {
      log.success(`${pc.cyan(host)} attached to ${pc.cyan(DEFAULT_WORKER_NAME)}.`);
    } else {
      followUpItems.push({
        kind: 'remote',
        message: `Could not attach ${host}: ${attached.errors.map((error) => error.message).join('; ')}. Remove any conflicting Pages CNAME only during an approved cutover.`,
      });
    }
  }
}

export async function runWorkerDomainPhase(
  projectRoot: string,
  doctorMode: boolean,
): Promise<PhaseResult> {
  const followUpItems: FollowUp[] = [];
  const accountId = doctorMode
    ? savedCloudflareAccount()
    : (await ensureCloudflareAccount(projectRoot)).accountId;
  // eslint-disable-next-line turbo/no-undeclared-env-vars -- local bootstrap credential, not a build input.
  const token = rt().wranglerOAuthToken() ?? process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) {
    followUpItems.push({
      kind: 'auth',
      message:
        'Sign in with Wrangler and select the LVBT Cloudflare account, then rerun `pnpm bootstrap --phase domain`.',
    });
    return { success: false, followUpItems };
  }

  const missing = await missingWorkerDomains(accountId, token, followUpItems);

  if (missing.length === 0 || doctorMode || followUpItems.length > 0) {
    if (doctorMode) {
      for (const host of missing) {
        followUpItems.push({
          kind: 'remote',
          message: `Attach ${host} to ${DEFAULT_WORKER_NAME} with pnpm bootstrap --phase domain.`,
        });
      }
    }
    return { success: followUpItems.length === 0, followUpItems };
  }

  const confirmed = await promptConfirm(
    'domain.attach-worker',
    `Attach ${missing.join(' and ')} to the production Worker?`,
    true,
  );
  if (!confirmed) {
    followUpItems.push({
      kind: 'remote',
      message: 'Attach the missing Worker domains with `pnpm bootstrap --phase domain`.',
    });
    return { success: false, followUpItems };
  }

  await attachMissingDomains(accountId, token, missing, followUpItems);
  return { success: followUpItems.length === 0, followUpItems };
}
