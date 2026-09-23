// Preview-only pages: the app pattern gallery (/patterns/) and prototypes
// (/prototypes/). They are built in local development and in builds that set
// PUBLIC_LVBT_PREVIEW_PAGES=1 (pull request previews and the CI audit), and
// never in production. The production deploy fails if either folder is in
// its build.

export const previewPagesEnabled =
  // eslint-disable-next-line turbo/no-undeclared-env-vars -- Astro's own development flag, not a build input.
  import.meta.env.DEV || import.meta.env.PUBLIC_LVBT_PREVIEW_PAGES === '1';

export const PREVIEW_PAGE_FOLDERS = ['patterns', 'prototypes'] as const;
