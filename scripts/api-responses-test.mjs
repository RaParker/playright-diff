import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { screenshot } from '../dist/screenshot.js';

/** Calls each endpoint in turn, so the responses arrive (and are numbered) in a fixed order. */
function pageHtml(port) {
  return `<!doctype html><html><body><h1>Here's your quote</h1><script>
    (async () => {
      await fetch('/api/quote-summary/abc?source=tcas');
      await fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });
      await fetch('/api/text');
      await fetch('/other.json');
      await fetch('http://localhost:${port}/api/cross');
      await fetch('/api/error');
      window.__done = true;
    })();
  </script></body></html>`;
}

const jsonRoutes = {
  '/api/quote-summary/abc?source=tcas': [200, { premium: 74.56 }],
  '/api/save': [201, { saved: true }],
  '/other.json': [200, { notApi: true }],
  '/api/cross': [200, { otherOrigin: true }],
  '/api/error': [500, { success: false }]
};

let server;
let base;

before(async () => {
  server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    const route = jsonRoutes[request.url];
    if (route !== undefined) {
      response.writeHead(route[0], { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(route[1]));
      return;
    }

    if (request.url === '/api/text') {
      response.setHeader('Content-Type', 'text/plain');
      response.end('hello');
      return;
    }

    response.setHeader('Content-Type', 'text/html');
    response.end(request.url === '/no-api' ? '<!doctype html><h1>No API calls</h1>' : pageHtml(server.address().port));
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
});

const waitForCalls = (page) => page.waitForFunction(() => window.__done === true);

async function readSaved(folder) {
  const names = (await readdir(folder)).sort();
  return Promise.all(names.map(async (name) => ({ name, ...JSON.parse(await readFile(join(folder, name), 'utf8')) })));
}

describe('API responses', () => {
  let directory;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'api-responses-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test('saves each JSON response from the page origin API, numbered in order, with its request', async () => {
    // arrange
    const folder = join(directory, 'nhi-api');

    // act
    await screenshot(`${base}/quote`, {
      output: join(directory, 'nhi.png'),
      width: 400,
      height: 300,
      wait: 0,
      beforeCapture: waitForCalls,
      apiResponsesFolder: folder
    });

    // assert
    const saved = await readSaved(folder);
    assert.deepEqual(
      saved.map(({ name }) => name),
      ['001-GET-quote-summary-abc.json', '002-POST-save.json', '003-GET-error.json']
    );
    assert.deepEqual(saved[0], {
      name: '001-GET-quote-summary-abc.json',
      url: `${base}/api/quote-summary/abc?source=tcas`,
      method: 'GET',
      status: 200,
      requestBody: null,
      body: { premium: 74.56 }
    });
    assert.deepEqual(saved[1].requestBody, { a: 1 });
    assert.deepEqual([saved[2].status, saved[2].body], [500, { success: false }]);
  });

  test('continues the numbering of responses already in the folder', async () => {
    // arrange
    const folder = join(directory, 'nhi-api');
    await mkdir(folder);
    await writeFile(join(folder, '001-GET-earlier.json'), '{}');

    // act
    await screenshot(`${base}/quote`, {
      output: join(directory, 'nhi.png'),
      wait: 0,
      beforeCapture: waitForCalls,
      apiResponsesFolder: folder
    });

    // assert
    assert.deepEqual((await readdir(folder)).sort(), [
      '001-GET-earlier.json',
      '002-GET-quote-summary-abc.json',
      '003-POST-save.json',
      '004-GET-error.json'
    ]);
  });

  test('saves the responses of a capture that fails', async () => {
    // arrange
    const folder = join(directory, 'tcas-api');
    const failingJourney = async (page) => {
      await waitForCalls(page);
      throw new Error('journey failed');
    };

    // act
    const capture = screenshot(`${base}/quote`, {
      output: join(directory, 'tcas.png'),
      wait: 0,
      beforeCapture: failingJourney,
      apiResponsesFolder: folder
    });

    // assert
    await assert.rejects(capture, /journey failed/);
    assert.equal((await readdir(folder)).length, 3);
  });

  test('leaves no folder when the page calls no API', async () => {
    // arrange
    const folder = join(directory, 'nhi-api');

    // act
    await screenshot(`${base}/no-api`, {
      output: join(directory, 'nhi.png'),
      wait: 0,
      beforeCapture: (page) => page.evaluate(() => (window.__done = true)),
      apiResponsesFolder: folder
    });

    // assert
    assert.deepEqual(await readdir(directory), ['nhi.png']);
  });

  test('saves nothing when no folder is given', async () => {
    // arrange
    const output = join(directory, 'plain.png');

    // act
    await screenshot(`${base}/quote`, { output, wait: 0, beforeCapture: waitForCalls });

    // assert
    assert.deepEqual(await readdir(directory), ['plain.png']);
  });
});
