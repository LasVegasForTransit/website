# The Week Without Driving campaign host

Read this before changing `functions/_middleware.ts`, the `/wwd` page, the redirects in `public/_redirects`, or the `lvwwd.org` domain. When you finish, the table below must still be true.

## Where the campaign lives

`lvwwd.org` is the campaign's public address. It is **not** a separate deployment yet: it is a custom domain on this repository's Cloudflare Pages project, and `functions/_middleware.ts` serves the `/wwd` page on it by looking at the request hostname. The page source is `src/pages/wwd.astro` and its campaign data is `src/lib/wwd.ts`.

The campaign's own repository, [`LasVegasForTransit/week-without-driving`](https://github.com/LasVegasForTransit/week-without-driving), already holds a standalone site built as a Worker. It is not deployed. Until it is, this project is what answers for the hostname.

## Behaviour

| Request                                               | Result                                     |
| ----------------------------------------------------- | ------------------------------------------ |
| `https://lasvegasfortransit.org/wwd` or `/wwd/`       | 302 to `https://lvwwd.org/`                |
| `https://lasvegasfortransit.org/week-without-driving` | 302 to `https://lvwwd.org/`                |
| `https://lvwwd.org/`                                  | 200, the campaign page                     |
| `https://lvwwd.org/wwd` or `/wwd/`                    | 301 to `https://lvwwd.org/`                |
| `https://lvwwd.org/robots.txt`                        | 200, `Allow: /`                            |
| `https://lvwwd.org/<anything else>`                   | 301 to the same path on the main site      |
| `https://www.lvwwd.org/*`                             | 301 to the apex                            |
| `https://<preview>.pages.dev/wwd/`                    | 200, so a pull request preview still works |

The main site's redirect is a 302, not a 301, because the main site is expected to get a programme page of its own at `/wwd` once the campaign settles, and a cached permanent redirect would keep anyone who followed the old link from ever reaching it.

That redirect lives in the middleware rather than `public/_redirects` for a specific reason: a rule there matches on path only, so it would also catch the middleware's internal fetch of `/wwd/` when serving the campaign host and bounce it straight back out. The middleware can match on hostname, so it redirects the main site and leaves the campaign host alone.

`tests/wwd-host.test.ts` covers every row above.

## Moving the campaign onto its own Worker

When the standalone site is ready, in this order:

1. Deploy the Worker from the campaign repository.
2. Remove `lvwwd.org` and `www.lvwwd.org` from this project's Pages custom domains, and point the [DNS](./glossary.md#dns) records at the Worker.
3. Confirm `https://lvwwd.org/` serves the campaign page and `https://www.lvwwd.org/` redirects to it.
4. Only then delete `functions/_middleware.ts`, `src/pages/wwd.astro`, `src/lib/wwd.ts` and `tests/wwd-host.test.ts` from this repository, and replace the middleware redirect with a plain rule in `public/_redirects`.

Doing step 4 first would leave the campaign page published nowhere: this project would still answer for the hostname and would serve the main site's home page instead.

Two things to settle before step 1. The `lvwwd.org` zone does not appear under the Las Vegas for Better Transit Cloudflare account, and the campaign hostnames carry no `zone_tag` on the Pages project while `lasvegasfortransit.org` does, which is how Cloudflare marks a zone owned by a different account. Workers custom domains need the zone and the Worker on one account, so the zone has to move first. The deploy also needs a token with Workers Scripts: Edit on that account; the one this repository already uses has no Workers access.
