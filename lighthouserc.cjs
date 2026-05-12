/**
 * Lighthouse CI config. One file, two presets — `LIGHTHOUSE_PRESET=mobile`
 * picks the mobile preset, looser CWV thresholds, and an isolated output
 * dir; anything else (default) runs desktop.
 *
 * URLs are the static index.html files in dist — `staticDistDir` makes
 * lhci spin up its own HTTP server and rewrite `http://localhost/<path>`
 * URLs to that server's port at runtime.
 */

const isMobile = process.env.LIGHTHOUSE_PRESET === 'mobile';

const url = [
  'http://localhost/index.html',
  'http://localhost/about/index.html',
  'http://localhost/about/strategy/index.html',
  'http://localhost/vision/index.html',
  'http://localhost/projects/index.html',
  'http://localhost/events/index.html',
  'http://localhost/contact/index.html',
  'http://localhost/go/index.html',
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

module.exports = {
  ci: {
    collect: {
      staticDistDir: './dist',
      url,
      numberOfRuns: 1,
      settings: { preset: isMobile ? 'mobile' : 'desktop' },
    },
    assert: {
      assertions: isMobile ? mobileAssertions : desktopAssertions,
    },
    upload: {
      target: 'filesystem',
      outputDir: isMobile ? '.lighthouseci-mobile' : '.lighthouseci',
    },
  },
};
