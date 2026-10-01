import { diffWordsWithSpace } from 'diff';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';

export interface CompareOptions {
  output?: string;
  threshold?: number;
  language?: string;
  useOcr?: boolean;
}

export async function compare(
  beforeArgument: string,
  afterArgument: string,
  options: CompareOptions = {}
): Promise<void> {
  const threshold = options.threshold ?? 20;
  const language = options.language ?? 'eng';
  const useOcr = options.useOcr ?? true;
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
    throw new Error('threshold must be an integer between 0 and 255.');
  }

  const paths = [resolve(beforeArgument), resolve(afterArgument)] as const;
  const [a, b] = await Promise.all([load(paths[0]), load(paths[1])]);
  const { width, height, highlight, changedPixels, boxes } = detectChanges(a, b, threshold);
  const output = await createOutputDirectory(options.output);
  await sharp(highlight, { raw: { width, height, channels: 3 } })
    .png()
    .toFile(join(output, 'diff.png'));
  const regions = await processRegions(a, b, boxes, output, language, useOcr);

  const report = {
    before: paths[0],
    after: paths[1],
    dimensions: { before: a.info, after: b.info },
    threshold,
    changedPixels,
    changedPercent: (changedPixels / (width * height)) * 100,
    ocrEnabled: useOcr,
    language: language,
    regions
  };
  await writeReport(output, report);
  console.log(
    `${changedPixels} changed pixels (${report.changedPercent.toFixed(2)}%). Report: ${join(output, 'report.md')}`
  );
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

type LoadedImage = Awaited<ReturnType<typeof load>>;
type OcrWorker = Awaited<ReturnType<typeof createWorker>>;
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function detectChanges(a: LoadedImage, b: LoadedImage, threshold: number) {
  const width = Math.max(a.info.width, b.info.width),
    height = Math.max(a.info.height, b.info.height);
  // Bound allocations for exceptionally large screenshots.
  if (width * height > 40_000_000) {
    throw new Error('Combined image canvas exceeds 40 million pixels.');
  }

  const tile = 32,
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
      const changed =
        inA !== inB ||
        (inA &&
          inB &&
          [0, 1, 2].some((c) => Math.abs(a.data.readUInt8(ai + c) - b.data.readUInt8(bi + c)) > threshold));
      const out = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) {
        highlight[out + c] = changed ? (c === 1 ? 0 : 255) : inB ? b.data.readUInt8(bi + c) : 255;
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
    boxes: groupChangedTiles(changedTiles, columns, rows, tile, width, height)
  };
}

function groupChangedTiles(
  changedTiles: Uint8Array,
  columns: number,
  rows: number,
  tile: number,
  width: number,
  height: number
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

    const left = Math.max(0, minX * tile - 40),
      top = Math.max(0, minY * tile - 40);
    boxes.push({
      left,
      top,
      width: Math.min(width, (maxX + 1) * tile + 40) - left,
      height: Math.min(height, (maxY + 1) * tile + 40) - top
    });
  }

  boxes.sort((a, b) => (a.top === b.top ? a.left - b.left : a.top - b.top));
  return boxes;
}

async function createOutputDirectory(outputArgument?: string) {
  // A fresh directory prevents overwriting inputs or previous reports.
  const output =
    outputArgument !== undefined && outputArgument.length > 0
      ? resolve(outputArgument)
      : resolve('comparisons', `run-${Date.now()}`);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  return output;
}

async function readRegion(source: LoadedImage, box: Box, image: string, output: string, worker?: OcrWorker) {
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
    worker !== undefined
      ? await worker.recognize(
          await sharp(crop)
            .resize({ width: cropWidth * 2 })
            .png()
            .toBuffer()
        )
      : undefined;
  return { text: result?.data.text.trim() ?? '', confidence: result?.data.confidence ?? null, image };
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
  language: string,
  useOcr: boolean
) {
  const cachePath = resolve('comparisons', '.ocr-cache');
  let worker: OcrWorker | undefined;
  const regions = [];
  try {
    if (boxes.length > 0 && useOcr) {
      await mkdir(cachePath, { recursive: true });
      console.log('Loading local OCR (first use downloads language data)…');
      worker = await createWorker(language, undefined, { cachePath });
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    }

    for (const [i, box] of boxes.entries()) {
      const old = await readRegion(a, box, `region-${i + 1}-before.png`, output, worker);
      const current = await readRegion(b, box, `region-${i + 1}-after.png`, output, worker);

      const changes =
        worker !== undefined
          ? diffWordsWithSpace(old.text, current.text)
              .filter((p) => p.added || p.removed)
              .map((p) => ({ type: p.added ? 'added' : 'removed', text: p.value }))
          : [];
      const region = {
        id: i + 1,
        bounds: box,
        before: old,
        after: current,
        textChanges: changes,
        assessment: assessRegion(worker !== undefined, changes.length > 0, old.text)
      };
      regions.push(region);
      console.log(`Region ${i + 1}: ${region.assessment}`);
      for (const change of changes) {
        console.log(`  ${change.type}: ${JSON.stringify(change.text)}`);
      }
    }
  } finally {
    await worker?.terminate();
  }

  return regions;
}

type Report = {
  before: string;
  after: string;
  changedPixels: number;
  changedPercent: number;
  regions: Awaited<ReturnType<typeof processRegions>>;
};

async function writeReport(output: string, report: Report) {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(output, 'report.md'), formatReport(report));
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
