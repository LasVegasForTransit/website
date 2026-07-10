import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { calendarEventsLoader } from './lib/events-loader';
import { beehiivNewsletterLoader } from './lib/newsletter-loader';
import { eventLocationSchema } from './lib/event-format';

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
      // How to attend, as a discriminated union (`format` is its discriminant).
      // Omitted when the event's details aren't arranged yet — confirmed and
      // dated, but join URL / venue still pending. See lib/event-format.ts.
      location: eventLocationSchema.optional(),
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
const EVENT_BODIES_DIR = './src/content/event-bodies';

const eventBodiesLoader = existsSync(EVENT_BODIES_DIR)
  ? glob({ pattern: '**/*.{md,mdx}', base: EVENT_BODIES_DIR })
  : {
      name: 'empty-event-bodies-loader',
      load: async ({ store }: { store: { clear: () => void } }) => {
        store.clear();
      },
    };

const eventBodies = defineCollection({
  loader: eventBodiesLoader,
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

// Pattern excludes `_`-prefixed files (e.g. `_template.mdx`) at the loader
// level — so an authoring template never enters the content store and never
// needs a `(entry) => !entry.id.startsWith('_'))` filter at each call site.
// See docs/reference/content-collections.md's "Templates" section.
const excludeTemplates = ['**/*.{md,mdx}', '!**/_*.{md,mdx}'];

const projects = defineCollection({
  loader: glob({ pattern: excludeTemplates, base: './src/content/projects' }),
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

const programs = defineCollection({
  loader: glob({ pattern: excludeTemplates, base: './src/content/programs' }),
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

// Letters from Leadership — an open-ended, chronological archive. One file
// per letter; adding a new one is just a new file, no route changes needed.
// See src/pages/letters/index.astro (list) and [...slug].astro (detail).
// Why "Leadership" and why author/authorTitle are per-letter fields:
// docs/reference/content-collections.md → "Letter".
const letters = defineCollection({
  loader: glob({ pattern: excludeTemplates, base: './src/content/letters' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string(),
    author: z.string(),
    authorTitle: z.string(),
    order: z.number().optional(),
  }),
});

const initiatives = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/initiatives' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    color: z.enum(['primary', 'ink', 'mute']).default('primary'),
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
    // Required by Google's JobPosting structured-data guide. Set to the date
    // the posting was actually added to the repo (verified via git/GitHub
    // history), not a placeholder.
    datePosted: z.coerce.date(),
  }),
});

export const collections = {
  docs,
  events,
  eventBodies,
  newsletter,
  projects,
  programs,
  initiatives,
  pages,
  glossary,
  roles,
  letters,
};
