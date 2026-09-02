/* Toggles `data-stuck` on the sticky site header when a 1px sentinel
 * placed above it leaves the viewport. Header.astro's CSS uses the
 * attribute to fade in the bottom hairline rule on every page, and
 * src/styles/vision.css also gates its transparent→cream color flip on
 * the same boundary.
 *
 * Lives in public/scripts/ (served as a static file, same-origin) so
 * it satisfies the site's CSP `script-src 'self'` (see public/_headers).
 * An inline <script> in the component would silently fail in production.
 */
(() => {
  const sentinel = document.querySelector('[data-header-sentinel]');
  const header = document.querySelector('[data-site-header]');
  if (!sentinel || !header) return;
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) delete header.dataset.stuck;
    else header.dataset.stuck = '';
  }).observe(sentinel);
})();
