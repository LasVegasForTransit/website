// Tiny Cloudflare Worker. Scheduled trigger fires (see wrangler.jsonc),
// POSTs to the Pages Deploy Hook, which causes a rebuild of the website.
// The website's build re-fetches the public Google Calendar ICS feed and
// the events visible on the site refresh.
//
// One responsibility — no logging beyond what's needed to debug a stuck
// schedule. If the hook URL isn't set, fail loud so the dashboard surfaces
// the misconfiguration.

export interface Env {
  PAGES_DEPLOY_HOOK_URL: string;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const url = env.PAGES_DEPLOY_HOOK_URL;
    if (!url) {
      throw new Error(
        'PAGES_DEPLOY_HOOK_URL not configured. Set it with `wrangler secret put PAGES_DEPLOY_HOOK_URL`.',
      );
    }
    ctx.waitUntil(
      fetch(url, { method: 'POST' }).then(async (res) => {
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Deploy hook returned ${res.status}: ${body}`);
        }
      }),
    );
  },
};
