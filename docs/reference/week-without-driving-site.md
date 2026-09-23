# The Week Without Driving campaign host

`lvwwd.org` is not part of this repository. It's its own site, built and
deployed from
[`LasVegasForTransit/week-without-driving`](https://github.com/LasVegasForTransit/week-without-driving),
and served by the `lvwwd` [Cloudflare Worker](./glossary.md#cloudflare-workers)
on the LVBT Cloudflare account.

This repository keeps only the redirects that send old links to it:
`/wwd`, `/wwd/` and `/week-without-driving` each answer with a 302 to
`https://lvwwd.org/`. Those rules live in
[`public/_redirects`](../../public/_redirects), and
[`tests/redirects.test.ts`](../../tests/redirects.test.ts) checks that they're
still there.

To change anything about the campaign itself — its content, its Worker, its
DNS — make the change in the `week-without-driving` repository, not here.
