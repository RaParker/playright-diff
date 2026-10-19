import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { clearOutput } from '../dist/clear-output.js';

const script = resolve('dist/main.js');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Runs the task with console.log captured, returning its result and the lines logged (without colour codes). */
async function capture(task) {
  const log = console.log;
  const lines = [];
  // eslint-disable-next-line no-control-regex
  console.log = (...values) => lines.push(values.join(' ').replace(/\u001b\[\d+m/g, ''));
  try {
    return { result: await task(), output: lines.join('\n') };
  } finally {
    console.log = log;
  }
}

describe('clearOutput', () => {
  let parent;
  let outputDir;
  let protectedPaths;
  beforeEach(async () => {
    parent = await mkdtemp(join(tmpdir(), 'clear-output-'));
    outputDir = join(parent, 'output');
    await mkdir(join(outputDir, 'ABCDEF1234567890ABCDEF1234567890-1'), { recursive: true });
    await writeFile(join(outputDir, 'ABCDEF1234567890ABCDEF1234567890-1', 'result.json'), '{}');
    await writeFile(join(outputDir, 'quote-pages.log'), '');
    protectedPaths = { projectRoot: join(parent, 'project'), userProfile: join(parent, 'profile') };
  });
  afterEach(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  test('prints the folder and its entry count, then deletes it', async () => {
    // arrange
    const target = outputDir;

    // act
    const { result, output } = await capture(() => clearOutput(target, protectedPaths));

    // assert
    assert.equal(result, 'deleted');
    assert.match(output, /Deleting these folders:\n {2}.+output \(2 entries\)\nDeleted .+output\./);
    assert.equal(await exists(outputDir), false);
  });

  test('counts a single entry as one entry', async () => {
    // arrange
    await rm(join(outputDir, 'quote-pages.log'));

    // act
    const { output } = await capture(() => clearOutput(outputDir, protectedPaths));

    // assert
    assert.match(output, /output \(1 entry\)/);
  });

  test('reports a missing folder and deletes nothing', async () => {
    // arrange
    const missing = join(parent, 'missing');

    // act
    const { result, output } = await capture(() => clearOutput(missing, protectedPaths));

    // assert
    assert.equal(result, 'missing');
    assert.match(output, /does not exist; nothing to delete\./);
    assert.equal(await exists(outputDir), true);
  });

  for (const blank of [undefined, '', '   ']) {
    test(`refuses when DIFF_OUTPUT_DIR is ${JSON.stringify(blank)}`, async () => {
      // act
      const { result, output } = await capture(() => clearOutput(blank, protectedPaths));

      // assert
      assert.equal(result, 'refused');
      assert.match(output, /DIFF_OUTPUT_DIR is not set/);
    });
  }

  test('refuses a drive root', async () => {
    // arrange
    const root = parse(outputDir).root;

    // act
    const { result, output } = await capture(() => clearOutput(root, protectedPaths));

    // assert
    assert.equal(result, 'refused');
    assert.match(output, /it is a drive root/);
  });

  for (const [name, folder] of [
    ['the project', 'project'],
    ['the user profile', 'profile']
  ]) {
    test(`refuses ${name} and any folder containing it`, async () => {
      // arrange
      await mkdir(join(parent, folder), { recursive: true });

      // act
      const itself = await capture(() => clearOutput(join(parent, folder), protectedPaths));
      const containing = await capture(() => clearOutput(parent, protectedPaths));

      // assert
      assert.equal(itself.result, 'refused');
      assert.equal(containing.result, 'refused');
      assert.match(itself.output, /Nothing was deleted\./);
      assert.equal(await exists(join(parent, folder)), true);
      assert.equal(await exists(outputDir), true);
    });
  }

  test('deletes a folder inside the project or profile', async () => {
    // arrange
    const inside = join(parent, 'project', 'output');
    await mkdir(inside, { recursive: true });

    // act
    const { result } = await capture(() => clearOutput(inside, protectedPaths));

    // assert
    assert.equal(result, 'deleted');
    assert.equal(await exists(inside), false);
    assert.equal(await exists(join(parent, 'project')), true);
  });

  test('ignores case when comparing with a protected folder', async () => {
    // arrange
    const upperProject = join(parent, 'PROJECT');

    // act
    const { result } = await capture(() => clearOutput(upperProject, protectedPaths));

    // assert
    assert.equal(result, 'refused');
  });
});

describe('clear-output command', () => {
  async function run(cwd, environment, args = []) {
    const child = spawn(process.execPath, [script, 'clear-output', ...args], {
      cwd,
      env: { ...process.env, ...environment }
    });
    let output = '';
    child.stdout.on('data', (data) => (output += data));
    child.stderr.on('data', (data) => (output += data));
    const code = await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', resolveExit);
    });
    // eslint-disable-next-line no-control-regex
    return { code, output: output.replace(/\u001b\[\d+m/g, '') };
  }

  let cwd;
  beforeEach(async () => {
    // A folder with no .env, so only the environment given here applies.
    cwd = await mkdtemp(join(tmpdir(), 'clear-output-cli-'));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('deletes DIFF_OUTPUT_DIR', async () => {
    // arrange
    const outputDir = join(cwd, 'output');
    await mkdir(join(outputDir, 'a'), { recursive: true });

    // act
    const { code, output } = await run(cwd, { DIFF_OUTPUT_DIR: outputDir });

    // assert
    assert.equal(code, 0, output);
    assert.match(output, /output \(1 entry\)/);
    assert.equal(await exists(outputDir), false);
  });

  test('exits with 1 when DIFF_OUTPUT_DIR is not set', async () => {
    // act
    const { code, output } = await run(cwd, { DIFF_OUTPUT_DIR: '' });

    // assert
    assert.equal(code, 1, output);
    assert.match(output, /DIFF_OUTPUT_DIR is not set/);
    assert.equal(await exists(cwd), true);
  });

  test('rejects an argument', async () => {
    // act
    const { code, output } = await run(cwd, { DIFF_OUTPUT_DIR: join(cwd, 'output') }, ['extra']);

    // assert
    assert.equal(code, 1, output);
    assert.match(output, /clear-output takes no arguments \(got extra\)\./);
  });
});
