function initializeProgramIndex(): void {
  const index = document.querySelector<HTMLElement>('.program-index');
  if (!index || index.dataset.programIndexInitialized === 'true') return;
  index.dataset.programIndexInitialized = 'true';
  const links = [...index.querySelectorAll<HTMLAnchorElement>('a')];
  const sections = links.map((link) => document.querySelector<HTMLElement>(link.hash));
  const header = document.querySelector<HTMLElement>('[data-site-header]');
  const controller = new AbortController();
  let scheduled = false;

  const update = () => {
    scheduled = false;
    if (!index.isConnected) return;
    const headerBottom = header?.getBoundingClientRect().bottom ?? 0;
    const midpoint = headerBottom + (window.innerHeight - headerBottom) / 2;
    const active = sections.findIndex((section) => {
      const bounds = section?.getBoundingClientRect();
      return bounds ? bounds.top <= midpoint && bounds.bottom > midpoint : false;
    });
    index.hidden = active === -1;
    links.forEach((link, position) => {
      if (position === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  };
  window.addEventListener('scroll', schedule, { passive: true, signal: controller.signal });
  window.addEventListener('resize', schedule, { signal: controller.signal });
  window.addEventListener('load', schedule, { signal: controller.signal });
  document.addEventListener('astro:before-swap', () => controller.abort(), { once: true });
  void document.fonts.ready.then(schedule);
  update();
}

initializeProgramIndex();
document.addEventListener('astro:page-load', initializeProgramIndex);
