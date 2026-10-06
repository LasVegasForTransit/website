import { z } from 'zod';
import { PROGRAM_DESIGNATIONS } from './programs';

export const programSchema = z
  .object({
    title: z.string(),
    summary: z.string(),
    image: z
      .object({
        src: z.string().trim().min(1),
        alt: z.string().trim().min(1),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        kind: z.enum(['photo', 'screenshot']).optional(),
        caption: z.string().trim().min(1).optional(),
        credit: z
          .object({
            name: z.string().trim().min(1),
            url: z.url(),
            license: z.string().trim().min(1),
            licenseUrl: z.url(),
          })
          .optional(),
      })
      .optional(),
    designation: z.enum(PROGRAM_DESIGNATIONS),
    icon: z.string(),
    order: z.number(),
    cadence: z.string().optional(),
    status: z.enum(['active', 'planned']),
    participationUrl: z.url().optional(),
    participationLabel: z.string().trim().min(1).optional(),
    calendarSeriesUid: z.string().trim().min(1).optional(),
    eventNoun: z.string().trim().min(1).optional(),
    venue: z
      .object({
        name: z.string(),
        address: z.string(),
        mapUrl: z.url(),
        status: z.enum(['proposed', 'confirmed']),
      })
      .optional(),
  })
  .superRefine((program, ctx) => {
    if (program.participationLabel && !program.participationUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['participationLabel'],
        message: 'A participation label requires a participation URL.',
      });
    }
  });
