import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
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
  test(`loading timeout ${name}`, async (context) => {
    // arrange
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(html);
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const directory = await mkdtemp(join(tmpdir(), 'loading-timeout-'));
    context.after(() => rm(directory, { recursive: true, force: true }));
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

test('loading timeout saves the failure screenshot, HTML and console while the loading screen is still shown', async (context) => {
  // arrange
  context.mock.method(console, 'log', () => undefined);
  context.mock.method(console, 'error', () => undefined);
  const html = `<h2>Loading your quote</h2><script>
    console.error('quote request failed');
    console.info('not recorded');
    setTimeout(() => { throw new Error('script broke'); }, 0);
    fetch('/missing');
  </script>`;
  const server = createServer((request, response) => {
    response.statusCode = request.url === '/missing' ? 404 : 200;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(request.url === '/missing' ? '' : html);
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const directory = await mkdtemp(join(tmpdir(), 'loading-timeout-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  try {
    // act
    await assert.rejects(
      screenshot(`http://127.0.0.1:${server.address().port}`, {
        output: join(directory, 'quote.png'),
        wait: 0,
        timeout,
        beforeCapture: quoteSummary('TCAS')
      }),
      /Timed out waiting for quote loading screen to disappear/
    );

    // assert
    assert.deepEqual((await readdir(directory)).sort(), [
      'quote-failed-console.log',
      'quote-failed.html',
      'quote-failed.png'
    ]);
    const saved = await readFile(join(directory, 'quote-failed-console.log'), 'utf8');
    assert.match(saved, /console\.error: quote request failed/);
    assert.match(saved, /page error: script broke/);
    assert.match(saved, /HTTP 404: GET http:\/\/127\.0\.0\.1:\d+\/missing/);
    assert.doesNotMatch(saved, /not recorded/);
    const logged = console.log.mock.calls.map((call) => String(call.arguments[0])).join('\n');
    assert.match(logged, /Browser console before the failure \(\d+\):/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
  }
});

test('loading timeout prints the browser console when it extends a wait', async (context) => {
  // arrange
  context.mock.method(console, 'log', () => undefined);
  const html = `${summaryPageHtml}<script>
    document.addEventListener('click', () => {
      console.warn('still pricing');
      document.body.innerHTML = '<h2>Loading your quote</h2>';
      setTimeout(() => { document.body.innerHTML = ${JSON.stringify(quotePageHtml)}; }, ${timeout * 1.5});
    });
  </script>`;
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(html);
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const directory = await mkdtemp(join(tmpdir(), 'loading-timeout-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  try {
    // act
    await screenshot(`http://127.0.0.1:${server.address().port}`, {
      output: join(directory, 'quote.png'),
      wait: 0,
      timeout,
      beforeCapture: quoteSummary('NHI')
    });

    // assert
    const logged = console.log.mock.calls.map((call) => String(call.arguments[0])).join('\n');
    assert.match(logged, /Browser console while the loading screen was shown \(1\):/);
    assert.match(logged, /console\.warning: still pricing/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
  }
});
