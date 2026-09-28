/**
 * Site-wide heading permalink copier. Pages opt in with `data-copy-anchor` on
 * an anchor whose href points at a section id.
 */
(() => {
  const timers = new WeakMap();

  document.addEventListener('click', (event) => {
    const target = event.target;
    const anchor = target instanceof Element ? target.closest('a[data-copy-anchor]') : null;
    if (!(anchor instanceof HTMLAnchorElement)) return;

    const href = anchor.getAttribute('href');
    if (!href || !href.startsWith('#')) return;

    event.preventDefault();

    const url = new URL(href, window.location.href).toString();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(() => {});
    }

    history.replaceState(null, '', href);
    anchor.setAttribute('data-copied', '');

    const existingTimer = timers.get(anchor);
    if (existingTimer) window.clearTimeout(existingTimer);

    timers.set(
      anchor,
      window.setTimeout(() => {
        anchor.removeAttribute('data-copied');
        timers.delete(anchor);
      }, 1400),
    );
  });
})();
