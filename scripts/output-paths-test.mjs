import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import {
  assertOutsideProject,
  environmentFolder,
  outputPath,
  outputPathOutside,
  mrpAndQuotePath,
  projectRoot,
  setOutputFolderError,
  setOutputRoot
} from '../dist/output-paths.js';
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
    ['the project itself (no OUTPUT_DIR, run from the project root)', undefined],
    ['a folder inside the project', join(projectRoot, 'output')],
    ['the project in another case', projectRoot.toUpperCase()]
  ]) {
    test(`refuses ${name}, so a run changes nothing in the project`, () => {
      // arrange
      setOutputRoot(root);

      // act and assert
      assert.throws(() => outputPathOutside(projectRoot, 'ID-1'), /is inside this project .*Set OUTPUT_DIR/);
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

describe('setOutputFolderError', () => {
  afterEach(() => setOutputRoot(undefined));

  test('throws the recorded error only when an output folder is used, until a folder is set', () => {
    // arrange
    setOutputFolderError(new Error('bad run name'));

    // act and assert
    assert.throws(() => outputPath('ID-1'), /bad run name/);
    assert.throws(() => mrpAndQuotePath(), /bad run name/);
    setOutputRoot('D:/temp/diff-output');
    assert.equal(outputPath('ID-1'), resolve('D:/temp/diff-output/ID-1'));
  });
});

describe('assertOutsideProject', () => {
  const project = resolve('D:/work/project');

  for (const [name, path] of [
    ['a sibling folder', 'D:/work/output'],
    ['a sibling whose name starts with the project name', 'D:/work/project-output'],
    ["the project's parent", 'D:/work'],
    ['another drive', 'E:/output'],
    ['a folder inside the user profile', 'C:/Users/someone/output']
  ]) {
    test(`allows ${name}, returning the absolute path`, () => {
      // act
      const resolved = assertOutsideProject(path, '--output', project);

      // assert
      assert.equal(resolved, resolve(path));
    });
  }

  for (const [name, path] of [
    ['the project itself', 'D:/work/project'],
    ['a folder inside the project', 'D:/work/project/output'],
    ['a file inside the project', 'D:/work/project/screenshots/a.png'],
    ['the project in another case', 'd:/WORK/Project/out']
  ]) {
    test(`refuses ${name}`, () => {
      // act and assert
      assert.throws(
        () => assertOutsideProject(path, '--root', project),
        /The output path .+ \(--root\) is inside this project/
      );
    });
  }

  test('refuses a relative path that resolves inside this project', () => {
    // act and assert
    assert.throws(() => assertOutsideProject('output', '--output'), /is inside this project/);
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
