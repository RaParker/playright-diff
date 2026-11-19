import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
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
  const capture = async (scale) => {
    const child = spawn(
      process.execPath,
      [
        'dist/main.js',
        'screenshot',
        `http://127.0.0.1:${port}`,
        '--output',
        'screenshots/smoke-test.png',
        '--wait',
        '0'
      ],
      { stdio: 'inherit', env: { ...process.env, SCREENSHOT_SCALE: scale } }
    );
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    assert.equal(code, 0, 'Screenshot CLI should succeed');
    return readFile('screenshots/smoke-test.png');
  };

  let png = await capture('1.0');
  assert.equal(png.readUInt32BE(16), 1440, 'Screenshot should match viewport width');
  assert.equal(png.readUInt32BE(20), 3200, 'Screenshot should include the entire page');

  // SCREENSHOT_SCALE keeps the layout but multiplies the image's pixels.
  png = await capture('1.5');
  assert.equal(png.readUInt32BE(16), 2160, 'A 150% screenshot should be 1.5 times the viewport width');
  assert.equal(png.readUInt32BE(20), 4800, 'A 150% screenshot should be 1.5 times the page height');
  console.log('Smoke test passed: captured 1440 × 3200 pixels with a 900-pixel viewport, and 2160 × 4800 at 150%.');
} finally {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  // Only the screenshot this test wrote; the screenshots folder may hold the user's own captures.
  await rm('screenshots/smoke-test.png', { force: true });
}
