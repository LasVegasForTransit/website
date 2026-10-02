import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'zod';

const excludeTemplates = ['**/*.{md,mdx}', '!**/_*.{md,mdx}'];

export const programs = defineCollection({
  loader: glob({ pattern: excludeTemplates, base: './src/content/programs' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    designation: z.enum(['community-gatherings', 'annual-challenges']),
    icon: z.string(),
    order: z.number(),
    cadence: z.string(),
    status: z.enum(['active', 'planned']),
    participationUrl: z.url().optional(),
    venue: z
      .object({
        name: z.string(),
        address: z.string(),
        mapUrl: z.url(),
        status: z.enum(['proposed', 'confirmed']),
      })
      .optional(),
  }),
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
