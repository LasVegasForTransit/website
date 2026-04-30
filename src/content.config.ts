import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const docs = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    order: z.number().optional(),
    updated: z.coerce.date(),
  }),
});

const events = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/events' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    endDate: z.coerce.date().optional(),
    location: z.string(),
    featured: z.boolean().default(false),
    rsvpUrl: z.string().url().optional(),
    summary: z.string(),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    status: z.enum(['active', 'planned', 'complete', 'paused']),
    initiatives: z.array(z.string()),
    tldr: z.string(),
    contacts: z.array(z.object({ name: z.string(), role: z.string() })).default([]),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().optional(),
    order: z.number().optional(),
  }),
});

const initiatives = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/initiatives' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    color: z.enum(['accent', 'ink', 'mute']).default('accent'),
  }),
});

const pages = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    summary: z.string().optional(),
  }),
});

export const collections = { docs, events, projects, initiatives, pages };
