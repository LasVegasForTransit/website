/**
 * Shared validators for `text({ validate })` prompts.
 *
 * Convention: an empty / whitespace-only input is **always** treated as valid
 * here. The caller's `defaultValue` kicks in when the user hits Enter on an
 * empty field — validation should never block that path.
 */

export function validateEmptyAllowed(
  raw: string | undefined,
  test: (trimmed: string) => string | undefined,
): string | undefined {
  const v = (raw ?? '').trim();
  if (!v) return undefined;
  return test(v);
}

const PAGES_PROJECT_RE = /^[a-z0-9](-?[a-z0-9])*$/;
const GIT_BRANCH_RE = /^[A-Za-z0-9._\-/]+$/;
const HOSTNAME_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
const OWNER_REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export const validatePagesProjectName = (raw: string | undefined): string | undefined =>
  validateEmptyAllowed(raw, (v) =>
    PAGES_PROJECT_RE.test(v)
      ? undefined
      : 'Lowercase letters, digits, and dashes only (no leading/trailing dash).',
  );

export const validateGitBranch = (raw: string | undefined): string | undefined =>
  validateEmptyAllowed(raw, (v) =>
    GIT_BRANCH_RE.test(v) && !v.startsWith('-')
      ? undefined
      : 'Use a valid git branch name (no spaces, no leading dash).',
  );

export const validateHostname = (raw: string | undefined): string | undefined =>
  validateEmptyAllowed(raw, (v) =>
    HOSTNAME_RE.test(v) ? undefined : 'Use a valid hostname (e.g. example.org).',
  );

export const validateOwnerRepo = (raw: string | undefined): string | undefined =>
  validateEmptyAllowed(raw, (v) =>
    OWNER_REPO_RE.test(v)
      ? undefined
      : 'Use the form <owner>/<name> with letters, digits, ., _, - only.',
  );
