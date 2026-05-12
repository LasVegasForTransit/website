// Visual-regression screenshot harness. See tests/README.md for usage,
// baseline policy, and the cross-platform pixel-hinting caveat.
import { defineConfig, devices } from '@playwright/test';

// AUDIT_PORT lets the baseline orchestrator pick a non-default port so it
// doesn't collide with a `pnpm dev` server (which holds 4321) — that
// collision silently reuses the dev server and tests run against whatever
// checkout that server is serving, not the worktree's fresh dist.
const PORT = Number(process.env.AUDIT_PORT ?? '4321');
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    },
  },
  // {platform} expands to 'darwin' on macOS, 'linux' on Ubuntu CI runners,
  // 'win32' on Windows. Pixel hinting differs across OSes — a baseline
  // captured on macOS will diff against an identical render on linux even
  // with no code change. Each platform keeps its own committed set; see
  // tests/README.md for the seeding workflow on each OS.
  snapshotPathTemplate: 'tests/snapshots/{platform}/{projectName}/{arg}{ext}',
  // One project per device band the site is designed to look good on.
  // Widths align to Tailwind's md (768) and lg (1024) breakpoints so each
  // project lands in a distinct layout band. Phones and tablets are
  // captured in both portrait and landscape; desktop sizes only have
  // one orientation in the wild.
  projects: [
    {
      name: 'ui-contracts',
      testMatch: /body-links\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-portrait',
      testMatch: /screenshots\.spec\.ts$/,
      use: { ...devices['iPhone 14'] }, // 390×844, DPR 3
    },
    {
      name: 'mobile-landscape',
      testMatch: /screenshots\.spec\.ts$/,
      use: { ...devices['iPhone 14 landscape'] }, // 844×390, DPR 3
    },
    {
      name: 'tablet-portrait',
      testMatch: /screenshots\.spec\.ts$/,
      use: { viewport: { width: 820, height: 1180 } }, // iPad Air portrait
    },
    {
      name: 'tablet-landscape',
      testMatch: /screenshots\.spec\.ts$/,
      use: { viewport: { width: 1180, height: 820 } }, // iPad Air landscape
    },
    {
      name: 'desktop',
      testMatch: /screenshots\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] }, // 1280×720
    },
    {
      name: 'desktop-xl',
      testMatch: /screenshots\.spec\.ts$/,
      use: { viewport: { width: 1920, height: 1080 } }, // full-HD external display
    },
    {
      name: 'a11y',
      testMatch: /a11y\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Chromium-only — performance.memory and the CDP HeapProfiler hook
      // the spec uses don't exist in Firefox or WebKit. Sampling after
      // CDP-driven GC + scroll-to-end takes a few seconds per page, so
      // give this project a more generous per-test timeout than the
      // default 30 s.
      name: 'perf-memory',
      testMatch: /perf-memory\.spec\.ts$/,
      timeout: 60_000,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // AUDIT_SKIP_BUILD lets the baseline orchestrator (which already builds
    // up front) reuse that dist instead of triggering a rebuild here. A
    // mid-test rebuild rewrites dist/sitemap-0.xml under tests/a11y.spec.ts,
    // which reads it at module load and ENOENTs across late-spawning workers.
    command:
      process.env.AUDIT_SKIP_BUILD === '1'
        ? `pnpm preview --port ${PORT}`
        : `pnpm build && pnpm preview --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
