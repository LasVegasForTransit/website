/* Click handler for initiative h2 permalinks. Copies the canonical URL
 * (origin + pathname + #id) to the clipboard, replaces the location
 * hash so deep-links stay shareable, and smooth-scrolls to the section
 * — `scroll-mt-24` on the section keeps the expanded header below the
 * sticky site header on land.
 *
 * Lives in public/scripts/ (same-origin static file) so it satisfies
 * the site's CSP `script-src 'self'` (see public/_headers).
 */
(() => {
  const links = document.querySelectorAll('[data-initiative-permalink]');
  if (links.length === 0) return;

  links.forEach((link) => {
    if (!(link instanceof HTMLAnchorElement)) return;
    link.addEventListener('click', async (event) => {
      const href = link.getAttribute('href');
      if (!href || !href.startsWith('#')) return;
      const id = href.slice(1);
      const target = document.getElementById(id);
      if (!target) return;

      event.preventDefault();
      const url = `${location.origin}${location.pathname}#${id}`;

      // Try the async Clipboard API first; fall back silently so the
      // anchor's scroll/hash-update side effects still happen even when
      // clipboard access is denied (insecure context, permission, etc.).
      try {
        await navigator.clipboard.writeText(url);
        link.dataset.copied = '';
        window.setTimeout(() => {
          delete link.dataset.copied;
        }, 1500);
      } catch {
        /* clipboard denied — proceed with navigation only */
      }

      history.replaceState(null, '', `#${id}`);
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
})();
