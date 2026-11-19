import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScreenshotScale } from '../dist/screenshot-scale.js';

describe('parseScreenshotScale', () => {
  for (const [value, expected] of [
    [undefined, 1],
    ['1', 1],
    ['1.0', 1],
    ['1.5', 1.5],
    [' 2 ', 2],
    ['0.5', 0.5],
    ['4', 4]
  ]) {
    test(`reads ${JSON.stringify(value)} as ${expected}`, () => {
      // act
      const scale = parseScreenshotScale(value);

      // assert
      assert.equal(scale, expected);
    });
  }

  for (const [value, message] of [
    ['150%', /must be a decimal number such as 1\.0 \(100%\) or 1\.5 \(150%\), not "150%"/],
    ['1,5', /must be a decimal number/],
    ['-1', /must be a decimal number/],
    ['abc', /must be a decimal number/],
    ['0.4', /must be a number from 0\.5 to 4/],
    ['4.5', /must be a number from 0\.5 to 4/]
  ]) {
    test(`rejects ${JSON.stringify(value)}`, () => {
      // act
      const parsing = () => parseScreenshotScale(value);

      // assert
      assert.throws(parsing, message);
    });
  }
});
