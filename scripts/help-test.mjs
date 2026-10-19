import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

const actions = [
  'screenshot',
  'compare',
  'quote-page',
  'quote-pages',
  'summarise',
  'migrate-output',
  'clear-output',
  'help'
];

async function runCli(directory, args) {
  const child = spawn(process.execPath, [resolve('dist/main.js'), ...args], { cwd: directory });
  let output = '';
  child.stdout.on('data', (data) => (output += data));
  child.stderr.on('data', (data) => (output += data));
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  return { code, output };
}

for (const flag of ['--help', '-h']) {
  test(`${flag} lists every action without configuration`, async (context) => {
    // arrange
    const directory = await mkdtemp(join(tmpdir(), 'help-test-'));
    context.after(() => rm(directory, { recursive: true, force: true }));

    // act
    const { code, output } = await runCli(directory, [flag]);

    // assert
    assert.equal(code, 0, output);
    assert.match(output, /^Usage: npm run <action>/);
    for (const action of actions) {
      assert.match(output, new RegExp(`^  ${action} `, 'm'), `missing ${action}`);
    }
  });
}
