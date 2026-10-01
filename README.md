# Full-page website screenshots

A TypeScript Node.js CLI using headless Chromium through Playwright.

## Setup

Requires Node.js 22 or newer.

```sh
npm install
npm run install:browser
```

## Capture a website

```sh
npm run screenshot -- https://example.com
npm run screenshot -- https://example.com --output screenshots/example.png
npm run screenshot -- https://example.com --width 390 --height 844 --wait 2000
```

The default output is `screenshots/screenshot.png`. Existing output files are overwritten.
PNG and JPEG are supported. Run `npm run screenshot -- --help` for all options.

The script waits for page load, scrolls through the document to trigger typical lazy loading,
returns to the top, waits an extra second, and captures the full scrollable document using
[Playwright's fullPage option](https://playwright.dev/docs/screenshots#full-page-screenshots).
Increase `--wait` for slower dynamic content and `--timeout` for slower navigation.

The scroll pass is limited to 100 viewport steps. Infinite feeds have no finite full-page
capture; only loaded content is captured. Independently scrolling panels and virtualized
lists may require site-specific handling. Cookie banners and login screens are captured as shown.

## Compare two images

```sh
npm run compare -- screenshots/before.png screenshots/after.png
npm run compare -- before.png after.png --output comparisons/my-comparison
```

The command prints removed and added OCR text for each changed region and writes:

- `diff.png`: changed pixels highlighted in magenta.
- `region-N-before.png` and `region-N-after.png`: crops with surrounding context.
- `report.md`: readable visual and text comparison, with OCR confidence.
- `report.json`: structured results, coordinates, text, and word changes.

The output directory must not already exist. PNG, JPEG, and other formats supported
by Sharp are accepted. Images are compared at their original coordinates, with
dimensions reported separately; layout shifts can produce many differences.
Regions group adjacent changed 32-pixel tiles and include 40 pixels of context.
Nearby changes may share a region, and crop boundaries can truncate long text.

`--threshold 20` ignores small channel differences (use `0` for exact pixels).
`--language eng` selects the OCR language; `--no-ocr` skips text extraction.
OCR runs locally using [Tesseract.js](https://github.com/naptha/tesseract.js),
with a language-data download on first use cached in `comparisons/.ocr-cache`.
Images are not uploaded. OCR can misread small or stylized text: check the crops
and confidence before treating a reported text change as definitive.
Large combined canvases above 40 million pixels are rejected.

## Capture and compare quote pages

Set the MRP directory and both quote URL templates in `.env`.
The policy ID must be a UUID with dashes removed (32 hexadecimal characters).
Input is case-insensitive and normalized to uppercase for file paths and URLs.
Existing environment variables take precedence over `.env`. Relative paths resolve
from the current working directory.

Use `${VARIABLE_NAME}` to reference another setting in `.env` or an existing
environment variable. References resolve recursively, including forward references.
For example, your configuration can use:

```dotenv
REPO_BASE_PATH=D:/Richard/Projects/github
MRP_AND_QUOTE_OUTPUT_DIR="${REPO_BASE_PATH}/GoPackages/internal/mrp-and-quote/output"
```

You can also set `REPO_BASE_PATH` in your environment instead of `.env`.
Missing references and circular references stop the action with an error.
Quote URL placeholders such as `{policyDetailsId}` remain unchanged until the
quote-page action replaces them.

```sh
npm run quote-page -- ABCDEF1234567890ABCDEF1234567890 42
npm run quote-page -- ABCDEF1234567890ABCDEF1234567890 42 --no-ocr
```

This reads `MRP_AND_QUOTE_OUTPUT_DIR/ABCDEF1234567890ABCDEF1234567890-42-mrp.json`, using its top-level
`"artemisQuoteGuid"` string property to replace `{artemisQuoteGuid}` in the NHI
template. The TCAS template uses `{policyDetailsId}` and `{historyId}`.
Replacement values are URL-encoded.

The action calls `screenshot` for each URL, saving `screenshots/ABCDEF1234567890ABCDEF1234567890-42-nhi.png`
and `screenshots/ABCDEF1234567890ABCDEF1234567890-42-tcas.png`, then calls `compare` with NHI as before
and TCAS as after. Screenshots are overwritten on repeat runs; comparison reports
use a new timestamped directory under `comparisons/`. A failed step stops the action.

Before capturing TCAS, the action runs `src/tcas-quote.steps.json` in order:
wait for Cover details, click Contact details, click Get your quote, then wait
for either an error summary or the welcome quote heading. Error summaries are
reported with their text and stop capture and comparison. The heading accepts
any customer name and straight or curly apostrophes. Edit the JSON file to change
the selectors or steps; failures identify the step that stopped the journey.
Each successful step is logged in gray with its step number, action, and elapsed milliseconds.
After each click, the action checks for `div.av-card-error-summary`; if present,
it reports each `.av-card-error-summary > ul > li > a` link's text on a separate
line and stops before running the next step. Summaries without links fall back
to their full text.
If the Contact details click reports "The cover start field needs to be between
YYYY-MM-DD ...", the action opens `svg.av-icon-calendar`, selects the calendar
`div` whose aria-label ends with that date (such as `October 2nd, 2026`), and
retries Contact details once. Remaining errors stop the journey as usual.

Both NHI and TCAS are monitored for an `h2` containing exactly `Oops`, from
navigation through capture. If one appears, the flow stops and saves a failure
screenshot; subsequent journey steps and comparison are skipped.

If navigation or a Playwright step fails after the page is created, the action captures
the current page beside the intended output with a `-failed.png` suffix (for example,
`ABCDEF1234567890ABCDEF1234567890-42-tcas-failed.png`). The original error is still
reported and comparison stops. If the failure screenshot cannot be saved, its error
is logged without replacing the original failure.

## Build and verify

`src/main.ts` is the CLI entry point for `screenshot`, `compare`, and `quote-page`.
The action files are importable TypeScript modules with typed options. For example:

```ts
import { screenshot } from './src/screenshot.js';
import { compare } from './src/compare.js';

await screenshot('https://example.com', { output: 'screenshots/example.png', width: 390 });
await compare('screenshots/before.png', 'screenshots/example.png', { useOcr: false });
```

`quotePage(policyDetailsId, historyId, options)` accepts the MRP directory and both
URL templates in its options. `.env` loading is handled by the CLI.

```sh
npm run typecheck
npm test
npm run build
npm start -- screenshot https://example.com --output screenshots/example.png
```

Run `npx eslint` (or `npm run lint`) from the project root. Generated output is ignored.

`npm test` (or `npm run test`) builds once and runs all screenshot, comparison,
and quote-page tests. Chromium must be installed; the OCR comparison test may
download language data on its first run. To run individual suites, use
`npm run test:compare` or `npm run test:quote-page`.

Builds and type checks use TypeScript 7 through the `typescript-compiler` package alias.
TypeScript 6 remains installed as `typescript` for ESLint's parser, which does not yet support the TypeScript 7 compiler API.
