/**
 * Single source of truth for internal URL shapes. Initiative links are
 * fragment anchors into the projects index, not separate routes — the index
 * groups projects by initiative under matching section ids.
 */
export const paths = {
  projects: '/projects',
  project: (id: string) => `/projects/${id}`,
  initiative: (id: string) => `/projects#${id}`,
} as const;
