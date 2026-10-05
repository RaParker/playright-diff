import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { nhiQuote } from '../dist/nhi-quote.js';
import { screenshot } from '../dist/screenshot.js';
import { quotePageHtml, quoteSummaryHtml } from './unsaved-journey-html.mjs';

function summaryLeadingTo(outcome) {
  return `<h1>Welcome Alex, thank you for choosing Homeprotect</h1>
    <button id="hp-summary-continue-button" type="button">Continue with quote</button><script>
    document.querySelector('button').onclick = () => {
      setTimeout(() => { document.body.innerHTML = ${JSON.stringify(outcome)}; }, 100);
    };
  </script>`;
}

for (const [name, html, expectedError] of [
  ['clicks Continue with quote on the summary page and captures the quote', quoteSummaryHtml, undefined],
  ['waits for the quote page to appear after Continue with quote', summaryLeadingTo(quotePageHtml), undefined],
  [
    'ignores a Continue with quote button without the summary id',
    '<button type="button">Continue with quote</button>',
    /Timeout/
  ],
  ['captures a page already showing the quote without clicking', quotePageHtml, undefined],
  [
    'reports the error summary shown after Continue with quote',
    summaryLeadingTo('<div class="av-card-error-summary"><ul><li><a>Quote unavailable</a></li></ul></div>'),
    /NHI quote summary errors: Quote unavailable/
  ],
  ['times out when Continue with quote never shows the quote', summaryLeadingTo('<h1>Still waiting</h1>'), /Timeout/],
  ['times out when the page is neither the summary nor the quote', '<h1>Something else</h1>', /Timeout/]
]) {
  test(`NHI quote ${name}`, async () => {
    // arrange
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(html);
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const directory = await mkdtemp(join(tmpdir(), 'nhi-quote-'));
    try {
      // act
      const capture = screenshot(`http://127.0.0.1:${server.address().port}`, {
        output: join(directory, 'quote.png'),
        wait: 0,
        timeout: 2000,
        beforeCapture: nhiQuote
      });

      // assert
      if (expectedError === undefined) {
        await capture;
        assert.deepEqual(await readdir(directory), ['quote.png']);
      } else {
        await assert.rejects(capture, expectedError);
        assert.deepEqual(await readdir(directory), ['quote-failed.png']);
      }
    } finally {
      server.closeAllConnections();
      await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
    }
  });
}
