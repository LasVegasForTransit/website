/* Toggles `data-stuck` on each initiative header on /projects so its
 * inline expanded layout (eyebrow + display title + lede) morphs to a
 * compact label-row when pinned below the sticky site header.
 *
 * Each section contains a 1px `[data-initiative-sentinel]` placed just
 * above the header. With rootMargin top shrunk by --lvbt-header-h, the
 * sentinel leaves the effective viewport at the exact moment the header
 * would visually pin — so `entry.isIntersecting === false` ↔ stuck.
 *
 * Lives in public/scripts/ (same-origin static file) so it satisfies
 * the site's CSP `script-src 'self'` (see public/_headers). An inline
 * <script> in the page would silently fail in production.
 */
(() => {
  const sentinels = document.querySelectorAll('[data-initiative-sentinel]');
  if (sentinels.length === 0) return;

  // Read --lvbt-header-h from :root so we stay in sync with the CSS
  // var (currently 4.5rem). Falls back to 4.5rem if the var is unset.
  const rootStyle = getComputedStyle(document.documentElement);
  const rootFontSize = parseFloat(rootStyle.fontSize) || 16;
  const headerRem = parseFloat(rootStyle.getPropertyValue('--lvbt-header-h')) || 4.5;
  const headerPx = headerRem * rootFontSize;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        // The header is the sentinel's next sibling (see index.astro).
        const header = entry.target.nextElementSibling;
        if (!(header instanceof HTMLElement)) continue;
        if (entry.isIntersecting) delete header.dataset.stuck;
        else header.dataset.stuck = '';
      }
    },
    { rootMargin: `-${headerPx}px 0px 0px 0px`, threshold: 0 },
  );

  sentinels.forEach((s) => observer.observe(s));
})();
