import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DeclinedError, screenshot } from '../dist/screenshot.js';
import { unsavedQuote } from '../dist/unsaved-quote.js';
import { declinedPageHtml, quotePageHtml, unsavedJourneyHtml } from './unsaved-journey-html.mjs';

for (const [name, html, beforeCapture, expectedDeclined] of [
  ['detects a declined quote on the opened page', declinedPageHtml, undefined, true],
  [
    'detects a declined quote that appears while the page waits',
    `<h1>Loading</h1><script>setTimeout(() => { document.body.innerHTML = ${JSON.stringify(declinedPageHtml)}; }, 200);</script>`,
    (page) => page.waitForTimeout(1500),
    true
  ],
  ['detects a declined quote after an unsaved journey', unsavedJourneyHtml({ declines: true }), unsavedQuote, true],
  [
    "captures a page with a we're sorry heading but no decline wording",
    "<h2>We're sorry for the wait</h2>" + quotePageHtml,
    undefined,
    false
  ]
]) {
  test(`declined quote: ${name}`, async () => {
    // arrange
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(html);
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const directory = await mkdtemp(join(tmpdir(), 'declined-quote-'));
    try {
      // act
      const capture = screenshot(`http://127.0.0.1:${server.address().port}`, {
        output: join(directory, 'quote.png'),
        wait: 0,
        timeout: 3000,
        beforeCapture
      });

      // assert
      if (expectedDeclined) {
        await assert.rejects(capture, DeclinedError);
        assert.deepEqual((await readdir(directory)).sort(), ['quote-declined.html', 'quote-declined.png']);
        assert.match(await readFile(join(directory, 'quote-declined.html'), 'utf8'), /unable to offer you a quote/);
      } else {
        await capture;
        assert.deepEqual(await readdir(directory), ['quote.png']);
      }
    } finally {
      server.closeAllConnections();
      await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
    }
  });
}

test('failure HTML is the rendered DOM, not the served source', async () => {
  // arrange
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<script>document.body.innerHTML = "<p>Rendered by script</p>";</script>');
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const directory = await mkdtemp(join(tmpdir(), 'declined-quote-'));
  try {
    // act
    const capture = screenshot(`http://127.0.0.1:${server.address().port}`, {
      output: join(directory, 'quote.png'),
      wait: 0,
      timeout: 1000,
      beforeCapture: (page) => page.locator('h1').waitFor()
    });

    // assert
    await assert.rejects(capture, /Timeout/);
    assert.match(await readFile(join(directory, 'quote-failed.html'), 'utf8'), /<p>Rendered by script<\/p>/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
  }
});
