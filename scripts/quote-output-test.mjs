import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { removeQuoteOutput } from '../dist/quote-output.js';

const policy = 'ABCDEF1234567890ABCDEF1234567890';
const basename = `${policy}-1`;
const originalDirectory = process.cwd();

async function writeComparison(directory, name, report) {
  await mkdir(join(directory, 'comparisons', name), { recursive: true });
  if (report !== undefined) {
    await writeFile(join(directory, 'comparisons', name, 'report.json'), report);
  }
}

async function list(directory, folder) {
  return (await readdir(join(directory, folder))).sort();
}

describe('removeQuoteOutput', () => {
  let directory;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'quote-output-'));
    process.chdir(directory);
  });
  afterEach(() => process.chdir(originalDirectory));

  test('removes every screenshot and failure HTML for the policy and keeps other policies and history IDs', async () => {
    // arrange
    await mkdir(join(directory, 'screenshots'));
    const removed = ['nhi', 'tcas'].flatMap((flow) =>
      ['.png', '-failed.png', '-failed.html', '-declined.png', '-declined.html'].map(
        (suffix) => `${basename}-${flow}${suffix}`
      )
    );
    const kept = [`${policy}-12-nhi.png`, `11111111111111111111111111111111-1-nhi.png`, `${basename}-nhi.html`];
    for (const name of [...removed, ...kept]) {
      await writeFile(join(directory, 'screenshots', name), '');
    }

    // act
    const result = await removeQuoteOutput(basename, ['nhi', 'tcas']);

    // assert
    assert.deepEqual(result, { screenshots: removed.length, comparisons: 0 });
    assert.deepEqual(await list(directory, 'screenshots'), kept.sort());
  });

  for (const [name, report, expectedRemoved] of [
    ['its before screenshot', { before: `screenshots/${basename}-nhi.png`, after: 'other.png' }, true],
    ['its after screenshot', { before: 'other.png', after: `screenshots/${basename}-tcas.png` }, true],
    ['only other screenshots', { before: `screenshots/${policy}-12-nhi.png`, after: 'other.png' }, false],
    ['no image paths', {}, false],
    ['null', null, false],
    ['malformed JSON', '{', false],
    ['no report.json', undefined, false]
  ]) {
    test(`${expectedRemoved ? 'removes' : 'keeps'} a comparison whose report has ${name}`, async () => {
      // arrange
      const content =
        typeof report === 'string' || report === undefined
          ? report
          : JSON.stringify(
              report === null
                ? null
                : Object.fromEntries(Object.entries(report).map(([key, path]) => [key, join(directory, path)]))
            );
      await writeComparison(directory, 'run-1', content);
      await writeComparison(directory, 'run-2', JSON.stringify({ before: join(directory, 'other.png') }));

      // act
      const result = await removeQuoteOutput(basename, ['nhi', 'tcas']);

      // assert
      assert.equal(result.comparisons, expectedRemoved ? 1 : 0);
      assert.deepEqual(await list(directory, 'comparisons'), expectedRemoved ? ['run-2'] : ['run-1', 'run-2']);
    });
  }

  test('does nothing when no output folders exist', async () => {
    // arrange
    // (empty working directory)

    // act
    const result = await removeQuoteOutput(basename, ['nhi', 'tcas']);

    // assert
    assert.deepEqual(result, { screenshots: 0, comparisons: 0 });
    assert.deepEqual(await readdir(directory), []);
  });
});
