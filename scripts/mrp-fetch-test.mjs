import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fetchCountCovering, prefetchMissingMrpFiles } from '../dist/mrp-fetch.js';

const policyA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const policyB = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const policyC = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const policyD = 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
const unlistedPolicy = 'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE';
const guidList = [policyA, policyB, policyC, policyD];

/**
 * Creates an mrp-and-quote project folder (with a go.mod unless `goModule` is false) whose output folder holds
 * `-1-mrp.json` files for the given policies.
 */
async function createOutputDir(fetchedPolicies, goModule = true) {
  const projectDir = await mkdtemp(join(tmpdir(), 'mrp-fetch-'));
  const outputDir = join(projectDir, 'output');
  await mkdir(outputDir);
  if (goModule) {
    await writeFile(join(projectDir, 'go.mod'), 'module mrp-and-quote\n');
  }

  for (const policyDetailsId of fetchedPolicies) {
    await writeFile(join(outputDir, `${policyDetailsId}-1-mrp.json`), '{}');
  }

  return { projectDir, outputDir };
}

/** Records each fetch the runner is asked for instead of running Go. */
function recordingRunner() {
  const calls = [];
  return { calls, runner: async (projectDir, count) => calls.push({ projectDir, count }) };
}

describe('fetchCountCovering', () => {
  for (const [name, policies, expected] of [
    ['the last listed policy', [policyB, policyD], 4],
    ['a middle listed policy', [policyA, policyB], 2],
    ['the first listed policy', [policyA], 1],
    ['unlisted policies only', [unlistedPolicy], 0],
    ['no policies', [], 0]
  ]) {
    test(`covers ${name}`, () => {
      // arrange
      const list = guidList;

      // act
      const count = fetchCountCovering(list, policies);

      // assert
      assert.equal(count, expected);
    });
  }
});

describe('prefetchMissingMrpFiles', () => {
  test('fetches nothing when every policy has an MRP file', async () => {
    // arrange
    const { outputDir } = await createOutputDir([policyA, policyB]);
    const { calls, runner } = recordingRunner();

    // act
    await prefetchMissingMrpFiles([policyA, policyB], 1, guidList, outputDir, runner);

    // assert
    assert.deepEqual(calls, []);
  });

  test('fetches once, in the project folder, up to the last missing policy', async () => {
    // arrange
    const { projectDir, outputDir } = await createOutputDir([policyA]);
    const { calls, runner } = recordingRunner();

    // act
    await prefetchMissingMrpFiles([policyB, policyC], 1, guidList, outputDir, runner);

    // assert
    assert.deepEqual(calls, [{ projectDir, count: 3 }]);
  });

  test('extends the fetch to keep existing MRP files later in the list', async () => {
    // arrange
    const { outputDir } = await createOutputDir([policyD]);
    const { calls, runner } = recordingRunner();

    // act
    await prefetchMissingMrpFiles([policyB], 1, guidList, outputDir, runner);

    // assert
    assert.deepEqual(
      calls.map(({ count }) => count),
      [4]
    );
  });

  test('skips policies not in the GUID list', async () => {
    // arrange
    const { outputDir } = await createOutputDir([policyD]);
    const { calls, runner } = recordingRunner();

    // act
    await prefetchMissingMrpFiles([unlistedPolicy], 1, guidList, outputDir, runner);

    // assert
    assert.deepEqual(calls, []);
  });

  test('fetches nothing when the output folder is not in a Go project', async () => {
    // arrange
    const { outputDir } = await createOutputDir([], false);
    const { calls, runner } = recordingRunner();

    // act
    await prefetchMissingMrpFiles([policyA], 1, guidList, outputDir, runner);

    // assert
    assert.deepEqual(calls, []);
  });

  test('fetches nothing for a history ID other than 1', async () => {
    // arrange
    const { outputDir } = await createOutputDir([]);
    const { calls, runner } = recordingRunner();

    // act
    await prefetchMissingMrpFiles([policyA], 2, guidList, outputDir, runner);

    // assert
    assert.deepEqual(calls, []);
  });

  test('rejects when the fetch fails', async () => {
    // arrange
    const { outputDir } = await createOutputDir([]);
    const runner = async () => {
      throw new Error('fetch failed');
    };

    // act
    const prefetch = prefetchMissingMrpFiles([policyA], 1, guidList, outputDir, runner);

    // assert
    await assert.rejects(prefetch, /fetch failed/);
  });
});
