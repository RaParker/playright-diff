import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { after, describe, test } from 'node:test';
import { mrpFetchEnvironment, prefetchMissingMrpFiles, reportMissingMrpFiles } from '../dist/mrp-fetch.js';

const policyA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const policyB = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const policyC = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const policyD = 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
const unlistedPolicy = 'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE';
const guidList = [policyA, policyB, policyC, policyD];

/** Temp folders made by `createOutputDir`, which the tests still read, removed once they have all run. */
const projectDirs = [];
after(() => Promise.all(projectDirs.map((projectDir) => rm(projectDir, { recursive: true, force: true }))));

/**
 * Creates an mrp-and-quote project folder (with a go.mod unless `goModule` is false) whose output folder holds
 * `-1-mrp.json` files for the given policies.
 */
async function createOutputDir(fetchedPolicies, goModule = true) {
  const projectDir = await mkdtemp(join(tmpdir(), 'mrp-fetch-'));
  projectDirs.push(projectDir);
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
  return {
    calls,
    runner: async (projectDir, outputDir, policyDetailsIds, sourceEnvironment) =>
      calls.push(
        sourceEnvironment === undefined
          ? { projectDir, outputDir, policyDetailsIds }
          : { projectDir, outputDir, policyDetailsIds, sourceEnvironment }
      )
  };
}

describe('prefetchMissingMrpFiles', () => {
  test('fetches nothing when every policy has an MRP file', async () => {
    // arrange
    const { projectDir, outputDir } = await createOutputDir([policyA, policyB]);
    const { calls, runner } = recordingRunner();

    // act
    await prefetchMissingMrpFiles([policyA, policyB], 1, guidList, { outputDir, projectDir }, runner);

    // assert
    assert.deepEqual(calls, []);
  });

  test('fetches once, in the project folder, only the missing policies', async () => {
    // arrange
    const { projectDir, outputDir } = await createOutputDir([policyA, policyC]);
    const { calls, runner } = recordingRunner();

    // act
    await prefetchMissingMrpFiles([policyA, policyB, policyC, policyD], 1, guidList, { outputDir, projectDir }, runner);

    // assert
    assert.deepEqual(calls, [{ projectDir, outputDir, policyDetailsIds: [policyB, policyD] }]);
  });

  test('fetches the listed missing policies but not unlisted ones', async () => {
    // arrange
    const { projectDir, outputDir } = await createOutputDir([]);
    const { calls, runner } = recordingRunner();

    // act
    await prefetchMissingMrpFiles([unlistedPolicy, policyC], 1, guidList, { outputDir, projectDir }, runner);

    // assert
    assert.deepEqual(
      calls.map(({ policyDetailsIds }) => policyDetailsIds),
      [[policyC]]
    );
  });

  test('skips policies not in the GUID list', async () => {
    // arrange
    const { projectDir, outputDir } = await createOutputDir([policyD]);
    const { calls, runner } = recordingRunner();

    // act
    await prefetchMissingMrpFiles([unlistedPolicy], 1, guidList, { outputDir, projectDir }, runner);

    // assert
    assert.deepEqual(calls, []);
  });

  test('fetches nothing for a history ID other than 1', async () => {
    // arrange
    const { projectDir, outputDir } = await createOutputDir([]);
    const { calls, runner } = recordingRunner();

    // act
    await prefetchMissingMrpFiles([policyA], 2, guidList, { outputDir, projectDir }, runner);

    // assert
    assert.deepEqual(calls, []);
  });

  test('resolves when the fetch fails', async () => {
    // arrange
    const { projectDir, outputDir } = await createOutputDir([]);
    const runner = async () => {
      throw new Error('fetch failed');
    };

    // act
    const prefetch = prefetchMissingMrpFiles([policyA], 1, guidList, { outputDir, projectDir }, runner);

    // assert
    await assert.doesNotReject(prefetch);
  });

  test('fetches in the given project folder into an output folder outside it', async (context) => {
    // arrange
    const { projectDir } = await createOutputDir([]);
    const outputDir = await mkdtemp(join(tmpdir(), 'mrp-output-'));
    context.after(() => rm(outputDir, { recursive: true, force: true }));
    await writeFile(join(outputDir, `${policyA}-1-mrp.json`), '{}');
    const { calls, runner } = recordingRunner();

    // act
    await prefetchMissingMrpFiles([policyA, policyB], 1, guidList, { outputDir, projectDir }, runner);

    // assert
    assert.deepEqual(calls, [{ projectDir, outputDir, policyDetailsIds: [policyB] }]);
  });

  test('fetches nothing when the given project folder is not a Go project', async () => {
    // arrange
    const { projectDir, outputDir } = await createOutputDir([], false);
    const { calls, runner } = recordingRunner();

    // act
    await prefetchMissingMrpFiles([policyA], 1, guidList, { outputDir, projectDir }, runner);

    // assert
    assert.deepEqual(calls, []);
  });

  test('stops with an error when files are missing and no project folder is given', async () => {
    // arrange
    const { outputDir } = await createOutputDir([]);
    const { calls, runner } = recordingRunner();

    // act
    const prefetch = prefetchMissingMrpFiles([policyA], 1, guidList, { outputDir }, runner);

    // assert
    await assert.rejects(prefetch, /1 MRP files are missing and MRP_AND_QUOTE_PROJECT_DIR is not set/);
    assert.deepEqual(calls, []);
  });

  test('needs no project folder when no files are missing', async () => {
    // arrange
    const { outputDir } = await createOutputDir([policyA]);
    const { calls, runner } = recordingRunner();

    // act
    const prefetch = prefetchMissingMrpFiles([policyA], 1, guidList, { outputDir }, runner);

    // assert
    await assert.doesNotReject(prefetch);
    assert.deepEqual(calls, []);
  });

  test('passes the runner absolute folders when given relative ones', async () => {
    // arrange
    const { projectDir, outputDir } = await createOutputDir([]);
    const { calls, runner } = recordingRunner();

    // act
    await prefetchMissingMrpFiles(
      [policyA],
      1,
      guidList,
      { outputDir: relative(process.cwd(), outputDir), projectDir: relative(process.cwd(), projectDir) },
      runner
    );

    // assert
    assert.deepEqual(calls, [{ projectDir, outputDir, policyDetailsIds: [policyA] }]);
  });

  test('passes the runner the source environment', async () => {
    // arrange
    const { projectDir, outputDir } = await createOutputDir([]);
    const { calls, runner } = recordingRunner();

    // act
    await prefetchMissingMrpFiles([policyA], 1, guidList, { outputDir, projectDir, sourceEnvironment: 'tst' }, runner);

    // assert
    assert.deepEqual(calls, [{ projectDir, outputDir, policyDetailsIds: [policyA], sourceEnvironment: 'tst' }]);
  });
});

describe('mrpFetchEnvironment', () => {
  test('sets OUTPUT_DIR to the absolute output folder, keeping the rest', () => {
    // arrange
    const environment = { PATH: 'path', OUTPUT_DIR: 'from-mrp-and-quote-env' };

    // act
    const fetchEnvironment = mrpFetchEnvironment('relative-output', environment);

    // assert
    assert.deepEqual(fetchEnvironment, { PATH: 'path', OUTPUT_DIR: resolve('relative-output') });
    assert.equal(environment.OUTPUT_DIR, 'from-mrp-and-quote-env');
  });

  test('sets SOURCE_ENVIRONMENT in upper case when a source environment is given', () => {
    // arrange
    const environment = { PATH: 'path', SOURCE_ENVIRONMENT: 'TST' };

    // act
    const fetchEnvironment = mrpFetchEnvironment('relative-output', environment, 'stg');

    // assert
    assert.deepEqual(fetchEnvironment, {
      PATH: 'path',
      SOURCE_ENVIRONMENT: 'STG',
      OUTPUT_DIR: resolve('relative-output')
    });
    assert.equal(environment.SOURCE_ENVIRONMENT, 'TST');
  });

  test('leaves SOURCE_ENVIRONMENT alone when no source environment is given', () => {
    // arrange
    const environment = { SOURCE_ENVIRONMENT: 'TST' };

    // act
    const fetchEnvironment = mrpFetchEnvironment('relative-output', environment);

    // assert
    assert.equal(fetchEnvironment.SOURCE_ENVIRONMENT, 'TST');
  });
});

describe('reportMissingMrpFiles', () => {
  test('reports how many policies have no MRP file', async (t) => {
    // arrange
    const { outputDir } = await createOutputDir([policyA]);
    const log = t.mock.method(console, 'log', () => undefined);

    // act
    await reportMissingMrpFiles([policyA, policyB, policyC], 1, outputDir);

    // assert
    assert.deepEqual(
      log.mock.calls.map((call) => String(call.arguments[0])),
      ['\u001b[33m2 of 3 policies have no MRP file and will fail; not fetching (--no-fetch).\u001b[0m']
    );
  });

  for (const [name, fetchedPolicies, historyId] of [
    ['every policy has an MRP file', [policyA, policyB], 1],
    ['the history ID is not 1', [], 2]
  ]) {
    test(`reports nothing when ${name}`, async (t) => {
      // arrange
      const { outputDir } = await createOutputDir(fetchedPolicies);
      const log = t.mock.method(console, 'log', () => undefined);

      // act
      await reportMissingMrpFiles([policyA, policyB], historyId, outputDir);

      // assert
      assert.equal(log.mock.callCount(), 0);
    });
  }
});
