/**
 * Lighthouse CI config. One file, three presets switched via
 * `LIGHTHOUSE_PRESET`:
 *
 *   (unset)   desktop preset, dist/ as the source, tight CWV budgets
 *   mobile    mobile preset, dist/ as the source, looser CWV budgets
 *   prod      mobile preset, live production URLs (no staticDistDir);
 *             same mobile thresholds — what's good enough for the CI
 *             build artifact is the floor for production.
 *
 * The URL list is derived from the built sitemap (see `sampledPaths`) so
 * new pages are audited automatically instead of waiting for someone to
 * edit a hand-kept array. lhci serves dist/ itself for the dist presets
 * and wants `.../index.html` paths; the prod preset uses absolute
 * production URLs. When dist/ isn't present at config-load — the
 * scheduled prod job hits the live origin without building — the list
 * falls back to a small evergreen set.
 */

const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const preset = process.env.LIGHTHOUSE_PRESET ?? '';
const isMobile = preset === 'mobile' || preset === 'prod';
const isProd = preset === 'prod';

const DIST_DIR = './dist';
const PROD_ORIGIN = 'https://lasvegasfortransit.org';

// Collection-driven subtrees. Audit each index plus ONE representative
// detail page (deterministic: first by sorted path) rather than all ~40
// detail pages — enough to catch a regression in the page *template*
// without a 40-URL × 3-run Lighthouse pass on every build.
const DYNAMIC_PREFIXES = ['/events/', '/join/', '/projects/'];

// Used only when dist/sitemap-0.xml is absent at config-load. Small and
// stable — routes guaranteed to exist on the live origin.
const FALLBACK_PATHS = [
  '/',
  '/about/',
  '/about/strategy/',
  '/projects/',
  '/events/',
  '/contact/',
  '/go/',
];

// Representative route sample from the built sitemap. The <loc> parse
// mirrors scripts/audit/_shared.ts::sitemapPaths() — duplicated inline
// because a .cjs can't import the .ts helper without a loader; keep the
// two in sync if the sitemap URL shape changes. Returns null when the
// sitemap is missing so the caller falls back to FALLBACK_PATHS.
function sampledPaths(distDir) {
  const file = join(distDir, 'sitemap-0.xml');
  if (!existsSync(file)) return null;
  const xml = readFileSync(file, 'utf8');
  const all = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => (m[1] ?? '').replace(PROD_ORIGIN, ''))
    .map((p) => p || '/')
    .sort();
  const seenPrefix = new Set();
  const out = [];
  for (const path of all) {
    const prefix = DYNAMIC_PREFIXES.find((pre) => path.startsWith(pre) && path.length > pre.length);
    if (!prefix) {
      out.push(path); // static leaf or a dynamic index — always audited
    } else if (!seenPrefix.has(prefix)) {
      seenPrefix.add(prefix);
      out.push(path); // first detail page under this collection
    }
  }
  return out;
}

const paths = sampledPaths(DIST_DIR) ?? FALLBACK_PATHS;
const distUrl = paths.map((p) =>
  p === '/' ? 'http://localhost/index.html' : `http://localhost${p}index.html`,
);
const prodUrl = paths.map((p) => `${PROD_ORIGIN}${p}`);

const sharedAssertions = {
  // Category scores stay the same across both presets — accessibility,
  // best practices, and SEO don't change with viewport.
  'categories:accessibility': ['error', { minScore: 0.95 }],
  'categories:best-practices': ['error', { minScore: 0.9 }],
  'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
};

const seoAssertions = {
  'categories:seo': ['error', { minScore: 0.95 }],
};

const prodSeoAssertions = {
  // Cloudflare currently injects `Content-Signal: search=yes,ai-train=no,use=reference`
  // into the live robots response. That policy is intentional, but
  // Lighthouse's robots parser still treats it as an unknown directive.
  // Keep the production exception pinned to that audit only and continue
  // checking the rest of the SEO category directly.
  'robots-txt': 'off',
  'document-title': ['error', { minScore: 1 }],
  'meta-description': ['error', { minScore: 1 }],
  'http-status-code': ['error', { minScore: 1 }],
  'link-text': ['error', { minScore: 1 }],
  'crawlable-anchors': ['error', { minScore: 1 }],
  'is-crawlable': ['error', { minScore: 1 }],
  canonical: ['error', { minScore: 1 }],
  hreflang: ['error', { minScore: 1 }],
  'font-size': ['error', { minScore: 1 }],
};

const desktopAssertions = {
  ...sharedAssertions,
  ...seoAssertions,
  'categories:performance': ['error', { minScore: 0.9 }],
  'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
  'total-blocking-time': ['error', { maxNumericValue: 200 }],
  interactive: ['error', { maxNumericValue: 3500 }],
  'speed-index': ['error', { maxNumericValue: 3000 }],
};

const mobileAssertions = {
  ...sharedAssertions,
  ...seoAssertions,
  // Mobile preset emulates a mid-range Moto G4 on slow 4G; perf score
  // and CWV thresholds relax accordingly while staying above the
  // Google "good" cutoffs (LCP ≤ 2.5s/4s, TBT ≤ 200/300ms, etc.).
  'categories:performance': ['error', { minScore: 0.85 }],
  'largest-contentful-paint': ['error', { maxNumericValue: 4000 }],
  'total-blocking-time': ['error', { maxNumericValue: 300 }],
  interactive: ['error', { maxNumericValue: 5000 }],
  'speed-index': ['error', { maxNumericValue: 4500 }],
};

const prodAssertions = {
  ...sharedAssertions,
  ...prodSeoAssertions,
  'categories:performance': ['error', { minScore: 0.85 }],
  'largest-contentful-paint': ['error', { maxNumericValue: 4000 }],
  'total-blocking-time': ['error', { maxNumericValue: 300 }],
  interactive: ['error', { maxNumericValue: 5000 }],
  'speed-index': ['error', { maxNumericValue: 4500 }],
};

// Lighthouse CI's `preset` setting only accepts `perf`, `experimental`,
// or `desktop`. Mobile is the default form-factor (Moto G4 + slow 4G)
// when no preset is set — so for mobile / prod presets we omit it
// entirely and lhci picks up the mobile defaults.
const settings = isMobile ? {} : { preset: 'desktop' };

// Three runs per URL, median-aggregated. Single-run Lighthouse on the
// GH Actions runner has ±5–10% score variance under 4x mobile CPU
// throttling; one bad run was tanking TBT and the perf score. lhci
// asserts against the median of N>1 runs, so three is the smallest
// sample size that's stable. ~2 extra minutes of CI for a budget gate
// that doesn't flap.
const collect = isProd
  ? { url: prodUrl, numberOfRuns: 3, settings }
  : {
      staticDistDir: './dist',
      url: distUrl,
      numberOfRuns: 3,
      settings,
    };

const outputDir = isProd
  ? '.lighthouseci-prod'
  : isMobile
    ? '.lighthouseci-mobile'
    : '.lighthouseci';

module.exports = {
  ci: {
    collect,
    assert: {
      assertions: isProd ? prodAssertions : isMobile ? mobileAssertions : desktopAssertions,
    },
    upload: {
      target: 'filesystem',
      outputDir,
    },
  },
};
