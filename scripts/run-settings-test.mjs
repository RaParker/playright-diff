import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, test } from 'node:test';
import { loadEnvironment } from '../dist/environment.js';
import { projectRoot, setOutputRoot } from '../dist/output-paths.js';
import { describeRunSettings } from '../dist/run-settings.js';

/** Loads `content` as a .env file beneath `environment`, as a run does. */
async function load(content, environment = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'run-settings-test-'));
  try {
    const path = join(directory, '.env');
    await writeFile(path, content);
    return await loadEnvironment(path, environment);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** The described value of one line, by its name. */
function line(lines, name) {
  return lines
    .find((text) => text.trimStart().startsWith(name))
    ?.trimStart()
    .slice(name.length)
    .trim();
}

describe('describeRunSettings', () => {
  afterEach(() => setOutputRoot(undefined));

  test('shows each setting with its source, and the folders it resolves to', async () => {
    // arrange
    const environment = await load(
      'QUOTE_JOURNEY_HOST=quotes-${QUOTE_JOURNEY_ENVIRONMENT}.example\nOUTPUT_DIR=D:/out',
      {
        QUOTE_JOURNEY_ENVIRONMENT: 'tst'
      }
    );
    setOutputRoot('D:/out/tst');

    // act
    const lines = describeRunSettings(environment);

    // assert
    assert.equal(line(lines, 'QUOTE_JOURNEY_ENVIRONMENT'), 'tst  (environment)');
    assert.equal(line(lines, 'QUOTE_JOURNEY_HOST'), 'quotes-tst.example  (.env)');
    assert.equal(line(lines, 'OUTPUT_DIR'), 'D:/out  (.env)');
    assert.equal(line(lines, 'MRP_AND_QUOTE_PROJECT_DIR'), '(not set)');
    assert.equal(line(lines, 'Output folder'), resolve('D:/out/tst'));
    assert.equal(line(lines, 'MRP folder'), resolve('D:/out/tst/mrp-and-quote'));
  });

  test('describes a value that cannot be read and an output folder that is refused, without throwing', async () => {
    // arrange
    const environment = await load('QUOTE_GUID_LIST_PATH=${UNDEFINED_ROOT}/guids.txt');
    setOutputRoot(join(projectRoot, 'output'));

    // act
    const lines = describeRunSettings(environment);

    // assert
    assert.match(line(lines, 'QUOTE_GUID_LIST_PATH'), /^\(cannot be read: .*UNDEFINED_ROOT/);
    assert.match(line(lines, 'Output folder'), /^\(cannot be resolved: The output folder .+ is inside this project/);
  });
});

describe('show-config command', () => {
  test('prints the settings and folders without running anything', async (context) => {
    // arrange
    const directory = await mkdtemp(join(tmpdir(), 'show-config-'));
    context.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(join(directory, '.env'), 'OUTPUT_DIR=./out\nQUOTE_JOURNEY_ENVIRONMENT=dev\n');
    const env = { ...process.env, NO_COLOR: '1' };
    delete env.QUOTE_JOURNEY_ENVIRONMENT;
    const child = spawn(process.execPath, [resolve('dist/main.js'), 'show-config'], { cwd: directory, env });
    let output = '';
    child.stdout.on('data', (data) => (output += data));
    child.stderr.on('data', (data) => (output += data));

    // act
    const code = await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', resolveExit);
    });

    // assert
    assert.equal(code, 0, output);
    assert.match(output, /QUOTE_JOURNEY_ENVIRONMENT +dev {2}\(\.env\)/);
    assert.match(output, /Output folder +.+[\\/]out[\\/]dev/);
  });

  /** Runs show-config in a new folder with the given .env, after `prepare` adds any files, and returns its output. */
  async function showConfig(context, dotEnv, environment = {}, prepare = async () => {}) {
    const directory = await mkdtemp(join(tmpdir(), 'show-config-'));
    context.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(join(directory, '.env'), dotEnv);
    await prepare(directory);
    const env = { ...process.env, NO_COLOR: '1', ...environment };
    for (const name of ['QUOTE_JOURNEY_ENVIRONMENT', 'QUOTE_JOURNEY_RUN_NAME']) {
      if (!(name in environment)) {
        delete env[name];
      }
    }

    const child = spawn(process.execPath, [resolve('dist/main.js'), 'show-config'], { cwd: directory, env });
    let output = '';
    child.stdout.on('data', (data) => (output += data));
    child.stderr.on('data', (data) => (output += data));
    const code = await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', resolveExit);
    });
    return { code, output };
  }

  test('shows an invalid run name as an error, rather than failing', async (context) => {
    // act
    const { code, output } = await showConfig(context, 'OUTPUT_DIR=./out\nQUOTE_JOURNEY_ENVIRONMENT=dev\n', {
      QUOTE_JOURNEY_RUN_NAME: 'a:b'
    });

    // assert
    assert.equal(code, 0, output);
    assert.match(output, /QUOTE_JOURNEY_RUN_NAME +a:b: QUOTE_JOURNEY_RUN_NAME "a:b" contains a character/);
    assert.match(output, /Output folder +\(cannot be resolved: QUOTE_JOURNEY_RUN_NAME "a:b"/);
  });

  test("resolves a named run's MRP folder from the environment its run.json records", async (context) => {
    // act: .env has moved on to dev since the run was made with tst
    const { code, output } = await showConfig(
      context,
      'OUTPUT_DIR=./out\nQUOTE_JOURNEY_ENVIRONMENT=dev\n',
      { QUOTE_JOURNEY_RUN_NAME: 'temp2' },
      async (directory) => {
        await mkdir(join(directory, 'out', 'temp2'), { recursive: true });
        await writeFile(join(directory, 'out', 'temp2', 'run.json'), JSON.stringify({ environment: 'tst' }));
      }
    );

    // assert
    assert.equal(code, 0, output);
    assert.match(output, /Output folder +.+[\\/]out[\\/]temp2/);
    assert.match(output, /MRP folder +.+[\\/]out[\\/]tst[\\/]mrp-and-quote/);
  });
});
