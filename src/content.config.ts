import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'zod';
import { calendarEventsLoader } from './lib/events-loader';
import { beehiivNewsletterLoader } from './lib/newsletter-loader';

const docs = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    order: z.number().optional(),
    updated: z.coerce.date(),
  }),
});

// Events are sourced from the public Google Calendar feed (see
// docs/explanation/events-pipeline.md). The custom loader in
// src/lib/events-loader.ts fetches the ICS, derives `format` and the
// per-event slug, auto-features the nearest upcoming event, and emits
// entries that satisfy the schema below. The schema's job here is now
// validation, not user-facing authoring shape.
const events = defineCollection({
  loader: calendarEventsLoader(),
  schema: z
    .object({
      title: z.string(),
      date: z.coerce.date(),
      endDate: z.coerce.date().optional(),
      format: z.enum(['virtual', 'in-person', 'hybrid']),
      venue: z
        .object({
          name: z.string(),
          streetAddress: z.string().optional(),
          addressLocality: z.string().default('Las Vegas'),
          addressRegion: z.string().default('NV'),
          addressCountry: z.string().default('US'),
        })
        .optional(),
      joinUrl: z.url().optional(),
      rsvpUrl: z.url().optional(),
      featured: z.boolean().default(false),
      summary: z.string(),
      // HTML body, derived from everything in the GCal description after
      // the first paragraph. Rendered via `set:html` on the detail page
      // when no MDX body fragment exists. Source is the LVBT-controlled
      // calendar; treated as trusted.
      body: z.string().optional(),
      image: z.string().optional(),
    })
    .superRefine((data, ctx) => {
      if (data.format !== 'virtual' && !data.venue) {
        ctx.addIssue({
          code: 'custom',
          path: ['venue'],
          message: '`venue` is required when format is `in-person` or `hybrid`',
        });
      }
      if (data.format !== 'in-person' && !data.joinUrl) {
        ctx.addIssue({
          code: 'custom',
          path: ['joinUrl'],
          message: '`joinUrl` is required when format is `virtual` or `hybrid`',
        });
      }
      // `endDate` is optional but, when present, must come strictly after
      // `date`. The .ics builder and the Live-now check otherwise emit
      // negative-duration events or never-live windows.
      if (data.endDate && data.endDate.getTime() <= data.date.getTime()) {
        ctx.addIssue({
          code: 'custom',
          path: ['endDate'],
          message: '`endDate` must be strictly after `date`',
        });
      }
    }),
});

// Optional long-form MDX body for an event. File name = event slug
// (e.g. 2026-05-28-general-meeting.mdx matches the calendar event whose
// derived slug is 2026-05-28-general-meeting). When a fragment is
// present, the detail page renders it below the header; otherwise the
// header is the full page. Frontmatter is intentionally minimal.
const eventBodies = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/event-bodies' }),
  schema: z.object({
    slug: z.string(),
  }),
});

// Newsletter issues sourced from the Beehiiv RSS feed (see
// src/lib/newsletter-loader.ts). The loader fetches the feed at build, derives
// a plain-text excerpt, and emits entries whose `link` points at the
// Beehiiv-hosted post — the site lists issues but does not host them. An empty
// feed is valid (no first issue yet); the page handles the empty state.
const newsletter = defineCollection({
  loader: beehiivNewsletterLoader(),
  schema: z.object({
    title: z.string(),
    link: z.url(),
    pubDate: z.coerce.date(),
    excerpt: z.string(),
    image: z.string().optional(),
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
    // Per-goal status so the public roadmap reads as live commitments, not
    // static aspiration. Three statuses, one optional target date. Keep it
    // simple — this is a public tracker, not a project-management system.
    // Render via src/components/ProjectGoals.astro.
    goals: z
      .array(
        z.object({
          text: z.string(),
          status: z.enum(['planned', 'in-progress', 'done']).default('planned'),
          target: z.coerce.date().optional(),
        }),
      )
      .default([]),
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

// Inline-tooltip glossary. One JSON file per term, keyed by filename. Looked up
// by <Gloss term="…" /> in MDX (src/components/inline/Gloss.astro). `term` is
// the canonical display form; `short` is the popover-sized definition.
const glossary = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/glossary' }),
  schema: z.object({
    term: z.string(),
    short: z.string(),
    // Optional long-form definition. Not rendered by the default <Gloss>;
    // available for a future /glossary index page or expanded popover.
    long: z.string().optional(),
    // Wikipedia-style intertextuality. When present, the <Gloss> trigger
    // renders as an external <a> instead of a <button>: click navigates to the
    // canonical source; the popover still shows on hover/focus.
    url: z.url().optional(),
  }),
});

const roles = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/roles' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    commitment: z.string(),
    team: z.string().optional(),
    order: z.number().optional(),
  }),
});

export const collections = {
  docs,
  events,
  eventBodies,
  newsletter,
  projects,
  initiatives,
  pages,
  glossary,
  roles,
};
