import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, test } from 'node:test';
import { readQuoteResult, writeQuoteResult } from '../dist/quote-result.js';
import {
  collectGuidListStatus,
  collectQuoteResults,
  countFailureReasons,
  countOopsPages,
  countTextChanges,
  listDifferentPolicies,
  listPoliciesToRecompare,
  listPoliciesToRetryFailed,
  normaliseIssue
} from '../dist/summarise.js';

const script = resolve('dist/main.js');
const identicalPolicy = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const textPolicy = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const failedPolicy = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const declinedPolicy = 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
const visualPolicy = 'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE';
const unrecordedPolicy = 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF';
const notRunPolicy = '11111111111111111111111111111111';

function failedResult(policyDetailsId, issues, validation = false) {
  return {
    policyDetailsId,
    historyId: 1,
    outcome: 'failed',
    validation,
    issues,
    startedAt: '2000-01-01T00:00:00.000Z',
    finishedAt: '2000-01-01T00:01:00.000Z'
  };
}

function region(id, before, after, confidence = [90, 90]) {
  return {
    id,
    bounds: { left: 0, top: 0, width: 10, height: 10 },
    before: { text: before, confidence: confidence[0], image: `region-${id}-before.png` },
    after: { text: after, confidence: confidence[1], image: `region-${id}-after.png` },
    textChanges: before === after ? [] : [{ type: 'removed', text: before }],
    assessment: ''
  };
}

async function writeReport(root, name, { changedPixels = 0, afterHeight = 100, regions = [] } = {}) {
  await mkdir(join(root, name), { recursive: true });
  await writeFile(
    join(root, name, 'report.json'),
    JSON.stringify({
      before: 'before.png',
      after: 'after.png',
      dimensions: { before: { width: 1440, height: 100 }, after: { width: 1440, height: afterHeight } },
      threshold: 20,
      changedPixels,
      changedPercent: changedPixels / 1440,
      ocrEnabled: true,
      language: 'eng',
      regions
    })
  );
}

/** Temp folders made by `projectFixture`, which the tests still read, removed once they have all run. */
const fixtureDirectories = [];
after(() => Promise.all(fixtureDirectories.map((directory) => rm(directory, { recursive: true, force: true }))));

/**
 * A project folder (also the output folder) with one policy of each kind, an OCR cache, a standalone comparison
 * report and Oops pages.
 */
async function projectFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'summarise-'));
  fixtureDirectories.push(directory);
  const root = directory;
  await writeReport(root, `${identicalPolicy}-1`);
  await writeReport(root, `${textPolicy}-1`, {
    changedPixels: 30,
    regions: [
      region(1, 'PAY ANNUALLY\n\n£137.63\n\na year', 'PAY ANNUALLY\n\n£137.62\n\na year'),
      region(2, 'frais ved', 'frases ved', [40, 90])
    ]
  });
  await writeReport(root, `${visualPolicy}-1`, { changedPixels: 144, afterHeight: 120 });
  await writeQuoteResult({ ...failedResult(textPolicy, []), outcome: 'compared', validation: false }, root);
  await writeQuoteResult(
    failedResult(failedPolicy, [
      'Quote capture failed; comparison skipped.',
      'NHI: Website displayed <h2>Oops</h2>; stopping the journey. (https://quotes.example/q/1)'
    ]),
    root
  );
  await writeQuoteResult({ ...failedResult(declinedPolicy, []), outcome: 'declined', validation: false }, root);
  await mkdir(join(root, `${unrecordedPolicy}-1`));
  await mkdir(join(root, '.ocr-cache'));
  await writeReport(join(root, 'comparisons'), 'run-2026-10-12', { changedPixels: 5 });

  await writeFile(join(root, `${identicalPolicy}-1`, 'nhi-failed.html'), '<body><h2 class="x"> Oops </h2></body>');
  await writeFile(join(root, `${failedPolicy}-1`, 'nhi-failed.html'), '<h2>Oops</h2>');
  await writeFile(join(root, `${failedPolicy}-1`, 'tcas-failed.html'), '<h2>Oops</h2>');
  await writeFile(join(root, `${visualPolicy}-1`, 'tcas-failed.html'), '<h1>Cover details</h1>');
  await writeFile(join(root, `${identicalPolicy}-1`, 'nhi.png'), '');

  const mrp = join(directory, 'mrp');
  await mkdir(mrp);
  for (const policy of [identicalPolicy, textPolicy, visualPolicy, declinedPolicy, unrecordedPolicy]) {
    await writeFile(join(mrp, `${policy}-1-mrp.json`), '{}');
  }

  const guidList = join(directory, 'guids.txt');
  await writeFile(
    guidList,
    [identicalPolicy, textPolicy, failedPolicy, declinedPolicy, visualPolicy, unrecordedPolicy, notRunPolicy, '']
      .map((guid) => guid.toLowerCase())
      .join('\n')
  );
  return { directory, root, mrp, guidList };
}

async function runCli(directory, args, env = {}) {
  const childEnv = { ...process.env, ...env };
  for (const name of ['QUOTE_GUID_LIST_PATH', 'MRP_AND_QUOTE_OUTPUT_DIR']) {
    if (!(name in env)) {
      delete childEnv[name];
    }
  }

  const child = spawn(process.execPath, [script, ...args], { cwd: directory, env: childEnv });
  let output = '';
  child.stdout.on('data', (data) => (output += data));
  child.stderr.on('data', (data) => (output += data));
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  // eslint-disable-next-line no-control-regex
  return { code, output: output.replace(/\u001b\[\d+m/g, '') };
}

describe('quote result file', () => {
  test('reads back what was written', async (context) => {
    // arrange
    const root = await mkdtemp(join(tmpdir(), 'quote-result-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const result = failedResult(failedPolicy, ['first', 'second'], true);

    // act
    await writeQuoteResult(result, root);

    // assert
    assert.deepEqual(await readQuoteResult(join(root, `${failedPolicy}-1`)), result);
  });

  test('reads back the endorsement order', async (context) => {
    // arrange
    const root = await mkdtemp(join(tmpdir(), 'quote-result-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const result = {
      ...failedResult(textPolicy, []),
      outcome: 'compared',
      endorsementOrder: { nhi: ['Bike', 'Unoccupancy'], tcas: ['Unoccupancy', 'Bike'] }
    };

    // act
    await writeQuoteResult(result, root);

    // assert
    assert.deepEqual(await readQuoteResult(join(root, `${textPolicy}-1`)), result);
  });

  test('reads a folder without a result as undefined', async (context) => {
    // arrange
    const root = await mkdtemp(join(tmpdir(), 'quote-result-'));
    context.after(() => rm(root, { recursive: true, force: true }));

    // act
    const result = await readQuoteResult(root);

    // assert
    assert.equal(result, undefined);
  });

  test('rejects a result cut short, naming the file', async (context) => {
    // arrange
    const root = await mkdtemp(join(tmpdir(), 'quote-result-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const path = join(root, 'result.json');
    await writeFile(path, '{"policyDetailsId": "ABC", "histo');

    // act
    const read = readQuoteResult(root);

    // assert
    await assert.rejects(read, (error) => {
      assert.ok(error.message.startsWith(`${path} is not valid JSON: `), error.message);
      return true;
    });
  });

  for (const [name, content] of [
    ['an array', []],
    ['a missing startedAt', { ...failedResult(failedPolicy, []), startedAt: undefined }],
    ['an unknown outcome', { ...failedResult(failedPolicy, []), outcome: 'skipped' }],
    ['non-string issues', { ...failedResult(failedPolicy, []), issues: [1] }],
    ['a missing finishedAt', { ...failedResult(failedPolicy, []), finishedAt: undefined }],
    ['an endorsement order without TCAS', { ...failedResult(failedPolicy, []), endorsementOrder: { nhi: ['Bike'] } }],
    ['non-string endorsement titles', { ...failedResult(failedPolicy, []), endorsementOrder: { nhi: [1], tcas: [] } }]
  ]) {
    test(`rejects ${name}`, async (context) => {
      // arrange
      const root = await mkdtemp(join(tmpdir(), 'quote-result-'));
      context.after(() => rm(root, { recursive: true, force: true }));
      await writeFile(join(root, 'result.json'), JSON.stringify(content));

      // act
      const read = () => readQuoteResult(root);

      // assert
      await assert.rejects(read, /Quote result must be/);
    });
  }
});

describe('normaliseIssue', () => {
  for (const [name, issue, expected] of [
    [
      'a URL in parentheses',
      'NHI: Website displayed <h2>Oops</h2>. (https://a.example/q?x=1)',
      'NHI: Website displayed <h2>Oops</h2>.'
    ],
    ['a bare URL', 'TCAS: opening https://a.example/q failed', 'TCAS: opening <url> failed'],
    [
      'a Windows path',
      'No saved MRP for this quote: D:\\work\\output\\ABC-1-mrp.json',
      'No saved MRP for this quote: <path>'
    ],
    ['a POSIX path', 'No saved MRP for this quote: /work/output/ABC-1-mrp.json', 'No saved MRP for this quote: <path>'],
    ['a policy ID', `Policy ${failedPolicy.toLowerCase()} failed`, 'Policy <id> failed'],
    ['a dashed GUID', 'GUID 6819e30c-2058-490b-8d1d-9e25d267b002 expired', 'GUID <id> expired'],
    [
      'no date format',
      'NHI cover details errors: Enter a date in DD/MM/YYYY format',
      'NHI cover details errors: Enter a date in DD/MM/YYYY format'
    ],
    ['no numeric date', 'Cover must start after 01/01/2020', 'Cover must start after 01/01/2020'],
    ['no slash-separated words', 'Select yes/no/unsure', 'Select yes/no/unsure'],
    ['plain text', 'Please select an option.', 'Please select an option.']
  ]) {
    test(`replaces ${name}`, () => {
      // arrange
      // act
      const normalised = normaliseIssue(issue);

      // assert
      assert.equal(normalised, expected);
    });
  }
});

describe('countFailureReasons', () => {
  test('groups reasons across policies, skipping the capture-failed heading', () => {
    // arrange
    const failed = [
      failedResult(failedPolicy, ['Quote capture failed; comparison skipped.', 'NHI: Oops (https://a.example/1)']),
      failedResult(textPolicy, ['Quote capture failed; comparison skipped.', 'NHI: Oops (https://a.example/2)']),
      failedResult(visualPolicy, ['NHI cover details errors: Enter a date'], true)
    ];

    // act
    const reasons = countFailureReasons(failed);

    // assert
    assert.deepEqual(reasons, [
      { reason: 'NHI: Oops', count: 2, validation: false },
      { reason: 'NHI cover details errors: Enter a date', count: 1, validation: true }
    ]);
  });

  test('counts a reason once per policy', () => {
    // arrange
    const failed = [failedResult(failedPolicy, ['Error (https://a.example/1)', 'Error (https://a.example/2)'])];

    // act
    const reasons = countFailureReasons(failed);

    // assert
    assert.deepEqual(reasons, [{ reason: 'Error', count: 1, validation: false }]);
  });
});

describe('countTextChanges', () => {
  test('groups changes by the lines removed and added, most common first', () => {
    // arrange
    const policy = (name, differences) => ({ name, changedPixels: 1, changedPercent: 0, textDifferences: differences });
    const price = { regionId: 1, removed: ['£137.63'], added: ['£137.62'], lowConfidence: false };
    const compared = [
      policy('a', [price]),
      policy('b', [price, { regionId: 2, removed: [], added: ['New line'], lowConfidence: false }])
    ];

    // act
    const changes = countTextChanges(compared);

    // assert
    assert.deepEqual(changes, [
      { change: '£137.63 → £137.62', count: 2 },
      { change: '(nothing) → New line', count: 1 }
    ]);
  });
});

describe('collectQuoteResults', () => {
  test('sorts policy folders by outcome and skips other folders', async () => {
    // arrange
    const { root } = await projectFixture();

    // act
    const summary = await collectQuoteResults(root);

    // assert
    assert.deepEqual(
      summary.compared.map(({ name }) => name),
      [`${identicalPolicy}-1`, `${textPolicy}-1`, `${visualPolicy}-1`]
    );
    assert.deepEqual(summary.declined, [`${declinedPolicy}-1`]);
    assert.deepEqual(
      summary.failed.map(({ name }) => name),
      [`${failedPolicy}-1`]
    );
    assert.deepEqual(summary.unrecorded, [`${unrecordedPolicy}-1`]);
  });

  test('reduces text changes to the changed lines and flags low OCR confidence', async () => {
    // arrange
    const { root } = await projectFixture();

    // act
    const summary = await collectQuoteResults(root);

    // assert
    const policy = summary.compared.find(({ name }) => name === `${textPolicy}-1`);
    assert.deepEqual(policy.textDifferences, [
      { regionId: 1, removed: ['£137.63'], added: ['£137.62'], lowConfidence: false },
      { regionId: 2, removed: ['frais ved'], added: ['frases ved'], lowConfidence: true }
    ]);
  });

  test('does not flag a side with no text, such as a region below the end of the shorter page', async (context) => {
    // arrange
    const root = await mkdtemp(join(tmpdir(), 'summarise-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    await writeReport(root, `${textPolicy}-1`, {
      changedPixels: 10,
      afterHeight: 120,
      regions: [region(1, '', 'Added block', [null, 90])]
    });

    // act
    const summary = await collectQuoteResults(root);

    // assert
    assert.deepEqual(summary.compared[0].textDifferences, [
      { regionId: 1, removed: [], added: ['Added block'], lowConfidence: false }
    ]);
  });

  test('flags a side whose text has no OCR confidence', async (context) => {
    // arrange
    const root = await mkdtemp(join(tmpdir(), 'summarise-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    await writeReport(root, `${textPolicy}-1`, { changedPixels: 10, regions: [region(1, 'Old', 'New', [null, 90])] });

    // act
    const summary = await collectQuoteResults(root);

    // assert
    assert.equal(summary.compared[0].textDifferences[0].lowConfidence, true);
  });

  test('reports a difference in page size', async () => {
    // arrange
    const { root } = await projectFixture();

    // act
    const summary = await collectQuoteResults(root);

    // assert
    const policy = summary.compared.find(({ name }) => name === `${visualPolicy}-1`);
    assert.equal(policy.sizeDifference, '1440×100 vs 1440×120');
    assert.deepEqual(policy.textDifferences, []);
  });

  test('marks a policy whose endorsements were listed in different orders', async () => {
    // arrange
    const { root } = await projectFixture();
    await writeQuoteResult(
      {
        ...failedResult(identicalPolicy, []),
        outcome: 'compared',
        endorsementOrder: { nhi: ['Bike', 'Unoccupancy'], tcas: ['Unoccupancy', 'Bike'] }
      },
      root
    );

    // act
    const summary = await collectQuoteResults(root);

    // assert
    const marked = summary.compared.filter((policy) => policy.endorsementOrderDiffers).map(({ name }) => name);
    assert.deepEqual(marked, [`${identicalPolicy}-1`]);
  });

  test('returns nothing for a missing folder', async (context) => {
    // arrange
    const directory = await mkdtemp(join(tmpdir(), 'summarise-'));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const root = join(directory, 'missing');

    // act
    const summary = await collectQuoteResults(root);

    // assert
    assert.deepEqual([summary.compared, summary.declined, summary.failed, summary.unrecorded], [[], [], [], []]);
  });
});

describe('countOopsPages', () => {
  test('counts Oops failure pages per flow and those whose policy later compared', async () => {
    // arrange
    const { root } = await projectFixture();
    const summary = await collectQuoteResults(root);

    // act
    const counts = await countOopsPages(summary);

    // assert
    assert.deepEqual(counts, [
      { flow: 'NHI', total: 2, recovered: 1 },
      { flow: 'TCAS', total: 1, recovered: 0 }
    ]);
  });
});

describe('countOopsPages with earlier runs', () => {
  test("skips an Oops page saved before the policy's last run started", async () => {
    // arrange
    const { root } = await projectFixture();
    const stale = new Date('1999-12-31T00:00:00.000Z');
    await utimes(join(root, `${failedPolicy}-1`, 'tcas-failed.html'), stale, stale);
    const summary = await collectQuoteResults(root);

    // act
    const counts = await countOopsPages(summary);

    // assert
    assert.deepEqual(counts, [
      { flow: 'NHI', total: 2, recovered: 1 },
      { flow: 'TCAS', total: 0, recovered: 0 }
    ]);
  });

  test('counts an old Oops page when the policy has no recorded run', async () => {
    // arrange
    const { root } = await projectFixture();
    const stale = new Date('1999-12-31T00:00:00.000Z');
    await utimes(join(root, `${identicalPolicy}-1`, 'nhi-failed.html'), stale, stale);
    const summary = await collectQuoteResults(root);

    // act
    const counts = await countOopsPages(summary);

    // assert
    assert.deepEqual(counts[0], { flow: 'NHI', total: 2, recovered: 1 });
  });
});

describe('listDifferentPolicies', () => {
  test('lists only compared policies with changed pixels, skipping identical, declined, failed and unrecorded ones', async () => {
    // arrange
    const { root } = await projectFixture();
    const summary = await collectQuoteResults(root);

    // act
    const different = listDifferentPolicies(summary);

    // assert
    assert.deepEqual(different, [
      { policyDetailsId: textPolicy, historyId: 1 },
      { policyDetailsId: visualPolicy, historyId: 1 }
    ]);
  });

  test('takes the history ID from the folder name', async (context) => {
    // arrange
    const root = await mkdtemp(join(tmpdir(), 'summarise-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    await writeReport(root, `${textPolicy}-42`, { changedPixels: 1 });
    const summary = await collectQuoteResults(root);

    // act
    const different = listDifferentPolicies(summary);

    // assert
    assert.deepEqual(different, [{ policyDetailsId: textPolicy, historyId: 42 }]);
  });
});

describe('end points', () => {
  /** Writes a compared policy's report and a result recording where each flow ended. */
  async function writeEndpoints(root, policy, changedPixels, endpoints) {
    await writeReport(root, `${policy}-1`, { changedPixels });
    await writeQuoteResult({ ...failedResult(policy, []), outcome: 'compared', endpoints }, root);
  }

  /** A folder with a matching referral, matching quotes, and flows that ended differently with matching pixels. */
  async function endpointFixture(context) {
    const root = await mkdtemp(join(tmpdir(), 'summarise-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    await writeEndpoints(root, identicalPolicy, 0, { nhi: 'quote', tcas: 'quote' });
    await writeEndpoints(root, textPolicy, 0, { nhi: 'referred', tcas: 'referred' });
    await writeEndpoints(root, visualPolicy, 0, { nhi: 'quote', tcas: 'declined' });
    return root;
  }

  for (const [name, changedPixels, endpoints, kind] of [
    ['two quotes with matching screenshots as identical', 0, { nhi: 'quote', tcas: 'quote' }, 'identical'],
    ['a result saved before end points were recorded as two quotes', 0, undefined, 'identical'],
    ['two referrals with matching screenshots as referred', 0, { nhi: 'referred', tcas: 'referred' }, 'referred'],
    [
      'two conditional quotes with matching screenshots as conditional',
      0,
      { nhi: 'conditional', tcas: 'conditional' },
      'conditional'
    ],
    ['two declines with matching screenshots as declined', 0, { nhi: 'declined', tcas: 'declined' }, 'declined'],
    ['two referrals whose screenshots differ as different', 5, { nhi: 'referred', tcas: 'referred' }, 'different'],
    [
      'flows that ended differently as different, even with matching screenshots',
      0,
      { nhi: 'quote', tcas: 'declined' },
      'different'
    ]
  ]) {
    test(`counts ${name}`, async (context) => {
      // arrange
      const root = await mkdtemp(join(tmpdir(), 'summarise-'));
      context.after(() => rm(root, { recursive: true, force: true }));
      await writeReport(root, `${identicalPolicy}-1`, { changedPixels });
      if (endpoints !== undefined) {
        await writeQuoteResult({ ...failedResult(identicalPolicy, []), outcome: 'compared', endpoints }, root);
      }

      // act
      const summary = await collectQuoteResults(root);

      // assert
      assert.equal(summary.compared[0].kind, kind);
    });
  }

  test('lists flows that ended differently for retry-different, but not a matching referral', async (context) => {
    // arrange
    const root = await endpointFixture(context);
    const summary = await collectQuoteResults(root);

    // act
    const different = listDifferentPolicies(summary);

    // assert
    assert.deepEqual(different, [{ policyDetailsId: visualPolicy, historyId: 1 }]);
  });

  test('summarise lists matching referrals apart and counts them in yellow', async (context) => {
    // arrange
    const root = await endpointFixture(context);

    // act
    const { code, output } = await runCli(root, ['summarise']);

    // assert
    assert.equal(code, 0, output);
    assert.match(
      output,
      /Matching referrals, conditional quotes and declines \(1\)\n {2}B{32}-1 {2}NHI and TCAS both referred\n/
    );
    assert.match(output, /Visual-only differences \(1\)\n {2}E{32}-1 {2}0\.00% changed, NHI quoted, TCAS declined\n/);
    assert.match(
      output,
      /3 policies: 3 compared \(1 identical, 1 different, 1 both referred, 0 with text changes\), 0 failed\./
    );
  });

  test('rejects a result with an unknown end point', async (context) => {
    // arrange
    const root = await mkdtemp(join(tmpdir(), 'summarise-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    await writeQuoteResult(
      { ...failedResult(identicalPolicy, []), outcome: 'compared', endpoints: { nhi: 'quote', tcas: 'maybe' } },
      root
    );

    // act
    const read = readQuoteResult(join(root, `${identicalPolicy}-1`));

    // assert
    await assert.rejects(read, /Quote result must be/);
  });
});

describe('retry selections', () => {
  const referredPolicy = '22222222222222222222222222222222';
  const savedOnlyPolicy = '33333333333333333333333333333333';
  const savedFailedPolicy = '44444444444444444444444444444444';

  /**
   * A folder with one policy of every kind: identical, different (pixels), different (end points), a matching
   * referral, an old both-declined result, a failure also in the failed-policies file, a failure only in its folder,
   * a folder with no result, and a policy only in the file.
   */
  async function everyKindFixture(context) {
    const root = await mkdtemp(join(tmpdir(), 'summarise-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const compared = async (policy, changedPixels, endpoints) => {
      await writeReport(root, `${policy}-1`, { changedPixels });
      await writeQuoteResult({ ...failedResult(policy, []), outcome: 'compared', endpoints }, root);
    };
    await compared(identicalPolicy, 0, { nhi: 'quote', tcas: 'quote' });
    await compared(textPolicy, 12, { nhi: 'quote', tcas: 'quote' });
    await compared(visualPolicy, 0, { nhi: 'referred', tcas: 'quote' });
    await compared(referredPolicy, 0, { nhi: 'referred', tcas: 'referred' });
    await writeQuoteResult({ ...failedResult(declinedPolicy, []), outcome: 'declined' }, root);
    await writeQuoteResult(failedResult(failedPolicy, ['Quote capture failed; comparison skipped.']), root);
    await writeQuoteResult(failedResult(savedFailedPolicy, ['Quote capture failed; comparison skipped.']), root);
    await mkdir(join(root, `${unrecordedPolicy}-1`));
    const saved = {
      historyId: 1,
      failed: [
        { policyDetailsId: savedFailedPolicy, issues: ['earlier'] },
        { policyDetailsId: savedOnlyPolicy, issues: ['earlier'] }
      ]
    };
    return { summary: await collectQuoteResults(root), saved };
  }

  const ids = (policies) => policies.map(({ policyDetailsId, historyId }) => `${policyDetailsId}-${historyId}`);

  test('retry-different reruns the different policies and the old both-declined results', async (context) => {
    // arrange
    const { summary } = await everyKindFixture(context);

    // act
    const policies = listPoliciesToRecompare(summary);

    // assert
    assert.deepEqual(ids(policies), [`${textPolicy}-1`, `${declinedPolicy}-1`, `${visualPolicy}-1`]);
  });

  test('retry-failed reruns failed folders, folders with no result and the saved failures, each once', async (context) => {
    // arrange
    const { summary, saved } = await everyKindFixture(context);

    // act
    const policies = listPoliciesToRetryFailed(summary, saved);

    // assert
    assert.deepEqual(ids(policies), [
      `${savedFailedPolicy}-1`,
      `${failedPolicy}-1`,
      `${unrecordedPolicy}-1`,
      `${savedOnlyPolicy}-1`
    ]);
  });

  test('says why each policy is rerun', async (context) => {
    // arrange
    const { summary, saved } = await everyKindFixture(context);

    // act
    const reasons = [...listPoliciesToRecompare(summary), ...listPoliciesToRetryFailed(summary, saved)].map(
      ({ policyDetailsId, reason }) => `${policyDetailsId.slice(0, 4)} ${reason}`
    );

    // assert
    assert.deepEqual(reasons, [
      'BBBB different: 0.01% changed',
      'DDDD both declined, saved before declines were compared',
      'EEEE different: 0.00% changed, NHI referred, TCAS quoted',
      '4444 failed: no issue recorded',
      'CCCC failed: no issue recorded',
      'FFFF no result: a run stopped part way through it',
      '3333 in the failed-policies file: earlier'
    ]);
  });

  test('retry-failed reruns the failed folders when there is no failed-policies file', async (context) => {
    // arrange
    const { summary } = await everyKindFixture(context);

    // act
    const policies = listPoliciesToRetryFailed(summary);

    // assert
    assert.deepEqual(ids(policies), [`${savedFailedPolicy}-1`, `${failedPolicy}-1`, `${unrecordedPolicy}-1`]);
  });

  test('retry-failed and retry-different together cover every policy that is not identical or a matching end point', async (context) => {
    // arrange
    const { summary, saved } = await everyKindFixture(context);
    const settled = new Set(summary.compared.filter(({ kind }) => kind !== 'different').map(({ name }) => name));
    const everyFolder = [
      ...summary.compared.map(({ name }) => name),
      ...summary.declined,
      ...summary.failed.map(({ name }) => name),
      ...summary.unrecorded
    ];

    // act
    const retried = new Set([
      ...ids(listPoliciesToRecompare(summary)),
      ...ids(listPoliciesToRetryFailed(summary, saved))
    ]);

    // assert
    assert.deepEqual(
      everyFolder.filter((name) => !settled.has(name) && !retried.has(name)),
      []
    );
    assert.deepEqual(
      [...settled].filter((name) => retried.has(name)),
      []
    );
    assert.deepEqual([...settled].sort(), [`${referredPolicy}-1`, `${identicalPolicy}-1`]);
  });
});

describe('collectGuidListStatus', () => {
  test('counts the list, the policies not run and the MRP records not retrieved', async () => {
    // arrange
    const { root, mrp, guidList } = await projectFixture();
    const summary = await collectQuoteResults(root);

    // act
    const status = await collectGuidListStatus(guidList, mrp, summary);

    // assert
    assert.equal(status.total, 7);
    assert.deepEqual(status.withoutResult, [unrecordedPolicy, notRunPolicy]);
    assert.deepEqual(status.missingMrp, [failedPolicy, notRunPolicy]);
  });
});

describe('summarise command', () => {
  for (const action of ['summarise', 'summarize']) {
    test(`${action} prints the differences, failures and totals`, async () => {
      // arrange
      const { directory, mrp, guidList } = await projectFixture();

      // act
      const { code, output } = await runCli(directory, [action], {
        QUOTE_GUID_LIST_PATH: guidList,
        MRP_AND_QUOTE_OUTPUT_DIR: mrp
      });

      // assert
      assert.equal(code, 0, output);
      assert.match(
        output,
        /Visual-only differences \(1\)\n {2}E{32}-1 {2}0\.10% changed, page sizes differ: 1440×100 vs 1440×120/
      );
      assert.match(output, /Region 1\n {4}- £137\.63\n {4}\+ £137\.62/);
      assert.match(output, /Region 2 \(low OCR confidence\)/);
      assert.match(output, /Failed policies \(1\)\nC{32}-1\n {2}Quote capture failed; comparison skipped\./);
      assert.match(output, /Policies without a result: F{32}-1\n/);
      assert.match(
        output,
        /Failures by reason\n {2}1× NHI: Website displayed <h2>Oops<\/h2>; stopping the journey\.\n/
      );
      assert.match(output, /MRP records not retrieved \(2\)\n {2}C{32}\n {2}1{32}\n/);
      assert.match(
        output,
        /GUID list: 7 policies \(.*guids\.txt\); 5 with a result, 2 without; 2 MRP records not retrieved\./
      );
      assert.match(
        output,
        /6 policies: 3 compared \(1 identical, 2 different, 1 with text changes\), 1 both declined before declines were compared \(run them again\), 1 failed, 1 without a result\./
      );
      assert.match(
        output,
        /Oops pages: NHI 2 \(1 later compared or declined\), TCAS 1 \(0 later compared or declined\)\./
      );
    });
  }

  test('skips the GUID list totals when the list is not configured', async () => {
    // arrange
    const { directory } = await projectFixture();

    // act
    const { code, output } = await runCli(directory, ['summarise']);

    // assert
    assert.equal(code, 0, output);
    assert.match(output, /GUID list skipped: QUOTE_GUID_LIST_PATH and MRP_AND_QUOTE_OUTPUT_DIR are not both set\./);
    assert.doesNotMatch(output, /MRP records not retrieved/);
  });

  test('differences prints only the differences and how many compared policies differ', async () => {
    // arrange
    const { directory, mrp, guidList } = await projectFixture();

    // act
    const { code, output } = await runCli(directory, ['summarise', 'differences'], {
      QUOTE_GUID_LIST_PATH: guidList,
      MRP_AND_QUOTE_OUTPUT_DIR: mrp
    });

    // assert
    assert.equal(code, 0, output);
    assert.match(output, /Different quote results \(/);
    assert.match(output, /Visual-only differences \(1\)\n {2}\S+E{32}-1 /);
    assert.match(output, /Text differences \(1\)\n\S+B{32}-1 /);
    assert.match(output, /Totals\n2 different of 3 compared\.\n/);
  });

  test('differences leaves out failures, MRP records, the GUID list and Oops pages', async () => {
    // arrange
    const { directory, mrp, guidList } = await projectFixture();

    // act
    const { code, output } = await runCli(directory, ['summarise', 'differences'], {
      QUOTE_GUID_LIST_PATH: guidList,
      MRP_AND_QUOTE_OUTPUT_DIR: mrp
    });

    // assert
    assert.equal(code, 0, output);
    for (const section of [
      /Failed policies/,
      /Failures by reason/,
      /without a result/,
      /MRP records/,
      /GUID list/,
      /Oops pages/
    ]) {
      assert.doesNotMatch(output, section);
    }
  });

  test('differences labels each policy with its full policy folder path', async () => {
    // arrange
    const { directory } = await projectFixture();

    // act
    const { code, output } = await runCli(directory, ['summarise', 'differences']);

    // assert
    assert.equal(code, 0, output);
    const [, root] = /Different quote results \((.+)\)\n/.exec(output) ?? [];
    assert.match(root ?? '', /summarise-\w+$/, output);
    assert.ok(output.includes(`\n  ${join(root, `${visualPolicy}-1`)}  0.10% changed`), output);
    assert.ok(output.includes(`\n${join(root, `${textPolicy}-1`)}  0.02% changed`), output);
  });

  test('the full summary labels each policy with its folder name', async () => {
    // arrange
    const { directory } = await projectFixture();

    // act
    const { code, output } = await runCli(directory, ['summarise']);

    // assert
    assert.equal(code, 0, output);
    assert.match(output, /\n {2}E{32}-1 {2}0\.10% changed/);
    assert.match(output, /\nB{32}-1 {2}0\.02% changed/);
  });

  test('rejects an unknown argument', async () => {
    // arrange
    const { directory } = await projectFixture();

    // act
    const { code, output } = await runCli(directory, ['summarise', 'identical']);

    // assert
    assert.notEqual(code, 0, output);
    assert.match(output, /Unknown summarise mode "identical" \(expected differences or changed-answers\)/);
    assert.match(output, /Usage: npm run summarise/);
    assert.doesNotMatch(output, /Modes:/);
  });

  test('rejects more than one mode', async () => {
    // arrange
    const { directory } = await projectFixture();

    // act
    const { code, output } = await runCli(directory, ['summarise', 'differences', 'changed-answers']);

    // assert
    assert.notEqual(code, 0, output);
    assert.match(output, /summarise takes at most one mode \(got differences changed-answers\)/);
    assert.doesNotMatch(output, /Modes:/);
  });

  test('shows help', async (context) => {
    // arrange
    const directory = await mkdtemp(join(tmpdir(), 'summarise-'));
    context.after(() => rm(directory, { recursive: true, force: true }));

    // act
    const { code, output } = await runCli(directory, ['summarise', '--help']);

    // assert
    assert.equal(code, 0, output);
    assert.match(output, /Usage: npm run summarise/);
  });
});
