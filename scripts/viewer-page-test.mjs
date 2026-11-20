import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { chromium } from 'playwright';
import { startViewerServer } from '../dist/viewer-server.js';
import { differentPolicy, failedPolicy, recheckedPolicy, viewerFixture } from './viewer-fixture.mjs';

const different = `${differentPolicy}-1`;
const rechecked = `${recheckedPolicy}-1`;
const failed = `${failedPolicy}-1`;

let browser;
before(async () => {
  browser = await chromium.launch();
});
after(() => browser?.close());

/** Starts a server on a new fixture folder, removed with the server when the test ends. */
async function serveFixture(context, options, prepare = async () => {}) {
  const root = await viewerFixture(options);
  await prepare(root);
  const server = await startViewerServer({ root, port: 0, run: { environment: 'dev' } });
  context.after(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, server };
}

/** Opens the viewer and waits for its list (or its empty message) to load. */
async function openViewer(context, url) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  context.after(() => page.close());
  await page.goto(url);
  await page.locator('#policy-list li, #empty:not([hidden])').first().waitFor();
  return page;
}

async function selectPolicy(page, name) {
  await page.locator(`#policy-list li[data-name="${name}"]`).click();
  await page.locator('#pane-nhi img, #pane-nhi .missing').first().waitFor();
}

describe('viewer page', () => {
  test('lists the different policies by default', async (context) => {
    // arrange
    const { server } = await serveFixture(context);

    // act
    const page = await openViewer(context, server.url);

    // assert
    assert.equal(await page.locator('#filter').inputValue(), 'different');
    assert.deepEqual(
      await page.locator('#policy-list li').evaluateAll((items) => items.map((item) => item.dataset.name)),
      [different, rechecked]
    );
    assert.match(await page.locator(`#policy-list li[data-name="${rechecked}"]`).innerText(), /cover re-checked/);
  });

  test('filters out re-checked policies', async (context) => {
    // arrange
    const { server } = await serveFixture(context);
    const page = await openViewer(context, server.url);

    // act
    await page.locator('#filter').selectOption('different-not-rechecked');

    // assert
    assert.deepEqual(
      await page.locator('#policy-list li').evaluateAll((items) => items.map((item) => item.dataset.name)),
      [different]
    );
  });

  test('shows both screenshots of the selected policy', async (context) => {
    // arrange
    const { server } = await serveFixture(context);
    const page = await openViewer(context, server.url);

    // act
    await selectPolicy(page, different);

    // assert
    assert.match(await page.locator('#pane-nhi img').getAttribute('src'), /screenshot-quote-page-nhi\.png$/);
    assert.match(await page.locator('#pane-mrp img').getAttribute('src'), /screenshot-quote-page-mrp\.png$/);
    assert.equal(await page.evaluate(() => location.hash), `#${different}`);
    const details = await page.locator('#details').innerText();
    assert.match(details, /rebuilding cost/);
    assert.match(details, /285,000/);
    assert.match(details, /249995/);
    assert.match(details, /NHI and TCAS both quoted/);
  });

  test('keeps rows aligned when the heights differ', async (context) => {
    // arrange
    const { server } = await serveFixture(context);
    const page = await openViewer(context, server.url);
    await selectPolicy(page, different);
    await page.waitForFunction(() =>
      [...document.querySelectorAll('#pane-nhi img, #pane-mrp img')].every((image) => image.complete)
    );

    // act
    const sizes = await page.evaluate(() =>
      ['#pane-nhi img', '#pane-mrp img'].map((selector) => {
        const { width, height } = document.querySelector(selector).getBoundingClientRect();
        return { width, height };
      })
    );
    await page.locator('#pane-nhi').evaluate((pane) => (pane.scrollTop = 50));
    await page.waitForFunction(() => document.querySelector('#pane-mrp').scrollTop === 50);

    // assert
    assert.equal(sizes[0].width, sizes[1].width);
    assert.ok(Math.abs(sizes[1].height / sizes[0].height - 1.2) < 0.01, JSON.stringify(sizes));
  });

  test("shows a region's text change", async (context) => {
    // arrange
    const { server } = await serveFixture(context);
    const page = await openViewer(context, server.url);
    await selectPolicy(page, different);

    // act
    await page.locator('#regions button[data-region="2"]').click();

    // assert
    const text = await page.locator('#region-text').innerText();
    assert.match(text, /£137\.63/);
    assert.match(text, /£137\.62/);
  });

  test('switches to the diff image', async (context) => {
    // arrange
    const { server } = await serveFixture(context);
    const page = await openViewer(context, server.url);
    await selectPolicy(page, different);

    // act
    await page.locator('#mode button[data-mode="diff"]').click();

    // assert
    const visible = await page.locator('#viewer img:visible').evaluateAll((images) => images.map((image) => image.src));
    assert.equal(visible.length, 1, JSON.stringify(visible));
    assert.match(visible[0], /diff\.png$/);
  });

  test('scrolls to a region in the diff.png view', async (context) => {
    // arrange
    const { server } = await serveFixture(context);
    const page = await openViewer(context, server.url);
    await selectPolicy(page, different);
    await page.locator('#mode button[data-mode="diff"]').click();
    await page.waitForFunction(() => document.querySelector('#pane-diff img')?.complete);

    // act
    await page.locator('#regions button[data-region="2"]').click();

    // assert
    assert.ok((await page.locator('#pane-diff').evaluate((pane) => pane.scrollTop)) > 0);
  });

  test('lists policies declined before declines were compared under All, not Matching end points', async (context) => {
    // arrange
    const name = `${'D'.repeat(32)}-1`;
    const { server } = await serveFixture(context, {}, async (root) => {
      await mkdir(join(root, name));
      await writeFile(
        join(root, name, 'result.json'),
        JSON.stringify({
          policyDetailsId: 'D'.repeat(32),
          historyId: 1,
          outcome: 'declined',
          validation: false,
          issues: [],
          startedAt: '2000-01-01T00:00:00.000Z',
          finishedAt: '2000-01-01T00:01:00.000Z'
        })
      );
    });
    const page = await openViewer(context, server.url);

    // act
    await page.locator('#filter').selectOption('endpoints');
    const underEndpoints = await page.locator(`#policy-list li[data-name="${name}"]`).count();
    await page.locator('#filter').selectOption('all');
    const underAll = await page.locator(`#policy-list li[data-name="${name}"]`).count();

    // assert
    assert.equal(underEndpoints, 0);
    assert.equal(underAll, 1);
  });

  test('says when a policy cannot be loaded, rather than showing the previous one', async (context) => {
    // arrange
    const { root, server } = await serveFixture(context);
    const page = await openViewer(context, server.url);
    await selectPolicy(page, different);
    await rm(join(root, rechecked), { recursive: true, force: true });

    // act
    await page.locator(`#policy-list li[data-name="${rechecked}"]`).click();

    // assert
    await page.locator('#details', { hasText: `Could not load ${rechecked}` }).waitFor();
    assert.equal(await page.locator('#viewer img').count(), 0);
  });

  test('ignores a malformed hash', async (context) => {
    // arrange
    const { server } = await serveFixture(context);

    // act
    const page = await openViewer(context, `${server.url}#%E0`);

    // assert
    assert.equal(await page.locator('#policy-list li').count(), 2);
  });

  test('keeps the chosen view after showing a failed policy', async (context) => {
    // arrange
    const { server } = await serveFixture(context);
    const page = await openViewer(context, server.url);
    await selectPolicy(page, different);
    await page.locator('#mode button[data-mode="blink"]').click();
    await page.locator('#filter').selectOption('all');
    await selectPolicy(page, failed);

    // act
    await selectPolicy(page, different);
    await page.locator('#pane-overlay img[src$="screenshot-quote-page-mrp.png"]').waitFor({ state: 'attached' });

    // assert
    assert.equal(await page.locator('#mode button[data-mode="blink"]').getAttribute('aria-pressed'), 'true');
  });

  test('reopens the policy in the hash', async (context) => {
    // arrange
    const { server } = await serveFixture(context);

    // act
    const page = await openViewer(context, `${server.url}#${rechecked}`);

    // assert
    await page.locator(`#policy-list li[data-name="${rechecked}"][aria-current="true"]`).waitFor();
  });

  test('moves with J and K', async (context) => {
    // arrange
    const { server } = await serveFixture(context);
    const page = await openViewer(context, server.url);
    await selectPolicy(page, different);

    // act
    await page.keyboard.press('j');
    const afterJ = await page.locator('#policy-list li[aria-current="true"]').getAttribute('data-name');
    await page.keyboard.press('k');
    const afterK = await page.locator('#policy-list li[aria-current="true"]').getAttribute('data-name');

    // assert
    assert.equal(afterJ, rechecked);
    assert.equal(afterK, different);
  });

  test("shows a failed policy's issues and screenshot", async (context) => {
    // arrange
    const { server } = await serveFixture(context);
    const page = await openViewer(context, server.url);
    await page.locator('#filter').selectOption('failed');

    // act
    await selectPolicy(page, failed);

    // assert
    assert.match(await page.locator('#details').innerText(), /Website displayed <h2>Oops<\/h2>/);
    const sources = await page.locator('#viewer img').evaluateAll((images) => images.map((image) => image.src));
    assert.ok(
      sources.some((source) => source.endsWith('screenshot-failed-nhi.png')),
      JSON.stringify(sources)
    );
  });

  test('says which screenshot is missing', async (context) => {
    // arrange
    const { server } = await serveFixture(context, {}, (root) =>
      rm(join(root, different, 'screenshot-quote-page-mrp.png'))
    );
    const page = await openViewer(context, server.url);

    // act
    await selectPolicy(page, different);

    // assert
    assert.match(await page.locator('#pane-mrp').innerText(), /MRP screenshot not saved/);
    assert.equal(await page.locator('#pane-mrp img').count(), 0);
  });

  test('says when there is nothing to show', async (context) => {
    // arrange
    const { root, server } = await serveFixture(context, { empty: true });

    // act
    const page = await openViewer(context, server.url);

    // assert
    const text = await page.locator('#empty').innerText();
    assert.match(text, /No different policies/);
    assert.ok(text.includes(root), text);
  });
});
