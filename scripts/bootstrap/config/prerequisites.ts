import type { CapabilityId, CommandGroup } from '../lib/types.js';

export interface AuthSpec {
  checkCommand: string;
  loginCommand: string;
  interactive?: boolean;
}

export interface InstallCommandsByOs {
  macos: string[];
  linux: string[];
}

export interface CapabilityConfig {
  id: CapabilityId;
  label: string;
  category: 'core' | 'deploy';
  requiredFor: CommandGroup[];
  requiredByDefault: boolean;
  binaryCommand: string;
  versionCommand?: string;
  minVersion?: string;
  versionPrefix?: string;
  installCommands: InstallCommandsByOs;
  pathCandidates?: string[];
  auth?: AuthSpec;
  postInstallHint?: string;
}

export const CAPABILITY_SPECS: CapabilityConfig[] = [
  {
    id: 'core-node',
    label: 'Node.js',
    category: 'core',
    requiredFor: ['dev', 'build', 'deploy'],
    requiredByDefault: true,
    binaryCommand: 'command -v node',
    versionCommand: 'node --version',
    minVersion: '24.18.0',
    installCommands: {
      macos: ['brew install node@24'],
      linux: [
        'curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -',
        'sudo apt-get install -y nodejs',
      ],
    },
  },
  {
    id: 'core-pnpm',
    label: 'pnpm',
    category: 'core',
    requiredFor: ['dev', 'build', 'deploy'],
    requiredByDefault: true,
    binaryCommand: 'command -v pnpm',
    versionCommand: 'pnpm --version',
    minVersion: '10.0.0',
    installCommands: {
      macos: ['corepack enable', 'corepack prepare pnpm@10.33.0 --activate'],
      linux: ['corepack enable', 'corepack prepare pnpm@10.33.0 --activate'],
    },
  },
  {
    id: 'core-git-lfs',
    label: 'Git LFS',
    category: 'core',
    // Visual-regression baselines (tests/snapshots/**/*.png) are stored in
    // Git LFS so they don't bloat the git pack. Without git-lfs a clone gets
    // pointer files instead of real PNGs and `pnpm test` can't compare.
    requiredFor: [],
    requiredByDefault: true,
    binaryCommand: 'command -v git-lfs',
    versionCommand: 'git lfs version',
    installCommands: {
      macos: ['brew install git-lfs', 'git lfs install'],
      linux: ['sudo apt-get install -y git-lfs', 'git lfs install'],
    },
    postInstallHint:
      'After installing, run `git lfs install` then `git lfs pull` to materialize the baseline PNGs.',
  },
  {
    id: 'core-actionlint',
    label: 'actionlint',
    category: 'core',
    // No CommandGroup gates on actionlint (it doesn't deploy or build), but
    // it's required-by-default so the install phase prompts when missing —
    // future workflow edits should never reach `git push` un-linted.
    requiredFor: [],
    requiredByDefault: true,
    binaryCommand: 'command -v actionlint',
    versionCommand: 'actionlint -version',
    installCommands: {
      macos: ['brew install actionlint'],
      // Upstream's official install script: pulls a static binary, no go/sudo.
      // We drop into ~/.local/bin so users don't need root; pathCandidates
      // below picks it up even when ~/.local/bin isn't on PATH yet.
      linux: [
        'mkdir -p "$HOME/.local/bin"',
        'curl -fsSL https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash | bash -s -- latest "$HOME/.local/bin"',
      ],
    },
    pathCandidates: [
      '/opt/homebrew/bin/actionlint',
      '/usr/local/bin/actionlint',
      '$HOME/.local/bin/actionlint',
    ],
    postInstallHint:
      'If actionlint is not detected after install, add `$HOME/.local/bin` (Linux) or the brew bin dir (macOS) to PATH.',
  },
  {
    id: 'tool-pngquant',
    label: 'pngquant',
    category: 'core',
    // Not strictly required for `pnpm dev`, but the asset-budget audit
    // (scripts/audit/asset-budget.ts) flags any raster over 20 KB without
    // a .webp companion. pngquant is the simplest tool for re-compressing
    // the existing PNGs (logo, OG default) below that ceiling. Optional
    // so a fresh clone without it still passes bootstrap; doctor mode
    // flags absence with the brew/apt one-liner.
    requiredFor: [],
    requiredByDefault: false,
    binaryCommand: 'command -v pngquant',
    versionCommand: 'pngquant --version',
    installCommands: {
      macos: ['brew install pngquant'],
      linux: ['sudo apt-get install -y pngquant'],
    },
  },
  {
    id: 'deploy-gh',
    label: 'GitHub CLI',
    category: 'deploy',
    requiredFor: ['deploy'],
    requiredByDefault: true,
    binaryCommand: 'command -v gh',
    versionCommand: 'gh --version',
    installCommands: {
      macos: ['brew install gh'],
      linux: ['sudo apt-get install -y gh'],
    },
    auth: {
      checkCommand: 'gh auth status 2>/dev/null',
      loginCommand: 'gh auth login',
      interactive: true,
    },
  },
  {
    id: 'deploy-wrangler',
    label: 'Cloudflare Wrangler',
    category: 'deploy',
    requiredFor: ['deploy'],
    requiredByDefault: true,
    binaryCommand: 'command -v wrangler',
    versionCommand: 'wrangler --version',
    installCommands: {
      macos: ['pnpm add -g wrangler'],
      linux: ['pnpm add -g wrangler'],
    },
    auth: {
      checkCommand: "wrangler whoami 2>/dev/null | grep -q '@'",
      loginCommand: 'wrangler login',
      interactive: true,
    },
  },
  {
    id: 'deploy-dig',
    label: 'dig (BIND DNS utilities)',
    category: 'deploy',
    requiredFor: [],
    requiredByDefault: false,
    binaryCommand: 'command -v dig',
    installCommands: {
      macos: ['brew install bind'],
      linux: ['sudo apt-get install -y dnsutils'],
    },
  },
];

export const COMMAND_CAPABILITY_MAP: Record<CommandGroup, CapabilityId[]> = {
  dev: ['core-node', 'core-pnpm'],
  build: ['core-node', 'core-pnpm'],
  deploy: ['core-node', 'core-pnpm', 'deploy-gh', 'deploy-wrangler'],
};
