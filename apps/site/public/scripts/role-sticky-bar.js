/* Reveals the condensed CTA bar on a role page once the hero (title +
 * commitment + "Express interest" button) scrolls out of view, and pins it
 * directly beneath the sticky site header.
 *
 * Two jobs:
 *   1. Publish the live site-header height as --site-header-h so the bar's
 *      `top` sits flush under it at any breakpoint (the header's wordmark is
 *      responsive, so the height isn't a constant).
 *   2. Toggle `data-visible` on the bar from an IntersectionObserver watching
 *      the hero. rootMargin offsets the trigger by the header height so the
 *      bar appears as the hero disappears behind the header, not before.
 *
 * Lives in public/scripts/ (static, same-origin) to satisfy the site CSP
 * `script-src 'self'` — an inline <script> would be rejected in production.
 */
(() => {
  const bar = document.querySelector('[data-role-bar]');
  const hero = document.querySelector('[data-role-hero]');
  const header = document.querySelector('[data-site-header]');
  if (!bar || !hero) return;

  const headerHeight = () => (header ? header.offsetHeight : 0);

  const setHeaderVar = () => {
    document.documentElement.style.setProperty('--site-header-h', `${headerHeight()}px`);
  };
  setHeaderVar();
  window.addEventListener('resize', setHeaderVar);

  new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) bar.removeAttribute('data-visible');
      else bar.setAttribute('data-visible', '');
    },
    { rootMargin: `-${headerHeight()}px 0px 0px 0px`, threshold: 0 },
  ).observe(hero);
})();
