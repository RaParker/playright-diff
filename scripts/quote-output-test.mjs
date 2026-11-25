import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { outputPath, setOutputRoot } from '../dist/output-paths.js';
import { flowOutputPaths } from '../dist/flow-output.js';
import { removeFlowOutput, removeQuoteOutput } from '../dist/quote-output.js';

const policy = 'ABCDEF1234567890ABCDEF1234567890';
const basename = `${policy}-1`;

describe('removeQuoteOutput', () => {
  let directory;
  let originalRoot;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'quote-output-'));
    originalRoot = outputPath();
    setOutputRoot(directory);
  });
  afterEach(async () => {
    setOutputRoot(originalRoot);
    await rm(directory, { recursive: true, force: true });
  });

  test("removes the policy's folder with everything in it and keeps other policies and history IDs", async () => {
    // arrange
    await mkdir(join(directory, basename, 'api-nhi'), { recursive: true });
    for (const file of [
      'screenshot-quote-page-nhi.png',
      'failed-mrp.html',
      'report.json',
      'result.json',
      join('api-nhi', '001-GET-x.json')
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

describe('removeFlowOutput', () => {
  test("removes one flow's files, console logs included, and keeps the other flow's", async (context) => {
    // arrange
    const directory = await mkdtemp(join(tmpdir(), 'quote-output-'));
    context.after(() => rm(directory, { recursive: true, force: true }));
    await mkdir(join(directory, 'api-mrp'));
    const mrpFiles = [
      'screenshot-quote-page-mrp.png',
      'screenshot-failed-mrp.png',
      'failed-mrp.html',
      'console-failed-mrp.log',
      'console-declined-mrp.log',
      join('api-mrp', '001-GET-x.json')
    ];
    const kept = ['console-failed-nhi.log', 'failed-nhi.html'];
    for (const file of [...mrpFiles, ...kept]) {
      await writeFile(join(directory, file), '');
    }

    // act
    await removeFlowOutput(flowOutputPaths(directory, 'mrp'));

    // assert
    assert.deepEqual((await readdir(directory)).sort(), kept);
  });
});
