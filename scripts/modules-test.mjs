import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { compare } from '../dist/compare.js';
import { quotePage } from '../dist/quote-page.js';
import { screenshot } from '../dist/screenshot.js';

test('action modules import without running commands or changing exit status', async () => {
  // arrange
  const imports = ['screenshot', 'compare', 'quote-page']
    .map((name) => `await import(${JSON.stringify(pathToFileURL(resolve(`dist/${name}.js`)).href)});`)
    .join('\n');

  // act
  const child = spawn(process.execPath, ['--input-type=module', '--eval', imports]);
  let output = '';
  child.stdout.on('data', (data) => (output += data));
  child.stderr.on('data', (data) => (output += data));
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });

  // assert
  assert.equal(code, 0, output);
  assert.equal(output, '');
});

test('action modules accept direct arguments and reject invalid input without CLI error handling', async () => {
  // arrange
  const options = {
    mrpAndQuoteOutputDir: '.',
    nhiQuotePageUrlTemplate: 'http://example.com/{artemisQuoteGuid}',
    tcasQuotePageUrlTemplate: 'http://example.com/{policyDetailsId}/{historyId}'
  };

  // act
  const fileUrlScreenshot = () => screenshot('file:///example');
  const zeroWidthScreenshot = () => screenshot('http://example.com', { width: 0 });
  const largeThresholdCompare = () => compare('before.png', 'after.png', { threshold: 256 });
  const invalidPolicyQuotePage = () => quotePage('invalid', 42, options);
  const negativeHistoryQuotePage = () => quotePage('ABCDEF1234567890ABCDEF1234567890', -1, options);

  // assert
  await assert.rejects(fileUrlScreenshot, /URL must use http/);
  await assert.rejects(zeroWidthScreenshot, /width must/);
  await assert.rejects(largeThresholdCompare, /threshold must/);
  await assert.rejects(invalidPolicyQuotePage, /policyDetailsId must/);
  await assert.rejects(negativeHistoryQuotePage, /historyId must/);
});
