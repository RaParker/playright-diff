import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  classifyComparison,
  describeEndpoints,
  formatComparisonCounts,
  isQuoteEndpoints,
  readQuoteEndpoint
} from '../dist/quote-endpoint.js';

/** Removes ANSI colour codes, for asserting on the text alone. */
function plain(text) {
  return text.replace(new RegExp(`${String.fromCharCode(27)}\\[\\d+m`, 'g'), '');
}

describe('readQuoteEndpoint', () => {
  for (const [name, html, expected] of [
    ['a quote', '<h2>Welcome Mr. A, here&rsquo;s your quote</h2>', 'quote'],
    ['an estimated quote as a referral', '<h2>Welcome Mr. A, here’s your estimated quote</h2>', 'referred'],
    ['a conditional quote', "<h2 class='x'>Welcome Mrs. B, here's your conditional quote</h2>", 'conditional'],
    [
      'a heading split by inline tags',
      '<h2>Welcome <span>Dr. C</span>, here&#39;s your <b>estimated</b>\n quote</h2>',
      'referred'
    ],
    ['any heading level', '<h1>Welcome Ms. D, here&apos;s your conditional quote</h1>', 'conditional'],
    ['a page with no quote heading as a quote', '<h1>Cover details</h1><p>here’s your estimated quote</p>', 'quote'],
    [
      'the quote heading, not an earlier heading that mentions a referral',
      '<h3>Estimated quote</h3><h2>Welcome E, here’s your quote</h2>',
      'quote'
    ]
  ]) {
    test(`reads ${name}`, () => {
      // arrange
      const page = `<html><body>${html}</body></html>`;

      // act
      const endpoint = readQuoteEndpoint(page);

      // assert
      assert.equal(endpoint, expected);
    });
  }
});

describe('classifyComparison', () => {
  for (const [name, changedPixels, endpoints, expected] of [
    ['matching quotes as identical', 0, { nhi: 'quote', tcas: 'quote' }, 'identical'],
    ['unrecorded end points as quotes', 0, undefined, 'identical'],
    ['changed pixels as different', 1, undefined, 'different'],
    ['matching referrals as referred', 0, { nhi: 'referred', tcas: 'referred' }, 'referred'],
    ['matching declines as declined', 0, { nhi: 'declined', tcas: 'declined' }, 'declined'],
    ['different end points as different', 0, { nhi: 'conditional', tcas: 'quote' }, 'different']
  ]) {
    test(`counts ${name}`, () => {
      // arrange
      const pixels = changedPixels;

      // act
      const kind = classifyComparison(pixels, endpoints);

      // assert
      assert.equal(kind, expected);
    });
  }
});

describe('describeEndpoints', () => {
  for (const [name, endpoints, expected] of [
    ['nothing for two quotes', { nhi: 'quote', tcas: 'quote' }, undefined],
    ['nothing when not recorded', undefined, undefined],
    ['a shared end point', { nhi: 'declined', tcas: 'declined' }, 'NHI and TCAS both declined'],
    ['each flow when they differ', { nhi: 'referred', tcas: 'quote' }, 'NHI referred, TCAS quoted'],
    ['a conditional quote', { nhi: 'quote', tcas: 'conditional' }, 'NHI quoted, TCAS conditional']
  ]) {
    test(`describes ${name}`, () => {
      // arrange
      const recorded = endpoints;

      // act
      const description = describeEndpoints(recorded);

      // assert
      assert.equal(description, expected);
    });
  }
});

describe('formatComparisonCounts', () => {
  test('lists identical and different, then only the matching end points that occur', () => {
    // arrange
    const kinds = ['identical', 'different', 'referred', 'referred', 'declined'];

    // act
    const counts = formatComparisonCounts(kinds);

    // assert
    assert.equal(plain(counts), '1 identical, 1 different, 2 both referred, 1 both declined');
  });

  test('colours identical green and the different and matching counts yellow', () => {
    // arrange
    const kinds = ['identical', 'different', 'conditional'];

    // act
    const counts = formatComparisonCounts(kinds);

    // assert
    assert.ok(counts.includes('\u001b[32m1 identical'), counts);
    assert.ok(counts.includes('\u001b[33m1 different'), counts);
    assert.ok(counts.includes('\u001b[33m1 both conditional'), counts);
  });

  test('leaves a zero different count uncoloured', () => {
    // arrange
    const kinds = ['identical'];

    // act
    const counts = formatComparisonCounts(kinds);

    // assert
    assert.ok(!counts.includes('\u001b[33m'), counts);
    assert.equal(plain(counts), '1 identical, 0 different');
  });
});

describe('isQuoteEndpoints', () => {
  for (const [name, value, expected] of [
    ['accepts known end points', { nhi: 'referred', tcas: 'declined' }, true],
    ['rejects an unknown end point', { nhi: 'quote', tcas: 'maybe' }, false],
    ['rejects a missing flow', { nhi: 'quote' }, false],
    ['rejects null', null, false]
  ]) {
    test(name, () => {
      // arrange
      const saved = value;

      // act
      const valid = isQuoteEndpoints(saved);

      // assert
      assert.equal(valid, expected);
    });
  }
});
