import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { intervalToMs } from '../dist/interval.js';

describe('intervalToMs', () => {
  for (const [interval, expected] of [
    ['5000', 5000],
    ['45s', 45 * 1000],
    ['2m', 2 * 60 * 1000],
    ['1h', 60 * 60 * 1000],
    ['8h', 8 * 60 * 60 * 1000],
    ['1', 1]
  ]) {
    test(`converts ${interval} to ${expected} ms`, () => {
      // arrange
      const value = interval;

      // act
      const milliseconds = intervalToMs(value);

      // assert
      assert.equal(milliseconds, expected);
    });
  }

  for (const interval of ['0', '0s', '-5', '-1m']) {
    test(`rejects ${interval} as less than 1 ms`, () => {
      // arrange
      const value = interval;

      // act
      const convert = () => intervalToMs(value);

      // assert
      assert.throws(convert, { message: `The 'interval' cannot be less than 1ms. Instead got '${interval}'` });
    });
  }

  for (const interval of ['481m', '9h', '1d']) {
    test(`rejects ${interval} as more than 8 hours`, () => {
      // arrange
      const value = interval;

      // act
      const convert = () => intervalToMs(value);

      // assert
      assert.throws(convert, /^Error: The 'interval' cannot be greater than 28800000ms\./);
    });
  }

  for (const interval of ['', 'abc', '45 s', '45ms', '1.5m', 'x7s', '123456789', '45S']) {
    test(`rejects the format ${JSON.stringify(interval)}`, () => {
      // arrange
      const value = interval;

      // act
      const convert = () => intervalToMs(value);

      // assert
      assert.throws(convert, /The 'interval' must be a number and optional suffix/);
    });
  }
});
