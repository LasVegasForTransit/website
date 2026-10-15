import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

test('lossless snapshots and fail-closed backup recovery', () => {
  execFileSync(
    'python3',
    ['-B', '-m', 'unittest', 'discover', '-s', 'tests/support', '-p', '*_cases.py'],
    {
      cwd: new URL('..', import.meta.url),
      stdio: 'inherit',
    },
  );
});
