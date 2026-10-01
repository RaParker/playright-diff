import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { screenshot } from '../dist/screenshot.js';
import { tcasQuote } from '../dist/tcas-quote.js';

const cover = '<h1>Cover details</h1>';
const contact = '<div class="av-timeline-all-sections"><ul><li title="Contact details">Contact details</li></ul></div>';

function journey(outcome) {
  return `${cover}${contact}<button hidden>Get your quote</button><script>
    document.querySelector('li').onclick = () => { document.querySelector('button').hidden = false; };
    document.querySelector('button').onclick = () => {
      setTimeout(() => { document.body.innerHTML = ${JSON.stringify(outcome)}; }, 100);
    };
  </script>`;
}

const cases = [
  ['straight apostrophe', journey("<h2>Welcome Alex, here's your quote</h2>"), undefined],
  ['curly apostrophe', journey('<h2>Welcome Sam Smith, here&rsquo;s your quote</h2>'), undefined],
  ['missing cover heading', contact + '<button>Get your quote</button>', /step 1/],
  ['missing contact selector', cover + '<button>Get your quote</button>', /step 2/],
  ['missing quote button', cover + contact, /step 3/],
  ['missing welcome heading', journey('<h2>Still processing</h2>'), /step 4/],
  [
    'delayed errors',
    journey('<div class="av-card-error-summary">Please enter your email</div>'),
    /Please enter your email/
  ],
  [
    'errors alongside quote',
    journey('<div class="av-card-error-summary">Invalid address</div><h2>Welcome Alex, here&rsquo;s your quote</h2>'),
    /Invalid address/
  ]
];

for (const [name, html, expectedError] of cases) {
  test(`TCAS journey: ${name}`, async () => {
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(html);
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const directory = await mkdtemp(join(tmpdir(), 'tcas-journey-'));
    try {
      const capture = screenshot(`http://127.0.0.1:${server.address().port}`, {
        output: join(directory, 'quote.png'),
        wait: 0,
        timeout: 1000,
        beforeCapture: tcasQuote
      });
      if (expectedError === undefined) {
        await capture;
        assert.deepEqual(await readdir(directory), ['quote.png']);
      } else {
        await assert.rejects(capture, expectedError);
        assert.deepEqual(await readdir(directory), ['quote-failed.png']);
        const image = await readFile(join(directory, 'quote-failed.png'));
        assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      }
    } finally {
      server.closeAllConnections();
      await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
    }
  });
}
