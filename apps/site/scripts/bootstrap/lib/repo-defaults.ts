import { existsSync } from 'node:fs';
import path from 'node:path';

export interface RepoDefaults {
  /** Inferred repository name — the directory containing the project. */
  repo: string;
  /** Inferred GitHub org/owner — the directory above the project. May be a personal-account name; let the user override. */
  org: string;
  /** `<org>/<repo>` form, suitable for `gh repo create`. */
  fullName: string;
  /**
   * Cloudflare Pages-safe project name derived from the inferred name:
   * lowercase, only [a-z0-9-], no leading/trailing hyphen.
   */
  pagesProject: string;
}

/**
 * The checkout that holds the site: the nearest directory at or above it with
 * a `.git` entry. The site lives in apps/site, so the repository's name and its
 * git state belong to the directory two levels up. Without a checkout (a fresh
 * copy that bootstrap has yet to `git init`), the site directory itself.
 */
export function repositoryRoot(projectRoot: string): string {
  let directory = path.resolve(projectRoot);
  while (!existsSync(path.join(directory, '.git'))) {
    const parent = path.dirname(directory);
    if (parent === directory) return projectRoot;
    directory = parent;
  }
  return directory;
}

export function inferRepoDefaults(projectRoot: string): RepoDefaults {
  const repo = path.basename(projectRoot);
  const org = path.basename(path.dirname(projectRoot));
  const fullName = `${org}/${repo}`;
  const pagesProject = toPagesProjectName(`${org}-${repo}`);
  return { repo, org, fullName, pagesProject };
}

export function toPagesProjectName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
