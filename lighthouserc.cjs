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
 * URLs for the dist-mode presets are static index.html paths; lhci
 * starts its own HTTP server on dist/ and rewrites them at runtime.
 * The prod preset replaces them with absolute production URLs.
 */

const preset = process.env.LIGHTHOUSE_PRESET ?? '';
const isMobile = preset === 'mobile' || preset === 'prod';
const isProd = preset === 'prod';

const distUrl = [
  'http://localhost/index.html',
  'http://localhost/about/index.html',
  'http://localhost/about/strategy/index.html',
  'http://localhost/vision/index.html',
  'http://localhost/projects/index.html',
  'http://localhost/events/index.html',
  'http://localhost/contact/index.html',
  'http://localhost/go/index.html',
];

// Production routes the live site actually exposes. Kept in sync with
// distUrl manually — only an evergreen route should land here, since
// the scheduled run is weekly and any drift is felt quickly.
const prodUrl = [
  'https://lasvegasfortransit.org/',
  'https://lasvegasfortransit.org/about/',
  'https://lasvegasfortransit.org/about/strategy/',
  'https://lasvegasfortransit.org/vision/',
  'https://lasvegasfortransit.org/projects/',
  'https://lasvegasfortransit.org/events/',
  'https://lasvegasfortransit.org/contact/',
  'https://lasvegasfortransit.org/go/',
];

const sharedAssertions = {
  // Category scores stay the same across both presets — accessibility,
  // best practices, and SEO don't change with viewport.
  'categories:accessibility': ['error', { minScore: 0.95 }],
  'categories:best-practices': ['error', { minScore: 0.9 }],
  'categories:seo': ['error', { minScore: 0.95 }],
  'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
};

const desktopAssertions = {
  ...sharedAssertions,
  'categories:performance': ['error', { minScore: 0.9 }],
  'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
  'total-blocking-time': ['error', { maxNumericValue: 200 }],
  interactive: ['error', { maxNumericValue: 3500 }],
  'speed-index': ['error', { maxNumericValue: 3000 }],
};

const mobileAssertions = {
  ...sharedAssertions,
  // Mobile preset emulates a mid-range Moto G4 on slow 4G; perf score
  // and CWV thresholds relax accordingly while staying above the
  // Google "good" cutoffs (LCP ≤ 2.5s/4s, TBT ≤ 200/300ms, etc.).
  'categories:performance': ['error', { minScore: 0.85 }],
  'largest-contentful-paint': ['error', { maxNumericValue: 4000 }],
  'total-blocking-time': ['error', { maxNumericValue: 300 }],
  interactive: ['error', { maxNumericValue: 5000 }],
  'speed-index': ['error', { maxNumericValue: 4500 }],
};

const collect = isProd
  ? // No staticDistDir on prod: lhci hits the live origin directly. Two
    // runs averaged out so a single noisy load doesn't tank the report.
    { url: prodUrl, numberOfRuns: 2, settings: { preset: 'mobile' } }
  : {
      staticDistDir: './dist',
      url: distUrl,
      numberOfRuns: 1,
      settings: { preset: isMobile ? 'mobile' : 'desktop' },
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
      assertions: isMobile ? mobileAssertions : desktopAssertions,
    },
    upload: {
      target: 'filesystem',
      outputDir,
    },
  },
};
