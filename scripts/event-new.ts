// Interactive scaffolder for new event entries. Walks the operator
// through the structured-format fields, then writes a Zod-correct .mdx
// file under src/content/events/.
//
// Usage:  pnpm event:new
//
// The script avoids re-validating the result against the live Zod
// schema — `astro check` after the file is written is the source of
// truth. The scaffolder's job is to produce a well-formed file, not to
// duplicate the schema.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

import { cancel, intro, isCancel, outro, select, text, confirm, note } from '@clack/prompts';
import pc from 'picocolors';

type Format = 'virtual' | 'in-person' | 'hybrid';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const EVENTS_DIR = path.join(REPO_ROOT, 'src', 'content', 'events');

const PLACEHOLDER_BODY = `The monthly general meeting covers four things:

- **Project updates.** Updates from people running active projects — what moved last month, where the project needs help.
- **Transit news.** What's happening across the Valley and in transit more broadly — service changes, projects underway, news from elsewhere worth talking about.
- **Open call for new projects.** If you've got something you want to organize around, this is the time to bring it.
- **Transit talk.** One person leads the room through something they know well — a short teaching segment.

About an hour. New people welcome.
`;

function exitIfCancelled<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel('Cancelled. No file written.');
    process.exit(0);
  }
  return value;
}

// Builds the YYYY-MM-DD prefix from a UTC-anchored date string the user
// entered. The slug filename uses calendar date in the event timezone,
// not UTC, so we extract the calendar portion of the ISO string the user
// provided rather than calling `.toISOString()` on a Date.
function ymdFromIsoInput(iso: string): string {
  // Permissive split — accepts "2026-12-31", "2026-12-31T18:00:00-08:00",
  // and "2026-12-31 18:00" all the same.
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) throw new Error(`Could not parse YYYY-MM-DD from ${iso}`);
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function run() {
  intro(pc.bgBlack(pc.white(' new event ')));

  const title = exitIfCancelled(
    await text({
      message: 'Event title',
      placeholder: 'General Meeting',
      defaultValue: 'General Meeting',
      validate: (value) => (value && value.length > 0 ? undefined : 'Title is required'),
    }),
  ) as string;

  const startInput = exitIfCancelled(
    await text({
      message: 'Start (ISO 8601 with timezone offset)',
      placeholder: '2026-12-31T18:00:00-08:00',
      validate: (value) => {
        if (!value) return 'Start date is required';
        if (Number.isNaN(Date.parse(value))) return 'Could not parse as a date';
        if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return 'Must start with YYYY-MM-DD';
        return undefined;
      },
    }),
  ) as string;

  const endInput = exitIfCancelled(
    await text({
      message: 'End (ISO 8601, blank for none)',
      placeholder: '2026-12-31T19:00:00-08:00',
      validate: (value) => {
        if (!value) return undefined;
        if (Number.isNaN(Date.parse(value))) return 'Could not parse as a date';
        if (Date.parse(value) <= Date.parse(startInput)) return 'End must be after start';
        return undefined;
      },
    }),
  ) as string;

  const format = exitIfCancelled(
    await select<Format>({
      message: 'Format',
      options: [
        { value: 'virtual', label: 'Virtual', hint: 'requires joinUrl' },
        { value: 'in-person', label: 'In person', hint: 'requires venue' },
        { value: 'hybrid', label: 'Hybrid', hint: 'requires both' },
      ],
      initialValue: 'virtual',
    }),
  ) as Format;

  let joinUrl: string | null = null;
  if (format !== 'in-person') {
    joinUrl = exitIfCancelled(
      await text({
        message: 'Join URL (meeting entry)',
        placeholder: 'https://meet.google.com/abc-defg-hij',
        validate: (value) => {
          if (!value) return 'Required for virtual / hybrid events';
          try {
            new URL(value);
            return undefined;
          } catch {
            return 'Not a valid URL';
          }
        },
      }),
    ) as string;
  }

  let venueName: string | null = null;
  let venueStreet: string | null = null;
  if (format !== 'virtual') {
    venueName = exitIfCancelled(
      await text({
        message: 'Venue name (use "TBD" if not locked yet)',
        placeholder: 'TBD',
        defaultValue: 'TBD',
        validate: (value) =>
          value && value.length > 0 ? undefined : 'Required for in-person / hybrid',
      }),
    ) as string;

    if (venueName !== 'TBD') {
      venueStreet = exitIfCancelled(
        await text({
          message: 'Street address (optional)',
          placeholder: '123 Example St.',
        }),
      ) as string;
    }
  }

  const summary = exitIfCancelled(
    await text({
      message: 'Summary (one sentence, used on cards + meta)',
      placeholder: 'The monthly general meeting. Project updates, transit news, ...',
      validate: (value) => (value && value.length > 0 ? undefined : 'Summary is required'),
    }),
  ) as string;

  const featured = exitIfCancelled(
    await confirm({ message: 'Feature on the events index?', initialValue: false }),
  ) as boolean;

  // Filename: <ymd>-<slugified-title>.mdx. Matches the convention of the
  // existing entries (`2026-05-21-general-meeting.mdx`).
  const ymd = ymdFromIsoInput(startInput);
  const slug = slugify(title);
  const filename = `${ymd}-${slug}.mdx`;
  const filepath = path.join(EVENTS_DIR, filename);

  if (existsSync(filepath)) {
    cancel(
      `A file already exists at ${path.relative(REPO_ROOT, filepath)} — refusing to overwrite.`,
    );
    process.exit(1);
  }

  const lines: string[] = ['---', `title: '${title.replace(/'/g, "''")}'`, `date: ${startInput}`];
  if (endInput) lines.push(`endDate: ${endInput}`);
  lines.push(`format: ${format}`);
  if (joinUrl) lines.push(`joinUrl: '${joinUrl}'`);
  if (venueName) {
    lines.push('venue:');
    lines.push(`  name: '${venueName.replace(/'/g, "''")}'`);
    if (venueStreet) lines.push(`  streetAddress: '${venueStreet.replace(/'/g, "''")}'`);
  }
  lines.push(`featured: ${featured}`);
  lines.push(`summary: '${summary.replace(/'/g, "''")}'`);
  lines.push('---');
  lines.push('');
  lines.push(PLACEHOLDER_BODY);

  await writeFile(filepath, lines.join('\n'), 'utf8');

  note(
    [
      `Wrote ${pc.cyan(path.relative(REPO_ROOT, filepath))}`,
      '',
      'Next:',
      `  • ${pc.dim('pnpm exec astro check')} — verify the schema accepted it`,
      `  • ${pc.dim('pnpm dev')} — preview at /events/${ymd}-${slug}/`,
      `  • Edit the body copy as needed`,
    ].join('\n'),
    'Done',
  );

  outro('Event scaffolded.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
