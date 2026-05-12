import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'zod';

const docs = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    order: z.number().optional(),
    updated: z.coerce.date(),
  }),
});

// Events carry a structured `format` (virtual / in-person / hybrid) that drives
// every downstream surface: the schema.org `eventAttendanceMode`, the detail-
// page CTA wording, the card pill, the carousel pill, the "Where" label. No
// surface parses the location string or sniffs the URL to infer format.
//
// Field shape per format (enforced by the superRefine below):
//
//   virtual   → `joinUrl` required; `venue` omitted.
//   in-person → `venue` required (`venue.name: 'TBD'` is the placeholder while
//               a venue is being secured); `joinUrl` omitted.
//   hybrid    → both `venue` and `joinUrl` required.
//
// `rsvpUrl` is independent of format — any event may register attendees via
// a separate URL (lu.ma, Eventbrite, etc.). Separating join-URL from RSVP-URL
// is what lets the CTA say "Join" for a virtual event and "RSVP" for an
// in-person event without sniffing the URL host.
const events = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/events' }),
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

export const collections = { docs, events, projects, initiatives, pages };
