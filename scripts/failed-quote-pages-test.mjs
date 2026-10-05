import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { readFailedQuotePages, writeFailedQuotePages } from '../dist/failed-quote-pages.js';

const policyA = 'ABCDEF1234567890ABCDEF1234567890';

describe('failed quote pages file', () => {
  test('reads back what was written', async () => {
    // arrange
    const path = join(await mkdtemp(join(tmpdir(), 'failed-quote-pages-')), 'failed.json');
    const failures = { historyId: 1, failed: [{ policyDetailsId: policyA, issues: ['first', 'second'] }] };

    // act
    await writeFailedQuotePages(path, failures);

    // assert
    assert.deepEqual(await readFailedQuotePages(path), failures);
    assert.ok((await readFile(path, 'utf8')).endsWith('\n'));
  });

  for (const [name, existing] of [
    ['an existing file', true],
    ['no existing file', false]
  ]) {
    test(`deletes the file when nothing failed, given ${name}`, async () => {
      // arrange
      const path = join(await mkdtemp(join(tmpdir(), 'failed-quote-pages-')), 'failed.json');
      if (existing) {
        await writeFailedQuotePages(path, { historyId: 1, failed: [{ policyDetailsId: policyA, issues: [] }] });
      }

      // act
      await writeFailedQuotePages(path, { historyId: 1, failed: [] });

      // assert
      assert.equal(await readFailedQuotePages(path), undefined);
    });
  }

  test('reads a missing file as undefined', async () => {
    // arrange
    const path = join(await mkdtemp(join(tmpdir(), 'failed-quote-pages-')), 'missing.json');

    // act
    const saved = await readFailedQuotePages(path);

    // assert
    assert.equal(saved, undefined);
  });

  test('uppercases policy details IDs', async () => {
    // arrange
    const path = join(await mkdtemp(join(tmpdir(), 'failed-quote-pages-')), 'failed.json');
    await writeFile(
      path,
      JSON.stringify({ historyId: 2, failed: [{ policyDetailsId: policyA.toLowerCase(), issues: [] }] })
    );

    // act
    const saved = await readFailedQuotePages(path);

    // assert
    assert.deepEqual(saved, { historyId: 2, failed: [{ policyDetailsId: policyA, issues: [] }] });
  });

  for (const [name, content] of [
    ['an array', []],
    ['a missing historyId', { failed: [] }],
    ['a negative historyId', { historyId: -1, failed: [] }],
    ['a non-array failed list', { historyId: 1, failed: {} }],
    ['an invalid policy details ID', { historyId: 1, failed: [{ policyDetailsId: 'not-a-guid', issues: [] }] }],
    ['non-string issues', { historyId: 1, failed: [{ policyDetailsId: policyA, issues: [1] }] }]
  ]) {
    test(`rejects ${name}`, async () => {
      // arrange
      const path = join(await mkdtemp(join(tmpdir(), 'failed-quote-pages-')), 'failed.json');
      await writeFile(path, JSON.stringify(content));

      // act
      const read = () => readFailedQuotePages(path);

      // assert
      await assert.rejects(read, /Failed quote pages must be/);
    });
  }
});
