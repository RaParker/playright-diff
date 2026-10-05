import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const requested = [];
let finishNhi;
let tcasRequested = false;
const server = createServer((request, response) => {
  requested.push(request.url);
  response.setHeader('Content-Type', 'text/html');
  const quote = '<h2>Welcome Alex, here&rsquo;s your quote</h2>';
  const journey = `<h1>Cover details</h1>
    <div class="av-timeline-all-sections"><ul><li title="Contact details"
      onclick="document.querySelector('button').hidden = false">Contact details</li></ul></div>
    <button hidden onclick="document.body.innerHTML = '${quote}'">Get your quote</button>`;
  const html = `<!doctype html><html><body>${request.url.startsWith('/tcas/') ? journey : quote}</body></html>`;
  if (request.url.startsWith('/nhi/') && !tcasRequested) {
    // A sequential implementation cannot reach TCAS before this NHI response.
    const timer = setTimeout(() => {
      response.writeHead(503);
      response.end('TCAS did not start concurrently');
    }, 5000);
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
try {
  const directory = await mkdtemp(join(tmpdir(), 'quote-page-'));
  await mkdir(join(directory, 'mrp'));
  await writeFile(
    join(directory, 'mrp', 'ABCDEF1234567890ABCDEF1234567890-42-mrp.json'),
    JSON.stringify({ artemisQuoteGuid: 'guid/a b' })
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  await writeFile(
    join(directory, '.env'),
    [
      'MRP_AND_QUOTE_OUTPUT_DIR=${QUOTE_TEST_OUTPUT_ROOT}/mrp',
      'QUOTE_TEST_OUTPUT_ROOT=${QUOTE_TEST_BASE_PATH}',
      'QUOTE_TEST_BASE_PATH=.',
      `QUOTE_JOURNEY_NHI_QUOTE_PAGE_URL_TEMPLATE=${base}/nhi/{artemisQuoteGuid}`,
      `QUOTE_JOURNEY_NHI_UNSAVED_URL_TEMPLATE=${base}/unsaved/{artemisQuoteGuid}`,
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
  for (const suffix of ['nhi', 'tcas']) {
    const png = await readFile(join(directory, 'screenshots', `ABCDEF1234567890ABCDEF1234567890-42-${suffix}.png`));
    assert.equal(png.readUInt32BE(16), 1440);
  }

  const [reportDirectory] = await readdir(join(directory, 'comparisons'));
  const report = JSON.parse(await readFile(join(directory, 'comparisons', reportDirectory, 'report.json'), 'utf8'));
  assert.equal(report.changedPixels, 0);
  assert.equal(report.ocrEnabled, false);
  assert.ok(report.before.endsWith('ABCDEF1234567890ABCDEF1234567890-42-nhi.png'));
  assert.ok(report.after.endsWith('ABCDEF1234567890ABCDEF1234567890-42-tcas.png'));
  console.log('Quote-page integration test passed.');
} finally {
  server.closeAllConnections();
  await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
}
