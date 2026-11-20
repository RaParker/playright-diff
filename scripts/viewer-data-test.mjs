import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { collectQuoteResults } from '../dist/summarise.js';
import { listViewerPolicies, readViewerPolicyDetail } from '../dist/viewer-data.js';
import {
  differentPolicy,
  failedPolicy,
  identicalPolicy,
  recheckedPolicy,
  unrecordedPolicy,
  viewerFixture
} from './viewer-fixture.mjs';

async function fixture(context, options) {
  const root = await viewerFixture(options);
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

describe('listViewerPolicies', () => {
  test("lists every policy with the summary's kinds", async (context) => {
    // arrange
    const root = await fixture(context);

    // act
    const run = await listViewerPolicies(root, { environment: 'dev' });

    // assert
    assert.equal(run.environment, 'dev');
    assert.deepEqual(
      run.policies.map(({ name, kind }) => [name, kind]),
      [
        [`${identicalPolicy}-1`, 'identical'],
        [`${differentPolicy}-1`, 'different'],
        [`${failedPolicy}-1`, 'failed'],
        [`${recheckedPolicy}-1`, 'different'],
        [`${unrecordedPolicy}-1`, 'unrecorded']
      ]
    );
    const summary = await collectQuoteResults(root);
    assert.equal(
      run.policies.filter(({ kind }) => kind === 'different').length,
      summary.compared.filter(({ kind }) => kind === 'different').length
    );
  });

  test("marks a re-checked policy with the summary's wording", async (context) => {
    // arrange
    const root = await fixture(context);

    // act
    const { policies } = await listViewerPolicies(root, {});

    // assert
    const rechecked = policies.find(({ name }) => name === `${recheckedPolicy}-1`);
    assert.match(rechecked.coverTypeRecheck, /^Matched MRP: buildings, contents/);
    assert.match(rechecked.coverTypeRecheck, /was Contents only on NHI$/);
    assert.equal(policies.find(({ name }) => name === `${differentPolicy}-1`).coverTypeRecheck, undefined);
  });

  test('keeps policies declined before declines were compared apart from compared declines', async (context) => {
    // arrange
    const root = await fixture(context);
    const name = `${'D'.repeat(32)}-1`;
    await mkdir(join(root, name));
    await writeFile(
      join(root, name, 'result.json'),
      JSON.stringify({
        policyDetailsId: 'D'.repeat(32),
        historyId: 1,
        outcome: 'declined',
        validation: false,
        issues: [],
        startedAt: '2000-01-01T00:00:00.000Z',
        finishedAt: '2000-01-01T00:01:00.000Z'
      })
    );

    // act
    const { policies } = await listViewerPolicies(root, {});

    // assert
    assert.equal(policies.find((policy) => policy.name === name).kind, 'not-compared');
  });

  test('lists nothing for an empty folder', async (context) => {
    // arrange
    const root = await fixture(context, { empty: true });

    // act
    const run = await listViewerPolicies(root, {});

    // assert
    assert.deepEqual(run.policies, []);
  });
});

describe('readViewerPolicyDetail', () => {
  test("reads a different policy's regions, images and answer changes", async (context) => {
    // arrange
    const root = await fixture(context);

    // act
    const detail = await readViewerPolicyDetail(root, `${differentPolicy}-1`);

    // assert
    assert.equal(detail.kind, 'different');
    assert.equal(detail.sizeDifference, '40×100 vs 40×120');
    assert.deepEqual(detail.images, {
      nhi: 'screenshot-quote-page-nhi.png',
      mrp: 'screenshot-quote-page-mrp.png',
      diff: 'diff.png'
    });
    assert.equal(detail.imageScale, 1);
    assert.deepEqual(detail.regions, [
      { id: 1, bounds: { left: 0, top: 0, width: 40, height: 10 }, removed: [], added: [], lowConfidence: false },
      {
        id: 2,
        bounds: { left: 0, top: 50, width: 40, height: 20 },
        removed: ['£137.63'],
        added: ['£137.62'],
        lowConfidence: false
      }
    ]);
    assert.equal(detail.answerChanges.changes.nhi['Property circumstances'][0].question, 'rebuilding cost');
    assert.equal(detail.endpoints, 'NHI and TCAS both quoted');
  });

  test('leaves out images not written yet', async (context) => {
    // arrange
    const root = await fixture(context);
    await rm(join(root, `${differentPolicy}-1`, 'screenshot-quote-page-mrp.png'));

    // act
    const detail = await readViewerPolicyDetail(root, `${differentPolicy}-1`);

    // assert
    assert.deepEqual(detail.images, { nhi: 'screenshot-quote-page-nhi.png', diff: 'diff.png' });
  });

  test("reads a failed policy's issues and failure screenshot", async (context) => {
    // arrange
    const root = await fixture(context);

    // act
    const detail = await readViewerPolicyDetail(root, `${failedPolicy}-1`);

    // assert
    assert.equal(detail.kind, 'failed');
    assert.deepEqual(detail.issues, [
      'Quote capture failed; comparison skipped.',
      'NHI: Website displayed <h2>Oops</h2>; stopping the journey.'
    ]);
    assert.deepEqual(detail.images, { failedNhi: 'screenshot-failed-nhi.png' });
  });

  for (const folder of ['mrp-and-quote', '..', '.ocr-cache', `${'9'.repeat(32)}-1`]) {
    test(`returns undefined for ${folder}, which is not a policy folder`, async (context) => {
      // arrange
      const root = await fixture(context);

      // act
      const detail = await readViewerPolicyDetail(root, folder);

      // assert
      assert.equal(detail, undefined);
    });
  }
});
