import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { readQuoteResult, writeQuoteResult } from '../dist/quote-result.js';
import {
  collectGuidListStatus,
  collectQuoteResults,
  countFailureReasons,
  countOopsPages,
  countTextChanges,
  listDifferentPolicies,
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

/** A project folder with one policy of each kind, an OCR cache, a run-<timestamp> report and Oops pages. */
async function projectFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'summarise-'));
  const comparisons = join(directory, 'comparisons');
  await writeReport(comparisons, `${identicalPolicy}-1`);
  await writeReport(comparisons, `${textPolicy}-1`, {
    changedPixels: 30,
    regions: [
      region(1, 'PAY ANNUALLY\n\n£137.63\n\na year', 'PAY ANNUALLY\n\n£137.62\n\na year'),
      region(2, 'frais ved', 'frases ved', [40, 90])
    ]
  });
  await writeReport(comparisons, `${visualPolicy}-1`, { changedPixels: 144, afterHeight: 120 });
  await writeQuoteResult({ ...failedResult(textPolicy, []), outcome: 'compared', validation: false }, comparisons);
  await writeQuoteResult(
    failedResult(failedPolicy, [
      'Quote capture failed; comparison skipped.',
      'NHI: Website displayed <h2>Oops</h2>; stopping the journey. (https://quotes.example/q/1)'
    ]),
    comparisons
  );
  await writeQuoteResult({ ...failedResult(declinedPolicy, []), outcome: 'declined', validation: false }, comparisons);
  await mkdir(join(comparisons, `${unrecordedPolicy}-1`));
  await mkdir(join(comparisons, '.ocr-cache'));
  await writeReport(comparisons, 'run-2026-10-12', { changedPixels: 5 });

  const screenshots = join(directory, 'screenshots');
  await mkdir(screenshots);
  await writeFile(join(screenshots, `${identicalPolicy}-1-nhi-failed.html`), '<body><h2 class="x"> Oops </h2></body>');
  await writeFile(join(screenshots, `${failedPolicy}-1-nhi-failed.html`), '<h2>Oops</h2>');
  await writeFile(join(screenshots, `${failedPolicy}-1-tcas-failed.html`), '<h2>Oops</h2>');
  await writeFile(join(screenshots, `${visualPolicy}-1-tcas-failed.html`), '<h1>Cover details</h1>');
  await writeFile(join(screenshots, `${identicalPolicy}-1-nhi.png`), '');

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
  return { directory, comparisons, screenshots, mrp, guidList };
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
  test('reads back what was written', async () => {
    // arrange
    const root = await mkdtemp(join(tmpdir(), 'quote-result-'));
    const result = failedResult(failedPolicy, ['first', 'second'], true);

    // act
    await writeQuoteResult(result, root);

    // assert
    assert.deepEqual(await readQuoteResult(join(root, `${failedPolicy}-1`)), result);
  });

  test('reads a folder without a result as undefined', async () => {
    // arrange
    const root = await mkdtemp(join(tmpdir(), 'quote-result-'));

    // act
    const result = await readQuoteResult(root);

    // assert
    assert.equal(result, undefined);
  });

  for (const [name, content] of [
    ['an array', []],
    ['a missing startedAt', { ...failedResult(failedPolicy, []), startedAt: undefined }],
    ['an unknown outcome', { ...failedResult(failedPolicy, []), outcome: 'skipped' }],
    ['non-string issues', { ...failedResult(failedPolicy, []), issues: [1] }],
    ['a missing finishedAt', { ...failedResult(failedPolicy, []), finishedAt: undefined }]
  ]) {
    test(`rejects ${name}`, async () => {
      // arrange
      const root = await mkdtemp(join(tmpdir(), 'quote-result-'));
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
    const { comparisons } = await projectFixture();

    // act
    const summary = await collectQuoteResults(comparisons);

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
    const { comparisons } = await projectFixture();

    // act
    const summary = await collectQuoteResults(comparisons);

    // assert
    const policy = summary.compared.find(({ name }) => name === `${textPolicy}-1`);
    assert.deepEqual(policy.textDifferences, [
      { regionId: 1, removed: ['£137.63'], added: ['£137.62'], lowConfidence: false },
      { regionId: 2, removed: ['frais ved'], added: ['frases ved'], lowConfidence: true }
    ]);
  });

  test('does not flag a side with no text, such as a region below the end of the shorter page', async () => {
    // arrange
    const root = await mkdtemp(join(tmpdir(), 'summarise-'));
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

  test('flags a side whose text has no OCR confidence', async () => {
    // arrange
    const root = await mkdtemp(join(tmpdir(), 'summarise-'));
    await writeReport(root, `${textPolicy}-1`, { changedPixels: 10, regions: [region(1, 'Old', 'New', [null, 90])] });

    // act
    const summary = await collectQuoteResults(root);

    // assert
    assert.equal(summary.compared[0].textDifferences[0].lowConfidence, true);
  });

  test('reports a difference in page size', async () => {
    // arrange
    const { comparisons } = await projectFixture();

    // act
    const summary = await collectQuoteResults(comparisons);

    // assert
    const policy = summary.compared.find(({ name }) => name === `${visualPolicy}-1`);
    assert.equal(policy.sizeDifference, '1440×100 vs 1440×120');
    assert.deepEqual(policy.textDifferences, []);
  });

  test('returns nothing for a missing folder', async () => {
    // arrange
    const root = join(await mkdtemp(join(tmpdir(), 'summarise-')), 'missing');

    // act
    const summary = await collectQuoteResults(root);

    // assert
    assert.deepEqual([summary.compared, summary.declined, summary.failed, summary.unrecorded], [[], [], [], []]);
  });
});

describe('countOopsPages', () => {
  test('counts Oops failure pages per flow and those whose policy later compared', async () => {
    // arrange
    const { comparisons, screenshots } = await projectFixture();
    const summary = await collectQuoteResults(comparisons);

    // act
    const counts = await countOopsPages(screenshots, summary);

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
    const { comparisons, screenshots } = await projectFixture();
    const stale = new Date('1999-12-31T00:00:00.000Z');
    await utimes(join(screenshots, `${failedPolicy}-1-tcas-failed.html`), stale, stale);
    const summary = await collectQuoteResults(comparisons);

    // act
    const counts = await countOopsPages(screenshots, summary);

    // assert
    assert.deepEqual(counts, [
      { flow: 'NHI', total: 2, recovered: 1 },
      { flow: 'TCAS', total: 0, recovered: 0 }
    ]);
  });

  test('counts an old Oops page when the policy has no recorded run', async () => {
    // arrange
    const { comparisons, screenshots } = await projectFixture();
    const stale = new Date('1999-12-31T00:00:00.000Z');
    await utimes(join(screenshots, `${identicalPolicy}-1-nhi-failed.html`), stale, stale);
    const summary = await collectQuoteResults(comparisons);

    // act
    const counts = await countOopsPages(screenshots, summary);

    // assert
    assert.deepEqual(counts[0], { flow: 'NHI', total: 2, recovered: 1 });
  });
});

describe('listDifferentPolicies', () => {
  test('lists only compared policies with changed pixels, skipping identical, declined, failed and unrecorded ones', async () => {
    // arrange
    const { comparisons } = await projectFixture();
    const summary = await collectQuoteResults(comparisons);

    // act
    const different = listDifferentPolicies(summary);

    // assert
    assert.deepEqual(different, [
      { policyDetailsId: textPolicy, historyId: 1 },
      { policyDetailsId: visualPolicy, historyId: 1 }
    ]);
  });

  test('takes the history ID from the folder name', async () => {
    // arrange
    const root = await mkdtemp(join(tmpdir(), 'summarise-'));
    await writeReport(root, `${textPolicy}-42`, { changedPixels: 1 });
    const summary = await collectQuoteResults(root);

    // act
    const different = listDifferentPolicies(summary);

    // assert
    assert.deepEqual(different, [{ policyDetailsId: textPolicy, historyId: 42 }]);
  });
});

describe('collectGuidListStatus', () => {
  test('counts the list, the policies not run and the MRP records not retrieved', async () => {
    // arrange
    const { comparisons, mrp, guidList } = await projectFixture();
    const summary = await collectQuoteResults(comparisons);

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
        /6 policies: 3 compared \(1 identical, 2 different, 1 with text changes\), 1 both declined, 1 failed, 1 without a result\./
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

  test('different prints only the differences and how many compared policies differ', async () => {
    // arrange
    const { directory, mrp, guidList } = await projectFixture();

    // act
    const { code, output } = await runCli(directory, ['summarise', 'different'], {
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

  test('different leaves out failures, MRP records, the GUID list and Oops pages', async () => {
    // arrange
    const { directory, mrp, guidList } = await projectFixture();

    // act
    const { code, output } = await runCli(directory, ['summarise', 'different'], {
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

  test('different labels each policy with its full comparisons folder path', async () => {
    // arrange
    const { directory } = await projectFixture();

    // act
    const { code, output } = await runCli(directory, ['summarise', 'different']);

    // assert
    assert.equal(code, 0, output);
    const [, root] = /Different quote results \((.+)\)\n/.exec(output) ?? [];
    assert.ok(root?.endsWith('comparisons'), output);
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
    assert.match(output, /Usage: npm run summarise/);
  });

  test('shows help', async () => {
    // arrange
    const directory = await mkdtemp(join(tmpdir(), 'summarise-'));

    // act
    const { code, output } = await runCli(directory, ['summarise', '--help']);

    // assert
    assert.equal(code, 0, output);
    assert.match(output, /Usage: npm run summarise/);
  });
});
