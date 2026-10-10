import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGeocodeResponse } from '../src/census';

void test('the Geocoder answer yields the block, ZIP code and places', () => {
  const result = parseGeocodeResponse({
    result: {
      addressMatches: [
        {
          addressComponents: { zip: '89101' },
          geographies: {
            'Census Blocks': [{ GEOID: '320030007001001' }],
            'Incorporated Places': [{ NAME: 'Las Vegas city' }],
          },
        },
      ],
    },
  });
  assert.deepEqual(result, {
    kind: 'match',
    censusBlock: '320030007001001',
    vintage: '2020',
    zip: '89101',
    places: ['Las Vegas city'],
  });
  assert.deepEqual(parseGeocodeResponse({ result: { addressMatches: [] } }), { kind: 'no_match' });
});
