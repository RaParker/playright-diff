import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { migrateOutput, planOutputMigration } from '../dist/migrate-output.js';

const script = resolve('dist/main.js');
const policy = 'ABCDEF1234567890ABCDEF1234567890-1';
const otherPolicy = '11111111111111111111111111111111-1';

async function writeFiles(root, files) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

/** Every file under the folder, as paths relative to it with forward slashes, sorted. */
async function listFiles(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(root.length + 1)
        .replaceAll('\\', '/')
    )
    .sort();
}

/** An old-layout comparison report of the policy's screenshots, as compare wrote it. */
function oldReport(root, name) {
  return JSON.stringify(
    {
      before: join(root, 'screenshots', `${name}-nhi.png`),
      after: join(root, 'screenshots', `${name}-tcas.png`),
      changedPixels: 5,
      regions: []
    },
    null,
    2
  );
}

async function quietly(task) {
  const log = console.log;
  console.log = () => {};
  try {
    return await task();
  } finally {
    console.log = log;
  }
}

describe('migrateOutput', () => {
  let root;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'migrate-output-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  for (const [oldPath, newPath] of [
    [`screenshots/${policy}-nhi.png`, `${policy}/nhi.png`],
    [`screenshots/${policy}-tcas.png`, `${policy}/tcas.png`],
    [`screenshots/${policy}-nhi-failed.png`, `${policy}/nhi-failed.png`],
    [`screenshots/${policy}-nhi-failed.html`, `${policy}/nhi-failed.html`],
    [`screenshots/${policy}-tcas-declined.png`, `${policy}/tcas-declined.png`],
    [`screenshots/${policy}-tcas-declined.html`, `${policy}/tcas-declined.html`],
    [`screenshots/${policy}-nhi-api/001-GET-quote.json`, `${policy}/nhi-api/001-GET-quote.json`],
    [`comparisons/${policy}/diff.png`, `${policy}/diff.png`],
    [`comparisons/${policy}/region-1-before.png`, `${policy}/region-1-before.png`],
    [`comparisons/${policy}/result.json`, `${policy}/result.json`],
    [`comparisons/${policy}/answer-changes.json`, `${policy}/answer-changes.json`],
    ['comparisons/.ocr-cache/eng.traineddata', '.ocr-cache/eng.traineddata']
  ]) {
    test(`moves ${oldPath} to ${newPath}`, async () => {
      // arrange
      await writeFiles(root, { [oldPath]: 'content' });

      // act
      await quietly(() => migrateOutput({ root, apply: true }));

      // assert
      assert.deepEqual(await listFiles(root), [newPath]);
      assert.equal(await readFile(join(root, newPath), 'utf8'), 'content');
    });
  }

  test('changes nothing on a dry run', async () => {
    // arrange
    await writeFiles(root, {
      [`screenshots/${policy}-nhi.png`]: '',
      [`comparisons/${policy}/result.json`]: '{}'
    });

    // act
    const plan = await quietly(() => migrateOutput({ root }));

    // assert
    assert.equal(plan.moves.length, 2);
    assert.deepEqual(await listFiles(root), [`comparisons/${policy}/result.json`, `screenshots/${policy}-nhi.png`]);
  });

  test("points a moved report at the policy's screenshots in their new place", async () => {
    // arrange
    await writeFiles(root, {
      [`screenshots/${policy}-nhi.png`]: '',
      [`screenshots/${policy}-tcas.png`]: '',
      [`comparisons/${policy}/report.json`]: oldReport(root, policy),
      [`comparisons/${policy}/report.md`]: `Before: ${join(root, 'screenshots', `${policy}-nhi.png`)}\nAfter: ${join(root, 'screenshots', `${policy}-tcas.png`)}\n`
    });

    // act
    await quietly(() => migrateOutput({ root, apply: true }));

    // assert
    const report = JSON.parse(await readFile(join(root, policy, 'report.json'), 'utf8'));
    assert.deepEqual(
      [report.before, report.after, report.changedPixels],
      [join(root, policy, 'nhi.png'), join(root, policy, 'tcas.png'), 5]
    );
    assert.equal(
      await readFile(join(root, policy, 'report.md'), 'utf8'),
      `Before: ${join(root, policy, 'nhi.png')}\nAfter: ${join(root, policy, 'tcas.png')}\n`
    );
  });

  test('rewrites report paths written under another output folder', async () => {
    // arrange
    const report = JSON.parse(oldReport('D:\\temp\\old-output', policy));
    await writeFiles(root, { [`comparisons/${policy}/report.json`]: JSON.stringify(report) });

    // act
    await quietly(() => migrateOutput({ root, apply: true }));

    // assert
    const moved = JSON.parse(await readFile(join(root, policy, 'report.json'), 'utf8'));
    assert.deepEqual([moved.before, moved.after], [join(root, policy, 'nhi.png'), join(root, policy, 'tcas.png')]);
  });

  test("keeps report paths that are not the policy's own screenshots", async () => {
    // arrange
    const report = { before: join(root, 'screenshots', `${otherPolicy}-nhi.png`), after: join(root, 'b.png') };
    await writeFiles(root, { [`comparisons/${policy}/report.json`]: JSON.stringify(report) });

    // act
    await quietly(() => migrateOutput({ root, apply: true }));

    // assert
    assert.deepEqual(JSON.parse(await readFile(join(root, policy, 'report.json'), 'utf8')), report);
  });

  test('leaves an entry whose target exists in place and lists it as a conflict', async () => {
    // arrange
    await writeFiles(root, {
      [`screenshots/${policy}-nhi.png`]: 'old',
      [`${policy}/nhi.png`]: 'new',
      [`screenshots/${policy}-tcas.png`]: 'old'
    });

    // act
    const plan = await quietly(() => migrateOutput({ root, apply: true }));

    // assert
    assert.deepEqual(plan.conflicts, [
      { from: join(root, 'screenshots', `${policy}-nhi.png`), to: join(root, policy, 'nhi.png') }
    ]);
    assert.deepEqual(await listFiles(root), [
      `${policy}/nhi.png`,
      `${policy}/tcas.png`,
      `screenshots/${policy}-nhi.png`
    ]);
    assert.equal(await readFile(join(root, policy, 'nhi.png'), 'utf8'), 'new');
  });

  test('leaves entries that are not quote-page output in place and keeps their folders', async () => {
    // arrange
    await writeFiles(root, {
      'screenshots/screenshot.png': '',
      'comparisons/run-1700000000000/report.json': '{}',
      'comparisons/notes.txt': '',
      [`comparisons/${policy}/result.json`]: '{}'
    });

    // act
    const plan = await quietly(() => migrateOutput({ root, apply: true }));

    // assert
    assert.deepEqual(plan.unrecognised, [
      join(root, 'screenshots', 'screenshot.png'),
      join(root, 'comparisons', 'notes.txt'),
      join(root, 'comparisons', 'run-1700000000000')
    ]);
    assert.deepEqual(await listFiles(root), [
      `${policy}/result.json`,
      'comparisons/notes.txt',
      'comparisons/run-1700000000000/report.json',
      'screenshots/screenshot.png'
    ]);
  });

  test('removes the old folders once they are empty', async () => {
    // arrange
    await writeFiles(root, {
      [`screenshots/${policy}-nhi.png`]: '',
      [`comparisons/${policy}/result.json`]: '{}',
      [`comparisons/${otherPolicy}/result.json`]: '{}'
    });

    // act
    await quietly(() => migrateOutput({ root, apply: true }));

    // assert
    assert.deepEqual((await readdir(root)).sort(), [policy, otherPolicy].sort());
  });

  test('finds nothing to move in an output folder already in the new layout', async () => {
    // arrange
    await writeFiles(root, { [`${policy}/nhi.png`]: '', [`${policy}/result.json`]: '{}' });

    // act
    const plan = await planOutputMigration(root);

    // assert
    assert.deepEqual(plan, { root: resolve(root), moves: [], conflicts: [], unrecognised: [] });
  });
});

describe('migrate-output command', () => {
  async function run(cwd, args) {
    const child = spawn(process.execPath, [script, 'migrate-output', ...args], {
      cwd,
      env: { ...process.env, DIFF_OUTPUT_DIR: cwd }
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

  let root;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'migrate-output-cli-'));
    await writeFiles(root, { [`screenshots/${policy}-nhi.png`]: '', [`comparisons/${policy}/result.json`]: '{}' });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('lists what would move without --apply', async () => {
    // arrange
    const args = [];

    // act
    const { code, output } = await run(root, args);

    // assert
    assert.equal(code, 0, output);
    assert.match(output, /Would move 2 files and folders into 1 policy folders\./);
    assert.match(output, /Dry run: nothing was moved\. Run again with --apply to move them\./);
    assert.deepEqual(await listFiles(root), [`comparisons/${policy}/result.json`, `screenshots/${policy}-nhi.png`]);
  });

  test('moves the files with --apply', async () => {
    // arrange
    const args = ['--apply'];

    // act
    const { code, output } = await run(root, args);

    // assert
    assert.equal(code, 0, output);
    assert.match(output, /Moved 2 files and folders into 1 policy folders\./);
    assert.deepEqual(await listFiles(root), [`${policy}/nhi.png`, `${policy}/result.json`]);
  });

  test('migrates the folder given with --root instead of DIFF_OUTPUT_DIR', async (context) => {
    // arrange
    const other = await mkdtemp(join(tmpdir(), 'migrate-output-cwd-'));
    context.after(() => rm(other, { recursive: true, force: true }));

    // act
    const { code, output } = await run(other, ['--apply', '--root', root]);

    // assert
    assert.equal(code, 0, output);
    assert.deepEqual(await listFiles(root), [`${policy}/nhi.png`, `${policy}/result.json`]);
  });

  test('rejects an argument', async () => {
    // arrange
    const args = ['now'];

    // act
    const { code, output } = await run(root, args);

    // assert
    assert.equal(code, 1);
    assert.match(output, /migrate-output takes no arguments \(got now\)\./);
  });
});
