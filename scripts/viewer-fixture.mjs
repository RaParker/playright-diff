import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { writeQuoteResult } from '../dist/quote-result.js';

export const identicalPolicy = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export const differentPolicy = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
export const failedPolicy = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
export const recheckedPolicy = 'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE';
export const unrecordedPolicy = 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF';

/**
 * Writes a plain PNG of one colour.
 * @param {string} path File to write.
 * @param {number} width Width in pixels.
 * @param {number} height Height in pixels.
 * @param {{ r: number; g: number; b: number }} background Colour.
 */
export async function writePng(path, width, height, background) {
  await sharp({ create: { width, height, channels: 3, background } })
    .png()
    .toFile(path);
}

function compared(policyDetailsId, extra = {}) {
  return {
    policyDetailsId,
    historyId: 1,
    outcome: 'compared',
    validation: false,
    issues: [],
    endpoints: { nhi: 'quote', tcas: 'quote' },
    startedAt: '2000-01-01T00:00:00.000Z',
    finishedAt: '2000-01-01T00:01:00.000Z',
    ...extra
  };
}

function region(id, before, after, bounds) {
  return {
    id,
    bounds,
    before: { text: before, confidence: 90, image: `region-${id}-nhi.png` },
    after: { text: after, confidence: 90, image: `region-${id}-mrp.png` },
    textChanges: before === after ? [] : [{ type: 'removed', text: before }],
    assessment: ''
  };
}

async function writeComparison(root, name, { changedPixels, afterHeight = 100, regions = [], images = true }) {
  const folder = join(root, name);
  await mkdir(folder, { recursive: true });
  const nhi = join(folder, 'screenshot-quote-page-nhi.png');
  const mrp = join(folder, 'screenshot-quote-page-mrp.png');
  if (images) {
    await writePng(nhi, 40, 100, { r: 255, g: 255, b: 255 });
    await writePng(mrp, 40, afterHeight, { r: 240, g: 240, b: 255 });
    await writePng(join(folder, 'diff.png'), 40, afterHeight, { r: 255, g: 0, b: 0 });
  }

  await writeFile(
    join(folder, 'report.json'),
    JSON.stringify({
      before: nhi,
      after: mrp,
      dimensions: { before: { width: 40, height: 100 }, after: { width: 40, height: afterHeight } },
      threshold: 20,
      imageScale: 1,
      changedPixels,
      changedPercent: (changedPixels / 4000) * 100,
      ocrEnabled: true,
      language: 'eng',
      regions
    })
  );
  return folder;
}

/**
 * An output folder holding one policy of each kind the viewer shows, plus the folders it must ignore.
 * @param {object} [options]
 * @param {boolean} [options.empty] Write no policies at all.
 * @returns {Promise<string>} The folder (the caller removes it).
 */
export async function viewerFixture({ empty = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'viewer-'));
  if (empty) {
    return root;
  }

  await writeComparison(root, `${identicalPolicy}-1`, { changedPixels: 0 });
  await writeQuoteResult(compared(identicalPolicy), root);

  const different = await writeComparison(root, `${differentPolicy}-1`, {
    changedPixels: 30,
    afterHeight: 120,
    regions: [
      region(1, 'Contact Us', 'Contact Us', { left: 0, top: 0, width: 40, height: 10 }),
      region(2, 'PAY ANNUALLY\n£137.63\na year', 'PAY ANNUALLY\n£137.62\na year', {
        left: 0,
        top: 50,
        width: 40,
        height: 20
      })
    ]
  });
  await writeQuoteResult(compared(differentPolicy), root);
  await writeFile(
    join(different, 'answer-changes.json'),
    JSON.stringify({
      policyDetailsId: differentPolicy,
      historyId: 1,
      changes: {
        nhi: { 'Property circumstances': [{ question: 'rebuilding cost', before: '285,000', after: '249995' }] }
      }
    })
  );

  await writeComparison(root, `${recheckedPolicy}-1`, { changedPixels: 144 });
  await writeQuoteResult(
    compared(recheckedPolicy, { coverTypeRecheck: { originalCoverType: 'C', outcome: 'matched' } }),
    root
  );

  await writeQuoteResult(
    {
      ...compared(failedPolicy),
      outcome: 'failed',
      issues: [
        'Quote capture failed; comparison skipped.',
        'NHI: Website displayed <h2>Oops</h2>; stopping the journey.'
      ]
    },
    root
  );
  await writePng(join(root, `${failedPolicy}-1`, 'screenshot-failed-nhi.png'), 40, 60, { r: 200, g: 200, b: 200 });

  await mkdir(join(root, `${unrecordedPolicy}-1`));
  await mkdir(join(root, '.ocr-cache'));
  await mkdir(join(root, 'mrp-and-quote'));
  await writeFile(join(root, 'mrp-and-quote', `${differentPolicy}-1-mrp.json`), '{}');
  await mkdir(join(different, 'api-nhi'));
  await writeFile(join(different, 'api-nhi', '001.json'), '{}');
  return root;
}
