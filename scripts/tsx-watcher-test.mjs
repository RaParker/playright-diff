import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { declinedPageHtml } from './unsaved-journey-html.mjs';

// The npm scripts run the TypeScript source through tsx, which rewrites named functions; the page watcher must
// still work there, not only in the compiled dist/ code the other tests use.
const timeoutMilliseconds = 8000;

for (const [name, finalHtml, expected] of [
  ['an Oops that appears after the page loads', '<h2>Oops</h2>', /Website displayed <h2>Oops<\/h2>/],
  ['a decline that appears after the page loads', declinedPageHtml, /Website declined the quote/]
]) {
  test(`page watcher under tsx stops at once on ${name}`, async () => {
    // arrange
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      // The screenshot command scrolls and waits after load, so a delayed change is seen only by the watcher
      // (and the checks just before capture) - the long --wait keeps the capture from finishing first.
      response.end(
        `<h1>Loading</h1><script>setTimeout(() => { document.body.innerHTML = ${JSON.stringify(finalHtml)}; }, 500);</script>`
      );
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const directory = await mkdtemp(join(tmpdir(), 'tsx-watcher-'));
    try {
      const started = performance.now();

      // act
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          resolve('src/main.ts'),
          'screenshot',
          `http://127.0.0.1:${server.address().port}`,
          '--output',
          join(directory, 'page.png'),
          '--wait',
          String(timeoutMilliseconds),
          '--timeout',
          String(timeoutMilliseconds)
        ],
        { cwd: resolve('.') }
      );
      let output = '';
      child.stdout.on('data', (data) => (output += data));
      child.stderr.on('data', (data) => (output += data));
      const code = await new Promise((resolveExit, reject) => {
        child.once('error', reject);
        child.once('close', resolveExit);
      });

      // assert
      assert.notEqual(code, 0, output);
      assert.match(output, expected);
      assert.ok(performance.now() - started < timeoutMilliseconds, `stopped only after the wait: ${output}`);
    } finally {
      server.closeAllConnections();
      await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
    }
  });
}
