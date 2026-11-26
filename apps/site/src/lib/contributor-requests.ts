import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'zod';

// Editors write one short file per request. The same choices appear on the posting and its form.
export const contributorRequests = defineCollection({
  loader: glob({
    pattern: ['**/*.{md,mdx}', '!**/_*.{md,mdx}'],
    base: './src/content/contributor-requests',
  }),
  schema: z.object({
    project: z.string().min(1),
    title: z.string().min(1),
    listing: z.string().min(1),
    summary: z.string().min(1),
    interestPrompt: z.string().min(1).default('Which part of this project would you work on?'),
    waysToHelp: z
      .array(z.object({ title: z.string().min(1), description: z.string().min(1) }))
      .min(1)
      .max(5),
  }),
});
