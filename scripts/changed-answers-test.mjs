import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, test } from 'node:test';
import { collectChangedAnswers, countChangedQuestions } from '../dist/changed-answers.js';

const script = resolve('dist/main.js');
const firstPolicy = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const secondPolicy = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const coverStartOnlyPolicy = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const unchangedPolicy = 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';

const rebuildingCost = {
  question: 'rebuilding cost',
  before: null,
  after: '249995',
  error: 'Enter the cost of rebuilding the property'
};
const claimValue = {
  question: 'claim value',
  before: '0',
  after: '55782',
  error: 'Must be between £1 and £10,000,000.'
};
const coverStart = {
  question: 'cover start',
  before: '28 Sep 2026',
  after: '13 Oct 2026',
  error: 'The Cover start field needs to be between 2026-10-13 and 2026-11-27'
};

/** Temp folders made by `comparisonsFixture`, which the tests still read, removed once they have all run. */
const fixtureDirectories = [];
after(() => Promise.all(fixtureDirectories.map((directory) => rm(directory, { recursive: true, force: true }))));

async function writeAnswerChangesFile(root, policyDetailsId, changes) {
  await mkdir(join(root, `${policyDetailsId}-1`), { recursive: true });
  await writeFile(
    join(root, `${policyDetailsId}-1`, 'answer-changes.json'),
    JSON.stringify({ policyDetailsId, historyId: 1, changes })
  );
}

/** A comparisons folder with two changed policies, one changing only the cover start, one unchanged and an OCR cache. */
async function comparisonsFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'changed-answers-'));
  fixtureDirectories.push(directory);
  const root = join(directory, 'comparisons');
  await writeAnswerChangesFile(root, firstPolicy, {
    nhi: { 'Property circumstances': [rebuildingCost], 'Household details': [claimValue, claimValue] },
    tcas: { 'Cover details': [coverStart] }
  });
  await writeAnswerChangesFile(root, secondPolicy, {
    tcas: { 'Cover details': [coverStart], 'Property circumstances': [rebuildingCost] }
  });
  await writeAnswerChangesFile(root, coverStartOnlyPolicy, { nhi: { 'Cover details': [coverStart] } });
  await mkdir(join(root, `${unchangedPolicy}-1`), { recursive: true });
  await mkdir(join(root, '.ocr-cache'), { recursive: true });
  return { directory, root };
}

async function runCli(directory, args) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: directory,
    env: { ...process.env, DIFF_OUTPUT_DIR: directory }
  });
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

describe('changed answers', () => {
  test('combines each policy’s changes by folder name, without the cover start', async () => {
    // arrange
    const { root } = await comparisonsFixture();

    // act
    const changedAnswers = await collectChangedAnswers(root);

    // assert
    assert.deepEqual(changedAnswers, {
      [`${firstPolicy}-1`]: {
        nhi: { 'Property circumstances': [rebuildingCost], 'Household details': [claimValue, claimValue] }
      },
      [`${secondPolicy}-1`]: { tcas: { 'Property circumstances': [rebuildingCost] } }
    });
  });

  test('leaves out a policy that changed only the cover start', async () => {
    // arrange
    const { root } = await comparisonsFixture();

    // act
    const changedAnswers = await collectChangedAnswers(root);

    // assert
    assert.equal(`${coverStartOnlyPolicy}-1` in changedAnswers, false);
  });

  test('skips folders without answer changes and folders that are not policies', async () => {
    // arrange
    const { root } = await comparisonsFixture();

    // act
    const changedAnswers = await collectChangedAnswers(root);

    // assert
    assert.deepEqual(Object.keys(changedAnswers), [`${firstPolicy}-1`, `${secondPolicy}-1`]);
  });

  test('finds nothing when the comparisons folder does not exist', async (context) => {
    // arrange
    const directory = await mkdtemp(join(tmpdir(), 'changed-answers-'));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const root = join(directory, 'missing');

    // act
    const changedAnswers = await collectChangedAnswers(root);

    // assert
    assert.deepEqual(changedAnswers, {});
  });

  test('counts each question by flow and section, most changed first', async () => {
    // arrange
    const { root } = await comparisonsFixture();

    // act
    const counts = countChangedQuestions(await collectChangedAnswers(root));

    // assert
    assert.deepEqual(counts, [
      { flow: 'nhi', section: 'Household details', question: 'claim value', count: 2 },
      { flow: 'nhi', section: 'Property circumstances', question: 'rebuilding cost', count: 1 },
      { flow: 'tcas', section: 'Property circumstances', question: 'rebuilding cost', count: 1 }
    ]);
  });
});

describe('summarise changed-answers command', () => {
  test('saves the combined changes to changed-answers.json in the output folder', async () => {
    // arrange
    const { directory, root } = await comparisonsFixture();

    // act
    const { code, output } = await runCli(directory, ['summarise', 'changed-answers']);

    // assert
    assert.equal(code, 0, output);
    const saved = JSON.parse(await readFile(join(directory, 'changed-answers.json'), 'utf8'));
    assert.deepEqual(saved, await collectChangedAnswers(root));
    assert.ok(output.includes(`Saved to ${join(directory, 'changed-answers.json')}`), output);
  });

  test('prints the count of each changed question and the totals', async () => {
    // arrange
    const { directory } = await comparisonsFixture();

    // act
    const { code, output } = await runCli(directory, ['summarise', 'changed-answers']);

    // assert
    assert.equal(code, 0, output);
    assert.match(output, /Changed answers \(.+comparisons; cover start ignored\)\n/);
    assert.match(output, /\n {2}2× NHI {3}Household details {7}claim value\n/);
    assert.match(output, /\n {2}1× NHI {3}Property circumstances {2}rebuilding cost\n/);
    assert.match(output, /\n {2}1× TCAS {2}Property circumstances {2}rebuilding cost\n/);
    assert.match(output, /Totals\n2 policies with changes, 4 changes\.\n/);
    assert.doesNotMatch(output, /cover start\n/);
  });
});
