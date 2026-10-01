import { diffWordsWithSpace } from 'diff';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';

const help = `Usage: npm run compare -- <before-image> <after-image> [options]
  -o, --output <directory>  New report directory (default: comparisons/run-<timestamp>)
  --threshold <0-255>      Ignore channel differences up to this value (default: 20)
  --language <code>        Tesseract language (default: eng)
  --no-ocr                Compare pixels without extracting text
  -h, --help              Show help
`;

async function load(path: string) {
  return sharp(path)
    .rotate()
    .flatten({ background: '#fff' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

export async function compare(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      threshold: { type: 'string', default: '20' },
      language: { type: 'string', default: 'eng' },
      'no-ocr': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    }
  });
  if (values.help === true) {
    console.log(help);
    return;
  }

  const [beforeArgument, afterArgument] = positionals;
  if (positionals.length !== 2 || beforeArgument === undefined || afterArgument === undefined) {
    throw new Error(help);
  }

  const threshold = Number(values.threshold);
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
    throw new Error('threshold must be an integer between 0 and 255.');
  }

  const paths = [resolve(beforeArgument), resolve(afterArgument)] as const;
  const [a, b] = await Promise.all([load(paths[0]), load(paths[1])]);
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

  const boxes: { left: number; top: number; width: number; height: number }[] = [];
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
  // A fresh directory prevents overwriting inputs or previous reports.
  const output =
    values.output !== undefined && values.output.length > 0
      ? resolve(values.output)
      : resolve('comparisons', `run-${Date.now()}`);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  await sharp(highlight, { raw: { width, height, channels: 3 } })
    .png()
    .toFile(join(output, 'diff.png'));
  const cachePath = resolve('comparisons', '.ocr-cache');
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  const regions = [];
  try {
    if (boxes.length > 0 && values['no-ocr'] !== true) {
      await mkdir(cachePath, { recursive: true });
      console.log('Loading local OCR (first use downloads language data)…');
      worker = await createWorker(values.language, undefined, { cachePath });
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    }

    for (const [i, box] of boxes.entries()) {
      const readings = [];
      for (const [label, source] of [
        ['before', a],
        ['after', b]
      ] as const) {
        const cropWidth = Math.min(box.width, source.info.width - box.left);
        const cropHeight = Math.min(box.height, source.info.height - box.top);
        if (cropWidth <= 0 || cropHeight <= 0) {
          readings.push({ text: '', confidence: null, image: null });
          continue;
        }

        const image = `region-${i + 1}-${label}.png`;
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
        readings.push({ text: result?.data.text.trim() ?? '', confidence: result?.data.confidence ?? null, image });
      }

      const [old, current] = readings;
      if (old === undefined || current === undefined) {
        throw new Error('Expected before and after readings for each region.');
      }

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
        assessment:
          worker === undefined
            ? 'OCR disabled'
            : changes.length > 0
              ? 'Recognized text differs'
              : old.text.length > 0
                ? 'Recognized text unchanged; visual appearance differs'
                : 'No text recognized; inspect crops'
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

  const report = {
    before: paths[0],
    after: paths[1],
    dimensions: { before: a.info, after: b.info },
    threshold,
    changedPixels,
    changedPercent: (changedPixels / (width * height)) * 100,
    ocrEnabled: values['no-ocr'] !== true,
    language: values.language,
    regions
  };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  const lines = [
    `# Image comparison`,
    '',
    `${changedPixels} changed pixels (${report.changedPercent.toFixed(2)}%). ${regions.length} regions.`,
    '',
    `Before: ${paths[0]}`,
    `After: ${paths[1]}`,
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

  await writeFile(join(output, 'report.md'), lines.join('\n'));
  console.log(
    `${changedPixels} changed pixels (${report.changedPercent.toFixed(2)}%). Report: ${join(output, 'report.md')}`
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  compare(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
