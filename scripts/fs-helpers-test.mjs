import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { retryWhileBusy } from '../dist/fs-helpers.js';

/** An operation that fails with each given error code in turn, then resolves with `'done'`. */
function failingOperation(codes) {
  const calls = { count: 0 };
  const operation = async () => {
    const code = codes[calls.count++];
    if (code !== undefined) {
      throw Object.assign(new Error(`failed with ${code}`), { code });
    }

    return 'done';
  };
  return { calls, operation };
}

/** Records each delay instead of waiting. */
function recordingDelay() {
  const delays = [];
  return { delays, delay: async (milliseconds) => delays.push(milliseconds) };
}

describe('retryWhileBusy', () => {
  for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
    test(`retries an operation that fails with ${code}`, async () => {
      // arrange
      const { calls, operation } = failingOperation([code, code]);
      const { delays, delay } = recordingDelay();

      // act
      const result = await retryWhileBusy(operation, delay);

      // assert
      assert.equal(result, 'done');
      assert.equal(calls.count, 3);
      assert.deepEqual(delays, [100, 200]);
    });
  }

  test('gives up with the last error after five attempts', async () => {
    // arrange
    const { calls, operation } = failingOperation(['EBUSY', 'EBUSY', 'EBUSY', 'EBUSY', 'EPERM']);
    const { delays, delay } = recordingDelay();

    // act
    const result = retryWhileBusy(operation, delay);

    // assert
    await assert.rejects(result, { code: 'EPERM' });
    assert.equal(calls.count, 5);
    assert.deepEqual(delays, [100, 200, 400, 800]);
  });

  test('rethrows any other error at once', async () => {
    // arrange
    const { calls, operation } = failingOperation(['ENOENT']);
    const { delays, delay } = recordingDelay();

    // act
    const result = retryWhileBusy(operation, delay);

    // assert
    await assert.rejects(result, { code: 'ENOENT' });
    assert.equal(calls.count, 1);
    assert.deepEqual(delays, []);
  });

  test('runs a succeeding operation once', async () => {
    // arrange
    const { calls, operation } = failingOperation([]);
    const { delays, delay } = recordingDelay();

    // act
    const result = await retryWhileBusy(operation, delay);

    // assert
    assert.equal(result, 'done');
    assert.equal(calls.count, 1);
    assert.deepEqual(delays, []);
  });
});
