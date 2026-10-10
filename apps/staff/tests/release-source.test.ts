import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertReleaseSource } from '../scripts/release-source';

void test('only the selected clean source commit can be packaged as a release', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lvbt-staff-source-test-'));
  const git = (args: string[], input?: string) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  try {
    git(['init']);
    await writeFile(join(root, 'message'), 'test: create isolated release source\n');
    const blob = git(['hash-object', '-w', '--stdin'], 'dist/\n');
    const tree = git(['mktree'], `100644 blob ${blob}\t.gitignore\n`);
    const initial = git([
      '-c',
      'user.name=Release test',
      '-c',
      'user.email=release@example.invalid',
      'commit-tree',
      tree,
      '-F',
      'message',
    ]);
    git(['update-ref', 'HEAD', initial]);
    git(['restore', '--source=HEAD', '--worktree', '--staged', '.gitignore']);
    await rm(join(root, 'message'));
    const commit = git(['rev-parse', 'HEAD']);
    await assertReleaseSource(root, commit);
    await assert.rejects(assertReleaseSource(root, 'b'.repeat(40)), /source commit/i);
    await writeFile(join(root, 'unreviewed.ts'), 'export const changed = true;');
    await assert.rejects(assertReleaseSource(root, commit), /clean/i);
    await rm(join(root, 'unreviewed.ts'));
    await writeFile(join(root, 'message'), 'test: retain tracked release input\n');
    await writeFile(join(root, 'tracked.ts'), 'export const reviewed = true;');
    execFileSync(
      'sh',
      [
        '-c',
        'git restore --staged . && git add tracked.ts && git -c user.name="Release test" -c user.email=release@example.invalid commit -F message',
      ],
      { cwd: root, stdio: 'pipe' },
    );
    await rm(join(root, 'message'));
    const updated = git(['rev-parse', 'HEAD']);
    await assertReleaseSource(root, updated);
    await writeFile(join(root, 'tracked.ts'), 'export const reviewed = false;');
    await assert.rejects(assertReleaseSource(root, updated), /clean/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
