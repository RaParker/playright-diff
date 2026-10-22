import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { monthlyQuotePageHtml, nhiPagesHtml, quoteSummaryHtml } from './unsaved-journey-html.mjs';

const requested = [];
let finishNhi;
let tcasRequested = false;
const server = createServer((request, response) => {
  requested.push(request.url);
  response.setHeader('Content-Type', 'text/html');
  // Ends on the same monthly quote page as the NHI summary, so both flows select annual and match.
  const journey = nhiPagesHtml(
    `<h1>Cover details</h1>
    <div class="av-timeline-all-sections"><ul><li title="Contact details"
      onclick="document.querySelector('button').hidden = false">Contact details</li></ul></div>
    <button id="get-quote" hidden>Get your quote</button>`,
    { 'get-quote': monthlyQuotePageHtml }
  );
  const html = `<!doctype html><html><body>${request.url.startsWith('/tcas/') ? journey : quoteSummaryHtml}</body></html>`;
  if (request.url.startsWith('/nhi/') && !tcasRequested) {
    // A sequential implementation cannot reach TCAS before this NHI response, so it never ends this wait early: it
    // gets the 503 below (well inside the 30 s default step timeout) and fails, however long the window is. The window
    // only needs to outlast how long a concurrent run takes to request TCAS, so it is generous to cope with load.
    const timer = setTimeout(() => {
      response.writeHead(503);
      response.end('TCAS did not start concurrently');
    }, 20000);
    finishNhi = () => {
      clearTimeout(timer);
      response.end(html);
    };
    return;
  }

  if (request.url.startsWith('/tcas/')) {
    tcasRequested = true;
    finishNhi?.();
  }

  response.end(html);
});
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const directory = await mkdtemp(join(tmpdir(), 'quote-page-'));
try {
  await mkdir(join(directory, 'mrp'));
  await writeFile(
    join(directory, 'mrp', 'ABCDEF1234567890ABCDEF1234567890-42-mrp.json'),
    JSON.stringify({ artemisQuoteGuid: 'guid/a b' })
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  // A previous run's stale output for this policy, removed before the new captures.
  const policyFolder = join(directory, 'ABCDEF1234567890ABCDEF1234567890-42');
  await mkdir(policyFolder);
  await writeFile(join(policyFolder, 'screenshot-failed-nhi.png'), '');
  await writeFile(
    join(directory, '.env'),
    [
      'MRP_AND_QUOTE_OUTPUT_DIR=${QUOTE_TEST_OUTPUT_ROOT}/mrp',
      'QUOTE_TEST_OUTPUT_ROOT=${QUOTE_TEST_BASE_PATH}',
      'QUOTE_TEST_BASE_PATH=.',
      `QUOTE_JOURNEY_NHI_QUOTE_PAGE_URL_TEMPLATE=${base}/nhi/{artemisQuoteGuid}`,
      `QUOTE_JOURNEY_NHI_UNSAVED_URL_TEMPLATE=${base}/unsaved/{artemisQuoteGuid}`,
      `QUOTE_JOURNEY_TCAS_REPLACEMENT_URL_TEMPLATE=${base}/tcas-replacement/{artemisQuoteGuid}`,
      `QUOTE_JOURNEY_TCAS_QUOTE_PAGE_URL_TEMPLATE=${base}/tcas/{policyDetailsId}/{historyId}`,
      `QUOTE_JOURNEY_QUOTE_GUID_URL=${base}/api/nhi/quote-guid`,
      'QUOTE_JOURNEY_AGENT_ID=agent',
      'QUOTE_JOURNEY_BRANCH_CODE=1066',
      'QUOTE_JOURNEY_CALL_MEDIA_USER=agent'
    ].join('\n')
  );
  const env = { ...process.env };
  for (const name of [
    'QUOTE_TEST_OUTPUT_ROOT',
    'QUOTE_TEST_BASE_PATH',
    'MRP_AND_QUOTE_OUTPUT_DIR',
    'QUOTE_JOURNEY_NHI_QUOTE_PAGE_URL_TEMPLATE',
    'QUOTE_JOURNEY_NHI_UNSAVED_URL_TEMPLATE',
    'QUOTE_JOURNEY_TCAS_REPLACEMENT_URL_TEMPLATE',
    'QUOTE_JOURNEY_TCAS_QUOTE_PAGE_URL_TEMPLATE',
    'QUOTE_JOURNEY_QUOTE_GUID_URL',
    'QUOTE_JOURNEY_AGENT_ID',
    'QUOTE_JOURNEY_BRANCH_CODE',
    'QUOTE_JOURNEY_CALL_MEDIA_USER'
  ]) {
    delete env[name];
  }

  const child = spawn(
    process.execPath,
    [resolve('dist/main.js'), 'quote-page', 'abcdef1234567890abcdef1234567890', '42', '--no-ocr'],
    {
      cwd: directory,
      env,
      stdio: 'inherit'
    }
  );
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', resolveExit);
  });
  assert.equal(code, 0);
  assert.ok(requested.includes('/nhi/guid%2Fa%20b'));
  assert.ok(requested.includes('/tcas/ABCDEF1234567890ABCDEF1234567890/42'));
  assert.ok(!requested.some((path) => path.startsWith('/tcas-replacement/')));
  // The screenshots and the comparison share the policy's folder; the stale failure screenshot is gone.
  assert.deepEqual((await readdir(policyFolder)).sort(), [
    'diff.png',
    'quote-page-mrp.html',
    'quote-page-nhi.html',
    'quote-page-standardized-mrp.html',
    'quote-page-standardized-nhi.html',
    'report.json',
    'report.md',
    'result.json',
    'screenshot-quote-page-mrp.png',
    'screenshot-quote-page-nhi.png'
  ]);
  for (const flow of ['nhi', 'mrp']) {
    const png = await readFile(join(policyFolder, `screenshot-quote-page-${flow}.png`));
    assert.equal(png.readUInt32BE(16), 1440);
  }

  const result = JSON.parse(await readFile(join(policyFolder, 'result.json'), 'utf8'));
  assert.equal(result.outcome, 'compared');
  assert.deepEqual(result.issues, []);
  const report = JSON.parse(await readFile(join(policyFolder, 'report.json'), 'utf8'));
  assert.equal(report.changedPixels, 0);
  assert.equal(report.ocrEnabled, false);
  assert.equal(report.before, join(policyFolder, 'screenshot-quote-page-nhi.png'));
  assert.equal(report.after, join(policyFolder, 'screenshot-quote-page-mrp.png'));
  console.log('Quote-page integration test passed.');
} finally {
  server.closeAllConnections();
  await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
  await rm(directory, { recursive: true, force: true });
}
