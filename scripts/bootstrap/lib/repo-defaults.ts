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
