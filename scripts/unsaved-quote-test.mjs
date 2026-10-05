import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { screenshot } from '../dist/screenshot.js';
import { unsavedQuote } from '../dist/unsaved-quote.js';
import { unsavedJourneyHtml } from './unsaved-journey-html.mjs';

const manySections = Array.from({ length: 20 }, (_value, index) => `Section ${index + 1}`);

for (const [name, journey, expectedError] of [
  ['continues through each section and gets the quote', {}, undefined],
  [
    'reports the section and error summary when Continue fails validation',
    { errorOn: 'Property type' },
    /NHI journey validation failed on Property type: Enter the year built/
  ],
  [
    'waits for the lookup and walks the journey again when Get your quote returns to a section',
    { bounceTo: 'Property type' },
    undefined
  ],
  [
    'reports the section and error summary that Continue leaves in place after a return',
    { bounceTo: 'Property type', resolves: false },
    /NHI journey validation failed on Property type: Enter the cost of rebuilding the property/
  ],
  [
    'stops when Get your quote returns to a section a second time',
    { bounceTo: 'Property type', bounceTimes: 2 },
    /NHI journey returned to Property type after Get your quote 2 times: Enter the cost of rebuilding the property/
  ],
  [
    'stops when Get your quote is not reached within the section limit',
    { sections: manySections },
    /did not reach Get your quote within 15 sections/
  ]
]) {
  test(`unsaved quote journey ${name}`, async () => {
    // arrange
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(unsavedJourneyHtml(journey));
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const directory = await mkdtemp(join(tmpdir(), 'unsaved-quote-'));
    try {
      // act
      const capture = screenshot(`http://127.0.0.1:${server.address().port}`, {
        output: join(directory, 'quote.png'),
        wait: 0,
        timeout: 2000,
        beforeCapture: unsavedQuote
      });

      // assert
      if (expectedError === undefined) {
        await capture;
        assert.deepEqual(await readdir(directory), ['quote.png']);
      } else {
        await assert.rejects(capture, expectedError);
        assert.deepEqual((await readdir(directory)).sort(), ['quote-failed.html', 'quote-failed.png']);
      }
    } finally {
      server.closeAllConnections();
      await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
    }
  });
}
