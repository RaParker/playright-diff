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

## Build and verify

```sh
npm run typecheck
npm test
npm run build
npm start -- https://example.com --output screenshots/example.png
```
