import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import { viewerFixture } from './viewer-fixture.mjs';

const script = resolve('dist/main.js');
const settingNames = ['QUOTE_GUID_LIST_PATH', 'OUTPUT_DIR', 'QUOTE_JOURNEY_ENVIRONMENT', 'QUOTE_JOURNEY_RUN_NAME'];

/** Starts the CLI in the fixture folder (its output folder) with none of the run settings from the shell. */
function spawnCli(directory, args) {
  const env = { ...process.env };
  settingNames.forEach((name) => delete env[name]);
  return spawn(process.execPath, [script, ...args], { cwd: directory, env });
}

/** Runs the CLI to its end, returning its exit code and output without colour codes. */
async function runCli(directory, args) {
  const child = spawnCli(directory, args);
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

async function fixture(context) {
  const root = await viewerFixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

describe('serve command', () => {
  test('serves the output folder', async (context) => {
    // arrange
    const root = await viewerFixture();
    const child = spawnCli(root, ['serve', '--port', '0', '--no-open']);
    const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
    // The child runs in the fixture folder, so it must have exited before the folder can be removed.
    context.after(async () => {
      child.kill();
      await exited;
      await rm(root, { recursive: true, force: true });
    });
    let output = '';
    const url = await new Promise((resolveUrl, reject) => {
      child.stdout.on('data', (data) => {
        output += data;
        const match = /Viewer: (http:\/\/127\.0\.0\.1:\d+\/) \(output: .+\)\. Ctrl\+C to stop\./.exec(output);
        if (match !== null) {
          resolveUrl(match[1]);
        }
      });
      child.once('close', () => reject(new Error(`serve stopped: ${output}`)));
    });

    // act
    const run = await (await fetch(new URL('/api/policies', url))).json();

    // assert
    assert.equal(run.policies.length, 5);
  });

  for (const port of ['abc', '-1', '70000', '1.5']) {
    test(`rejects the port ${port}`, async (context) => {
      // arrange
      const root = await fixture(context);

      // act
      const { code, output } = await runCli(root, ['serve', '--port', port, '--no-open']);

      // assert
      assert.equal(code, 1);
      assert.match(output, /--port must be a whole number from 0 to 65535/);
      assert.match(output, /Usage: npm run serve/);
    });
  }

  for (const option of ['--bogus', '-x']) {
    test(`reports the unknown option ${option} as unknown, not as a bad port`, async (context) => {
      // arrange
      const root = await fixture(context);

      // act
      const { code, output } = await runCli(root, ['serve', option]);

      // assert
      assert.equal(code, 1);
      assert.match(output, /Unknown option/);
      assert.doesNotMatch(output, /--port must be/);
    });
  }

  test('reports a port in use', async (context) => {
    // arrange
    const root = await fixture(context);
    const blocker = createServer();
    await new Promise((resolveListen) => blocker.listen(0, '127.0.0.1', resolveListen));
    context.after(() => new Promise((resolveClose) => blocker.close(resolveClose)));
    const { port } = blocker.address();

    // act
    const { code, output } = await runCli(root, ['serve', '--port', String(port), '--no-open']);

    // assert
    assert.equal(code, 1);
    assert.match(output, new RegExp(`Port ${port} is in use; choose another with --port`));
    assert.doesNotMatch(output, /\n\s+at /);
  });

  test('--help prints the serve usage', async (context) => {
    // arrange
    const root = await fixture(context);

    // act
    const { code, output } = await runCli(root, ['serve', '--help']);

    // assert
    assert.equal(code, 0);
    assert.match(output, /Usage: npm run serve -- \[--port <port>\] \[--no-open\]/);
  });
});
