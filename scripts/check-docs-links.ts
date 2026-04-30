#!/usr/bin/env tsx
/**
 * Validate every relative link in `.md` and `.mdx` files.
 *
 * Walks every `.md` / `.mdx` file (excluding build / cache / vendor dirs),
 * extracts both Markdown `[text](target)` links and JSX-style `<a href="...">`
 * links from MDX, and verifies:
 *   - the target path resolves to an existing file or directory
 *   - if the link has an `#anchor`, that the anchor exists in the target
 *     (matched against GitHub's heading-slug rules)
 *
 * External links (http(s)://, mailto:, tel:, ftp:, bare #frag) are skipped.
 * Site-absolute routes (starting with `/`) are skipped — those are validated
 * by the Astro build's `astro check`.
 *
 * Usage: `pnpm check:docs` — exit 0 = clean, exit 1 = broken links printed.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  '.astro',
  '.lvbt',
  '.git',
  '.wrangler',
  '.github',
  'test-results',
  'playwright-report',
  'tests/snapshots',
]);

interface Link {
  file: string; // repo-relative path
  line: number;
  text: string;
  target: string;
}

interface Broken {
  link: Link;
  reason: string;
}

function walkMarkdown(dir: string, root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (IGNORED_DIRS.has(rel)) continue;
    if (entry.isDirectory()) {
      walkMarkdown(full, root, out);
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (lower.endsWith('.md') || lower.endsWith('.mdx')) out.push(full);
    }
  }
  return out;
}

const MD_LINK_RE = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HREF_RE = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;

function extractLinks(absPath: string, root: string, content: string): Link[] {
  const links: Link[] = [];
  const lines = content.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    MD_LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MD_LINK_RE.exec(line)) !== null) {
      links.push({
        file: path.relative(root, absPath),
        line: i + 1,
        text: m[1] ?? '',
        target: m[2] ?? '',
      });
    }
    HREF_RE.lastIndex = 0;
    while ((m = HREF_RE.exec(line)) !== null) {
      links.push({
        file: path.relative(root, absPath),
        line: i + 1,
        text: '<a>',
        target: m[1] ?? m[2] ?? '',
      });
    }
  }
  return links;
}

function isOutOfScope(target: string): boolean {
  // External protocols, bare anchors, and site-absolute routes are not
  // resolved by this script — the build handles route validation.
  return /^(https?:|mailto:|tel:|ftp:|#|\/)/.test(target);
}

/** GitHub-flavored heading slug, close enough for anchor checks. */
function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/`([^`]*)`/g, '$1') // strip inline code
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // strip markdown link syntax, keep text
    .replace(/[*_~]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractHeadingSlugs(content: string): Set<string> {
  const slugs = new Set<string>();
  let inFence = false;
  for (const line of content.split('\n')) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (m) slugs.add(slugify(m[1]!));
  }
  return slugs;
}

function resolveTarget(
  sourceAbs: string,
  pathPart: string,
): { abs: string; isDir: boolean } | null {
  const base = path.dirname(sourceAbs);
  const decoded = decodeURIComponent(pathPart);
  const abs = path.resolve(base, decoded);
  if (!existsSync(abs)) return null;
  return { abs, isDir: statSync(abs).isDirectory() };
}

function pickAnchorHost(target: { abs: string; isDir: boolean }): string | null {
  if (!target.isDir) return target.abs;
  const indexCandidates = ['README.md', 'readme.md', 'index.md'];
  for (const name of indexCandidates) {
    const candidate = path.join(target.abs, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function main(): number {
  const root = process.cwd();
  const files = walkMarkdown(root, root);
  const headingsCache = new Map<string, Set<string>>();
  const broken: Broken[] = [];
  let checked = 0;

  for (const abs of files) {
    const content = readFileSync(abs, 'utf8');
    // Pre-populate the cache with this file's own headings so a self-anchor
    // link like `[see below](#section)` doesn't trigger a redundant re-read.
    if (!headingsCache.has(abs)) {
      headingsCache.set(abs, extractHeadingSlugs(content));
    }
    const links = extractLinks(abs, root, content);
    for (const link of links) {
      if (isOutOfScope(link.target)) continue;
      checked++;

      const [rawPath = '', anchor] = link.target.split('#');
      const pathPart = rawPath.trim();

      const resolved = resolveTarget(abs, pathPart);
      if (!resolved) {
        broken.push({ link, reason: `path does not exist: ${pathPart}` });
        continue;
      }

      if (!anchor) continue;

      const host = pickAnchorHost(resolved);
      if (!host) {
        broken.push({
          link,
          reason: `link to directory has #anchor but no README.md/index.md to host it`,
        });
        continue;
      }

      let slugs = headingsCache.get(host);
      if (!slugs) {
        slugs = extractHeadingSlugs(readFileSync(host, 'utf8'));
        headingsCache.set(host, slugs);
      }
      if (!slugs.has(anchor)) {
        broken.push({
          link,
          reason: `anchor "#${anchor}" not found in ${path.relative(root, host)}`,
        });
      }
    }
  }

  if (broken.length === 0) {
    console.log(
      `\u2713 ${checked} markdown link${checked === 1 ? '' : 's'} OK across ${files.length} file${files.length === 1 ? '' : 's'}.`,
    );
    return 0;
  }
  console.error(
    `\u2717 ${broken.length} broken link${broken.length === 1 ? '' : 's'} (of ${checked} checked):\n`,
  );
  for (const b of broken) {
    console.error(`  ${b.link.file}:${b.link.line}  [${b.link.text}](${b.link.target})`);
    console.error(`    \u2192 ${b.reason}`);
  }
  return 1;
}

process.exit(main());
