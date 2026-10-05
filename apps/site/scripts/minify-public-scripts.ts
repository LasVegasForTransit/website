import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { transform } from 'esbuild';

const directory = resolve('dist/scripts');
const files = (await readdir(directory)).filter((file) => file.endsWith('.js'));

for (const file of files) {
  const path = resolve(directory, file);
  const { code } = await transform(await readFile(path, 'utf8'), {
    loader: 'js',
    minify: true,
    target: 'es2022',
    sourcefile: file,
  });
  await writeFile(path, code);
}

process.stdout.write(`Minified ${files.length} public interaction scripts.\n`);
