import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { startViewerServer } from '../dist/viewer-server.js';
import { differentPolicy, viewerFixture } from './viewer-fixture.mjs';

async function startOnFixture(context) {
  const root = await viewerFixture();
  const server = await startViewerServer({ root, port: 0, run: { environment: 'dev' } });
  context.after(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, server };
}

describe('viewer server', () => {
  test('serves the page and its JSON without caching', async (context) => {
    // arrange
    const { server } = await startOnFixture(context);

    // act
    const [page, policies] = await Promise.all([fetch(server.url), fetch(new URL('/api/policies', server.url))]);

    // assert
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.equal(policies.status, 200);
    assert.equal(policies.headers.get('cache-control'), 'no-store');
    const run = await policies.json();
    assert.equal(run.environment, 'dev');
    assert.equal(run.policies.length, 5);
  });

  test("serves a policy's detail", async (context) => {
    // arrange
    const { server } = await startOnFixture(context);

    // act
    const response = await fetch(new URL(`/api/policies/${differentPolicy}-1`, server.url));

    // assert
    assert.equal(response.status, 200);
    assert.equal((await response.json()).images.nhi, 'screenshot-quote-page-nhi.png');
  });

  test("serves a policy's screenshot as a PNG", async (context) => {
    // arrange
    const { root, server } = await startOnFixture(context);
    const name = `${differentPolicy}-1`;

    // act
    const response = await fetch(new URL(`/files/${name}/screenshot-quote-page-nhi.png`, server.url));

    // assert
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      await readFile(join(root, name, 'screenshot-quote-page-nhi.png'))
    );
  });

  for (const path of [
    '/files/..%2F..%2Fetc/x',
    `/files/${differentPolicy}-1/..%2Freport.json`,
    `/files/${differentPolicy}-1/%2e%2e%5Creport.json`,
    `/files/${differentPolicy}-1/../${differentPolicy}-1/report.json/x`,
    '/files/C:%5CWindows/win.ini',
    `/files/${differentPolicy}-1/api-nhi%2F001.json`,
    `/files/${differentPolicy}-1/api-nhi/001.json`,
    `/files/${differentPolicy}-1/api-nhi`,
    '/files/mrp-and-quote/x-1-mrp.json',
    '/files/.ocr-cache/x',
    '/api/policies/..',
    '/api/policies/mrp-and-quote',
    '/nothing-here'
  ]) {
    test(`refuses ${path}`, async (context) => {
      // arrange
      const { server } = await startOnFixture(context);

      // act
      const response = await fetch(new URL(server.url).origin + path);

      // assert
      assert.equal(response.status, 404);
    });
  }

  test('picks up a policy written after it started', async (context) => {
    // arrange
    const { root, server } = await startOnFixture(context);
    const before = await (await fetch(new URL('/api/policies', server.url))).json();
    const added = `${'1'.repeat(32)}-1`;
    await mkdir(join(root, added));
    await writeFile(join(root, added, 'note.txt'), '');

    // act
    const after = await (await fetch(new URL('/api/policies', server.url))).json();

    // assert
    assert.equal(after.policies.length, before.policies.length + 1);
    assert.ok(after.policies.some(({ name }) => name === added));
  });

  test('rejects writes', async (context) => {
    // arrange
    const { server } = await startOnFixture(context);

    // act
    const response = await fetch(new URL('/api/policies', server.url), { method: 'POST' });

    // assert
    assert.equal(response.status, 405);
  });

  for (const hostHeader of ['evil.example', 'evil.example:4173', '127.0.0.1.evil.example']) {
    test(`refuses a request for another host, ${hostHeader} (DNS rebinding)`, async (context) => {
      // arrange
      const { server } = await startOnFixture(context);

      // act
      const status = await new Promise((resolveStatus, reject) => {
        const request = httpRequest(
          { host: '127.0.0.1', port: server.port, path: '/api/policies', headers: { Host: hostHeader } },
          (response) => {
            response.resume();
            resolveStatus(response.statusCode);
          }
        );
        request.on('error', reject);
        request.end();
      });

      // assert
      assert.equal(status, 403);
    });
  }

  test('accepts localhost as the host', async (context) => {
    // arrange
    const { server } = await startOnFixture(context);

    // act
    const response = await fetch(`http://localhost:${server.port}/api/policies`);

    // assert
    assert.equal(response.status, 200);
  });

  test('listens on 127.0.0.1 only', async (context) => {
    // arrange
    const { server } = await startOnFixture(context);

    // act
    const { hostname } = new URL(server.url);

    // assert
    assert.equal(hostname, '127.0.0.1');
  });

  test('reports a port in use', async (context) => {
    // arrange
    const { root, server } = await startOnFixture(context);

    // act
    const second = startViewerServer({ root, port: server.port, run: {} });

    // assert
    await assert.rejects(second, new RegExp(`^Error: Port ${server.port} is in use; pass --port$`));
  });
});
