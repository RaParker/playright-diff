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
  ...['<h2>Loading your quote</h2>', '<div class="hp-loading-widget-screen"></div>'].map((loading) => [
    `TCAS loading before journey: ${loading}`,
    `${loading}<script>setTimeout(() => {
      document.body.innerHTML = ${JSON.stringify(cover + contact + '<button>Get your quote</button>')};
      document.querySelector('button').onclick = () => { document.body.innerHTML = "<h2>Welcome Alex, here's your quote</h2>"; };
    }, 300);</script>`,
    undefined
  ]),
  ['Oops on initial TCAS page', '<h2>Oops</h2>', /Website displayed <h2>Oops<\/h2>/],
  ['Oops after quote click', journey('<h2>Oops</h2>'), /Website displayed <h2>Oops<\/h2>/],
  ...[
    ['2026-10-02', 'Friday, October 2nd, 2026', false, undefined],
    ['2026-11-11', 'Choose Wednesday, November 11th, 2026', false, undefined],
    ['2026-10-02', 'Friday, October 2nd, 2026', true, /step 2.*The cover start field/],
    ['2026-02-30', 'Monday, March 2nd, 2026', false, /Invalid cover start date/]
  ].map(([date, label, keepError, expectedError]) => [
    `cover start recovery: ${date}, persistent error ${keepError}`,
    `${cover}${contact}<svg class="av-icon-calendar" width="24" height="24"><rect width="24" height="24" /></svg>
    <div hidden aria-label="${label}">Select date</div>
    <div class="react-datepicker__day react-datepicker__day--outside-month" aria-label="${label}">Outside month</div>
    <div aria-label="October 02, 2026">Wrong date format</div>
    <div aria-label="October 2nd, 2025">Wrong year</div><button hidden>Get your quote</button>
    <script>
      let selected = false;
      let attempts = 0;
      document.querySelector('li').onclick = () => {
        attempts++;
        if (attempts > 2) throw new Error('Too many retries');
        if (selected && !${keepError}) {
          document.querySelector('.av-card-error-summary')?.remove();
          document.querySelector('button').hidden = false;
        } else if (!document.querySelector('.av-card-error-summary')) {
          document.body.insertAdjacentHTML('beforeend', '<div class="av-card-error-summary"><ul><li><a>The cover start field needs to be between ${date} and 2027-01-01</a></li></ul></div>');
        }
      };
      document.querySelector('svg').onclick = () => { document.querySelector('[aria-label]').hidden = false; };
      document.querySelector('[aria-label]').onclick = () => { selected = true; };
      document.querySelector('button').onclick = () => { document.body.innerHTML = "<h2>Welcome Alex, here's your quote</h2>"; };
    </script>`,
    expectedError
  ]),
  ['straight apostrophe', journey("<h2>Welcome Alex, here's your quote</h2>"), undefined],
  ['curly apostrophe', journey('<h2>Welcome Sam Smith, here&rsquo;s your quote</h2>'), undefined],
  ['missing cover heading', contact + '<button>Get your quote</button>', /step 1/],
  ['missing contact selector', cover + '<button>Get your quote</button>', /step 2/],
  ['missing quote button', cover + contact, /step 3/],
  ['missing welcome heading', journey('<h2>Still processing</h2>'), /step 4/],
  [
    'errors after contact click',
    `${cover}${contact}<script>
      document.querySelector('li').onclick = () => {
        document.body.innerHTML += '<div class="av-card-error-summary"><h2>Check your details</h2><ul><li><a href="#contact"> Missing contact details </a></li><li><a href="#email">Please enter your email</a></li></ul></div>';
      };
    </script>`,
    /step 2 \(click\) failed: TCAS quote errors: Missing contact details\nPlease enter your email$/
  ],
  [
    'errors after quote click',
    `${cover}${contact}<button>Get your quote</button><script>
      document.querySelector('button').onclick = () => {
        document.body.innerHTML = '<div class="av-card-error-summary"><ul><li><a href="#quote">Invalid quote details</a></li></ul></div>';
      };
    </script>`,
    /step 3 \(click\) failed: TCAS quote errors: Invalid quote details/
  ],
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

test('Oops appearing during capture cannot produce a normal screenshot', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<h2>Quote ready</h2>');
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const directory = await mkdtemp(join(tmpdir(), 'oops-capture-'));
  try {
    await assert.rejects(
      screenshot(`http://127.0.0.1:${server.address().port}`, {
        output: join(directory, 'quote.png'),
        wait: 0,
        timeout: 1000,
        beforeCapture: async (page) => {
          // Exercise the direct check even if observer notification is unavailable.
          await page.evaluate(() => {
            window.__stopOnOops = async () => undefined;
          });
          const capture = page.screenshot.bind(page);
          page.screenshot = async (options) => {
            const image = await capture(options);
            await page.evaluate(() => {
              document.body.innerHTML = '<h2>Oops</h2>';
            });
            return image;
          };
        }
      }),
      /Website displayed <h2>Oops<\/h2>/
    );
    assert.deepEqual((await readdir(directory)).sort(), ['quote-failed.html', 'quote-failed.png']);
  } finally {
    server.closeAllConnections();
    await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
  }
});

for (const loading of ['<h2>Loading your quote</h2>', '<div class="hp-loading-widget-screen"></div>']) {
  for (const completes of [true, false]) {
    test(`shared capture loading: ${loading}, completes: ${completes}`, async () => {
      const server = createServer((_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end(
          `${loading}${completes ? '<script>setTimeout(() => { document.body.innerHTML = \'<div style="height:1800px">Quote ready</div>\'; }, 400);</script>' : ''}`
        );
      });
      await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
      const directory = await mkdtemp(join(tmpdir(), 'loading-quote-'));
      try {
        const capture = screenshot(`http://127.0.0.1:${server.address().port}`, {
          output: join(directory, 'quote.png'),
          wait: 0,
          timeout: 1000
        });
        if (completes) {
          await capture;
          const png = await readFile(join(directory, 'quote.png'));
          assert.ok(png.readUInt32BE(20) >= 1800);
        } else {
          await assert.rejects(capture, /Timed out waiting for quote loading screen/);
          assert.deepEqual(await readdir(directory), []);
        }
      } finally {
        server.closeAllConnections();
        await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
      }
    });
  }
}

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
        assert.deepEqual((await readdir(directory)).sort(), ['quote-failed.html', 'quote-failed.png']);
        const image = await readFile(join(directory, 'quote-failed.png'));
        assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      }
    } finally {
      server.closeAllConnections();
      await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
    }
  });
}
