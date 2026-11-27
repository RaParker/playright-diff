import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  createQuoteGuidList,
  formatQuoteGuidList,
  maxConsecutiveMisses,
  parseQueryOutput,
  policyApiCheck,
  selectExistingPolicies,
  sqlcmdArguments
} from '../dist/new-guid-list.js';
import { readQuoteGuidList } from '../dist/quote-guid-list.js';

const policyA = 'ABCDEF1234567890ABCDEF1234567890';
const policyB = '11111111111111111111111111111111';
const policyC = '22222222222222222222222222222222';
const now = new Date('2026-11-27T10:00:00.000Z');

/** Creates a temporary folder removed after the test, and the options for a list in it. */
async function listFixture(context, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'new-guid-list-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return {
    listPath: join(directory, 'testdata', 'quoteGuids-stg.txt'),
    environment: 'stg',
    server: 'stgSQL03.example',
    database: 'NHI_Test',
    policyApiUrlTemplate: 'http://127.0.0.1:1/policy/{policyDetailsId}/1',
    maxCount: 2,
    force: false,
    now,
    ...overrides
  };
}

/** Services that return the given query output and treat the listed policies as found in TCAS. */
function fakeServices(output, found, calls = []) {
  return {
    runSqlcmd: async (args, cwd) => {
      calls.push({ args, cwd });
      return output;
    },
    policyCheck: () => async (policyDetailsId) => found.includes(policyDetailsId),
    log: () => undefined
  };
}

describe('sqlcmdArguments', () => {
  test('uses Windows authentication, bare rows and three candidates per policy wanted', () => {
    // act
    const args = sqlcmdArguments({ server: 'stgSQL03.example', database: 'NHI_Test', maxCount: 50 });

    // assert
    assert.deepEqual(args, [
      ...['-S', 'stgSQL03.example', '-d', 'NHI_Test', '-E', '-b'],
      ...['-l', '30', '-t', '300', '-W', '-h', '-1'],
      ...['-i', 'quote-guids.sql', '-v', 'MaxCount=150']
    ]);
  });
});

describe('parseQueryOutput', () => {
  test('returns upper-case IDs without blanks or duplicates', () => {
    // act
    const ids = parseQueryOutput(`${policyA.toLowerCase()}\r\n\n${policyB}  \n${policyA}\n`);

    // assert
    assert.deepEqual(ids, [policyA, policyB]);
  });

  test('rejects anything but policy IDs, such as a sqlcmd message', () => {
    // act
    const parse = () => parseQueryOutput(`${policyA}\nMsg 207, Level 16: Invalid column name\n`);

    // assert
    assert.throws(parse, /Unexpected sqlcmd output: Msg 207/);
  });
});

describe('formatQuoteGuidList', () => {
  test('starts with a header naming the environment and source', () => {
    // act
    const text = formatQuoteGuidList({ environment: 'tst', server: 'tstSQL03', database: 'NHI_Test', now }, [policyA]);

    // assert
    assert.equal(
      text,
      [
        '# Quote GUID list for tst: TCAS policy details IDs of unpurchased NHI quotes the Policy API found.',
        '# Made 2026-11-27T10:00:00.000Z from tstSQL03/NHI_Test by new-guid-list (sql/quote-guids.sql).',
        '# environment: tst',
        policyA,
        ''
      ].join('\n')
    );
  });
});

describe('selectExistingPolicies', () => {
  test('keeps found policies in order, up to maxCount', async () => {
    // arrange
    const found = new Set([policyB, policyC, policyA]);

    // act
    const kept = await selectExistingPolicies([policyA, '0'.repeat(32), policyB, policyC], 2, async (id) =>
      found.has(id)
    );

    // assert
    assert.deepEqual(kept, [policyA, policyB]);
  });

  test('stops after a long run of misses', async () => {
    // arrange
    const misses = Array.from({ length: maxConsecutiveMisses + 50 }, (_value, index) =>
      index.toString(16).toUpperCase().padStart(32, '0')
    );
    const checked = [];
    const messages = [];

    // act
    const kept = await selectExistingPolicies(
      [policyA, ...misses, policyB],
      10,
      async (id) => {
        checked.push(id);
        return id === policyA || id === policyB;
      },
      (message) => messages.push(message)
    );

    // assert
    assert.deepEqual(kept, [policyA]);
    assert.ok(!checked.includes(policyB));
    assert.match(messages.at(-1), /stopped: the last \d+ candidates have no TCAS policy/);
  });

  test('passes on a failed check', async () => {
    // act
    const result = selectExistingPolicies([policyA], 1, async () => {
      throw new Error('Policy API answered 500');
    });

    // assert
    await assert.rejects(result, /Policy API answered 500/);
  });
});

describe('policyApiCheck', () => {
  for (const [name, status, expected] of [
    ['finds a policy the API returns', 200, true],
    ['misses a policy the API does not know', 404, false]
  ]) {
    test(name, async (context) => {
      // arrange
      const requests = [];
      const server = createServer((request, response) => {
        requests.push(request.url);
        response.writeHead(status).end('{}');
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      context.after(() => server.close());
      const check = policyApiCheck(`http://127.0.0.1:${server.address().port}/policy/{policyDetailsId}/1`);

      // act
      const found = await check(policyA);

      // assert
      assert.equal(found, expected);
      assert.deepEqual(requests, [`/policy/${policyA}/1`]);
    });
  }

  test('rejects any other status', async (context) => {
    // arrange
    const server = createServer((_request, response) => response.writeHead(500).end());
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    context.after(() => server.close());
    const check = policyApiCheck(`http://127.0.0.1:${server.address().port}/policy/{policyDetailsId}/1`);

    // act
    const result = check(policyA);

    // assert
    await assert.rejects(result, /Policy API answered 500/);
  });
});

describe('createQuoteGuidList', () => {
  test('writes the found policies under the header, readable as the environment list', async (context) => {
    // arrange
    const options = await listFixture(context);
    const calls = [];

    // act
    const written = await createQuoteGuidList(
      options,
      fakeServices(`${policyA}\n${policyB}\n${policyC}\n`, [policyA, policyC], calls)
    );

    // assert
    assert.equal(written, 2);
    assert.deepEqual(await readQuoteGuidList(options.listPath, 'stg'), [policyA, policyC]);
    assert.match(calls[0].cwd, /sql[\\/]$/);
  });

  test('refuses to replace an existing list without force', async (context) => {
    // arrange
    const options = await listFixture(context);
    await createQuoteGuidList(options, fakeServices(policyA, [policyA]));
    const calls = [];

    // act
    const result = createQuoteGuidList(options, fakeServices(policyB, [policyB], calls));

    // assert
    await assert.rejects(result, /already exists\. Pass --force/);
    assert.equal(calls.length, 0);
  });

  test('replaces an existing list with force', async (context) => {
    // arrange
    const options = await listFixture(context);
    await createQuoteGuidList(options, fakeServices(policyA, [policyA]));

    // act
    await createQuoteGuidList({ ...options, force: true }, fakeServices(policyB, [policyB]));

    // assert
    assert.deepEqual(await readQuoteGuidList(options.listPath), [policyB]);
  });

  test('leaves the list unchanged when no candidate has a TCAS policy', async (context) => {
    // arrange
    const options = await listFixture(context, { force: true });
    await writeFile(join(options.listPath, '..', '..', 'marker'), '');
    await createQuoteGuidList(options, fakeServices(policyA, [policyA]));

    // act
    const result = createQuoteGuidList(options, fakeServices(`${policyB}\n${policyC}`, []));

    // assert
    await assert.rejects(result, /None of the 2 candidates .* has a TCAS policy/);
    assert.match(await readFile(options.listPath, 'utf8'), new RegExp(policyA));
  });
});
