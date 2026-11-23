import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import sharp from 'sharp';
import { screenshot } from '../dist/screenshot.js';

/** VWO's anti-flicker style, which hides the whole page until VWO removes it (or, for a split test, never). */
const hidingStyle =
  '<style id="_vis_opt_path_hides_split" type="text/css">body{opacity:0 !important;background:none !important;}</style>';

/** A page with black text on white, hidden by VWO's style; `removeAfter` ms later a script removes it, if given. */
function pageHtml(removeAfter) {
  const remover =
    removeAfter === undefined
      ? ''
      : `<script>setTimeout(() => document.getElementById('_vis_opt_path_hides_split').remove(), ${removeAfter});</script>`;
  return `<!doctype html><html><head>${hidingStyle}</head><body style="margin:0;background:#fff">
    <h1 style="font-size:80px;background:#000;color:#000">Here's your quote</h1>${remover}
  </body></html>`;
}

/** An Oops page that VWO never shows, with a black block so a visible capture is not blank. */
const oopsPageHtml = `<!doctype html><html><head>${hidingStyle}</head><body style="margin:0;background:#fff">
  <h2>Oops</h2><div style="width:200px;height:100px;background:#000"></div></body></html>`;

let server;
let base;

before(async () => {
  server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      request.url === '/oops' ? oopsPageHtml : pageHtml(request.url === '/removed-by-vwo' ? 300 : undefined)
    );
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
});

/** Captures the page and returns the darkest red value in the screenshot (255 when it is blank white). */
async function captureDarkest(path) {
  const directory = await mkdtemp(join(tmpdir(), 'screenshot-hidden-'));
  try {
    const output = join(directory, 'page.png');
    await screenshot(`${base}${path}`, { output, width: 400, height: 300, wait: 0 });
    return (await sharp(output).stats()).channels[0].min;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('screenshot of a page hidden by VWO', () => {
  test('the failure screenshot of an Oops page VWO never shows is not blank', async (t) => {
    // arrange
    t.mock.method(console, 'log', () => undefined);
    t.mock.method(console, 'error', () => undefined);
    const directory = await mkdtemp(join(tmpdir(), 'screenshot-hidden-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const output = join(directory, 'page.png');

    // act
    await assert.rejects(screenshot(`${base}/oops`, { output, width: 400, height: 300, wait: 0 }), {
      name: 'OopsError'
    });

    // assert
    assert.equal((await sharp(join(directory, 'page-failed.png')).stats()).channels[0].min, 0);
  });

  test('a page VWO never shows is shown before the screenshot', async (t) => {
    // arrange
    const log = t.mock.method(console, 'log', () => undefined);

    // act
    const darkest = await captureDarkest('/never-shown');

    // assert
    assert.equal(darkest, 0);
    assert.ok(
      log.mock.calls.some((call) => String(call.arguments[0]).includes('_vis_opt_path_hides_split')),
      'logs that it removed the hiding style'
    );
  });

  test('a page VWO shows itself is captured without removing anything', async (t) => {
    // arrange
    const log = t.mock.method(console, 'log', () => undefined);

    // act
    const darkest = await captureDarkest('/removed-by-vwo');

    // assert
    assert.equal(darkest, 0);
    assert.ok(!log.mock.calls.some((call) => String(call.arguments[0]).includes('_vis_opt_path_hides')));
  });
});
