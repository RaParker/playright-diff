import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const requested = [];
const server = createServer((request, response) => {
  requested.push(request.url);
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><html><body>Quote page integration test</body></html>');
});
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
try {
  const directory = await mkdtemp(join(tmpdir(), 'quote-page-'));
  await mkdir(join(directory, 'mrp'));
  await writeFile(
    join(directory, 'mrp', 'ABCDEF1234567890ABCDEF1234567890-42-mrp.json'),
    JSON.stringify({ '//artemisQuotGuid': 'guid/a b' })
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  await writeFile(
    join(directory, '.env'),
    [
      'MRP_AND_QUOTE_OUTPUT_DIR=./mrp',
      `QUOTE_JOURNEY_NHI_QUOTE_PAGE_URL_TEMPLATE=${base}/nhi/{artemisQuotGuid}`,
      `QUOTE_JOURNEY_TCAS_QUOTE_PAGE_URL_TEMPLATE=${base}/tcas/{policyDetailsId}/{historyId}`
    ].join('\n')
  );
  const env = { ...process.env };
  for (const name of [
    'MRP_AND_QUOTE_OUTPUT_DIR',
    'QUOTE_JOURNEY_NHI_QUOTE_PAGE_URL_TEMPLATE',
    'QUOTE_JOURNEY_TCAS_QUOTE_PAGE_URL_TEMPLATE'
  ]) {
    delete env[name];
  }

  const child = spawn(
    process.execPath,
    [resolve('dist/quote-page.js'), 'abcdef1234567890abcdef1234567890', '42', '--no-ocr'],
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
