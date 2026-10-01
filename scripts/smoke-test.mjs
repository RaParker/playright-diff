import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end(
    '<!doctype html><html><body style="margin:0"><main style="height:3200px;background:linear-gradient(white,blue)">Full-page screenshot test</main></body></html>'
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const { port } = server.address();
  const child = spawn(
    process.execPath,
    ['dist/screenshot.js', `http://127.0.0.1:${port}`, '--output', 'screenshots/smoke-test.png', '--wait', '0'],
    { stdio: 'inherit' }
  );
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  assert.equal(code, 0, 'Screenshot CLI should succeed');
  const png = await readFile('screenshots/smoke-test.png');
  assert.equal(png.readUInt32BE(16), 1440, 'Screenshot should match viewport width');
  assert.equal(png.readUInt32BE(20), 3200, 'Screenshot should include the entire page');
  console.log('Smoke test passed: captured 1440 × 3200 pixels with a 900-pixel viewport.');
} finally {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
