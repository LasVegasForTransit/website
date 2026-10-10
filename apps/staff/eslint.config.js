import { config } from '@lasvegasfortransit/eslint-config/base';

export default [
  ...config,
  {
    files: ['tests/e2e/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './tsconfig.e2e.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
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
