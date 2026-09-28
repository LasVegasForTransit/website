import { config } from '@lasvegasfortransit/eslint-config/base';

export default [
  ...config,
  {
    ignores: [
      '.astro/**',
      '.turbo/**',
      'dist/**',
      'playwright-report/**',
      'test-results/**',
      'tests/snapshots/**',
    ],
  },
];
