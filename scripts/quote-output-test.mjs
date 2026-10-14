import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { removeQuoteOutput } from '../dist/quote-output.js';

const policy = 'ABCDEF1234567890ABCDEF1234567890';
const basename = `${policy}-1`;
const originalDirectory = process.cwd();

describe('removeQuoteOutput', () => {
  let directory;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'quote-output-'));
    process.chdir(directory);
  });
  afterEach(async () => {
    process.chdir(originalDirectory);
    await rm(directory, { recursive: true, force: true });
  });

  test("removes the policy's folder with everything in it and keeps other policies and history IDs", async () => {
    // arrange
    await mkdir(join(directory, basename, 'nhi-api'), { recursive: true });
    for (const file of [
      'nhi.png',
      'tcas-failed.html',
      'report.json',
      'result.json',
      join('nhi-api', '001-GET-x.json')
    ]) {
      await writeFile(join(directory, basename, file), '');
    }

    const kept = [`${policy}-12`, '11111111111111111111111111111111-1', '.ocr-cache'];
    for (const name of kept) {
      await mkdir(join(directory, name));
    }

    // act
    const removed = await removeQuoteOutput(basename);

    // assert
    assert.equal(removed, true);
    assert.deepEqual((await readdir(directory)).sort(), kept.sort());
  });

  test('does nothing when the policy has no folder', async () => {
    // arrange
    await mkdir(join(directory, `${policy}-12`));

    // act
    const removed = await removeQuoteOutput(basename);

    // assert
    assert.equal(removed, false);
    assert.deepEqual(await readdir(directory), [`${policy}-12`]);
  });
});
