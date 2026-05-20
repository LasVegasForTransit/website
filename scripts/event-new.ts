// Interactive helper for adding a new event. Events themselves now live
// in Google Calendar (see docs/explanation/events-pipeline.md) — this
// script no longer scaffolds the event metadata. Instead it:
//
//   1. Tells you exactly which fields to set in the GCal event for the
//      build pipeline to pick it up correctly.
//   2. Offers to scaffold an optional MDX body fragment under
//      src/content/event-bodies/<slug>.mdx for events that need rich
//      long-form copy on their detail page.
//
// Usage:  pnpm event:new

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

import { cancel, intro, isCancel, outro, text, confirm, note } from '@clack/prompts';
import pc from 'picocolors';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const BODIES_DIR = path.join(REPO_ROOT, 'src', 'content', 'event-bodies');

function exitIfCancelled<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel('Cancelled.');
    process.exit(0);
  }
  return value;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function ymdFromIsoInput(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) throw new Error(`Could not parse YYYY-MM-DD from ${iso}`);
  return `${match[1]}-${match[2]}-${match[3]}`;
}

async function run() {
  intro(pc.bgBlack(pc.white(' new event ')));

  note(
    [
      pc.bold('Step 1 — create the event in Google Calendar.'),
      '',
      'Calendar: ' + pc.dim('Las Vegans for Better Transit (public)'),
      '',
      'Required fields:',
      `  • ${pc.bold('Title')} — what shows on the events page (e.g. "General Meeting").`,
      `  • ${pc.bold('Date / time')} — in Pacific Time. Always set an end time; the .ics builder needs it.`,
      `  • ${pc.bold('Location')} — either a meeting URL (virtual) or a physical address (in-person).`,
      `       If both, put the address in Location and the meeting URL on its own line in Description.`,
      '',
      'Optional:',
      `  • ${pc.bold('RSVP')} — add a line ${pc.cyan('RSVP: https://…')} in the description.`,
      '',
      pc.dim(
        'The build maps these fields to title / date / endDate / format / venue / joinUrl / rsvpUrl.\n' +
          'Missing a join URL AND a venue will fail the build.',
      ),
    ].join('\n'),
    'In Google Calendar',
  );

  const wantsFragment = exitIfCancelled(
    await confirm({
      message: 'Does this event need a long-form body on its detail page?',
      initialValue: false,
    }),
  ) as boolean;

  if (!wantsFragment) {
    outro("Done — create the event in Google Calendar and you're finished.");
    return;
  }

  const title = exitIfCancelled(
    await text({
      message: 'Event title (must match the GCal title)',
      placeholder: 'General Meeting',
      validate: (value) => (value && value.length > 0 ? undefined : 'Title is required'),
    }),
  ) as string;

  const startInput = exitIfCancelled(
    await text({
      message: 'Event date (YYYY-MM-DD, Pacific date as it appears in GCal)',
      placeholder: '2026-12-31',
      validate: (value) => {
        if (!value) return 'Date is required';
        if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return 'Must be YYYY-MM-DD';
        return undefined;
      },
    }),
  ) as string;

  const ymd = ymdFromIsoInput(startInput);
  const slug = `${ymd}-${slugify(title)}`;
  const filename = `${slug}.mdx`;
  const filepath = path.join(BODIES_DIR, filename);

  if (existsSync(filepath)) {
    cancel(
      `A body fragment already exists at ${path.relative(REPO_ROOT, filepath)} — refusing to overwrite.`,
    );
    process.exit(1);
  }

  const body = [
    '---',
    `slug: '${slug}'`,
    '---',
    '',
    `<!-- Long-form copy for ${title} (${ymd}). Anything you write here renders below the event header on the detail page. -->`,
    '',
  ].join('\n');

  await writeFile(filepath, body, 'utf8');

  note(
    [
      `Wrote ${pc.cyan(path.relative(REPO_ROOT, filepath))}`,
      '',
      'Next:',
      `  • Create the event in Google Calendar with title ${pc.cyan(title)}.`,
      `  • Slug must resolve to ${pc.cyan(slug)} — i.e. start date in PT is ${ymd}.`,
      `  • Fill in the body copy; preview at ${pc.dim(`/events/${slug}`)} with ${pc.dim('pnpm dev')}.`,
    ].join('\n'),
    'Body fragment ready',
  );

  outro('Done.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
