import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { compare } from '../dist/compare.js';
import { screenshot } from '../dist/screenshot.js';
import { readEndorsementTitles, standardiseQuotePage } from '../dist/standardise-page.js';

/** Endorsements by path; each page lists them in its own order, as NHI and TCAS do. */
const pages = {
  '/nhi': [
    ['Bike security endorsement', 'Lock your bike.'],
    ['Unoccupancy clause', 'Limited cover when empty.']
  ],
  '/tcas': [
    ['Unoccupancy clause', 'Limited cover when empty.'],
    ['Bike security endorsement', 'Lock your bike.']
  ],
  '/tcas-reworded': [
    ['Unoccupancy clause', 'No cover when empty.'],
    ['Bike security endorsement', 'Lock your bike.']
  ],
  '/single': [['Unoccupancy clause', 'Limited cover when empty.']]
};

/** A quote page's endorsements card, as the quote page renders it, followed by the next card. */
function pageHtml(endorsements) {
  const containers = endorsements
    .map(
      ([title, text]) =>
        `<div class="hp-info-container"><div class="hp-title-and-body"><div class="hp-info-title">${title}</div><div class="hp-info-text"><p>${text}</p></div></div></div>`
    )
    .join('');
  return `<!doctype html><html><body style="margin:0;font-size:24px">
    <div class="av-card av-card-child hp-endorsements-info"><h3>Your policy endorsements</h3><div><p>Introduction</p></div>${containers}</div>
    <div class="av-card av-card-child hp-policy-documents"><div class="hp-info-title">Not an endorsement</div></div>
  </body></html>`;
}

let server;
let base;
let directory;

before(async () => {
  server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(pageHtml(pages[request.url] ?? []));
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  base = `http://127.0.0.1:${server.address().port}`;
  directory = await mkdtemp(join(tmpdir(), 'standardise-page-'));
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
  await rm(directory, { recursive: true, force: true });
});

/** Captures a page, standardising it when asked, and returns where its screenshot and HTML were saved. */
async function capture(path, standardise) {
  const name = `${path.slice(1)}-${standardise ? 'standardised' : 'shown'}`;
  const files = {
    image: join(directory, `${name}.png`),
    original: join(directory, `${name}-quote-page.html`),
    standardised: join(directory, `${name}-quote-page-standardized.html`)
  };
  await screenshot(`${base}${path}`, {
    output: files.image,
    width: 600,
    height: 300,
    wait: 0,
    html: standardise
      ? {
          output: files.original,
          standardisedOutput: files.standardised,
          standardise: (page) => standardiseQuotePage(page, 'TEST')
        }
      : undefined
  });
  return files;
}

/** Captures two pages the same way and returns the comparison's changed pixel count. */
async function changedPixels(before, after, standardise) {
  const [a, b] = [await capture(before, standardise), await capture(after, standardise)];
  const output = join(directory, `comparison-${before.slice(1)}-${after.slice(1)}-${standardise}`);
  await compare(a.image, b.image, { output, useOcr: false });
  return JSON.parse(await readFile(join(output, 'report.json'), 'utf8')).changedPixels;
}

describe('standardiseQuotePage', () => {
  test('pages listing the endorsements in different orders differ without standardising', async () => {
    // arrange
    const standardise = false;

    // act
    const changed = await changedPixels('/nhi', '/tcas', standardise);

    // assert
    assert.ok(changed > 0);
  });

  test('standardising removes a difference in endorsement order alone', async () => {
    // arrange
    const standardise = true;

    // act
    const changed = await changedPixels('/nhi', '/tcas', standardise);

    // assert
    assert.equal(changed, 0);
  });

  test('standardising still shows a difference in endorsement wording', async () => {
    // arrange
    const standardise = true;

    // act
    const changed = await changedPixels('/nhi', '/tcas-reworded', standardise);

    // assert
    assert.ok(changed > 0);
  });

  test('saves the HTML as rendered and as standardised', async () => {
    // arrange
    const path = '/tcas';

    // act
    const files = await capture(path, true);

    // assert
    assert.deepEqual(readEndorsementTitles(await readFile(files.original, 'utf8')), [
      'Unoccupancy clause',
      'Bike security endorsement'
    ]);
    assert.deepEqual(readEndorsementTitles(await readFile(files.standardised, 'utf8')), [
      'Bike security endorsement',
      'Unoccupancy clause'
    ]);
  });

  test('leaves a page already in standard order unchanged', async () => {
    // arrange
    const path = '/nhi';

    // act
    const files = await capture(path, true);

    // assert
    assert.equal(await readFile(files.standardised, 'utf8'), await readFile(files.original, 'utf8'));
  });

  test('leaves a page with one endorsement unchanged', async () => {
    // arrange
    const path = '/single';

    // act
    const files = await capture(path, true);

    // assert
    assert.equal(await readFile(files.standardised, 'utf8'), await readFile(files.original, 'utf8'));
  });
});

describe('readEndorsementTitles', () => {
  test('reads only the endorsements card, decoding entities', () => {
    // arrange
    const html = pageHtml([['Fixtures &amp; fittings', 'Text.']]);

    // act
    const titles = readEndorsementTitles(html);

    // assert
    assert.deepEqual(titles, ['Fixtures & fittings']);
  });

  test('returns nothing for a page without endorsements', () => {
    // arrange
    const html = '<html><body><div class="hp-info-title">Other</div></body></html>';

    // act
    const titles = readEndorsementTitles(html);

    // assert
    assert.deepEqual(titles, []);
  });
});
