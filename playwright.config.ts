// Visual-regression screenshot harness. See tests/README.md for usage,
// baseline policy, and the cross-platform pixel-hinting caveat.
import { defineConfig, devices } from '@playwright/test';

const PORT = 4321;
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
  snapshotPathTemplate: 'tests/snapshots/{projectName}/{arg}{ext}',
  // One project per device band the site is designed to look good on.
  // Widths align to Tailwind's md (768) and lg (1024) breakpoints so each
  // project lands in a distinct layout band. Phones and tablets are
  // captured in both portrait and landscape; desktop sizes only have
  // one orientation in the wild.
  projects: [
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
  ],
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
