/** Editorial classifications; they do not select a page layout. */
export const PROGRAM_DESIGNATIONS = [
  'community-gatherings',
  'annual-challenges',
  'civic-technology',
] as const;

export type ProgramDesignation = (typeof PROGRAM_DESIGNATIONS)[number];
