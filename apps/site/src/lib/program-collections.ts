import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'zod';
import { programSchema } from './program-schema';

const excludeTemplates = ['**/*.{md,mdx}', '!**/_*.{md,mdx}'];

export const programs = defineCollection({
  loader: glob({ pattern: excludeTemplates, base: './src/content/programs' }),
  schema: programSchema,
});

// Broad areas of work explain how projects connect across named programs.
export const workAreas = defineCollection({
  loader: glob({ pattern: excludeTemplates, base: './src/content/work-areas' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    icon: z.string(),
    order: z.number(),
    projects: z.array(z.string()).default([]),
    cohorts: z
      .array(
        z.object({
          name: z.string(),
          status: z.string(),
          description: z.string(),
        }),
      )
      .default([]),
  }),
});
