import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { screenshot } from '../dist/screenshot.js';
import { parseVwoCombinations, vwoCookies } from '../dist/vwo-combinations.js';

describe('parseVwoCombinations', () => {
  for (const [name, value, expected] of [
    ['reads nothing from an unset setting', undefined, []],
    ['reads nothing from a blank setting', '  ', []],
    ['reads one pair', '49:3', [{ campaign: 49, combination: 3 }]],
    [
      'reads pairs in order, ignoring spaces',
      ' 49 : 3 , 60:3 ',
      [
        { campaign: 49, combination: 3 },
        { campaign: 60, combination: 3 }
      ]
    ]
  ]) {
    test(name, () => {
      // act
      const combinations = parseVwoCombinations(value);

      // assert
      assert.deepEqual(combinations, expected);
    });
  }

  for (const [name, value, expectedError] of [
    ['rejects a campaign with no combination', '49', /campaign:combination pairs .* not "49"\./],
    ['rejects words', 'dev:3', /not "dev:3"\./],
    ['rejects a zero combination', '49:0', /not "49:0"\./],
    ['rejects a negative campaign', '-49:3', /not "-49:3"\./],
    ['rejects an empty pair', '49:3,,60:3', /not "49:3,,60:3"\./],
    ['rejects a campaign given twice', '49:3,49:2', /campaign 49 more than once/]
  ]) {
    test(name, () => {
      // act and assert
      assert.throws(() => parseVwoCombinations(value), expectedError);
    });
  }
});

describe('vwoCookies', () => {
  test('names one cookie per campaign, set on the parent domain', () => {
    // act
    const cookies = vwoCookies(
      [
        { campaign: 49, combination: 3 },
        { campaign: 60, combination: 1 }
      ],
      'https://quotes-dev.homeprotect.co.uk/quotesummary#guid=x'
    );

    // assert
    assert.deepEqual(cookies, [
      { name: '_vis_opt_exp_49_combi', value: '3', domain: '.homeprotect.co.uk', path: '/' },
      { name: '_vis_opt_exp_60_combi', value: '1', domain: '.homeprotect.co.uk', path: '/' }
    ]);
  });

  for (const [name, url, expectedUrl] of [
    ['an IP address', 'http://127.0.0.1:8080/page', 'http://127.0.0.1:8080'],
    ['a host with no parent domain', 'https://example.com/page', 'https://example.com'],
    ['localhost', 'http://localhost:3000/', 'http://localhost:3000']
  ]) {
    test(`sets the cookie for the page's origin on ${name}`, () => {
      // act
      const cookies = vwoCookies([{ campaign: 49, combination: 3 }], url);

      // assert
      assert.deepEqual(cookies, [{ name: '_vis_opt_exp_49_combi', value: '3', url: expectedUrl }]);
    });
  }
});

describe('screenshot with VWO combinations', () => {
  for (const [name, vwoCombinations, expectedCookie] of [
    ['sends the cookies before the page opens', [{ campaign: 49, combination: 3 }], '_vis_opt_exp_49_combi=3'],
    ['sends no cookie when none are given', undefined, '']
  ]) {
    test(name, async (context) => {
      // arrange
      context.mock.method(console, 'log', () => undefined);
      const requestCookies = [];
      const server = createServer((request, response) => {
        requestCookies.push(request.headers.cookie ?? '');
        response.setHeader('Content-Type', 'text/html');
        response.end('<h1>Page</h1>');
      });
      await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
      const directory = await mkdtemp(join(tmpdir(), 'vwo-combinations-'));
      context.after(() => rm(directory, { recursive: true, force: true }));
      let pageCookie;
      try {
        // act
        await screenshot(`http://127.0.0.1:${server.address().port}`, {
          output: join(directory, 'page.png'),
          wait: 0,
          vwoCombinations,
          beforeCapture: async (page) => {
            pageCookie = await page.evaluate(() => document.cookie);
          }
        });

        // assert
        assert.equal(requestCookies[0], expectedCookie);
        assert.equal(pageCookie, expectedCookie);
      } finally {
        server.closeAllConnections();
        await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
      }
    });
  }
});
