import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { compare } from '../dist/compare.js';
import { screenshot } from '../dist/screenshot.js';

/** A page whose footer separator differs by path, as OCR saw on the real NHI and TCAS footers. */
function pageHtml(separator) {
  return `<!doctype html><html><body style="margin:0">
    <h1>Here's your quote</h1>
    <div class="container hp-footer hp-center" style="font-size:40px">Legal ${separator} Privacy policy</div>
  </body></html>`;
}

let server;
let base;

before(async () => {
  server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(pageHtml(request.url === '/nhi' ? '=' : '»'));
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
});

/** Captures both pages with the given mask and returns the comparison's changed pixel count. */
async function captureAndCompare(mask) {
  const directory = await mkdtemp(join(tmpdir(), 'screenshot-mask-'));
  const [nhi, tcas] = [join(directory, 'nhi.png'), join(directory, 'tcas.png')];
  await screenshot(`${base}/nhi`, { output: nhi, width: 400, height: 300, wait: 0, mask });
  await screenshot(`${base}/tcas`, { output: tcas, width: 400, height: 300, wait: 0, mask });
  const output = join(directory, 'comparison');
  await compare(nhi, tcas, { output, useOcr: false });
  return JSON.parse(await readFile(join(output, 'report.json'), 'utf8')).changedPixels;
}

describe('screenshot mask', () => {
  test('pages that differ only in the footer differ without a mask', async () => {
    // arrange
    const mask = undefined;

    // act
    const changedPixels = await captureAndCompare(mask);

    // assert
    assert.ok(changedPixels > 0);
  });

  test('masking the footer removes the difference', async () => {
    // arrange
    const mask = ['.hp-footer'];

    // act
    const changedPixels = await captureAndCompare(mask);

    // assert
    assert.equal(changedPixels, 0);
  });
});
