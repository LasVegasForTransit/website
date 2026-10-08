import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { qrSvg } from '../src/lib/qr-svg';

// Frozen output from the published main-site encoder, before shared strictness
// adoption: existing printed and presenter QR destinations must remain identical.
void test('shared strictness retains the exact QR encoding for public destinations', () => {
  for (const [destination, digest] of [
    ['join/', '677d33b540eb0b264482ed9e6cc836b43ab9b85f1d1002bc376ebaa9c17ccd35'],
    ['programs/', '0c38a82e0154d3e35cc7a54b3ed1436ece0be02afb4159e9cd604b93f3fc68a7'],
    [
      'campaigns/arts-district/',
      '59ce2b99b2c10f99f0842b258921b571e586fde1f141a6f987d34a491b990a07',
    ],
  ] as const) {
    assert.equal(
      createHash('sha256')
        .update(qrSvg(`https://lasvegasfortransit.org/${destination}`))
        .digest('hex'),
      digest,
    );
  }
  assert.throws(() => qrSvg('x'.repeat(85)), /destination is too long/);
});
