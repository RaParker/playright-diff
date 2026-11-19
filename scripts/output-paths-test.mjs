import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { environmentFolder, outputPath, outputPathOutside, projectRoot, setOutputRoot } from '../dist/output-paths.js';
import { writeQuoteResult } from '../dist/quote-result.js';

describe('outputPath', () => {
  afterEach(() => setOutputRoot(undefined));

  // A project folder elsewhere, so the current working directory (this project) counts as outside it
  const otherProject = resolve('D:/elsewhere/project');

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
      const path = outputPathOutside(otherProject, 'ID-1', 'a.png');

      // assert
      assert.equal(path, expected);
    });
  }

  for (const [name, root] of [
    ['the project itself (no DIFF_OUTPUT_DIR, run from the project root)', undefined],
    ['a folder inside the project', join(projectRoot, 'output')],
    ['the project in another case', projectRoot.toUpperCase()]
  ]) {
    test(`refuses ${name}, so a run changes nothing in the project`, () => {
      // arrange
      setOutputRoot(root);

      // act and assert
      assert.throws(() => outputPathOutside(projectRoot, 'ID-1'), /is inside this project .*Set DIFF_OUTPUT_DIR/);
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
    assert.equal(outputPath(), resolve(root));
    const saved = await readFile(join(root, `${result.policyDetailsId}-1`, 'result.json'), 'utf8');
    assert.deepEqual(JSON.parse(saved), result);
  });
});

describe('environmentFolder', () => {
  for (const [name, environment, expected] of [
    ['adds the environment as a subfolder', 'dev', resolve('D:/temp/output/dev')],
    ['lower-cases and trims the environment', ' TST ', resolve('D:/temp/output/tst')],
    ['gives the base folder when no environment is set', undefined, resolve('D:/temp/output')],
    ['gives the base folder when the environment is blank', '  ', resolve('D:/temp/output')]
  ]) {
    test(name, () => {
      // act
      const folder = environmentFolder('D:/temp/output', environment);

      // assert
      assert.equal(folder, expected);
    });
  }

  for (const environment of ['..', 'dev/../..', 'a\\b', 'dev stg']) {
    test(`rejects ${JSON.stringify(environment)}, which could leave the base folder`, () => {
      // act and assert
      assert.throws(() => environmentFolder('D:/temp/output', environment), /letters, digits and hyphens/);
    });
  }
});
