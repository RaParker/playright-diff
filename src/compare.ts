import { diffWordsWithSpace } from 'diff';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';
import { color } from './color.js';
import { createSerialisedUntilSuccess } from './concurrency.js';
import { replaceFile } from './fs-helpers.js';
import { outputPath } from './output-paths.js';
import { checkScreenshotScale, defaultScreenshotScale } from './screenshot-scale.js';

export interface CompareOptions {
  output?: string;
  /**
   * Write into the output directory even when it already exists, as quote-page does beside a policy's screenshots.
   * Otherwise the directory must be new, so inputs and previous reports are not overwritten.
   */
  reuseOutput?: boolean;
  threshold?: number;
  language?: string;
  useOcr?: boolean;
  /**
   * Device pixels per CSS pixel the screenshots were captured at (default 1.0; `SCREENSHOT_SCALE` in the CLI). Region
   * tiles and context grow with it so regions cover the same part of the page at every scale, and OCR enlarges crops
   * less, as their text already has more pixels.
   */
  imageScale?: number;
  /**
   * Names the region crops end with, `region-N-<name>.png` (default `before` and `after`; `COMPARE_BEFORE_NAME` and
   * `COMPARE_AFTER_NAME` in the CLI): letters, digits and hyphens, different from each other.
   */
  imageNames?: ImageNames;
  /**
   * Printed in yellow, with the report path, instead of the green changed-pixel count when the screenshots match, for
   * matching pages that should not read as identical (such as two referrals, which show no cover details).
   */
  identicalMessage?: string;
}

/** Names the before and after region crops end with. */
export interface ImageNames {
  before: string;
  after: string;
}

/** Region crop names when none are given. */
export const defaultImageNames: ImageNames = { before: 'before', after: 'after' };

/** How much two compared screenshots differ. */
export interface ComparisonCounts {
  changedPixels: number;
  /** Changed regions whose recognised text differs; always 0 when OCR is disabled. */
  textChangedRegions: number;
}

/**
 * Compares two screenshots, writing a highlighted `diff.png`, each changed region's images and the report.
 * @returns The changed pixel count and how many changed regions' text differs.
 */
export async function compare(
  beforeArgument: string,
  afterArgument: string,
  options: CompareOptions = {}
): Promise<ComparisonCounts> {
  const threshold = options.threshold ?? 20;
  const language = options.language ?? 'eng';
  const useOcr = options.useOcr ?? true;
  const imageScale = checkScreenshotScale(options.imageScale ?? defaultScreenshotScale, 'imageScale');
  const imageNames = checkImageNames(options.imageNames ?? defaultImageNames);
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
    throw new Error('threshold must be an integer between 0 and 255.');
  }

  const paths = [resolve(beforeArgument), resolve(afterArgument)] as const;
  const [a, b] = await Promise.all([load(paths[0]), load(paths[1])]);
  const { width, height, highlight, changedPixels, boxes } = detectChanges(a, b, threshold, imageScale);
  const output = await createOutputDirectory(options.output, options.reuseOutput ?? false);
  await sharp(highlight, { raw: { width, height, channels: 3 } })
    .png()
    .toFile(join(output, 'diff.png'));
  const regions = await processRegions(a, b, boxes, output, { language, useOcr, imageScale, imageNames });

  const report = {
    before: paths[0],
    after: paths[1],
    dimensions: { before: a.info, after: b.info },
    threshold,
    imageScale,
    changedPixels,
    changedPercent: (changedPixels / (width * height)) * 100,
    ocrEnabled: useOcr,
    language: language,
    regions
  };
  await writeReport(output, report);
  const reportPath = join(output, 'report.md');
  const summary = `${changedPixels} changed pixels (${report.changedPercent.toFixed(2)}%). Report: ${reportPath}`;
  // Green for identical images, yellow when there are differences or a matching page to review.
  if (changedPixels === 0 && options.identicalMessage !== undefined) {
    console.log(color.Yellow(`${options.identicalMessage} Report: ${reportPath}`));
  } else {
    console.log(changedPixels === 0 ? color.Green(summary) : color.Yellow(summary));
  }

  return { changedPixels, textChangedRegions: regions.filter((region) => region.textChanges.length > 0).length };
}

/**
 * Checks the names region crops end with, so settings can be checked before anything is captured.
 * @param names The names.
 * @returns The names.
 * @throws When a name is not letters, digits and hyphens, or both names are the same, so crops would overwrite.
 */
export function checkImageNames(names: ImageNames): ImageNames {
  for (const name of [names.before, names.after]) {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) {
      throw new Error(`Image names must be letters, digits and hyphens, not "${name}".`);
    }
  }

  if (names.before.toLowerCase() === names.after.toLowerCase()) {
    throw new Error(`The before and after image names must differ, not both "${names.before}".`);
  }

  return names;
}

/** A word with no letters or digits, such as `©`, `@`, `—` or `|`. */
const symbolsOnlyWord = /^[^\p{L}\p{N}]*$/u;
/** At most one character inside brackets or bars, such as `[1]` or `(v)`: how OCR reads checkboxes and icons. */
const boxedGlyphWord = /^[[(|][\p{L}\p{N}]?[\])|]$/u;
/** A `|` with whitespace or the start or end of the text on both sides. */
const standaloneBar = /(?<=^|\s)\|(?=\s|$)/gu;

/**
 * Tells whether a changed run of OCR text is noise rather than a text change: every word in it has no letters or digits
 * (`©` read as `@`, a stray `—` or `|`), or is at most one character in brackets or bars (an empty checkbox read as
 * `[1]`). A change with any other word, such as a price or "1 claim", is real. The region's pixels still differ, so it
 * is still reported, as text unchanged.
 * @param text The added or removed text.
 * @returns Whether the change is only symbols.
 */
export function isSymbolOnlyChange(text: string): boolean {
  return text
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .every((word) => symbolsOnlyWord.test(word) || boxedGlyphWord.test(word));
}

/** A change between two OCR readings of a region. */
export interface TextChange {
  type: 'added' | 'removed';
  text: string;
}

/**
 * Lists the word changes between two OCR readings, leaving out those that are only OCR noise (see
 * {@link isSymbolOnlyChange}). A `|` standing alone is compared as `I`, since OCR reads a capital I on its own, such as
 * at the start of "I agree", as a bar on some captures and not others. Listed changes show it as `I`.
 * @param before The text read from the before image.
 * @param after The text read from the after image.
 * @returns The added and removed text, in reading order; empty when the readings match.
 */
export function findTextChanges(before: string, after: string): TextChange[] {
  return diffWordsWithSpace(readBarsAsI(before), readBarsAsI(after))
    .filter((part) => (part.added || part.removed) && !isSymbolOnlyChange(part.value))
    .map((part) => ({ type: part.added ? 'added' : 'removed', text: part.value }));
}

async function load(path: string) {
  return sharp(path)
    .rotate()
    .flatten({ background: '#fff' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

/** Loads OCR workers one at a time per language until one has loaded, and so cached its language data. */
const loadOcrLanguage = createSerialisedUntilSuccess();

/** Side of the square tiles changed pixels are grouped by, in CSS pixels (device pixels at 100%). */
const tileCssPixels = 32;
/** Context added around each changed region, in CSS pixels. */
const regionContextCssPixels = 40;
/**
 * Scale OCR reads text at, relative to a 100% screenshot: crops from a lower scale are enlarged to it, as Tesseract
 * misreads text drawn smaller. Crops already at or above it are read as they are, since enlarging only blurs them.
 */
const ocrReadingScale = 2;

type LoadedImage = Awaited<ReturnType<typeof load>>;
type OcrWorker = Awaited<ReturnType<typeof createWorker>>;
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** How changed regions are read and named. */
interface RegionOptions {
  language: string;
  useOcr: boolean;
  imageScale: number;
  imageNames: ImageNames;
}

function detectChanges(a: LoadedImage, b: LoadedImage, threshold: number, imageScale: number) {
  const width = Math.max(a.info.width, b.info.width),
    height = Math.max(a.info.height, b.info.height);
  // Bound allocations for exceptionally large screenshots.
  if (width * height > 40_000_000) {
    throw new Error('Combined image canvas exceeds 40 million pixels.');
  }

  const tile = Math.round(tileCssPixels * imageScale),
    columns = Math.ceil(width / tile),
    rows = Math.ceil(height / tile);
  const changedTiles = new Uint8Array(columns * rows);
  const highlight = Buffer.alloc(width * height * 3, 255);
  let changedPixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inA = x < a.info.width && y < a.info.height,
        inB = x < b.info.width && y < b.info.height;
      const ai = (y * a.info.width + x) * 3,
        bi = (y * b.info.width + x) * 3;
      // Plain indexing rather than a closure and readUInt8 per channel: this runs for every pixel of a full page.
      const changed =
        inA !== inB ||
        (inA &&
          inB &&
          (Math.abs((a.data[ai] as number) - (b.data[bi] as number)) > threshold ||
            Math.abs((a.data[ai + 1] as number) - (b.data[bi + 1] as number)) > threshold ||
            Math.abs((a.data[ai + 2] as number) - (b.data[bi + 2] as number)) > threshold));
      const out = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) {
        highlight[out + c] = changed ? (c === 1 ? 0 : 255) : inB ? (b.data[bi + c] as number) : 255;
      }

      if (changed) {
        changedPixels++;
        changedTiles[Math.floor(y / tile) * columns + Math.floor(x / tile)] = 1;
      }
    }
  }

  return {
    width,
    height,
    highlight,
    changedPixels,
    boxes: groupChangedTiles(
      changedTiles,
      columns,
      rows,
      tile,
      width,
      height,
      Math.round(regionContextCssPixels * imageScale)
    )
  };
}

function groupChangedTiles(
  changedTiles: Uint8Array,
  columns: number,
  rows: number,
  tile: number,
  width: number,
  height: number,
  context: number
): Box[] {
  const boxes: Box[] = [];
  for (let start = 0; start < changedTiles.length; start++) {
    if (changedTiles[start] === 0) {
      continue;
    }

    const queue = [start];
    changedTiles[start] = 0;
    let minX = columns,
      maxX = 0,
      minY = rows,
      maxY = 0;
    for (const cell of queue) {
      const x = cell % columns,
        y = Math.floor(cell / columns);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy,
            next = ny * columns + nx;
          if (nx >= 0 && nx < columns && ny >= 0 && ny < rows && changedTiles[next] === 1) {
            changedTiles[next] = 0;
            queue.push(next);
          }
        }
      }
    }

    const left = Math.max(0, minX * tile - context),
      top = Math.max(0, minY * tile - context);
    boxes.push({
      left,
      top,
      width: Math.min(width, (maxX + 1) * tile + context) - left,
      height: Math.min(height, (maxY + 1) * tile + context) - top
    });
  }

  boxes.sort((a, b) => (a.top === b.top ? a.left - b.left : a.top - b.top));
  return boxes;
}

async function createOutputDirectory(outputArgument: string | undefined, reuseOutput: boolean) {
  // Unless reused, a fresh directory prevents overwriting inputs or previous reports.
  const output =
    outputArgument !== undefined && outputArgument.length > 0
      ? resolve(outputArgument)
      : outputPath('comparisons', `run-${Date.now()}`);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { recursive: reuseOutput });
  return output;
}

async function readRegion(
  source: LoadedImage,
  box: Box,
  image: string,
  output: string,
  imageScale: number,
  worker?: OcrWorker
) {
  const cropWidth = Math.min(box.width, source.info.width - box.left);
  const cropHeight = Math.min(box.height, source.info.height - box.top);
  if (cropWidth <= 0 || cropHeight <= 0) {
    return { text: '', confidence: null, image: null };
  }

  const crop = await sharp(source.data, {
    raw: { width: source.info.width, height: source.info.height, channels: 3 }
  })
    .extract({ ...box, width: cropWidth, height: cropHeight })
    .png()
    .toBuffer();
  await writeFile(join(output, image), crop);
  const result =
    worker !== undefined ? await worker.recognize(await prepareForOcr(crop, cropWidth, imageScale)) : undefined;
  return { text: result?.data.text.trim() ?? '', confidence: result?.data.confidence ?? null, image };
}

/**
 * Prepares a crop for OCR: enlarges it to {@link ocrReadingScale} when it was captured below it. Greyscale, contrast
 * stretching, a white margin, a stated resolution and other page-segmentation modes were measured against 374 saved
 * region pairs; each fixed some misreadings but caused others (or skipped real text), so the crop is otherwise unchanged.
 */
async function prepareForOcr(crop: Buffer, cropWidth: number, imageScale: number): Promise<Buffer> {
  const enlargement = Math.max(1, ocrReadingScale / imageScale);
  return sharp(crop)
    .resize({ width: Math.round(cropWidth * enlargement) })
    .png()
    .toBuffer();
}

function readBarsAsI(text: string): string {
  return text.replace(standaloneBar, 'I');
}

function assessRegion(useOcr: boolean, hasChanges: boolean, text: string) {
  if (useOcr) {
    if (hasChanges) {
      return 'Recognized text differs';
    }

    return text.length > 0
      ? 'Recognized text unchanged; visual appearance differs'
      : 'No text recognized; inspect crops';
  }

  return 'OCR disabled';
}

async function processRegions(
  a: LoadedImage,
  b: LoadedImage,
  boxes: Box[],
  output: string,
  { language, useOcr, imageScale, imageNames }: RegionOptions
) {
  const cachePath = outputPath('.ocr-cache');
  let worker: OcrWorker | undefined;
  const regions = [];
  try {
    if (boxes.length > 0 && useOcr) {
      await mkdir(cachePath, { recursive: true });
      console.log(color.Gray('Loading local OCR (first use downloads language data)…'));
      worker = await createOcrWorker(language, cachePath);
      // Tesseract prints diagnostics such as "Estimating resolution as …" to stdout for every crop; send them to
      // the null device inside its virtual file system. This changes only logging, not recognition.
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, debug_file: '/dev/null' });
    }

    for (const [i, box] of boxes.entries()) {
      const old = await readRegion(a, box, `region-${i + 1}-${imageNames.before}.png`, output, imageScale, worker);
      const current = await readRegion(b, box, `region-${i + 1}-${imageNames.after}.png`, output, imageScale, worker);

      const changes = worker !== undefined ? findTextChanges(old.text, current.text) : [];
      const region = {
        id: i + 1,
        bounds: box,
        before: old,
        after: current,
        textChanges: changes,
        assessment: assessRegion(worker !== undefined, changes.length > 0, old.text)
      };
      regions.push(region);
      // Only text changes are listed; every region, changed text or not, is in report.md.
      if (changes.length > 0) {
        console.log(`Region ${i + 1}: ${region.assessment}`);
        for (const change of changes) {
          console.log(`  ${change.type}: ${JSON.stringify(change.text)}`);
        }
      }
    }
  } finally {
    await worker?.terminate();
  }

  printRegionCount(regions.length, regions.filter((region) => region.textChanges.length > 0).length, useOcr);
  return regions;
}

/**
 * Creates an OCR worker. Until one worker for the language has loaded, they load one at a time (a failed load lets the
 * next try alone), so concurrent comparisons never download its language data into the shared cache at the same time.
 */
async function createOcrWorker(language: string, cachePath: string): Promise<OcrWorker> {
  return loadOcrLanguage(language, () => createWorker(language, undefined, { cachePath }));
}

function printRegionCount(total: number, withTextChanges: number, useOcr: boolean): void {
  if (total === 0) {
    return;
  }

  const regions = `${total} changed ${total === 1 ? 'region' : 'regions'}`;
  console.log(color.Gray(useOcr ? `${regions}, ${withTextChanges} with text changes.` : `${regions}; OCR disabled.`));
}

/** Image size, as `sharp` reads it. */
interface ImageSize {
  width: number;
  height: number;
}

/**
 * The parts of a comparison's `report.json` that `summarise` reads. Defined here, beside the writer, so renaming a field
 * fails to compile where it is read rather than at run time.
 */
export interface ComparisonReportBasics {
  dimensions: { before: ImageSize; after: ImageSize };
  changedPixels: number;
  changedPercent: number;
}

interface Report extends ComparisonReportBasics {
  before: string;
  after: string;
  regions: Awaited<ReturnType<typeof processRegions>>;
}

async function writeReport(output: string, report: Report) {
  await replaceFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await replaceFile(join(output, 'report.md'), formatReport(report));
}

function formatReport(report: Report) {
  const { changedPixels, regions } = report;
  const lines = [
    `# Image comparison`,
    '',
    `${changedPixels} changed pixels (${report.changedPercent.toFixed(2)}%). ${regions.length} regions.`,
    '',
    `Before: ${report.before}`,
    `After: ${report.after}`,
    '',
    '[Highlighted differences](diff.png)',
    '',
    'Images are compared at their original coordinates. OCR results are estimates; verify against the crops.',
    ''
  ];
  for (const region of regions) {
    lines.push(`## Region ${region.id}`, '', `Bounds: ${JSON.stringify(region.bounds)}`, '', region.assessment, '');
    for (const [label, reading] of [
      ['Before', region.before],
      ['After', region.after]
    ] as const) {
      lines.push(
        `${label} (OCR confidence: ${reading.confidence ?? 'unavailable'}):`,
        '',
        '    ' + (reading.text.length > 0 ? reading.text : '(no text)').replaceAll('\n', '\n    '),
        ''
      );
      if (reading.image !== null && reading.image.length > 0) {
        lines.push(`[${label} crop](${reading.image})`, '');
      }
    }

    for (const change of region.textChanges) {
      lines.push(`${change.type}: ${JSON.stringify(change.text)}`, '');
    }
  }

  return lines.join('\n');
}
