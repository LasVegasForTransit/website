import { readFile } from 'node:fs/promises';
import { distHtmlFiles, relFromDist } from './_shared';
import { linksFromHtml, checkInternalLinkResults } from './build-links';
import type { LinkReport, LinkRequest } from '@lasvegasfortransit/web-platform/links';

export async function buildLinkReport(
  dist: string,
  origin: string,
  request: LinkRequest = fetch,
): Promise<LinkReport> {
  const internal = new Set<string>();
  const external = new Set<string>();
  const sources = new Map<string, Set<string>>();
  for (const file of distHtmlFiles(dist)) {
    const page = relFromDist(dist, file);
    const links = linksFromHtml(await readFile(file, 'utf8'), page, origin);
    for (const url of links.internal) {
      internal.add(url);
      const pages = sources.get(url) ?? new Set<string>();
      pages.add(page);
      sources.set(url, pages);
    }
    for (const url of links.external) external.add(url);
  }
  const report = await checkInternalLinkResults(internal, origin, request);
  for (const url of report.external) external.add(url);
  return {
    ...report,
    results: report.results.map((entry) => ({
      ...entry,
      source: [...(sources.get(entry.url) ?? [])].join(', '),
    })),
    external: [...external],
  };
}
interface LycheeEntry {
  url: string;
  status?: { code?: number; text?: string };
}
export interface LycheeReport {
  total: number;
  errors: number;
  error_map?: Record<string, LycheeEntry[]>;
}
export function mergeExternalReport(report: LinkReport, data: LycheeReport): LinkReport {
  if (!Number.isFinite(data.total) || data.total < 1 || !Number.isFinite(data.errors))
    throw new Error('Lychee produced no valid checked URL evidence.');
  const failures = Object.entries(data.error_map ?? {}).flatMap(([source, entries]) =>
    entries.map((entry) => ({
      url: entry.url,
      source,
      status: 'fail' as const,
      diagnostic: `HTTP ${entry.status?.code ?? 'error'}: ${entry.status?.text ?? 'External link failed.'}`,
    })),
  );
  if (data.errors > 0 && !failures.length)
    throw new Error('Lychee failed without concrete URL findings; inspect the raw artifact.');
  return {
    ...report,
    checked: report.checked + data.total,
    results: [...report.results, ...failures],
  };
}

export function selectLinkReport(
  target: string,
  adapters: { local: () => Promise<LinkReport>; production: () => Promise<LinkReport> },
): Promise<LinkReport> {
  if (target === 'local') return adapters.local();
  if (target === 'production') return adapters.production();
  throw new Error(`Unknown link audit target: ${target}`);
}
