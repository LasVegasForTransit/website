import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const GET: APIRoute = async () => {
  const bodies = await getCollection('eventBodies');
  const payload = bodies.map((body) => ({
    id: body.id,
    data: {
      calendarOccurrenceId: body.data.calendarOccurrenceId,
    },
  }));
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
