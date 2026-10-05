import { expect, test } from '../../scripts/deploy/access-browser';

const campaign = '/campaigns/arts-district/';

test('archives the listening session when its Las Vegas day ends without a redeploy', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-18T06:59:30Z') });
  await page.goto(campaign);
  const session = page.locator('[data-campaign-event="community-listening-session"]');
  await expect(page.locator('[data-campaign-list="upcoming"]')).toContainText(
    'Community listening session',
  );
  await expect(session).toHaveClass(/event--featured/);
  await session.evaluate((card) => {
    const link = document.createElement('a');
    link.href = '/events/test-gathering';
    link.dataset.campaignRsvp = '';
    link.textContent = 'Event details and RSVP';
    card.querySelector('.event-copy')?.appendChild(link);
  });
  await page.clock.fastForward(60_000);
  await expect(page.locator('[data-campaign-group="past"]')).toBeVisible();
  await expect(page.locator('[data-campaign-list="past"]')).toContainText(
    'Community listening session',
  );
  await expect(session).not.toHaveClass(/event--featured/);
  await expect(session.getByRole('link', { name: 'Get directions' })).toBeHidden();
  await expect(session.getByRole('link', { name: 'Event details', exact: true })).toHaveAttribute(
    'href',
    '/events/test-gathering',
  );
  await expect(page.locator('[data-campaign-empty]')).toBeVisible();
  await expect(page.locator('[data-campaign-list="proposed"] article')).toHaveCount(3);
});

test('archived event pages keep their details and stop offering attendance actions', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-18T07:00:00Z') });
  await page.goto(campaign + 'events/community-listening-session/');
  await expect(page.getByText('Past gathering', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Planned discussion', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get directions', exact: true })).toBeHidden();
  await expect(
    page.getByRole('heading', { name: 'Community listening session', exact: true }),
  ).toBeVisible();
});

test('promotes the next confirmed gathering after the featured gathering ends', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-18T06:59:30Z') });
  await page.goto(campaign);
  // Simulate a second published gathering without adding an unconfirmed
  // date to public campaign content.
  await page.locator('[data-campaign-event="community-listening-session"]').evaluate((original) => {
    const next = original.cloneNode(true) as HTMLElement;
    next.dataset.campaignEvent = 'next-confirmed';
    next.dataset.start = '2026-11-07T14:00:00-08:00';
    const title = next.querySelector('h3 a');
    if (title) title.textContent = 'Next confirmed gathering';
    original.parentElement?.appendChild(next);
  });
  await page.clock.fastForward(60_000);
  const next = page.locator('[data-campaign-event="next-confirmed"]');
  await expect(next).toHaveClass(/event--featured/);
  await expect(next.locator('[data-campaign-event-label]')).toHaveText('Next gathering');
  await expect(page.locator('[data-campaign-list="upcoming"]')).toContainText(
    'Next confirmed gathering',
  );
  await expect(page.locator('[data-campaign-empty]')).toBeHidden();
});
