import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { quoteSummary } from '../dist/quote-summary.js';
import { screenshot } from '../dist/screenshot.js';
import {
  assumptionsPageHtml,
  nhiPagesHtml,
  quotePageHtml,
  quoteSummaryHtml,
  summaryPageHtml
} from './unsaved-journey-html.mjs';

const summaryButton = 'hp-summary-continue-button';
const assumptionsButton = 'hp-assumptions-quote-button';
const errorSummaryHtml = '<div class="av-card-error-summary"><ul><li><a>Quote unavailable</a></li></ul></div>';

for (const [name, html, expectedError, label = 'NHI'] of [
  ['clicks through the summary and assumptions pages and captures the quote', quoteSummaryHtml, undefined],
  [
    'clicks Continue with quote when the summary leads straight to the quote',
    nhiPagesHtml(summaryPageHtml, { [summaryButton]: quotePageHtml }),
    undefined
  ],
  [
    'clicks Yes, take me to my quote when the assumptions page is shown first',
    nhiPagesHtml(assumptionsPageHtml, { [assumptionsButton]: quotePageHtml }),
    undefined
  ],
  ['captures a page already showing the quote without clicking', quotePageHtml, undefined],
  [
    'ignores a Continue with quote button without the summary id',
    '<button type="button">Continue with quote</button>',
    /Timeout/
  ],
  [
    'never clicks No, I need to make changes',
    nhiPagesHtml('<button id="hp-edit-questions-button" type="button">No, I need to make changes</button>', {
      'hp-edit-questions-button': quotePageHtml
    }),
    /Timeout/
  ],
  [
    'reports the error summary shown after Continue with quote',
    nhiPagesHtml(summaryPageHtml, { [summaryButton]: errorSummaryHtml }),
    /NHI quote summary errors: Quote unavailable/
  ],
  [
    'reports the error summary shown after Yes, take me to my quote',
    nhiPagesHtml(assumptionsPageHtml, { [assumptionsButton]: errorSummaryHtml }),
    /NHI assumptions errors: Quote unavailable/
  ],
  [
    'stops when the pages keep leading to each other',
    nhiPagesHtml(summaryPageHtml, { [summaryButton]: assumptionsPageHtml, [assumptionsButton]: summaryPageHtml }),
    /NHI quote did not appear within 5 clicks; last shown: assumptions/
  ],
  [
    'prefixes errors with the flow label',
    nhiPagesHtml(assumptionsPageHtml, { [assumptionsButton]: errorSummaryHtml }),
    /TCAS assumptions errors: Quote unavailable/,
    'TCAS'
  ],
  [
    'times out when Continue with quote never shows the quote',
    nhiPagesHtml(summaryPageHtml, { [summaryButton]: '<h1>Still waiting</h1>' }),
    /Timeout/
  ],
  ['times out when the page is neither the summary nor the quote', '<h1>Something else</h1>', /Timeout/]
]) {
  test(`${label} quote summary ${name}`, async () => {
    // arrange
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(html);
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const directory = await mkdtemp(join(tmpdir(), 'quote-summary-'));
    try {
      // act
      const capture = screenshot(`http://127.0.0.1:${server.address().port}`, {
        output: join(directory, 'quote.png'),
        wait: 0,
        timeout: 2000,
        beforeCapture: quoteSummary(label)
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
