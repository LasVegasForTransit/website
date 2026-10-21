import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    pointers: { type: 'string' },
    seed: { type: 'string' },
    objects: { type: 'string' },
  },
});
if (!values.pointers || !values.seed || !values.objects) {
  throw new Error('Select pointer, seed and LFS object directories.');
}
const counts = { seeded: 0, missing: 0, unmatched: 0, bytes: 0 };
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const pointerPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(pointerPath);
    } else if (entry.isFile() && entry.name.endsWith('.png')) {
      const pointer = await readFile(pointerPath, 'utf8');
      const match =
        /^version https:\/\/git-lfs.github.com\/spec\/v1\noid sha256:([a-f0-9]{64})\nsize (\d+)\n?$/.exec(
          pointer,
        );
      if (!match) throw new Error('Expected an unmaterialized Git LFS pointer.');
      const candidate = path.join(values.seed, path.relative(values.pointers, pointerPath));
      const info = await lstat(candidate).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!info) {
        counts.missing++;
        continue;
      }
      if (!info.isFile() || info.size !== Number(match[2])) {
        counts.unmatched++;
        continue;
      }
      const bytes = await readFile(candidate);
      if (createHash('sha256').update(bytes).digest('hex') !== match[1]) {
        counts.unmatched++;
        continue;
      }
      const destination = path.join(
        values.objects,
        match[1].slice(0, 2),
        match[1].slice(2, 4),
        match[1],
      );
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
      counts.seeded++;
      counts.bytes += bytes.length;
    }
  }
}
await visit(values.pointers);
console.log(JSON.stringify(counts));
