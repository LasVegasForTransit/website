import { env } from 'cloudflare:workers';
import { defineMiddleware } from 'astro:middleware';
import { staffMiddleware } from './lib/middleware';
export const onRequest = defineMiddleware(
  async ({ request, locals }, next) => await staffMiddleware(request, env, { locals, next }),
);
