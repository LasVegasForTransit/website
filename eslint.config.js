import { config } from '@lasvegasfortransit/eslint-config/base';

export default [
  ...config,
  {
    ignores: [
      '.astro/**',
      '.lvbt/web-platform/**',
      'dist/**',
      'playwright-report/**',
      'test-results/**',
      'tests/snapshots/**',
    ],
  },
];
