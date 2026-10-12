import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, test } from 'node:test';
import { runConcurrently, validateConcurrency } from '../dist/concurrency.js';

/** Runs items through the pool, recording the most tasks in flight and the order tasks finished. */
async function runRecording(items, concurrency, durationOf) {
  let running = 0;
  let mostRunning = 0;
  const finished = [];
  await runConcurrently(items, concurrency, async (item) => {
    running++;
    mostRunning = Math.max(mostRunning, running);
    await delay(durationOf(item));
    running--;
    finished.push(item);
  });
  return { mostRunning, finished };
}

describe('runConcurrently', () => {
  for (const [concurrency, items, expected] of [
    [1, [1, 2, 3, 4, 5], 1],
    [3, [1, 2, 3, 4, 5], 3],
    [10, [1, 2, 3], 3]
  ]) {
    test(`runs at most ${expected} tasks at once with a concurrency of ${concurrency} and ${items.length} items`, async () => {
      // arrange
      const durationOf = () => 10;

      // act
      const { mostRunning } = await runRecording(items, concurrency, durationOf);

      // assert
      assert.equal(mostRunning, expected);
    });
  }

  test('runs every item once, passing its index', async () => {
    // arrange
    const items = ['a', 'b', 'c', 'd'];
    const seen = [];

    // act
    await runConcurrently(items, 2, async (item, index) => {
      await delay(index % 2 === 0 ? 15 : 1);
      seen[index] = item;
    });

    // assert
    assert.deepEqual(seen, items);
  });

  test('a concurrency of 1 runs the items one after another, in order', async () => {
    // arrange
    const durationOf = (item) => (item === 1 ? 20 : 1);

    // act
    const { finished } = await runRecording([1, 2, 3], 1, durationOf);

    // assert
    assert.deepEqual(finished, [1, 2, 3]);
  });

  test('later items can finish before earlier ones', async () => {
    // arrange
    const durationOf = (item) => (item === 1 ? 40 : 1);

    // act
    const { finished } = await runRecording([1, 2, 3], 3, durationOf);

    // assert
    assert.deepEqual(finished, [2, 3, 1]);
  });

  test('does nothing for an empty list', async () => {
    // arrange
    let calls = 0;

    // act
    await runConcurrently([], 3, async () => {
      calls++;
    });

    // assert
    assert.equal(calls, 0);
  });

  test('waits for the other tasks, then rethrows a task rejection', async () => {
    // arrange
    const finished = [];

    // act
    const run = runConcurrently([1, 2], 2, async (item) => {
      if (item === 1) {
        throw new Error('task failed');
      }

      await delay(10);
      finished.push(item);
    });

    // assert
    await assert.rejects(run, /task failed/);
    assert.deepEqual(finished, [2]);
  });

  for (const concurrency of [0, -1, 1.5, Number.NaN]) {
    test(`rejects a concurrency of ${concurrency}`, async () => {
      // arrange
      const items = [1];

      // act
      const run = runConcurrently(items, concurrency, async () => undefined);

      // assert
      await assert.rejects(run, /concurrency must be a positive integer/);
      assert.throws(() => validateConcurrency(concurrency), /concurrency must be a positive integer/);
    });
  }
});
