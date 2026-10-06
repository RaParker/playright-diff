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
  ],
  [
    'fixes the cover start date when Continue on Cover details reports it out of range',
    { coverStartError: 'continue' },
    undefined
  ],
  [
    'reports a cover start error that Continue still shows after the date is fixed',
    { coverStartError: 'continue', coverStartFixable: false },
    /NHI journey validation failed on Cover details: The Cover start field needs to be between 2026-10-06/
  ],
  [
    'opens Cover details from the timeline when Get your quote reports the cover start out of range',
    { coverStartError: 'quote' },
    undefined
  ],
  [
    'stops when Get your quote keeps reporting the cover start after the date is fixed',
    { coverStartError: 'quote', coverStartFixable: false },
    /NHI journey returned to Contact details after Get your quote 2 times: The Cover start field needs to be between/
  ],
  [
    'enters the replacement email address when Get your quote reports invalid characters',
    { emailError: true },
    undefined
  ],
  [
    'stops when Get your quote keeps reporting the email address after it is replaced',
    { emailError: true, emailFixable: false },
    /NHI journey returned to Contact details after Get your quote 2 times: The Email address field contains invalid/
  ],
  ['fixes both the cover start date and the email address', { coverStartError: 'quote', emailError: true }, undefined]
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
