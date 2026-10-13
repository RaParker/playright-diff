import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { defaultQuoteGuidCount, readQuoteGuidList, selectQuoteGuids } from '../dist/quote-guid-list.js';
import { readQuoteGuidMapping, requestQuoteGuid, saveQuoteGuidMapping } from '../dist/quote-guid.js';
import { declinedPageHtml, quotePageHtml, quoteSummaryHtml, unsavedJourneyHtml } from './unsaved-journey-html.mjs';

/**
 * Reads the saved result of a policy A run that skipped the comparison, checking it is the only file in its
 * comparisons folder (no report was written).
 */
async function readOnlyResult(directory) {
  const folder = join(directory, 'comparisons', `${policyA}-1`);
  assert.deepEqual(await readdir(folder), ['result.json']);
  const { outcome, validation } = JSON.parse(await readFile(join(folder, 'result.json'), 'utf8'));
  return { outcome, validation };
}

const script = resolve('dist/main.js');
const policyA = 'ABCDEF1234567890ABCDEF1234567890';
const policyB = '11111111111111111111111111111111';
const policyC = '22222222222222222222222222222222';
const red = '\u001b[31m';
const yellow = '\u001b[33m';
const tcasJourneyHtml = `<h1>Cover details</h1>
  <div class="av-timeline-all-sections"><ul><li title="Contact details">Contact details</li></ul></div>
  <button onclick="document.body.innerHTML = '${quotePageHtml}'">Get your quote</button>`;

async function withServer(handler, run) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    handler(request, response);
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`, requests);
  } finally {
    server.closeAllConnections();
    await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
  }
}

function jsonHandler(status, body) {
  return (_request, response) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
}

// Serves NHI quote summary pages (Oops for GUIDs in oopsGuids), the unsaved and TCAS journeys, the replacement TCAS
// quote summary, and the quote-guid endpoint.
function quoteJourneyHandler(
  oopsGuids,
  replacementGuid = 'new-guid',
  unsavedJourney = {},
  tcasReplacementHtml = quoteSummaryHtml
) {
  return (request, response) => {
    if (request.url.startsWith('/api/nhi/quote-guid')) {
      jsonHandler(200, { guid: replacementGuid, productVersion: 'florence' })(request, response);
      return;
    }

    response.setHeader('Content-Type', 'text/html');
    if (request.url.startsWith('/tcas/')) {
      response.end(tcasJourneyHtml);
      return;
    }

    if (request.url.startsWith('/tcas-replacement/')) {
      response.end(tcasReplacementHtml);
      return;
    }

    if (request.url.startsWith('/unsaved/')) {
      response.end(unsavedJourneyHtml(unsavedJourney));
      return;
    }

    const guid = decodeURIComponent(request.url.split('/').pop());
    response.end(oopsGuids.includes(guid) ? '<h2>Oops</h2>' : quoteSummaryHtml);
  };
}

async function fixture(base, mrpFiles = { [`${policyA}-1`]: 'orig-guid' }) {
  const directory = await mkdtemp(join(tmpdir(), 'quote-guid-'));
  for (const [basename, artemisQuoteGuid] of Object.entries(mrpFiles)) {
    await writeFile(join(directory, `${basename}-mrp.json`), JSON.stringify({ artemisQuoteGuid }));
  }

  const env = { ...process.env };
  Object.assign(env, {
    MRP_AND_QUOTE_OUTPUT_DIR: directory,
    QUOTE_JOURNEY_NHI_QUOTE_PAGE_URL_TEMPLATE: `${base}/nhi/{artemisQuoteGuid}`,
    QUOTE_JOURNEY_NHI_UNSAVED_URL_TEMPLATE: `${base}/unsaved/{artemisQuoteGuid}`,
    QUOTE_JOURNEY_TCAS_REPLACEMENT_URL_TEMPLATE: `${base}/tcas-replacement/{artemisQuoteGuid}`,
    QUOTE_JOURNEY_TCAS_QUOTE_PAGE_URL_TEMPLATE: `${base}/tcas/{policyDetailsId}/{historyId}`,
    QUOTE_JOURNEY_QUOTE_GUID_URL: `${base}/api/nhi/quote-guid`,
    QUOTE_JOURNEY_AGENT_ID: 'agent',
    QUOTE_JOURNEY_BRANCH_CODE: '1066',
    QUOTE_JOURNEY_CALL_MEDIA_USER: 'media-user',
    QUOTE_GUID_LIST_PATH: join(directory, 'quoteGuids.txt')
  });
  return { directory, env };
}

async function run(directory, env, args) {
  const child = spawn(process.execPath, [script, ...args], { cwd: directory, env });
  let output = '';
  child.stdout.on('data', (data) => (output += data));
  child.stderr.on('data', (data) => (output += data));
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  // ANSI colour codes removed, for asserting on the text alone.
  const plain = output.replace(new RegExp(`${String.fromCharCode(27)}\\[\\d+m`, 'g'), '');
  return { code, output, plain };
}

/** Writes a comparison report for a policy's earlier run, with the given number of changed pixels. */
async function writeComparison(directory, name, changedPixels) {
  const folder = join(directory, 'comparisons', name);
  await mkdir(folder, { recursive: true });
  const size = { width: 1440, height: 100 };
  await writeFile(
    join(folder, 'report.json'),
    JSON.stringify({ dimensions: { before: size, after: size }, changedPixels, changedPercent: 0, regions: [] })
  );
}

async function readFailed(directory) {
  return JSON.parse(await readFile(join(directory, 'quote-pages-failed.json'), 'utf8'));
}

async function readMapping(directory) {
  return JSON.parse(await readFile(join(directory, 'quote-guid-mapping.json'), 'utf8'));
}

describe('readQuoteGuidList', () => {
  test('returns uppercase GUIDs and skips blank lines', async () => {
    // arrange
    const directory = await mkdtemp(join(tmpdir(), 'quote-guid-list-'));
    const path = join(directory, 'quoteGuids.txt');
    await writeFile(path, `${policyA.toLowerCase()}\r\n\n  ${policyB}  \n`);

    // act
    const guids = await readQuoteGuidList(path);

    // assert
    assert.deepEqual(guids, [policyA, policyB]);
  });

  test('rejects a line that is not a dashless UUID', async () => {
    // arrange
    const directory = await mkdtemp(join(tmpdir(), 'quote-guid-list-'));
    const path = join(directory, 'quoteGuids.txt');
    await writeFile(path, `${policyA}\nnot-a-guid\n`);

    // act
    const result = readQuoteGuidList(path);

    // assert
    await assert.rejects(result, /line 2: "not-a-guid"/);
  });
});

describe('selectQuoteGuids', () => {
  const guids = Array.from({ length: defaultQuoteGuidCount + 5 }, (_value, index) =>
    index.toString(16).toUpperCase().padStart(32, '0')
  );
  for (const [name, selector, expected] of [
    ['defaults to the first 250', undefined, guids.slice(0, defaultQuoteGuidCount)],
    ['limits to maxCount', '3', guids.slice(0, 3)],
    ['allows maxCount 0', '0', []],
    ['allows maxCount above the list length', '1000', guids],
    ['selects a GUID case-insensitively', guids[7].toLowerCase(), [guids[7]]]
  ]) {
    test(name, () => {
      // arrange
      // (guids defined above)

      // act
      const selected = selectQuoteGuids(guids, selector);

      // assert
      assert.deepEqual(selected, expected);
    });
  }

  for (const [name, selector, expected] of [
    ['an unknown GUID', policyA, /No entry in the GUID list matches/],
    ['a negative maxCount', '-1', /neither a non-negative maxCount nor a quote GUID/],
    ['a non-numeric selector', 'ten', /neither a non-negative maxCount nor a quote GUID/]
  ]) {
    test(`rejects ${name}`, () => {
      // arrange
      // (guids defined above)

      // act
      const select = () => selectQuoteGuids(guids, selector);

      // assert
      assert.throws(select, expected);
    });
  }
});

describe('requestQuoteGuid', () => {
  test('posts agent and policy parameters and returns the guid', async () => {
    await withServer(jsonHandler(200, { guid: 'new-guid', productVersion: 'florence' }), async (base, requests) => {
      // arrange
      const options = { quoteGuidUrl: `${base}/api/nhi/quote-guid`, agentId: 'a', branchCode: 'b', callMediaUser: 'c' };

      // act
      const guid = await requestQuoteGuid(policyA, 1, options);

      // assert
      assert.equal(guid, 'new-guid');
      const query = new URL(requests[0], base).searchParams;
      assert.deepEqual(Object.fromEntries(query), {
        agentId: 'a',
        branchCode: 'b',
        callMediaUser: 'c',
        policyDetailsId: policyA,
        historyId: '1'
      });
    });
  });

  test("sends today's date as the cover start date in a JSON body", async () => {
    let received;
    const handler = (request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        received = { method: request.method, contentType: request.headers['content-type'], body };
        jsonHandler(200, { guid: 'new-guid' })(request, response);
      });
    };
    await withServer(handler, async (base) => {
      // arrange
      const options = { quoteGuidUrl: `${base}/api/nhi/quote-guid`, agentId: 'a', branchCode: 'b', callMediaUser: 'c' };
      const now = new Date();
      const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
        .map((part) => String(part).padStart(2, '0'))
        .join('-');

      // act
      await requestQuoteGuid(policyA, 1, options);

      // assert
      assert.equal(received.method, 'POST');
      assert.equal(received.contentType, 'application/json');
      assert.deepEqual(JSON.parse(received.body), { coverStartDate: today });
    });
  });

  for (const [name, status, body, expected] of [
    ['an HTTP failure', 500, { guid: 'x' }, /HTTP 500/],
    ['a missing guid', 200, { productVersion: 'florence' }, /must contain the "guid" property/],
    ['a blank guid', 200, { guid: ' ' }, /non-empty string/],
    ['a numeric guid', 200, { guid: 42 }, /non-empty string/],
    ['a null body', 200, 'null', /must contain the "guid" property/]
  ]) {
    test(`rejects ${name}`, async () => {
      await withServer(jsonHandler(status, body), async (base) => {
        // arrange
        const options = {
          quoteGuidUrl: `${base}/api/nhi/quote-guid`,
          agentId: 'a',
          branchCode: 'b',
          callMediaUser: 'c'
        };

        // act
        const result = requestQuoteGuid(policyA, 1, options);

        // assert
        await assert.rejects(result, expected);
      });
    });
  }

  test('rejects a non-HTTP URL', async () => {
    // arrange
    const options = { quoteGuidUrl: 'file:///quote-guid', agentId: 'a', branchCode: 'b', callMediaUser: 'c' };

    // act
    const result = requestQuoteGuid(policyA, 1, options);

    // assert
    await assert.rejects(result, /must use http/);
  });
});

describe('quote GUID mapping file', () => {
  test('reads a missing file as an empty mapping', async () => {
    // arrange
    const path = join(await mkdtemp(join(tmpdir(), 'quote-guid-map-')), 'mapping.json');

    // act
    const mapping = await readQuoteGuidMapping(path);

    // assert
    assert.deepEqual(mapping, {});
  });

  test('saves new entries alongside existing ones', async () => {
    // arrange
    const path = join(await mkdtemp(join(tmpdir(), 'quote-guid-map-')), 'mapping.json');
    await writeFile(path, JSON.stringify({ first: 'one' }));

    // act
    await saveQuoteGuidMapping(path, 'second', 'two');

    // assert
    assert.deepEqual(await readQuoteGuidMapping(path), { first: 'one', second: 'two' });
  });

  for (const [name, content] of [
    ['an array', '[]'],
    ['null', 'null'],
    ['a non-string value', '{"a":1}']
  ]) {
    test(`rejects ${name}`, async () => {
      // arrange
      const path = join(await mkdtemp(join(tmpdir(), 'quote-guid-map-')), 'mapping.json');
      await writeFile(path, content);

      // act
      const result = readQuoteGuidMapping(path);

      // assert
      await assert.rejects(result, /JSON object of strings/);
    });
  }

  test('keeps every entry when many are saved at once', async () => {
    // arrange
    const path = join(await mkdtemp(join(tmpdir(), 'quote-guid-map-')), 'mapping.json');
    const entries = Array.from({ length: 20 }, (_, index) => [`original-${index}`, `replacement-${index}`]);

    // act
    await Promise.all(entries.map(([original, replacement]) => saveQuoteGuidMapping(path, original, replacement)));

    // assert
    assert.deepEqual(await readQuoteGuidMapping(path), Object.fromEntries(entries));
    assert.deepEqual(await readdir(dirname(path)), ['mapping.json']);
  });

  test('reads and saves made at the same time all succeed and keep every entry', async () => {
    // arrange
    const path = join(await mkdtemp(join(tmpdir(), 'quote-guid-map-')), 'mapping.json');
    await saveQuoteGuidMapping(path, 'first', 'one');

    // act
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        index % 2 === 0 ? saveQuoteGuidMapping(path, `original-${index}`, 'replacement') : readQuoteGuidMapping(path)
      )
    );

    // assert
    assert.deepEqual(
      results.filter((result) => result.status === 'rejected'),
      []
    );
    assert.equal(Object.keys(await readQuoteGuidMapping(path)).length, 11);
  });
});

describe('quote-page NHI Oops fallback', () => {
  test('requests a replacement GUID, saves the mapping, and runs its unsaved journey', async () => {
    await withServer(quoteJourneyHandler(['orig-guid']), async (base, requests) => {
      // arrange
      const { directory, env } = await fixture(base);

      // act
      const result = await run(directory, env, ['quote-page', policyA, '1', '--no-ocr']);

      // assert
      assert.equal(result.code, 0, result.output);
      assert.deepEqual(await readMapping(directory), { 'orig-guid': 'new-guid' });
      assert.ok(requests.includes('/nhi/orig-guid'));
      assert.ok(requests.includes('/unsaved/new-guid'));
      assert.ok(!requests.includes('/nhi/new-guid'));
      assert.ok(requests.includes(`/tcas/${policyA}/1`));
      assert.ok(
        requests.indexOf('/tcas-replacement/new-guid') > requests.indexOf('/unsaved/new-guid'),
        requests.join('\n')
      );
      const quoteGuidRequest = requests.find((path) => path.startsWith('/api/nhi/quote-guid'));
      assert.equal(new URL(quoteGuidRequest, base).searchParams.get('policyDetailsId'), policyA);
      assert.equal(new URL(quoteGuidRequest, base).searchParams.get('callMediaUser'), 'media-user');
      assert.ok((await readdir(directory)).includes('comparisons'));
    });
  });

  test('logs each URL it opens', async () => {
    await withServer(quoteJourneyHandler(['orig-guid']), async (base) => {
      // arrange
      const { directory, env } = await fixture(base);

      // act
      const result = await run(directory, env, ['quote-page', policyA, '1', '--no-ocr']);

      // assert
      assert.equal(result.code, 0, result.output);
      assert.ok(result.output.includes(`NHI: opening ${base}/nhi/orig-guid`), result.output);
      assert.ok(result.output.includes(`NHI: opening ${base}/unsaved/new-guid`), result.output);
      assert.ok(result.output.includes(`TCAS: opening ${base}/tcas/${policyA}/1`), result.output);
      assert.ok(result.output.includes('TCAS: using replacement quote GUID new-guid to match NHI.'), result.output);
      assert.ok(result.output.includes(`TCAS: opening ${base}/tcas-replacement/new-guid`), result.output);
      assert.ok(result.output.includes('TCAS: selecting Pay annually.'), result.output);
    });
  });

  test('reports a replacement TCAS failure even though the original TCAS capture succeeded', async () => {
    await withServer(quoteJourneyHandler(['orig-guid'], 'new-guid', {}, '<h2>Oops</h2>'), async (base) => {
      // arrange
      const { directory, env } = await fixture(base);

      // act
      const result = await run(directory, env, ['quote-page', policyA, '1', '--no-ocr']);

      // assert
      assert.notEqual(result.code, 0);
      assert.ok(
        result.output.includes(
          `TCAS: Website displayed <h2>Oops</h2>; stopping the journey. (${base}/tcas-replacement/new-guid)`
        ),
        result.output
      );
      assert.ok(result.output.includes(`${red}Quote capture failed; comparison skipped.`), result.output);
      assert.deepEqual(await readOnlyResult(directory), { outcome: 'failed', validation: false });
    });
  });

  test('reports the section, error summary and URL when the unsaved journey fails validation', async () => {
    await withServer(quoteJourneyHandler(['orig-guid'], 'new-guid', { errorOn: 'Property type' }), async (base) => {
      // arrange
      const { directory, env } = await fixture(base);

      // act
      const result = await run(directory, env, ['quote-page', policyA, '1', '--no-ocr']);

      // assert
      assert.notEqual(result.code, 0);
      assert.ok(
        result.output.includes(
          `NHI: NHI journey validation failed on Property type: Enter the year built (${base}/unsaved/new-guid)`
        ),
        result.output
      );
      assert.ok(result.output.includes(`${yellow}Quote capture failed; comparison skipped.`), result.output);
      assert.ok(result.output.includes(`${yellow}Failure screenshot and HTML saved to`), result.output);
    });
  });

  test('uses an existing mapping without opening the original GUID', async () => {
    await withServer(quoteJourneyHandler(['orig-guid']), async (base, requests) => {
      // arrange
      const { directory, env } = await fixture(base);
      await writeFile(join(directory, 'quote-guid-mapping.json'), JSON.stringify({ 'orig-guid': 'mapped-guid' }));

      // act
      const result = await run(directory, env, ['quote-page', policyA, '1', '--no-ocr']);

      // assert
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /using mapped quote GUID mapped-guid/);
      assert.ok(requests.includes('/nhi/mapped-guid'));
      assert.ok(!requests.includes('/nhi/orig-guid'));
      assert.ok(!requests.some((path) => path.startsWith('/api/nhi/quote-guid')));
      assert.ok(!requests.includes(`/tcas/${policyA}/1`));
      assert.ok(requests.indexOf('/tcas-replacement/mapped-guid') > requests.indexOf('/nhi/mapped-guid'));
    });
  });

  test('runs the unsaved journey without another request when the mapped GUID shows Oops', async () => {
    await withServer(quoteJourneyHandler(['orig-guid', 'mapped-guid']), async (base, requests) => {
      // arrange
      const { directory, env } = await fixture(base);
      await writeFile(join(directory, 'quote-guid-mapping.json'), JSON.stringify({ 'orig-guid': 'mapped-guid' }));

      // act
      const result = await run(directory, env, ['quote-page', policyA, '1', '--no-ocr']);

      // assert
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /mapped quote GUID mapped-guid is not saved to NHI yet/);
      assert.ok(requests.includes('/nhi/mapped-guid'));
      assert.ok(requests.includes('/unsaved/mapped-guid'));
      assert.ok(requests.indexOf('/tcas-replacement/mapped-guid') > requests.indexOf('/unsaved/mapped-guid'));
      assert.ok(!requests.some((path) => path.startsWith('/api/nhi/quote-guid')));
      assert.deepEqual(await readMapping(directory), { 'orig-guid': 'mapped-guid' });
    });
  });

  test('reports the Oops and request failure when the replacement request fails', async () => {
    const handler = (request, response) =>
      request.url.startsWith('/api/nhi/quote-guid')
        ? jsonHandler(503, {})(request, response)
        : quoteJourneyHandler(['orig-guid'])(request, response);
    await withServer(handler, async (base) => {
      // arrange
      const { directory, env } = await fixture(base);

      // act
      const result = await run(directory, env, ['quote-page', policyA, '1', '--no-ocr']);

      // assert
      assert.notEqual(result.code, 0);
      assert.ok(
        result.output.includes(
          `Oops</h2>; stopping the journey. (${base}/nhi/orig-guid) Requesting a replacement quote GUID failed: Quote GUID request returned HTTP 503`
        ),
        result.output
      );
      assert.ok(!(await readdir(directory)).includes('quote-guid-mapping.json'));
    });
  });
});

// Serves the declined page for any request whose path contains one of the given fragments.
function decliningHandler(fragments, handler = quoteJourneyHandler([])) {
  return (request, response) => {
    if (fragments.some((fragment) => request.url.includes(fragment))) {
      response.setHeader('Content-Type', 'text/html');
      response.end(declinedPageHtml);
      return;
    }

    handler(request, response);
  };
}

describe('quote-page declined quotes', () => {
  for (const [name, fragments, expectedSuccess, expectedOutput, expectedScreenshots] of [
    [
      'succeeds without comparing when NHI and TCAS both decline',
      ['/nhi/', '/tcas/'],
      true,
      /NHI and TCAS both declined the quote; comparison skipped\./,
      ['nhi-declined.html', 'nhi-declined.png', 'tcas-declined.html', 'tcas-declined.png']
    ],
    [
      'fails when only NHI declines',
      ['/nhi/'],
      false,
      /Quote outcomes differ: NHI declined, TCAS quoted; comparison skipped\./,
      ['nhi-declined.html', 'nhi-declined.png', 'tcas.png']
    ],
    [
      'fails when only TCAS declines',
      ['/tcas/'],
      false,
      /Quote outcomes differ: NHI quoted, TCAS declined; comparison skipped\./,
      ['nhi.png', 'tcas-declined.html', 'tcas-declined.png']
    ]
  ]) {
    test(name, async () => {
      await withServer(decliningHandler(fragments), async (base) => {
        // arrange
        const { directory, env } = await fixture(base);

        // act
        const result = await run(directory, env, ['quote-page', policyA, '1', '--no-ocr']);

        // assert
        assert.equal(result.code === 0, expectedSuccess, result.output);
        assert.match(result.output, expectedOutput);
        // Failures are shown in red; a both-declined success is not.
        assert.equal(result.output.includes('\u001b[31m'), !expectedSuccess, result.output);
        assert.deepEqual(await readOnlyResult(directory), {
          outcome: expectedSuccess ? 'declined' : 'failed',
          validation: false
        });
        assert.deepEqual(
          (await readdir(join(directory, 'screenshots'))).sort(),
          expectedScreenshots.map((suffix) => `${policyA}-1-${suffix}`)
        );
      });
    });
  }

  test('captures the replacement TCAS quote when the replacement NHI journey declines', async () => {
    await withServer(
      quoteJourneyHandler(['orig-guid'], 'new-guid', { declines: true }, declinedPageHtml),
      async (base, requests) => {
        // arrange
        const { directory, env } = await fixture(base);

        // act
        const result = await run(directory, env, ['quote-page', policyA, '1', '--no-ocr']);

        // assert
        assert.equal(result.code, 0, result.output);
        assert.ok(requests.includes('/tcas-replacement/new-guid'));
        assert.match(result.output, /NHI and TCAS both declined/);
      }
    );
  });
});

describe('QUOTE_PAGE_TIMEOUT', () => {
  test('sets the step timeout of the NHI and TCAS captures', async () => {
    const stuckPage = (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<h1>Still waiting</h1>');
    };
    await withServer(stuckPage, async (base) => {
      // arrange
      const { directory, env } = await fixture(base);
      env.QUOTE_PAGE_TIMEOUT = '1s';

      // act
      const result = await run(directory, env, ['quote-page', policyA, '1', '--no-ocr']);

      // assert
      assert.notEqual(result.code, 0);
      assert.match(result.plain, /NHI: Expected page did not appear within 1 s/);
      assert.match(result.plain, /TCAS: .*Timeout 1000ms exceeded/);
    });
  });

  for (const value of ['0s', 'abc', '45 s', '9h']) {
    test(`rejects a value of ${value}`, async () => {
      // arrange
      const { directory, env } = await fixture('http://127.0.0.1:1');
      env.QUOTE_PAGE_TIMEOUT = value;

      // act
      const result = await run(directory, env, ['quote-page', policyA, '1', '--no-ocr']);

      // assert
      assert.notEqual(result.code, 0);
      assert.match(result.output, /QUOTE_PAGE_TIMEOUT: The 'interval' /);
    });
  }
});

describe('quote-pages', () => {
  test('counts policies where both sides declined as passed', async () => {
    await withServer(decliningHandler(['guid-a', policyA]), async (base) => {
      // arrange
      const { directory, env } = await fixture(base, { [`${policyA}-1`]: 'guid-a', [`${policyB}-1`]: 'guid-b' });
      await writeFile(env.QUOTE_GUID_LIST_PATH, `${policyA}\n${policyB}\n`);

      // act
      const result = await run(directory, env, ['quote-pages', '--no-ocr']);

      // assert
      assert.equal(result.code, 0, result.output);
      assert.match(result.plain, /2 passed \(1 both declined\), 0 failed/);
      // A clean list run leaves no saved failures file behind.
      await assert.rejects(readFailed(directory), { code: 'ENOENT' });
    });
  });

  test('runs the selected GUIDs from the list with historyId 1', async () => {
    await withServer(quoteJourneyHandler([]), async (base, requests) => {
      // arrange
      const { directory, env } = await fixture(base, { [`${policyA}-1`]: 'guid-a', [`${policyB}-1`]: 'guid-b' });
      await writeFile(env.QUOTE_GUID_LIST_PATH, `${policyA}\n${policyB}\n`);

      // act
      const result = await run(directory, env, ['quote-pages', '1', '--no-ocr']);

      // assert
      assert.equal(result.code, 0, result.output);
      assert.match(result.plain, /\n\nQuote pages summary\n1 passed \(0 both declined\), 0 failed\.\n/);
      assert.ok(result.output.includes(`\u001b[36m[1/1] ${policyA}-1`), result.output);
      assert.ok(requests.includes(`/tcas/${policyA}/1`));
      assert.ok(!requests.some((path) => path.startsWith('/tcas-replacement/')));
      assert.ok(!requests.some((path) => path.includes(policyB) || path.includes('guid-b')));
    });
  });

  test('continues past a failing policy and reports a summary', async () => {
    await withServer(quoteJourneyHandler([]), async (base) => {
      // arrange
      const { directory, env } = await fixture(base, { [`${policyB}-1`]: 'guid-b' });
      await writeFile(env.QUOTE_GUID_LIST_PATH, `${policyA}\n${policyB}\n`);

      // act
      const result = await run(directory, env, ['quote-pages', '--no-ocr']);

      // assert
      assert.notEqual(result.code, 0);
      assert.match(result.plain, /Quote pages summary\n1 passed \(0 both declined\), 1 failed\.\n/);
      assert.match(result.plain, new RegExp(`\n${policyA}-1\n  No saved MRP for this quote`));
      assert.match(result.plain, /1 of 2 quote pages failed; see the summary above\./);
      // Only the issues and the failed count are red, not the whole summary.
      assert.ok(result.output.includes('\u001b[32m1 passed'), result.output);
      assert.ok(result.output.includes(`\n${policyA}-1\n`), result.output);
      assert.ok((await readdir(join(directory, 'screenshots'))).includes(`${policyB}-1-nhi.png`));
      const saved = await readFailed(directory);
      assert.deepEqual(
        saved.failed.map(({ policyDetailsId }) => policyDetailsId),
        [policyA]
      );
      assert.match(saved.failed[0].issues.join('\n'), /No saved MRP for this quote/);
      assert.match(
        result.plain,
        /Failed policies saved to quote-pages-failed\.json; retry them with npm run quote-pages -- retry-failed/
      );
    });
  });

  test('retry-failed reruns only the saved failures and keeps those still failing', async () => {
    await withServer(quoteJourneyHandler([]), async (base, requests) => {
      // arrange
      const { directory, env } = await fixture(base, { [`${policyB}-1`]: 'guid-b', [`${policyC}-1`]: 'guid-c' });
      await writeFile(env.QUOTE_GUID_LIST_PATH, `${policyA}\n${policyB}\n${policyC}\n`);
      await writeFile(
        join(directory, 'quote-pages-failed.json'),
        JSON.stringify({
          historyId: 1,
          failed: [
            { policyDetailsId: policyA, issues: ['earlier'] },
            { policyDetailsId: policyB, issues: ['earlier'] }
          ]
        })
      );

      // act
      const result = await run(directory, env, ['quote-pages', 'retry-failed', '--no-ocr']);

      // assert
      assert.notEqual(result.code, 0);
      assert.match(result.plain, /Retrying 2 failed policies from quote-pages-failed\.json/);
      assert.match(result.plain, /Quote pages summary\n1 passed \(0 both declined\), 1 failed\.\n/);
      assert.ok(requests.includes(`/tcas/${policyB}/1`));
      assert.ok(!requests.some((path) => path.includes(policyC) || path.includes('guid-c')));
      const saved = await readFailed(directory);
      assert.deepEqual(
        saved.failed.map(({ policyDetailsId }) => policyDetailsId),
        [policyA]
      );
    });
  });

  test('retry-failed reports when there is nothing to retry', async () => {
    // arrange
    const { directory, env } = await fixture('http://127.0.0.1:1');
    delete env.QUOTE_GUID_LIST_PATH;

    // act
    const result = await run(directory, env, ['quote-pages', 'retry-failed']);

    // assert
    assert.equal(result.code, 0, result.output);
    assert.match(result.plain, /No failed quote pages to retry \(quote-pages-failed\.json\)\./);
  });

  test('retry-different reruns only the policies whose screenshots differed', async () => {
    await withServer(quoteJourneyHandler([]), async (base, requests) => {
      // arrange
      const { directory, env } = await fixture(base, { [`${policyA}-1`]: 'guid-a', [`${policyB}-1`]: 'guid-b' });
      await writeFile(
        env.QUOTE_GUID_LIST_PATH,
        `${policyA}
${policyB}
`
      );
      await writeComparison(directory, `${policyA}-1`, 25);
      await writeComparison(directory, `${policyB}-1`, 0);
      const saved = `${JSON.stringify({ historyId: 1, failed: [{ policyDetailsId: policyC, issues: ['earlier'] }] })}
`;
      await writeFile(join(directory, 'quote-pages-failed.json'), saved);

      // act
      const result = await run(directory, env, ['quote-pages', 'retry-different', '--no-ocr']);

      // assert
      assert.equal(result.code, 0, result.output);
      assert.match(result.plain, /Retrying 1 different policies from .*comparisons\n/);
      assert.ok(requests.includes(`/tcas/${policyA}/1`));
      assert.ok(!requests.some((path) => path.includes(policyB) || path.includes('guid-b')));
      assert.equal(await readFile(join(directory, 'quote-pages-failed.json'), 'utf8'), saved);
    });
  });

  test('retry-different reports when there is nothing to retry', async () => {
    // arrange
    const { directory, env } = await fixture('http://127.0.0.1:1');
    delete env.QUOTE_GUID_LIST_PATH;
    await writeComparison(directory, `${policyA}-1`, 0);

    // act
    const result = await run(directory, env, ['quote-pages', 'retry-different']);

    // assert
    assert.equal(result.code, 0, result.output);
    assert.match(result.plain, /No different quote pages to retry \(.*comparisons\)\./);
  });

  for (const [name, selector] of [
    ['a GUID', policyA],
    ['a maxCount of 1', '1']
  ]) {
    test(`a one-off run selecting ${name} leaves the saved failures untouched`, async () => {
      await withServer(quoteJourneyHandler([]), async (base) => {
        // arrange
        const { directory, env } = await fixture(base, { [`${policyB}-1`]: 'guid-b' });
        await writeFile(env.QUOTE_GUID_LIST_PATH, `${policyA}\n${policyB}\n`);
        const saved = `${JSON.stringify({ historyId: 1, failed: [{ policyDetailsId: policyB, issues: ['earlier'] }] })}\n`;
        await writeFile(join(directory, 'quote-pages-failed.json'), saved);

        // act
        const result = await run(directory, env, ['quote-pages', selector, '--no-ocr']);

        // assert
        assert.notEqual(result.code, 0);
        assert.equal(await readFile(join(directory, 'quote-pages-failed.json'), 'utf8'), saved);
        assert.doesNotMatch(result.plain, /Failed policies saved to/);
      });
    });
  }

  test('a clean run with a maxCount above 1 deletes the saved failures', async () => {
    await withServer(quoteJourneyHandler([]), async (base) => {
      // arrange
      const { directory, env } = await fixture(base, { [`${policyA}-1`]: 'guid-a', [`${policyB}-1`]: 'guid-b' });
      await writeFile(env.QUOTE_GUID_LIST_PATH, `${policyA}\n${policyB}\n`);
      await writeFile(
        join(directory, 'quote-pages-failed.json'),
        JSON.stringify({ historyId: 1, failed: [{ policyDetailsId: policyC, issues: ['earlier'] }] })
      );

      // act
      const result = await run(directory, env, ['quote-pages', '2', '--no-ocr']);

      // assert
      assert.equal(result.code, 0, result.output);
      await assert.rejects(readFailed(directory), { code: 'ENOENT' });
    });
  });

  for (const [name, args, expected] of [
    ['an unknown GUID', [policyB], /No entry in the GUID list matches/],
    ['an invalid selector', ['ten'], /neither a non-negative maxCount/],
    ['extra arguments', ['1', '2'], /quote-pages takes at most one argument \(got 1 2\)\.\nUsage: npm run quote-pages/]
  ]) {
    test(`rejects ${name}`, async () => {
      // arrange
      const { directory, env } = await fixture('http://127.0.0.1:1');
      await writeFile(env.QUOTE_GUID_LIST_PATH, `${policyA}\n`);

      // act
      const result = await run(directory, env, ['quote-pages', ...args]);

      // assert
      assert.notEqual(result.code, 0);
      assert.match(result.output, expected);
    });
  }

  for (const value of ['0', 'three', '-1', '101']) {
    test(`rejects a concurrency of ${value}`, async () => {
      // arrange
      const { directory, env } = await fixture('http://127.0.0.1:1');
      await writeFile(env.QUOTE_GUID_LIST_PATH, `${policyA}\n`);

      // act
      const result = await run(directory, env, ['quote-pages', `--concurrency=${value}`]);

      // assert
      assert.notEqual(result.code, 0);
      assert.match(result.output, /--concurrency must be an integer from 1 to 100/);
    });
  }

  test("prefixes each policy's lines with its position when policies run at once", async () => {
    await withServer(quoteJourneyHandler([]), async (base) => {
      // arrange
      const { directory, env } = await fixture(base, { [`${policyA}-1`]: 'guid-a', [`${policyB}-1`]: 'guid-b' });
      await writeFile(env.QUOTE_GUID_LIST_PATH, `${policyA}\n${policyB}\n`);

      // act
      const result = await run(directory, env, ['quote-pages', '--no-ocr']);

      // assert
      assert.equal(result.code, 0, result.output);
      assert.match(result.plain, /\n\[1\/2 ABCDEF12\] NHI: opening /);
      assert.match(result.plain, /\n\[2\/2 11111111\] NHI: opening /);
      assert.match(result.plain, /\n\nQuote pages summary\n2 passed \(0 both declined\), 0 failed\.\n/);
    });
  });

  test('a concurrency of 1 runs the policies in turn without line prefixes', async () => {
    await withServer(quoteJourneyHandler([]), async (base) => {
      // arrange
      const { directory, env } = await fixture(base, { [`${policyA}-1`]: 'guid-a', [`${policyB}-1`]: 'guid-b' });
      await writeFile(env.QUOTE_GUID_LIST_PATH, `${policyA}\n${policyB}\n`);

      // act
      const result = await run(directory, env, ['quote-pages', '-c', '1', '--no-ocr']);

      // assert
      assert.equal(result.code, 0, result.output);
      assert.doesNotMatch(result.plain, /\[\d\/2 [0-9A-F]{8}\]/);
      const firstPolicyDone = result.plain.indexOf('Screenshot saved to', result.plain.indexOf(`[1/2] ${policyA}-1`));
      assert.ok(firstPolicyDone < result.plain.indexOf(`[2/2] ${policyB}-1`), result.plain);
    });
  });

  test('runs a policy repeated in the list (in any case) only once', async () => {
    await withServer(quoteJourneyHandler([]), async (base, requests) => {
      // arrange
      const { directory, env } = await fixture(base, { [`${policyA}-1`]: 'guid-a', [`${policyB}-1`]: 'guid-b' });
      await writeFile(env.QUOTE_GUID_LIST_PATH, `${policyA}\n${policyB}\n${policyA.toLowerCase()}\n`);

      // act
      const result = await run(directory, env, ['quote-pages', '--no-ocr']);

      // assert
      assert.equal(result.code, 0, result.output);
      assert.match(result.plain, /Skipping 1 repeated policy ID; each policy runs once\./);
      assert.match(result.plain, /Quote pages summary\n2 passed \(0 both declined\), 0 failed\.\n/);
      assert.equal(requests.filter((path) => path === `/tcas/${policyA}/1`).length, 1);
    });
  });

  test('saves failures in list order when policies run at once', async () => {
    await withServer(quoteJourneyHandler([]), async (base) => {
      // arrange
      const { directory, env } = await fixture(base, { [`${policyB}-1`]: 'guid-b' });
      await writeFile(env.QUOTE_GUID_LIST_PATH, `${policyB}\n${policyC}\n${policyA}\n`);

      // act
      const result = await run(directory, env, ['quote-pages', '--concurrency', '3', '--no-ocr']);

      // assert
      assert.notEqual(result.code, 0);
      assert.match(result.plain, /Quote pages summary\n1 passed \(0 both declined\), 2 failed\.\n/);
      const saved = await readFailed(directory);
      assert.deepEqual(
        saved.failed.map(({ policyDetailsId }) => policyDetailsId),
        [policyC, policyA]
      );
    });
  });

  test('--no-fetch runs with the saved MRP files without trying to fetch the missing ones', async () => {
    await withServer(quoteJourneyHandler([]), async (base) => {
      // arrange
      const { directory, env } = await fixture(base, { [`${policyB}-1`]: 'guid-b' });
      await writeFile(env.QUOTE_GUID_LIST_PATH, `${policyA}\n${policyB}\n`);

      // act
      const result = await run(directory, env, ['quote-pages', '--no-fetch', '--no-ocr']);

      // assert
      assert.notEqual(result.code, 0);
      assert.match(result.plain, /1 of 2 policies have no MRP file and will fail; not fetching \(--no-fetch\)\./);
      assert.doesNotMatch(result.plain, /not the mrp-and-quote project/);
      assert.match(result.plain, /Quote pages summary\n1 passed \(0 both declined\), 1 failed\.\n/);
      assert.match(result.plain, new RegExp(`\n${policyA}-1\n  No saved MRP for this quote`));
    });
  });

  test('without --no-fetch, tries to fetch the missing MRP files', async () => {
    // arrange
    const { directory, env } = await fixture('http://127.0.0.1:1', {});
    await writeFile(env.QUOTE_GUID_LIST_PATH, `${policyA}\n`);

    // act
    const result = await run(directory, env, ['quote-pages', '--no-ocr']);

    // assert
    assert.match(
      result.plain,
      /MRP files missing, but .* is not the mrp-and-quote project \(no go\.mod\); not fetching\./
    );
    assert.doesNotMatch(result.plain, /--no-fetch/);
  });

  test('reports a missing QUOTE_GUID_LIST_PATH', async () => {
    // arrange
    const { directory, env } = await fixture('http://127.0.0.1:1');
    delete env.QUOTE_GUID_LIST_PATH;

    // act
    const result = await run(directory, env, ['quote-pages']);

    // assert
    assert.notEqual(result.code, 0);
    assert.match(result.output, /QUOTE_GUID_LIST_PATH must be configured/);
  });
});
