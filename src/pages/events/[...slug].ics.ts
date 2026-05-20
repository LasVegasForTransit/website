// Per-event RFC 5545 calendar feed. Astro emits one static file per event
// at /events/<id>.ics under static output. Headers set here apply to
// astro dev; Cloudflare Pages serves the built file with the MIME pinned
// in public/_headers.
import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { buildIcs } from '../../lib/event-ics';

export const getStaticPaths: GetStaticPaths = async () => {
  const events = await getCollection('events');
  return events.map((event) => ({
    params: { slug: event.id },
    props: { event },
  }));
};

export const GET: APIRoute = ({ props }) => {
  // Astro's `props` type on APIRoute is `Record<string, unknown>` because
  // it can't statically reach into getStaticPaths. The cast narrows it to
  // what we actually return above; the build will fail if the shape drifts.
  const event = props.event as Awaited<ReturnType<typeof getCollection<'events'>>>[number];
  return new Response(buildIcs(event), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
    },
  });
};
