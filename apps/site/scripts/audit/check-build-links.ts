import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { distHtmlFiles, relFromDist } from './_shared';
import { linksFromHtml, checkInternalLinks } from './build-links';
import { withLocalWorker } from './local-worker';

const { values } = parseArgs({ options: { 'external-output': { type: 'string' } } });
const dist = path.resolve('dist');
await withLocalWorker(async (origin) => {
  const internal = new Set<string>();
  const external = new Set<string>();
  for (const file of distHtmlFiles(dist)) {
    const links = linksFromHtml(await readFile(file, 'utf8'), relFromDist(dist, file), origin);
    links.internal.forEach((url) => internal.add(url));
    links.external.forEach((url) => external.add(url));
  }
  const redirects = await checkInternalLinks(internal, origin);
  redirects.forEach((url) => external.add(url));
  if (values['external-output'])
    await writeFile(values['external-output'], `${[...external].sort().join('\n')}\n`);
  process.stdout.write(
    `Build link checks passed: ${internal.size} internal URLs, ${external.size} external URLs retained for lychee.\n`,
  );
});
