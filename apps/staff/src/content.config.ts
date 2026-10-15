import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { calendarEventsLoader } from '../../site/src/lib/events-loader';
export const collections = {
  paperEvents: defineCollection({
    loader: calendarEventsLoader(),
    schema: z.object({
      title: z.string(),
      calendarOccurrenceId: z.string().max(512),
      date: z.coerce.date(),
    }),
  }),
};
