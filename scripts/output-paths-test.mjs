import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { outputPath, setOutputRoot } from '../dist/output-paths.js';
import { writeQuoteResult } from '../dist/quote-result.js';

describe('outputPath', () => {
  afterEach(() => setOutputRoot(undefined));

  for (const [name, root, expected] of [
    ['uses the current working directory when no output folder is set', undefined, resolve('ID-1', 'a.png')],
    ['uses the current working directory when the output folder is blank', '  ', resolve('ID-1', 'a.png')],
    ['uses the configured output folder', 'D:/temp/diff-output', resolve('D:/temp/diff-output/ID-1/a.png')],
    ['resolves a relative output folder from the current working directory', 'out', resolve('out/ID-1/a.png')]
  ]) {
    test(name, () => {
      // arrange
      setOutputRoot(root);

      // act
      const path = outputPath('ID-1', 'a.png');

      // assert
      assert.equal(path, expected);
    });
  }

  test('writes quote results into the policy folder under the configured output folder', async (context) => {
    // arrange
    const root = await mkdtemp(join(tmpdir(), 'output-paths-test-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    setOutputRoot(root);
    const result = {
      policyDetailsId: 'ABCDEF1234567890ABCDEF1234567890',
      historyId: 1,
      outcome: 'compared',
      validation: false,
      issues: [],
      startedAt: '2026-10-13T09:00:00.000Z',
      finishedAt: '2026-10-13T09:01:00.000Z'
    };

    // act
    await writeQuoteResult(result);

    // assert
    const saved = await readFile(join(root, `${result.policyDetailsId}-1`, 'result.json'), 'utf8');
    assert.deepEqual(JSON.parse(saved), result);
  });
});
