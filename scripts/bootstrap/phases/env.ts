import { existsSync, copyFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { log, text } from '@clack/prompts';
import pc from 'picocolors';
import type { FollowUp, PhaseResult } from '../lib/types.js';
import { parseEnvFile, mergeEnvFile } from '../lib/env-file.js';
import { promptOrExit, promptConfirm, printToolTable, type ToolRow } from '../lib/ui.js';
import type { ReadinessState } from '../state.js';

interface EnvKeyConfig {
  prompt: string;
  hint: string;
  example?: string;
  placeholderTokens?: string[];
  validate?: (raw: string) => string | undefined;
  required: boolean;
  // When set, bootstrap mints the value itself instead of prompting (used for
  // the membership intake shared secret, which has no dashboard to copy from).
  generate?: () => string;
  // Extra line printed after the value is set — e.g. where to mirror a
  // generated secret that bootstrap can't reach (Apps Script script property).
  postFill?: string;
}

const PROMPTED_KEYS: Record<string, EnvKeyConfig> = {
  LVBT_BEEHIIV_API_KEY: {
    prompt: 'Beehiiv API key',
    hint: 'In Beehiiv: Settings → API → create a key scoped to Subscribers (write). Server-side only — never baked into HTML.',
    example: 'sk_live_...',
    // No placeholderTokens — .env.example ships this key empty, so the
    // empty-value branch in `valueIsPlaceholder` handles "still pending".
    // `validate` rejects anyone who pastes the literal `sk_live_...` example.
    required: false,
    validate: (v) =>
      v && v.length < 20 ? 'That looks too short to be a valid API key.' : undefined,
  },
  LVBT_BEEHIIV_PUBLICATION_ID: {
    prompt: 'Beehiiv publication ID',
    hint: 'In Beehiiv: Settings → Publication → copy the ID (starts with pub_).',
    example: 'pub_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    placeholderTokens: ['pub_PLACEHOLDER'],
    required: false,
    validate: (v) =>
      v && !v.startsWith('pub_') ? 'Expected a pub_... ID from the Beehiiv dashboard.' : undefined,
  },
  LVBT_MEMBERSHIP_INTAKE_SECRET: {
    prompt: 'Membership intake shared secret',
    hint: 'Random bearer token shared by Google Apps Script and the Cloudflare Pages Function. Server-side only.',
    required: false,
    // Minted here rather than prompted: there is no dashboard to copy it from,
    // and both sides just need the same opaque value.
    generate: () => randomBytes(32).toString('hex'),
    postFill:
      'Paste this same value into Apps Script → Project Settings → Script properties as LVBT_MEMBERSHIP_INTAKE_SECRET.',
  },
  LVBT_NOTION_API_KEY: {
    prompt: 'Notion API key',
    hint: 'Internal Notion integration secret with Insert Content access to the membership intake data source.',
    example: 'ntn_...',
    required: false,
    validate: (v) =>
      v && v.length < 20 ? 'That looks too short to be a valid Notion API key.' : undefined,
  },
  LVBT_NOTION_DATA_SOURCE_ID: {
    prompt: 'Notion membership intake data source ID',
    hint: 'The Notion data source ID (not the database ID) where intake pages are created. See docs/reference/membership-intake.md.',
    example: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    required: false,
  },
  PUBLIC_LVBT_MEMBERSHIP_FORM_URL: {
    prompt: 'Membership form URL',
    hint: 'Public Google Form for new members — the forms.gle short link (Send → link → Shorten URL). Drives the /join CTA and the QR slide.',
    example: 'https://forms.gle/xxxxxxxxxxxx',
    required: false,
    validate: (v) =>
      v && !/^https?:\/\//.test(v) ? 'Use an absolute URL starting with https://' : undefined,
  },
  PUBLIC_LVBT_DONATE_URL: {
    prompt: 'Donation URL',
    hint: 'Givebutter, Donorbox, or other donation page.',
    example: 'https://givebutter.com/your-campaign',
    placeholderTokens: ['givebutter.com/lvbt'],
    required: false,
    validate: (v) =>
      v && !/^https?:\/\//.test(v) ? 'Use an absolute URL starting with https://' : undefined,
  },
  PUBLIC_LVBT_INSTAGRAM: {
    prompt: 'Instagram profile URL',
    hint: 'Full URL to the LVBT Instagram profile.',
    example: 'https://instagram.com/lasvegasfortransit',
    required: false,
  },
  PUBLIC_LVBT_LINKEDIN: {
    prompt: 'LinkedIn organization URL',
    hint: 'Full URL to the LVBT LinkedIn organization page.',
    example: 'https://www.linkedin.com/company/lasvegasfortransit/',
    required: false,
  },
  PUBLIC_LVBT_BLUESKY: {
    prompt: 'Bluesky profile URL',
    hint: 'Full URL to the LVBT Bluesky profile.',
    example: 'https://bsky.app/profile/lasvegasfortransit.org',
    required: false,
  },
  PUBLIC_LVBT_DISCORD: {
    prompt: 'Discord invite URL',
    hint: 'Server → Invite People → copy a non-expiring invite link.',
    example: 'https://discord.gg/xxxxxxxx',
    required: false,
  },
  PUBLIC_CWA_TOKEN: {
    prompt: 'Cloudflare Web Analytics site token',
    hint: 'Cloudflare dashboard → Analytics → Web Analytics → your site → Token. Leave blank for local dev — no token means no beacon ships and the strict CSP holds.',
    example: 'abcdef0123456789abcdef0123456789',
    required: false,
    // Tokens are 32-char hex strings in practice. Reject anything
    // obviously smaller so paste mistakes (just the first few chars)
    // don't silently end up baked into the static HTML.
    validate: (v) =>
      v && v.length < 16
        ? 'That token looks too short — copy the full value from the CF dashboard.'
        : undefined,
  },
};

export async function runEnvPhase(
  projectRoot: string,
  doctorMode: boolean,
  state: ReadinessState,
): Promise<PhaseResult> {
  const followUpItems: FollowUp[] = [];
  const envLocalPath = path.join(projectRoot, '.env.local');
  const examplePath = path.join(projectRoot, '.env.example');

  // Step 1: ensure .env.local exists from .env.example
  if (!existsSync(examplePath)) {
    log.warn('.env.example missing — will create a fresh empty .env.local.');
  } else if (!existsSync(envLocalPath)) {
    if (doctorMode) {
      log.warn('.env.local: missing (would copy from .env.example)');
      followUpItems.push({ kind: 'local', message: 'Copy .env.example to .env.local' });
    } else {
      copyFileSync(examplePath, envLocalPath);
      log.success('.env.local: created from .env.example');
    }
  } else {
    log.success('.env.local: exists');
  }

  // Step 2: show current config status (placeholder vs live)
  const env = parseEnvFile(envLocalPath);
  const rows: ToolRow[] = [];
  const placeholderKeys: string[] = [];

  for (const [key, config] of Object.entries(PROMPTED_KEYS)) {
    const current = (env.get(key) ?? '').trim();
    const isPlaceholder = !current || valueIsPlaceholder(current, config.placeholderTokens);
    if (isPlaceholder) {
      rows.push({ label: config.prompt, status: 'pending', detail: 'placeholder' });
      placeholderKeys.push(key);
    } else {
      rows.push({ label: config.prompt, status: 'ready', detail: trimDisplay(current) });
    }
  }
  printToolTable('Site config (.env.local)', rows);

  if (doctorMode) {
    if (placeholderKeys.length > 0) {
      followUpItems.push({
        kind: 'local',
        message: `Run \`pnpm bootstrap --phase env\` to fill in ${placeholderKeys.length} placeholder value(s) in .env.local.`,
      });
    }
    return { success: followUpItems.length === 0, followUpItems };
  }

  if (placeholderKeys.length === 0) {
    log.success('All site config is already set.');
    return { success: true, followUpItems };
  }

  // Step 3: single up-front gate
  const fillInNow = await promptConfirm(
    `Fill in the ${placeholderKeys.length} placeholder value(s) now? (n keeps placeholders — re-run with \`pnpm bootstrap --phase env\` later.)`,
    false,
  );

  if (!fillInNow) {
    log.info(
      pc.dim(
        'Keeping placeholders. Re-run `pnpm bootstrap --phase env` whenever you have the URLs.',
      ),
    );
    return { success: true, followUpItems };
  }

  // Step 4: prompt only for placeholder keys
  const updates = new Map<string, string>();
  for (const key of placeholderKeys) {
    const config = PROMPTED_KEYS[key]!;

    // Generated keys (the intake shared secret) are minted, not prompted, then
    // echoed so the same value can be pasted into the system bootstrap can't
    // reach (Apps Script).
    if (config.generate) {
      const generated = config.generate();
      updates.set(key, generated);
      log.success(`${config.prompt}: generated.`);
      log.info(pc.dim(`  ${generated}`));
      if (config.postFill) log.info(pc.dim(`  ${config.postFill}`));
      continue;
    }

    // Hint is surrounding context (where to find the value, what blank means).
    log.info(pc.dim(config.hint));
    const value = await promptOrExit(
      text({
        // Placeholder is the greyed example inside the input — never submitted.
        message: `${config.prompt} ${pc.dim('(blank to skip)')}`,
        placeholder: config.example,
        validate: (raw: string | undefined) => {
          const trimmed = (raw ?? '').trim();
          if (!trimmed) {
            return config.required ? `${config.prompt} is required.` : undefined;
          }
          return config.validate ? config.validate(trimmed) : undefined;
        },
      }),
    );

    if (typeof value === 'string' && value.trim()) {
      updates.set(key, value.trim());
    }
  }

  if (updates.size > 0) {
    mergeEnvFile(envLocalPath, updates);
    // Also hydrate the live process env so a deploy phase later in this same
    // run pushes the just-entered values instead of the stale startup snapshot.
    for (const [key, value] of updates) {
      process.env[key] = value;
    }
    log.success(`Wrote ${updates.size} value(s) to ${pc.dim('.env.local')}.`);
  } else {
    log.info(pc.dim('Nothing changed.'));
  }

  // Step 5: only ask about Cloudflare Pages env sync if something actually changed
  const cap = state.capabilities['deploy-wrangler'];
  if (updates.size === 0 || cap?.status !== 'ready' || cap.authStatus !== 'ready') {
    return { success: true, followUpItems };
  }

  let hasPublicVars = false;
  let hasSecretVars = false;
  for (const k of updates.keys()) {
    if (k.startsWith('PUBLIC_')) hasPublicVars = true;
    else hasSecretVars = true;
    if (hasPublicVars && hasSecretVars) break;
  }

  const lines: string[] = [];
  if (hasSecretVars) {
    lines.push(
      'For server-side LVBT_* vars (non-PUBLIC): `pnpm bootstrap --phase deploy` pushes them as Production secrets. For the Preview environment, add them as Secrets in Cloudflare Pages → Settings → Environment Variables.',
    );
  }
  if (hasPublicVars) {
    lines.push(
      'For PUBLIC_LVBT_* vars: run `wrangler pages secret put <KEY> --project-name=lvbt-website`, then redeploy so the new values bake into the static HTML.',
    );
  }
  if (lines.length > 0) {
    const sync = await promptConfirm(
      'Add a follow-up reminder to sync these vars to Cloudflare Pages?',
      true,
    );
    if (sync) {
      followUpItems.push({ kind: 'remote', message: lines.join(' ') });
    }
  }

  return { success: true, followUpItems };
}

function valueIsPlaceholder(value: string, tokens?: string[]): boolean {
  if (!value) return true;
  if (!tokens) return false;
  return tokens.some((t) => value.includes(t));
}

function trimDisplay(s: string): string {
  return s.length > 40 ? s.slice(0, 37) + '...' : s;
}
