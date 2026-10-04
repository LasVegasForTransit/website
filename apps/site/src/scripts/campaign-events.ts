import { groupCampaignEvents } from '../lib/campaigns/event-schedule';

function render(): void {
  const now = new Date();
  document.querySelectorAll<HTMLElement>('[data-campaign-events]').forEach((root) => {
    const upcomingList = root.querySelector<HTMLElement>('[data-campaign-list="upcoming"]');
    const pastList = root.querySelector<HTMLElement>('[data-campaign-list="past"]');
    if (!upcomingList || !pastList) return;
    const events = Array.from(root.querySelectorAll<HTMLElement>('[data-campaign-event]')).map(
      (element) => ({
        element,
        start: element.dataset.start,
        end: element.dataset.end,
      }),
    );
    const groups = groupCampaignEvents(events, now);
    for (const [kind, list, entries] of [
      ['upcoming', upcomingList, groups.upcoming],
      ['past', pastList, groups.past],
    ] as const) {
      entries.forEach(({ element }, index) => {
        const featured = kind === 'upcoming' && index === 0;
        element.classList.toggle('event--featured', featured);
        element.classList.toggle('event--past', kind === 'past');
        const label = element.querySelector('[data-campaign-event-label]');
        if (label)
          label.textContent =
            kind === 'past' ? 'Past gathering' : featured ? 'Next gathering' : 'Upcoming gathering';
        element.querySelectorAll<HTMLElement>('[data-active-action]').forEach((action) => {
          action.hidden = kind === 'past';
        });
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
    const past =
      groupCampaignEvents(
        [
          {
            start: root.dataset.start,
            end: root.dataset.end,
            proposed: root.dataset.proposed === 'true',
          },
        ],
        now,
      ).past.length > 0;
    root.querySelectorAll<HTMLElement>('[data-active-action]').forEach((action) => {
      action.hidden = past;
    });
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
