import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { quoteSummary } from '../dist/quote-summary.js';
import { screenshot } from '../dist/screenshot.js';
import { quotePageHtml, summaryPageHtml } from './unsaved-journey-html.mjs';

const timeout = 1000;

/** Summary page whose Continue with quote shows a loading screen for loadingMs, then the quote (or a stuck page). */
function loadingAfterClick(loadingMs, finalHtml = quotePageHtml) {
  return `${summaryPageHtml}<script>
    document.addEventListener('click', () => {
      document.body.innerHTML = '<h2>Loading your quote</h2>';
      setTimeout(() => { document.body.innerHTML = ${JSON.stringify(finalHtml)}; }, ${loadingMs});
    });
  </script>`;
}

for (const [name, html, beforeCapture, expectedError] of [
  [
    'allows a loading screen on opening to outlast the step timeout',
    `<h2>Loading your quote</h2><script>setTimeout(() => {
      document.body.innerHTML = ${JSON.stringify(quotePageHtml)};
    }, ${timeout * 1.5});</script>`,
    undefined,
    undefined
  ],
  [
    'extends a quote wait while the loading screen is still shown',
    loadingAfterClick(timeout * 1.5),
    quoteSummary('NHI'),
    undefined
  ],
  [
    'fails when the loading screen outlasts the extension',
    loadingAfterClick(timeout * 10),
    quoteSummary('NHI'),
    /Timed out waiting for quote loading screen to disappear/
  ],
  [
    'reports an unexpected page, not a timeout, for a wait with no loading screen',
    loadingAfterClick(0, '<h1>Still waiting</h1>'),
    quoteSummary('NHI'),
    {
      name: 'UnexpectedPageError',
      message: /^Expected page did not appear within 1 s and no loading screen is shown; page shows "Still waiting"\.$/
    }
  ],
  [
    'reports an unexpected page when the page is wrong once the loading screen clears',
    loadingAfterClick(timeout * 1.5, '<h1>Something else</h1>'),
    quoteSummary('NHI'),
    {
      name: 'UnexpectedPageError',
      message: /^Expected page did not appear within 1 s and no loading screen is shown; page shows "Something else"\.$/
    }
  ]
]) {
  test(`loading timeout ${name}`, async () => {
    // arrange
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(html);
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const directory = await mkdtemp(join(tmpdir(), 'loading-timeout-'));
    try {
      // act
      const capture = screenshot(`http://127.0.0.1:${server.address().port}`, {
        output: join(directory, 'quote.png'),
        wait: 0,
        timeout,
        beforeCapture
      });

      // assert
      if (expectedError === undefined) {
        await capture;
        assert.deepEqual(await readdir(directory), ['quote.png']);
      } else {
        await assert.rejects(capture, expectedError);
      }
    } finally {
      server.closeAllConnections();
      await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
    }
  });
}
