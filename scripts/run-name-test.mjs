import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import {
  checkFeatureHost,
  checkRunEnvironment,
  readRunEnvironment,
  runFolder,
  validateRunName
} from '../dist/run-name.js';

describe('validateRunName', () => {
  for (const name of ['temp2', 'my run', 'Run_2026-11-20', 'a.b', 'Ünïcödé', 'con2', 'devs', `${'a'.repeat(255)}`]) {
    test(`accepts ${JSON.stringify(name.length > 20 ? `${name.slice(0, 10)}… (${name.length})` : name)}`, () => {
      // act
      const validated = validateRunName(name);

      // assert
      assert.equal(validated, name);
    });
  }

  for (const [name, runName, reason] of [
    ['an empty name', '', /is not a folder name/],
    ['"."', '.', /is not a folder name/],
    ['".."', '..', /is not a folder name/],
    ...['<', '>', ':', '"', '/', '\\', '|', '?', '*'].map((character) => [
      `a name with ${character}`,
      `run${character}2`,
      /contains a character Windows or Linux does not allow/
    ]),
    ['a name with a tab', 'run\t2', /contains a control character/],
    ['a name with a NUL character', 'run\u00002', /contains a control character/],
    ['a name ending with a space', 'run ', /ends with a space or a dot/],
    ['a name ending with a dot', 'run.', /ends with a space or a dot/],
    ...['CON', 'prn', 'Aux', 'nul', 'COM1', 'lpt9', 'nul.txt', 'com1.tar.gz'].map((reserved) => [
      `the reserved name ${reserved}`,
      reserved,
      /is a name Windows reserves for a device/
    ]),
    ['a name over 255 UTF-8 bytes', 'é'.repeat(128), /is longer than 255 bytes/],
    ...['dev', 'TST', 'Stg'].map((environment) => [
      `the environment name ${environment}`,
      environment,
      /is an environment name/
    ]),
    ...['mrp-and-quote', 'MRP-and-Quote'].map((folder) => [
      `the MRP folder name ${folder}`,
      folder,
      /is the MRP files' folder name/
    ])
  ]) {
    test(`rejects ${name}`, () => {
      // act and assert
      assert.throws(() => validateRunName(runName), reason);
    });
  }
});

describe('runFolder', () => {
  for (const [name, environment, runName, expected] of [
    ['uses the run name when one is given', 'dev', 'temp2', resolve('D:/out/temp2')],
    ["uses the environment's folder without a run name", 'tst', undefined, resolve('D:/out/tst')],
    ["uses the environment's folder for a blank run name", 'dev', '', resolve('D:/out/dev')],
    ['keeps the run name as given', 'dev', 'My Run', resolve('D:/out/My Run')]
  ]) {
    test(name, () => {
      // act
      const folder = runFolder('D:/out', environment, runName);

      // assert
      assert.equal(folder, expected);
    });
  }

  test('rejects an invalid run name', () => {
    // act and assert
    assert.throws(() => runFolder('D:/out', 'dev', '../elsewhere'), /contains a character/);
  });
});

describe('checkRunEnvironment', () => {
  async function runDirectory(context) {
    const directory = await mkdtemp(join(tmpdir(), 'run-name-test-'));
    context.after(() => rm(directory, { recursive: true, force: true }));
    return join(directory, 'temp2');
  }

  test('records the environment on first use, creating the run folder', async (context) => {
    // arrange
    const folder = await runDirectory(context);

    // act
    await checkRunEnvironment(folder, 'DEV', true);

    // assert
    assert.deepEqual(JSON.parse(await readFile(join(folder, 'run.json'), 'utf8')), { environment: 'dev' });
  });

  test('accepts a later run with the same environment', async (context) => {
    // arrange
    const folder = await runDirectory(context);
    await checkRunEnvironment(folder, 'dev', true);

    // act
    const checking = checkRunEnvironment(folder, 'dev', true);

    // assert
    await assert.doesNotReject(checking);
  });

  test('refuses a run with another environment, as its replacement quote GUIDs only exist in the first', async (context) => {
    // arrange
    const folder = await runDirectory(context);
    await checkRunEnvironment(folder, 'dev', true);

    // act
    const checking = checkRunEnvironment(folder, 'tst', true);

    // assert
    await assert.rejects(checking, /was made with dev, not tst/);
  });

  test('records nothing when not recording, as for a dry run', async (context) => {
    // arrange
    const folder = await runDirectory(context);

    // act
    await checkRunEnvironment(folder, 'dev', false);

    // assert
    await assert.rejects(readFile(join(folder, 'run.json'), 'utf8'), { code: 'ENOENT' });
  });

  test('checks nothing without an environment', async (context) => {
    // arrange
    const folder = await runDirectory(context);
    await checkRunEnvironment(folder, 'dev', true);
    await writeFile(join(folder, 'other.txt'), '');

    // act
    const checking = checkRunEnvironment(folder, undefined, true);

    // assert
    await assert.doesNotReject(checking);
  });
});

describe('readRunEnvironment', () => {
  test('reads the environment a run file records, or nothing without one', async (context) => {
    // arrange
    const folder = await mkdtemp(join(tmpdir(), 'run-name-read-'));
    context.after(() => rm(folder, { recursive: true, force: true }));
    const before = await readRunEnvironment(folder);
    await writeFile(join(folder, 'run.json'), JSON.stringify({ environment: 'tst' }));

    // act
    const after = await readRunEnvironment(folder);

    // assert
    assert.equal(before, undefined);
    assert.equal(after, 'tst');
  });
});

describe('checkFeatureHost', () => {
  for (const [name, host, environment] of [
    ['a feature host on dev', 'quotes-feature-dev.homeprotect.co.uk', 'dev'],
    ['a feature host on tst', 'quotes-feature-tst.homeprotect.co.uk', 'TST'],
    ['a main host on stg', 'quotes-stg.homeprotect.co.uk', 'stg'],
    ['no host', undefined, 'stg'],
    ['no environment', 'quotes-feature-stg.homeprotect.co.uk', undefined],
    ['a host with "feature" inside a word', 'quotes-features.example', 'stg']
  ]) {
    test(`accepts ${name}`, () => {
      // act and assert
      assert.doesNotThrow(() => checkFeatureHost(host, environment));
    });
  }

  test('refuses a feature host on stg, as feature builds only reach dev and tst', () => {
    // act and assert
    assert.throws(
      () => checkFeatureHost('quotes-feature-stg.homeprotect.co.uk', 'stg'),
      /feature builds only reach dev and tst, not stg/
    );
  });
});
