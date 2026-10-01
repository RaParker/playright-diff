import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { compare } from '../dist/compare.js';
import { quotePage } from '../dist/quote-page.js';
import { screenshot } from '../dist/screenshot.js';

test('action modules import without running commands or changing exit status', async () => {
  const imports = ['screenshot', 'compare', 'quote-page']
    .map((name) => `await import(${JSON.stringify(pathToFileURL(resolve(`dist/${name}.js`)).href)});`)
    .join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '--eval', imports]);
  let output = '';
  child.stdout.on('data', (data) => (output += data));
  child.stderr.on('data', (data) => (output += data));
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  assert.equal(code, 0, output);
  assert.equal(output, '');
});

test('action modules accept direct arguments and reject invalid input without CLI error handling', async () => {
  await assert.rejects(screenshot('file:///example'), /URL must use http/);
  await assert.rejects(screenshot('http://example.com', { width: 0 }), /width must/);
  await assert.rejects(compare('before.png', 'after.png', { threshold: 256 }), /threshold must/);
  const options = {
    mrpAndQuoteOutputDir: '.',
    nhiQuotePageUrlTemplate: 'http://example.com/{artemisQuotGuid}',
    tcasQuotePageUrlTemplate: 'http://example.com/{policyDetailsId}/{historyId}'
  };
  await assert.rejects(quotePage('invalid', 42, options), /policyDetailsId must/);
  await assert.rejects(quotePage('ABCDEF1234567890ABCDEF1234567890', -1, options), /historyId must/);
});
