function updateActions(root: HTMLElement, past: boolean): void {
  root.querySelectorAll<HTMLElement>('[data-active-action]').forEach((action) => {
    action.hidden = past;
  });
  root.querySelectorAll<HTMLElement>('[data-campaign-rsvp]').forEach((link) => {
    link.textContent = past ? 'Event details' : 'Event details and RSVP';
  });
}

function render(): void {
  const now = Date.now();
  document.querySelectorAll<HTMLElement>('[data-campaign-events]').forEach((root) => {
    const upcomingList = root.querySelector<HTMLElement>('[data-campaign-list="upcoming"]');
    const pastList = root.querySelector<HTMLElement>('[data-campaign-list="past"]');
    if (!upcomingList || !pastList) return;
    const events = Array.from(root.querySelectorAll<HTMLElement>('[data-campaign-event]')).sort(
      (a, b) => Date.parse(a.dataset.start ?? '') - Date.parse(b.dataset.start ?? ''),
    );
    const groups = {
      upcoming: events.filter((event) => Number(event.dataset.cutoff) > now),
      past: events.filter((event) => Number(event.dataset.cutoff) <= now).reverse(),
    };
    for (const [kind, list, entries] of [
      ['upcoming', upcomingList, groups.upcoming],
      ['past', pastList, groups.past],
    ] as const) {
      entries.forEach((element, index) => {
        const featured = kind === 'upcoming' && index === 0;
        element.classList.toggle('event--featured', featured);
        element.classList.toggle('event--past', kind === 'past');
        const label = element.querySelector('[data-campaign-event-label]');
        if (label)
          label.textContent =
            kind === 'past' ? 'Past gathering' : featured ? 'Next gathering' : 'Upcoming gathering';
        updateActions(element, kind === 'past');
        // Avoid moving unchanged cards every minute (including a focused link).
        if (list.children[index] !== element)
          list.insertBefore(element, list.children[index] ?? null);
      });
    }
    const pastGroup = root.querySelector<HTMLElement>('[data-campaign-group="past"]');
    if (pastGroup) pastGroup.hidden = groups.past.length === 0;
    const empty = root.querySelector<HTMLElement>('[data-campaign-empty]');
    if (empty) empty.hidden = groups.upcoming.length > 0;
  });
  document.querySelectorAll<HTMLElement>('[data-campaign-event-detail]').forEach((root) => {
    const past = root.dataset.proposed !== 'true' && Number(root.dataset.cutoff) <= now;
    updateActions(root, past);
    const label = root.querySelector<HTMLElement>('[data-past-event-label]');
    if (label) label.hidden = !past;
    const heading = root.querySelector<HTMLElement>('[data-discussion-heading]');
    if (heading && root.dataset.start && root.dataset.proposed !== 'true')
      heading.textContent = past ? 'Planned discussion' : 'What we’ll discuss';
  });
}

render();
window.setInterval(render, 60_000);
document.addEventListener('astro:page-load', render);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render();
});
