import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end(
    '<!doctype html><html><body style="margin:0"><main style="height:3200px;background:linear-gradient(white,blue)">Full-page screenshot test</main></body></html>'
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
// Output is never written inside the project, so the screenshot goes to a temporary folder.
const directory = await mkdtemp(join(tmpdir(), 'smoke-test-'));
const outputFile = join(directory, 'smoke-test.png');
try {
  const { port } = server.address();
  const runScreenshot = async (output, scale, stdio) => {
    const child = spawn(
      process.execPath,
      ['dist/main.js', 'screenshot', `http://127.0.0.1:${port}`, '--output', output, '--wait', '0'],
      { stdio, env: { ...process.env, SCREENSHOT_SCALE: scale } }
    );
    let log = '';
    child.stdout?.on('data', (data) => (log += data));
    child.stderr?.on('data', (data) => (log += data));
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    return { code, log };
  };
  const capture = async (scale) => {
    const { code } = await runScreenshot(outputFile, scale, 'inherit');
    assert.equal(code, 0, 'Screenshot CLI should succeed');
    return readFile(outputFile);
  };

  let png = await capture('1.0');
  assert.equal(png.readUInt32BE(16), 1440, 'Screenshot should match viewport width');
  assert.equal(png.readUInt32BE(20), 3200, 'Screenshot should include the entire page');

  // SCREENSHOT_SCALE keeps the layout but multiplies the image's pixels.
  png = await capture('1.5');
  assert.equal(png.readUInt32BE(16), 2160, 'A 150% screenshot should be 1.5 times the viewport width');
  assert.equal(png.readUInt32BE(20), 4800, 'A 150% screenshot should be 1.5 times the page height');

  const inside = 'screenshots/smoke-test-inside-project.png';
  const refused = await runScreenshot(inside, '1.0', 'pipe');
  assert.equal(refused.code, 1, refused.log);
  assert.match(refused.log, /is inside this project/, 'An --output inside the project should be refused');
  await assert.rejects(access(inside), 'Nothing should be written inside the project');
  console.log(
    'Smoke test passed: captured 1440 × 3200 pixels with a 900-pixel viewport, and 2160 × 4800 at 150%, and ' +
      'refused an --output inside the project.'
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await rm(directory, { recursive: true, force: true });
}
