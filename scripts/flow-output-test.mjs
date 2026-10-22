import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { flowOutputPaths, legacyFlowOutputPaths } from '../dist/flow-output.js';

const folder = join('out', 'ID-1');

describe('flowOutputPaths', () => {
  for (const flow of ['nhi', 'mrp']) {
    test(`names the ${flow} files by page, then flow`, () => {
      // arrange
      const expected = {
        screenshot: join(folder, `screenshot-quote-page-${flow}.png`),
        html: join(folder, `quote-page-${flow}.html`),
        standardisedHtml: join(folder, `quote-page-standardized-${flow}.html`),
        stopped: {
          declined: {
            screenshot: join(folder, `screenshot-declined-${flow}.png`),
            html: join(folder, `declined-${flow}.html`)
          },
          failed: {
            screenshot: join(folder, `screenshot-failed-${flow}.png`),
            html: join(folder, `failed-${flow}.html`)
          }
        },
        apiResponses: join(folder, `api-${flow}`)
      };

      // act
      const paths = flowOutputPaths(folder, flow);

      // assert
      assert.deepEqual(paths, expected);
    });
  }
});

describe('legacyFlowOutputPaths', () => {
  for (const [flow, legacyName] of [
    ['nhi', 'nhi'],
    ['mrp', 'tcas']
  ]) {
    test(`names the ${flow} files read back from results saved as ${legacyName}`, () => {
      // arrange
      const expected = {
        apiResponses: join(folder, `${legacyName}-api`),
        failedHtml: join(folder, `${legacyName}-failed.html`)
      };

      // act
      const paths = legacyFlowOutputPaths(folder, flow);

      // assert
      assert.deepEqual(paths, expected);
    });
  }
});
