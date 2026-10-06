import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { quoteSummary } from '../dist/quote-summary.js';
import { screenshot, ValidationError } from '../dist/screenshot.js';
import { assertGreyLogsInOrder } from './log-assertions.mjs';
import {
  assumptionsPageHtml,
  nhiPagesHtml,
  otherAmountScript,
  quotePageHtml,
  rebuildingCostHtml,
  quoteSummaryHtml,
  summaryPageHtml
} from './unsaved-journey-html.mjs';

const summaryButton = 'hp-summary-continue-button';
const assumptionsButton = 'hp-assumptions-quote-button';
const errorSummaryHtml = '<div class="av-card-error-summary"><ul><li><a>Quote unavailable</a></li></ul></div>';

/**
 * Builds an assumptions page whose Yes button returns to the journey with an error about its test data (markup trimmed
 * from the live page). The Cover start calendar is only shown on Cover details, the email field on Contact details, and
 * the rebuilding cost field on Property circumstances.
 * @param {object} [options]
 * @param {'cover start' | 'email' | 'rebuilding cost'} [options.error] Error reported: the cover start date out of range
 * (fixed by picking October 6th), invalid characters in the email address (fixed by entering
 * nobody.special@nhitest.com), or a missing rebuilding cost (fixed by selecting "Choose another amount", which starts
 * unselected, and entering 249995).
 * @param {string} [options.returnTo] Section Yes returns to (default Cover details).
 * @param {'quote' | 'loading' | 'new error' | 'same error'} [options.afterFix] What Return to quote shows once the error
 * is fixed: the quote, a loading screen that outlasts the step timeout before the quote, a re-rendered error summary, or
 * nothing (the existing summary stays in place).
 * @returns {string} Page HTML.
 */
function journeyErrorHtml({ error = 'cover start', returnTo = 'Cover details', afterFix = 'quote' } = {}) {
  const message = {
    'cover start': 'The Cover start field needs to be between 2026-10-06 and 2026-11-20',
    email: 'The Email address field contains invalid characters',
    'rebuilding cost': 'Enter the cost of rebuilding the property'
  }[error];
  return `${assumptionsPageHtml}<script>
    const journey = '<div class="av-timeline-all-sections"><ul><li title="Cover details">Cover details</li>'
      + '<li title="Property circumstances">Property circumstances</li>'
      + '<li title="Contact details">Contact details</li></ul></div><h1></h1><span id="calendar">'
      + '<svg class="av-icon av-icon-calendar" width="24" height="24"><rect width="24" height="24" /></svg></span>'
      + '<div id="day" hidden aria-label="Choose Tuesday, October 6th, 2026">6</div>'
      + '<input name="email" type="text" value="first name.last@example.com">'
      + ${JSON.stringify(rebuildingCostHtml(false))}
      + '<button type="button" class="btn btn-primary hp-submit-form"><div>Return to quote</div></button>';
    const summary = '<div class="av-card-error-summary"><h3>You haven&lsquo;t answered all the questions</h3><ul><li>'
      + '<a href="#">' + ${JSON.stringify(message)} + '</a></li></ul></div>';
    let picked = false;
    const fixed = () => ({
      'cover start': () => picked,
      email: () => document.querySelector('input[name="email"]').value === 'nobody.special@nhitest.com',
      'rebuilding cost': () => {
        const cost = document.querySelector('input[name="rebuildingCost"]');
        return !cost.hidden && cost.value === '249995';
      }
    })[${JSON.stringify(error)}]();
    ${otherAmountScript}
    const showSection = (section) => {
      document.querySelector('h1').textContent = section;
      document.getElementById('calendar').hidden = section !== 'Cover details';
      document.querySelector('input[name="email"]').hidden = section !== 'Contact details';
      document.getElementById('rebuilding').hidden = section !== 'Property circumstances';
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
      } else if (event.target.closest('li[title]') !== null) {
        showSection(event.target.closest('li[title]').title);
      } else if (event.target.closest('svg') !== null) {
        document.getElementById('day').hidden = false;
      } else if (event.target.id === 'day') {
        picked = true;
      } else if (event.target.closest('.hp-submit-form') !== null) {
        const afterFix = ${JSON.stringify(afterFix)};
        if (fixed() && afterFix === 'quote') {
          setTimeout(() => { document.body.innerHTML = ${JSON.stringify(quotePageHtml)}; }, 100);
        } else if (fixed() && afterFix === 'loading') {
          document.body.insertAdjacentHTML('beforeend', '<h2>Loading your quote</h2>');
          setTimeout(() => { document.body.innerHTML = ${JSON.stringify(quotePageHtml)}; }, 2500);
        } else if (afterFix === 'new error') {
          setTimeout(showError, 100);
        }
      }
    });
  </script>`;
}

for (const [name, html, expectedError, label = 'NHI', expectedLogs = []] of [
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
    nhiPagesHtml(assumptionsPageHtml, { [assumptionsButton]: assumptionsPageHtml + errorSummaryHtml }),
    /NHI assumptions errors: Quote unavailable/
  ],
  [
    'stops when the pages keep leading to each other',
    nhiPagesHtml(summaryPageHtml, { [summaryButton]: assumptionsPageHtml, [assumptionsButton]: summaryPageHtml }),
    /NHI quote did not appear within 5 clicks; last shown: assumptions/
  ],
  [
    'prefixes errors with the flow label',
    nhiPagesHtml(assumptionsPageHtml, { [assumptionsButton]: assumptionsPageHtml + errorSummaryHtml }),
    /TCAS assumptions errors: Quote unavailable/,
    'TCAS'
  ],
  [
    'times out when Continue with quote never shows the quote',
    nhiPagesHtml(summaryPageHtml, { [summaryButton]: '<h1>Still waiting</h1>' }),
    /Timeout/
  ],
  ['times out when the page is neither the summary nor the quote', '<h1>Something else</h1>', /Timeout/],
  ['fixes the cover start date on Cover details and returns to the quote', journeyErrorHtml(), undefined],
  [
    'opens Cover details from the timeline to fix the cover start date',
    journeyErrorHtml({ returnTo: 'Contact details' }),
    undefined
  ],
  [
    'waits for the loading screen Return to quote shows before the quote',
    journeyErrorHtml({ afterFix: 'loading' }),
    undefined
  ],
  [
    'reports a cover start error shown again after Return to quote',
    journeyErrorHtml({ afterFix: 'new error' }),
    /NHI cover details errors: The Cover start field needs to be between 2026-10-06/
  ],
  [
    'reports a cover start error left in place after Return to quote',
    journeyErrorHtml({ afterFix: 'same error' }),
    /NHI cover details errors: The Cover start field needs to be between 2026-10-06/
  ],
  [
    'enters the replacement email address on Contact details and returns to the quote',
    journeyErrorHtml({ error: 'email', returnTo: 'Contact details' }),
    undefined
  ],
  [
    'opens Contact details from the timeline to replace the email address',
    journeyErrorHtml({ error: 'email' }),
    undefined
  ],
  [
    'reports an email error shown again after Return to quote',
    journeyErrorHtml({ error: 'email', returnTo: 'Contact details', afterFix: 'new error' }),
    /NHI contact details errors: The Email address field contains invalid characters/
  ],
  [
    'opens Property circumstances from the timeline to replace the rebuilding cost',
    journeyErrorHtml({ error: 'rebuilding cost' }),
    undefined,
    'NHI',
    [
      'NHI: entering rebuilding cost 249995 on Property circumstances.',
      'NHI: opening Property circumstances from the timeline.',
      'NHI: selecting Choose another amount.',
      'NHI: property circumstances: clicking Return to quote.'
    ]
  ],
  [
    'reports a rebuilding cost error shown again after Return to quote',
    journeyErrorHtml({ error: 'rebuilding cost', returnTo: 'Property circumstances', afterFix: 'new error' }),
    /NHI property circumstances errors: Enter the cost of rebuilding the property/
  ]
]) {
  test(`${label} quote summary ${name}`, async (context) => {
    // arrange
    const log = context.mock.method(console, 'log');
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
        await assert.rejects(capture, (error) => {
          assert.match(error.message, expectedError);
          // Error summaries on the assumptions page or a journey section are validation; the quote summary's are not.
          assert.equal(
            error instanceof ValidationError,
            /^(NHI|TCAS) (assumptions|[a-z ]+ (details|circumstances)) errors: /.test(error.message),
            error.message
          );
          return true;
        });
        assert.deepEqual((await readdir(directory)).sort(), ['quote-failed.html', 'quote-failed.png']);
      }
      assertGreyLogsInOrder(log, expectedLogs);
    } finally {
      server.closeAllConnections();
      await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
    }
  });
}
