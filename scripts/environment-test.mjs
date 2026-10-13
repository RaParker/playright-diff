import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { loadEnvironment } from '../dist/environment.js';

async function load(content, environment = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'environment-test-'));
  try {
    const path = join(directory, '.env');
    await writeFile(path, content);
    return await loadEnvironment(path, environment);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('environment resolves quoted, nested and forward references from .env', async () => {
  // arrange
  const content =
    'MRP_AND_QUOTE_OUTPUT_DIR="${OUTPUT_ROOT}/output"\nOUTPUT_ROOT=${REPO_BASE_PATH}/GoPackages/internal/mrp-and-quote\nREPO_BASE_PATH="D:/repo with spaces"';

  // act
  const values = await load(content);

  // assert
  assert.equal(values.MRP_AND_QUOTE_OUTPUT_DIR, 'D:/repo with spaces/GoPackages/internal/mrp-and-quote/output');
  assert.equal(values.OUTPUT_ROOT, 'D:/repo with spaces/GoPackages/internal/mrp-and-quote');
});

test('environment uses externally configured values over file values without mutating the input', async () => {
  // arrange
  const environment = { ROOT: 'D:/external', OUTPUT: '${ROOT}/override', UNRELATED: '${MISSING}' };

  // act
  const values = await load('ROOT=D:/file\nOUTPUT=${ROOT}/file', environment);

  // assert
  assert.equal(values.OUTPUT, 'D:/external/override');
  assert.equal(values.UNRELATED, '${MISSING}');
  assert.equal(environment.OUTPUT, '${ROOT}/override');
});

test('environment supports references defined only in the process environment', async () => {
  // arrange
  const environment = { REPO_BASE_PATH: 'D:/repositories' };

  // act
  const values = await load('OUTPUT=${REPO_BASE_PATH}/output', environment);

  // assert
  assert.equal(values.OUTPUT, 'D:/repositories/output');
});

test('environment preserves empty values, repeated references and quote-page URL placeholders', async () => {
  // arrange
  const content = 'EMPTY=\nROOT=https://example.com\nURL=${ROOT}/{policyDetailsId}/${EMPTY}/{historyId}?again=${ROOT}';

  // act
  const values = await load(content);

  // assert
  assert.equal(values.URL, 'https://example.com/{policyDetailsId}//{historyId}?again=https://example.com');
});

test('environment rejects a missing reference with its variable name when the setting is read', async () => {
  // arrange
  const values = await load('OUTPUT=${REPO_BASE_PATH}/output');

  // act
  const read = () => values.OUTPUT;

  // assert
  assert.throws(read, /REPO_BASE_PATH is referenced but not defined/);
});

test('environment rejects direct and indirect reference cycles when the setting is read', async () => {
  // arrange
  const direct = await load('A=${A}');
  const indirect = await load('A=${B}\nB=${C}\nC=${A}');

  // act
  const readDirect = () => direct.A;
  const readIndirect = () => indirect.A;

  // assert
  assert.throws(readDirect, /Circular environment variable reference: A -> A/);
  assert.throws(readIndirect, /A -> B -> C -> A/);
});

test('environment reads a setting without references when another references a missing name', async () => {
  // arrange
  const values = await load('DIFF_OUTPUT_DIR=D:/output\nPROJECT=${REPO_BASE_PATH}/project');

  // act
  const output = values.DIFF_OUTPUT_DIR;

  // assert
  assert.equal(output, 'D:/output');
  assert.throws(() => values.PROJECT, /REPO_BASE_PATH is referenced but not defined/);
});

test('environment overrides can break file cycles and undefined overrides do not hide file values', async () => {
  // arrange
  const environment = { B: 'external', ROOT: undefined };

  // act
  const values = await load('A=${B}\nB=${A}\nROOT=file\nOUTPUT=${ROOT}', environment);

  // assert
  assert.equal(values.A, 'external');
  assert.equal(values.OUTPUT, 'file');
});

test('environment allows a missing .env file when settings are provided externally', async (context) => {
  // arrange
  const directory = await mkdtemp(join(tmpdir(), 'environment-missing-'));
  context.after(() => rm(directory, { recursive: true, force: true }));

  // act
  const values = await loadEnvironment(join(directory, '.env'), { OUTPUT: 'external' });

  // assert
  assert.deepEqual(values, { OUTPUT: 'external' });
});

test('an action shows its help when .env references a name defined nowhere', async (context) => {
  // arrange
  const directory = await mkdtemp(join(tmpdir(), 'environment-help-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, '.env'), 'MRP_AND_QUOTE_PROJECT_DIR=${UNDEFINED_REPO_ROOT}/mrp-and-quote\n');

  // act
  const child = spawn(process.execPath, [resolve('dist/main.js'), 'quote-page', '--help'], { cwd: directory });
  let output = '';
  child.stdout.on('data', (data) => (output += data));
  child.stderr.on('data', (data) => (output += data));
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });

  // assert
  assert.equal(code, 0, output);
  assert.match(output, /^Usage: npm run quote-page/);
});

test('environment reads the first setting of a .env file saved with a byte order mark', async () => {
  // arrange
  const content = '\uFEFFDIFF_OUTPUT_DIR=D:/output\nOTHER=1';

  // act
  const values = await load(content);

  // assert
  assert.equal(values.DIFF_OUTPUT_DIR, 'D:/output');
});

test(
  'environment finds a reference in a different case on Windows',
  { skip: process.platform !== 'win32' && 'environment variable names are case-sensitive here' },
  async () => {
    // arrange
    const content = 'AGENT=${Username}';

    // act
    const values = await load(content, { USERNAME: 'agent.name' });

    // assert
    assert.equal(values.AGENT, 'agent.name');
  }
);
