import assert from 'node:assert/strict';
import { test } from 'node:test';
import { color } from '../dist/color.js';

/**
 * Runs `task` with `NO_COLOR` set to `value` (or unset for `undefined`), restoring it afterwards.
 * @param {string | undefined} value Value to set.
 * @param {() => unknown} task Work to run.
 * @returns {unknown} The task's result.
 */
function withNoColor(value, task) {
  const previous = process.env.NO_COLOR;
  if (value === undefined) {
    delete process.env.NO_COLOR;
  } else {
    process.env.NO_COLOR = value;
  }

  try {
    return task();
  } finally {
    if (previous === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = previous;
    }
  }
}

test('colours text with ANSI codes by default', () => {
  // arrange
  const paint = () => color.Red('failed');

  // act
  const text = withNoColor(undefined, paint);

  // assert
  assert.equal(text, '\u001b[31mfailed\u001b[0m');
});

test('leaves text uncoloured when NO_COLOR is set', () => {
  // arrange
  const paint = () => [color.Gray('a'), color.Red('b'), color.Green('c'), color.Yellow('d'), color.Cyan('e')];

  // act
  const text = withNoColor('1', paint);

  // assert
  assert.deepEqual(text, ['a', 'b', 'c', 'd', 'e']);
});
