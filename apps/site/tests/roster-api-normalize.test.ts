import assert from 'node:assert/strict';
import test from 'node:test';
void test('API normalization preserves unknown provider consent and actual original form answers without inventing a join', async () => {
  const { normalizeApiRoster } = await import('../scripts/platform/roster-api-normalize');
  const rows = normalizeApiRoster({
    observedAt: '2026-10-14T12:00:00.000Z',
    beehiiv: [
      {
        id: 'sub_test',
        email: 'subscriber@example.invalid',
        status: 'active',
        created: 1700000000,
      },
    ],
    notion: [
      {
        page: {
          id: '00000000-0000-4000-8000-000000000000',
          properties: {
            Email: { email: 'form@example.invalid' },
            Name: { title: [{ plain_text: 'Original full name' }] },
            'Submitted at': { date: { start: '2026-03-01T12:03:05.000Z' } },
          },
        },
        blocks: [
          {
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [
                {
                  plain_text:
                    'Finishing this form will sign you up for our email newsletter. Is this okay?: Yes',
                },
              ],
            },
          },
        ],
      },
    ],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.newsletter.givenAt, null);
  assert.equal(rows[0].newsletter.affirmative, false);
  assert.ok(rows[1]);
  assert.equal(rows[1].newsletter.affirmative, true);
  assert.equal(rows[1].newsletter.method, 'unknown');
  assert.equal(rows[1].newsletter.givenAt, '2026-03-01T12:03:05.000Z');
  assert.equal(rows[1].form?.membershipAffirmative, null);
  assert.equal(rows[1].givenName, undefined);
});
