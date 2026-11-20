// /join/roles.json: each open role's title and the committee an accepted
// applicant joins. The account apply handler (functions/account/apply) reads it
// so an application names a role that is really posted on the site.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const prerender = true;

export const GET: APIRoute = async () => {
  const roles = await getCollection('roles');
  const index = Object.fromEntries(
    roles.map((role) => [
      role.id,
      { title: role.data.title, committee: role.data.committee ?? null },
    ]),
  );
  return new Response(JSON.stringify(index), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
