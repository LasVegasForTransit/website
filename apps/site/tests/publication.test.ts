import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicationReceipt } from '../scripts/deploy/publication';

const release = { commit: 'a'.repeat(40), releaseId: '123' };
void test('a failed public check retains confirmed activation and the selected immutable artifact', () => {
  const receipt = publicationReceipt({
    release,
    baseline: { ...release, releaseId: '122' },
    artifactHash: 'b'.repeat(64),
    version: 'bc13008c-f19d-4e27-a330-0b480fed8d63',
    activation: 'success',
    verification: 'failure',
  });
  assert.equal(receipt.activation, 'confirmed');
  assert.equal(receipt.verification, 'failure');
  assert.equal(receipt.baseline?.releaseId, '122');
  assert.equal(receipt.artifactHash, 'b'.repeat(64));
});
void test('a failed activation is unknown and must be reconciled before another publication', () => {
  assert.equal(
    publicationReceipt({ release, baseline: null, activation: 'failure', verification: 'skipped' })
      .activation,
    'unknown',
  );
  assert.equal(
    publicationReceipt({ release, baseline: null, activation: 'skipped', verification: 'skipped' })
      .activation,
    'not-attempted',
  );
});
