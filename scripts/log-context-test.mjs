import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, test } from 'node:test';
import { runWithLogPrefix, withPrefixedConsole } from '../dist/log-context.js';

/** Replaces console.log, console.error and console.warn with mocks, restored after the test. */
function mockConsole(t) {
  return {
    log: t.mock.method(console, 'log', () => undefined),
    error: t.mock.method(console, 'error', () => undefined),
    warn: t.mock.method(console, 'warn', () => undefined)
  };
}

function lines(method) {
  return method.mock.calls.map((call) => call.arguments.join(' '));
}

describe('log prefixes', () => {
  test('prefixes every console method inside a prefixed task', async (t) => {
    // arrange
    const logged = mockConsole(t);

    // act
    await withPrefixedConsole(() =>
      runWithLogPrefix('[1/2]', async () => {
        console.log('opened %s', 'page');
        console.error('failed');
        console.warn('warned');
      })
    );

    // assert
    assert.deepEqual(lines(logged.log), ['[1/2] opened page']);
    assert.deepEqual(lines(logged.error), ['[1/2] failed']);
    assert.deepEqual(lines(logged.warn), ['[1/2] warned']);
  });

  test('prefixes each line of a multi-line message', async (t) => {
    // arrange
    const logged = mockConsole(t);

    // act
    await withPrefixedConsole(() => runWithLogPrefix('[3/9]', async () => console.error('first\nsecond')));

    // assert
    assert.deepEqual(lines(logged.error), ['[3/9] first\n[3/9] second']);
  });

  test('keeps each concurrent task its own prefix across awaits', async (t) => {
    // arrange
    const logged = mockConsole(t);
    const task = (prefix, wait) =>
      runWithLogPrefix(prefix, async () => {
        await delay(wait);
        console.log('done');
      });

    // act
    await withPrefixedConsole(() => Promise.all([task('[A]', 20), task('[B]', 1)]));

    // assert
    assert.deepEqual(lines(logged.log), ['[B] done', '[A] done']);
  });

  test('leaves lines outside a prefixed task unchanged', async (t) => {
    // arrange
    const logged = mockConsole(t);

    // act
    await withPrefixedConsole(async () => console.log('summary'));

    // assert
    assert.deepEqual(lines(logged.log), ['summary']);
  });

  test('restores the console methods afterwards, even when the task fails', async (t) => {
    // arrange
    const logged = mockConsole(t);
    const mockedLog = console.log;

    // act
    await assert.rejects(
      withPrefixedConsole(() =>
        runWithLogPrefix('[1/1]', async () => {
          throw new Error('stopped');
        })
      ),
      /stopped/
    );
    await runWithLogPrefix('[1/1]', async () => console.log('after'));

    // assert
    assert.equal(console.log, mockedLog);
    assert.deepEqual(lines(logged.log), ['after']);
  });

  test('does not prefix when the console is not wrapped', async (t) => {
    // arrange
    const logged = mockConsole(t);

    // act
    await runWithLogPrefix('[1/1]', async () => console.log('plain'));

    // assert
    assert.deepEqual(lines(logged.log), ['plain']);
  });
});
