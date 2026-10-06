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

/**
 * Builds an assumptions page whose Yes button returns to the journey with the cover start date out of range (markup
 * trimmed from the live page). The Cover start calendar is only shown on Cover details.
 * @param {object} [options]
 * @param {string} [options.returnTo] Section Yes returns to (default Cover details).
 * @param {'quote' | 'new error' | 'same error'} [options.afterFix] What Return to quote shows once October 6th is
 * picked: the quote, a re-rendered error summary, or nothing (the existing summary stays in place).
 * @returns {string} Page HTML.
 */
function coverStartJourneyHtml({ returnTo = 'Cover details', afterFix = 'quote' } = {}) {
  return `${assumptionsPageHtml}<script>
    const journey = '<div class="av-timeline-all-sections"><ul><li title="Cover details">Cover details</li>'
      + '<li title="Contact details">Contact details</li></ul></div><h1></h1><span id="calendar">'
      + '<svg class="av-icon av-icon-calendar" width="24" height="24"><rect width="24" height="24" /></svg></span>'
      + '<div id="day" hidden aria-label="Choose Tuesday, October 6th, 2026">6</div>'
      + '<button type="button" class="btn btn-primary hp-submit-form"><div>Return to quote</div></button>';
    const summary = '<div class="av-card-error-summary"><h3>You haven&lsquo;t answered all the questions</h3><ul><li>'
      + '<a href="/cover-details">The Cover start field needs to be between 2026-10-06 and 2026-11-20</a></li></ul></div>';
    let selected = false;
    const showSection = (section) => {
      document.querySelector('h1').textContent = section;
      document.getElementById('calendar').hidden = section !== 'Cover details';
    };
    const showError = () => {
      document.querySelector('.av-card-error-summary')?.remove();
      document.querySelector('h1').insertAdjacentHTML('afterend', summary);
    };
    document.addEventListener('click', (event) => {
      if (event.target.closest('#${assumptionsButton}') !== null) {
        setTimeout(() => {
          document.body.innerHTML = journey;
          showSection(${JSON.stringify(returnTo)});
          showError();
        }, 100);
      } else if (event.target.closest('li[title="Cover details"]') !== null) {
        showSection('Cover details');
      } else if (event.target.closest('svg') !== null) {
        document.getElementById('day').hidden = false;
      } else if (event.target.id === 'day') {
        selected = true;
      } else if (event.target.closest('.hp-submit-form') !== null) {
        const afterFix = ${JSON.stringify(afterFix)};
        if (selected && afterFix === 'quote') {
          setTimeout(() => { document.body.innerHTML = ${JSON.stringify(quotePageHtml)}; }, 100);
        } else if (afterFix === 'new error') {
          setTimeout(showError, 100);
        }
      }
    });
  </script>`;
}

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
  ['times out when the page is neither the summary nor the quote', '<h1>Something else</h1>', /Timeout/],
  ['fixes the cover start date on Cover details and returns to the quote', coverStartJourneyHtml(), undefined],
  [
    'opens Cover details from the timeline to fix the cover start date',
    coverStartJourneyHtml({ returnTo: 'Contact details' }),
    undefined
  ],
  [
    'reports a cover start error shown again after Return to quote',
    coverStartJourneyHtml({ afterFix: 'new error' }),
    /NHI cover details errors: The Cover start field needs to be between 2026-10-06/
  ],
  [
    'reports a cover start error left in place after Return to quote',
    coverStartJourneyHtml({ afterFix: 'same error' }),
    /NHI cover details errors: The Cover start field needs to be between 2026-10-06/
  ]
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
        assert.deepEqual((await readdir(directory)).sort(), ['quote-failed.html', 'quote-failed.png']);
      }
    } finally {
      server.closeAllConnections();
      await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
    }
  });
}
