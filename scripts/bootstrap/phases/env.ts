import { existsSync, copyFileSync } from 'node:fs';
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
}

const PROMPTED_KEYS: Record<string, EnvKeyConfig> = {
  PUBLIC_LVBT_BEEHIIV_EMBED_URL: {
    prompt: 'Beehiiv newsletter embed URL',
    hint: 'In Beehiiv: Settings → Embed Form → copy the iframe `src=` URL.',
    example: 'https://embeds.beehiiv.com/<id>',
    placeholderTokens: ['PLACEHOLDER'],
    required: false,
    validate: (v) =>
      v && !v.startsWith('https://embeds.beehiiv.com/')
        ? 'Expected a https://embeds.beehiiv.com/... URL.'
        : undefined,
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
  PUBLIC_LVBT_BLUESKY: {
    prompt: 'Bluesky profile URL',
    hint: 'Full URL to the LVBT Bluesky profile.',
    example: 'https://bsky.app/profile/lasvegasfortransit.org',
    required: false,
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
    log.success(`Wrote ${updates.size} value(s) to ${pc.dim('.env.local')}.`);
  } else {
    log.info(pc.dim('Nothing changed.'));
  }

  // Step 5: only ask about Cloudflare Pages env sync if something actually changed
  if (updates.size > 0) {
    const cap = state.capabilities['deploy-wrangler'];
    if (cap?.status === 'ready' && cap.authStatus === 'ready') {
      const sync = await promptConfirm(
        'These vars get baked at build time. Add a follow-up reminder to push them to Cloudflare Pages too?',
        true,
      );
      if (sync) {
        followUpItems.push({
          kind: 'remote',
          message:
            'Run `wrangler pages secret put <KEY> --project-name=<your-project>` for each PUBLIC_LVBT_* var, then redeploy so the new values bake in.',
        });
      }
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
